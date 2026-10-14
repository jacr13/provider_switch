'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const BACKUP = 'claudeExtensionSettingsBackup.v1';
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

async function setup({ initial = {}, trusted = true, installed = true, overrides = {}, secret = new Map([['deepseekApiKey', 'test-secret']]) } = {}) {
  const values = copy(initial), writes = [], commands = {}, messages = [], executed = [], events = {};
  const item = { show() {}, dispose() {} };
  const hooks = {};
  const window = {
    createStatusBarItem: () => item,
    showWarningMessage: message => messages.push(message),
    showInformationMessage: async message => { messages.push(message); return hooks.reload ? 'Reload Window' : undefined; },
    showErrorMessage: message => messages.push(message),
    showInputBox: async () => undefined,
    showQuickPick: async () => ({ model: 'deepseek' }),
    createTerminal: () => { throw new Error('Must never create a terminal'); },
  };
  const cfg = {
    get: (name, fallback) => overrides[name] ?? values[name] ?? fallback,
    inspect: name => ({ globalValue: copy(values[name]), workspaceValue: overrides[name] }),
    update: async (name, value, target) => {
      assert.equal(target, 1);
      if (hooks.failWrite?.(name, value)) throw new Error('Failure with test-secret');
      writes.push({ name, value: copy(value) });
      if (value === undefined) delete values[name]; else values[name] = copy(value);
      events.config?.({ affectsConfiguration: () => true });
    },
  };
  const vscode = {
    window, StatusBarAlignment: { Left: 1, Right: 2 }, ConfigurationTarget: { Global: 1 },
    extensions: { getExtension: id => { assert.equal(id, 'anthropic.claude-code'); return installed ? {} : undefined; } },
    workspace: {
      isTrusted: trusted,
      getConfiguration: section => {
        assert.ok(['claudeCode', 'claudeDeepseekSwitcher'].includes(section));
        return section === 'claudeCode' ? cfg : { get: () => undefined };
      },
      onDidChangeConfiguration: fn => { events.config = fn; return { dispose() {} }; },
    },
    commands: {
      registerCommand: (name, fn) => { commands[name] = fn; return { dispose() {} }; },
      executeCommand: async name => executed.push(name),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('extension.js', 'utf8'), {
    module, require: name => name === 'vscode' ? vscode : require(name),
    setInterval: () => 1, clearInterval() {},
  });
  await module.exports.activate({ subscriptions: [], secrets: {
    get: async key => { if (hooks.failSecret) throw new Error('test-secret'); return secret.get(key); },
    store: async (key, value) => { if (hooks.failSecret) throw new Error('test-secret'); secret.set(key, value); },
    delete: async key => secret.delete(key),
  } });
  return {
    values, writes, commands, window, item, events, secret, messages, executed, hooks,
    env: () => Object.fromEntries((values.environmentVariables || []).map(entry => [entry.name, entry.value])),
    switch: async model => { window.showQuickPick = async () => ({ model }); await commands['claude-deepseek-switcher.switchModel'](); },
    reset: () => commands['claude-deepseek-switcher.resetDeepseekApiKey'](),
  };
}

test('activation is read-only and provider comes from extension settings', async () => {
  const app = await setup({ initial: { environmentVariables: [{ name: 'ANTHROPIC_BASE_URL', value: 'https://api.deepseek.com/anthropic' }] } });
  assert.equal(app.writes.length, 0);
  assert.match(app.item.text, /DeepSeek/);
  app.values.environmentVariables = [];
  app.events.config({ affectsConfiguration: () => true });
  assert.match(app.item.text, /Claude/);
});

test('DeepSeek configures the native chat panel and preserves unrelated settings', async () => {
  const app = await setup({ initial: { environmentVariables: [{ name: 'CUSTOM', value: 'keep' }], useTerminal: true } });
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'test-secret');
  assert.equal(app.env().ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(app.env().ANTHROPIC_MODEL, 'deepseek-flash[1m]');
  assert.equal(app.env().ANTHROPIC_API_KEY, '');
  assert.equal(app.env().CLAUDE_CODE_USE_BEDROCK, '0');
  assert.equal(app.env().CUSTOM, 'keep');
  assert.equal(app.values.disableLoginPrompt, true);
  assert.equal(app.values.useTerminal, false);
  assert.match(app.item.text, /DeepSeek/);
  assert.equal(app.executed.length, 0);
  assert.ok(app.secret.has(BACKUP));
});

test('Claude restores credentials and login settings, retaining unrelated edits', async () => {
  const app = await setup({ initial: {
    environmentVariables: [{ name: 'ANTHROPIC_API_KEY', value: 'original-key' }, { name: 'CUSTOM', value: 'before' }],
    disableLoginPrompt: false,
  } });
  await app.switch('deepseek');
  app.values.environmentVariables.find(entry => entry.name === 'CUSTOM').value = 'after';
  app.values.environmentVariables.push({ name: 'NEW', value: 'keep' });
  await app.switch('claude');
  assert.deepEqual(app.env(), { CUSTOM: 'after', NEW: 'keep', ANTHROPIC_API_KEY: 'original-key' });
  assert.equal(app.values.disableLoginPrompt, false);
  assert.equal(app.values.useTerminal, false);
  assert.equal(app.secret.has(BACKUP), false);
  assert.match(app.item.text, /Claude/);
});

test('backup survives extension reload and repeated DeepSeek selection', async () => {
  const first = await setup();
  await first.switch('deepseek');
  const backup = first.secret.get(BACKUP);
  const second = await setup({ initial: first.values, secret: first.secret });
  await second.switch('deepseek');
  assert.equal(second.secret.get(BACKUP), backup);
  await second.switch('claude');
  assert.equal(Object.hasOwn(second.values, 'environmentVariables'), false);
  assert.equal(Object.hasOwn(second.values, 'disableLoginPrompt'), false);
});

test('cancelled picker, key entry, and replacement leave configuration untouched', async () => {
  const app = await setup({ secret: new Map() });
  app.window.showQuickPick = async () => undefined;
  await app.commands['claude-deepseek-switcher.switchModel']();
  await app.switch('deepseek');
  assert.equal(app.writes.length, 0);
  assert.equal(app.secret.has(BACKUP), false);
  app.secret.set('deepseekApiKey', 'keep');
  await app.reset();
  assert.equal(app.secret.get('deepseekApiKey'), 'keep');
  assert.equal(app.writes.length, 0);
});

test('key replacement updates active DeepSeek settings and retains original backup', async () => {
  const app = await setup();
  await app.switch('deepseek');
  const backup = app.secret.get(BACKUP);
  app.window.showInputBox = async () => ' new-key ';
  await app.reset();
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'new-key');
  assert.equal(app.secret.get('deepseekApiKey'), 'new-key');
  assert.equal(app.secret.get(BACKUP), backup);
});

test('key replacement while Claude is selected does not switch providers', async () => {
  const app = await setup();
  app.window.showInputBox = async () => 'new-key';
  await app.reset();
  assert.equal(app.writes.length, 0);
  assert.equal(app.secret.get('deepseekApiKey'), 'new-key');
});

test('untrusted workspaces, missing Claude, overrides, and wrappers prevent writes', async () => {
  for (const options of [
    { trusted: false }, { installed: false }, { overrides: { useTerminal: true } },
    { overrides: { environmentVariables: [] } }, { initial: { claudeProcessWrapper: 'custom-wrapper' } },
  ]) {
    const app = await setup(options);
    await app.switch('deepseek');
    assert.equal(app.writes.length, 0);
    assert.equal(app.secret.has(BACKUP), false);
    assert.equal(app.messages.length, 1);
  }
});

test('failed configuration rolls back without leaving a stale backup or exposing secrets', async () => {
  const initial = { environmentVariables: [{ name: 'CUSTOM', value: 'keep' }] };
  const app = await setup({ initial });
  app.hooks.failWrite = name => name === 'disableLoginPrompt';
  await app.switch('deepseek');
  assert.deepEqual(app.values, initial);
  assert.equal(app.secret.has(BACKUP), false);
  assert.ok(!app.messages.join('').includes('test-secret'));
  assert.match(app.item.text, /Claude/);
  app.hooks.failWrite = undefined;
  await app.switch('claude');
  assert.equal(app.secret.has(BACKUP), false);
});

test('secret storage failure cannot prevent activation or write configuration', async () => {
  const app = await setup();
  app.hooks.failSecret = true;
  await app.switch('deepseek');
  assert.equal(app.writes.length, 0);
  assert.match(app.item.text, /Claude/);
  assert.ok(!app.messages.join('').includes('test-secret'));
});

test('reload occurs only when user selects Reload Window', async () => {
  const app = await setup();
  app.hooks.reload = true;
  await app.switch('deepseek');
  assert.deepEqual(app.executed, ['workbench.action.reloadWindow']);
});

test('external provider without a backup is not erased or mislabeled as Claude', async () => {
  const app = await setup({ initial: { environmentVariables: [{ name: 'ANTHROPIC_BASE_URL', value: 'https://custom.example' }] } });
  await app.switch('claude');
  assert.equal(app.writes.length, 0);
  assert.match(app.item.text, /Custom provider/);
  assert.match(app.messages[0], /no saved Claude configuration/);
});
