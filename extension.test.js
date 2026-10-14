'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function setup({ legacy = {}, trusted = true } = {}) {
  const writes = [], created = [], commands = {}, events = {}, messages = [];
  const secret = new Map([['deepseekApiKey', 'test-secret']]);
  const item = { show() {}, dispose() {} };
  const window = {
    activeTerminal: undefined,
    createStatusBarItem: () => item,
    showWarningMessage: message => messages.push(message),
    showInformationMessage: message => messages.push(message),
    showErrorMessage: message => messages.push(message),
    showInputBox: async () => undefined,
    showQuickPick: async () => ({ model: 'deepseek' }),
    onDidChangeActiveTerminal: fn => { events.active = fn; return { dispose() {} }; },
    onDidCloseTerminal: fn => { events.close = fn; return { dispose() {} }; },
    createTerminal: options => {
      const terminal = { options, show() { window.activeTerminal = terminal; events.active(); } };
      created.push(terminal); return terminal;
    },
  };
  const vscode = {
    window, StatusBarAlignment: { Left: 1, Right: 2 }, ConfigurationTarget: { Global: 1 },
    workspace: { isTrusted: trusted, getConfiguration: () => ({
      get: () => undefined,
      inspect: name => ({ globalValue: legacy[name] }),
      update: async (name, value) => writes.push({ name, value }),
    }) },
    commands: { registerCommand: (name, fn) => { commands[name] = fn; return { dispose() {} }; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('extension.js', 'utf8'), {
    module, require: name => name === 'vscode' ? vscode : require(name),
    setInterval: () => 1, clearInterval() {},
  });
  await module.exports.activate({ subscriptions: [], secrets: {
    get: async key => secret.get(key), store: async (key, value) => secret.set(key, value),
  } });
  return { writes, created, commands, window, item, events, secret, messages };
}

test('key only enters dedicated transient terminal; settings never receive it', async () => {
  const app = await setup();
  await app.commands['claude-deepseek-switcher.switchModel']();
  assert.equal(app.created.length, 1);
  assert.equal(app.created[0].options.env.ANTHROPIC_AUTH_TOKEN, 'test-secret');
  assert.equal(app.created[0].options.isTransient, true);
  assert.equal(app.writes.length, 0);
  assert.match(app.item.text, /DeepSeek/);
  app.window.showQuickPick = async () => ({ model: 'claude' });
  await app.commands['claude-deepseek-switcher.switchModel']();
  assert.equal(app.created.length, 2);
  assert.equal(app.created[1].options.env.ANTHROPIC_AUTH_TOKEN, null);
  assert.equal(app.created[1].options.env.ANTHROPIC_BASE_URL, null);
  app.window.activeTerminal = undefined; app.events.active();
  assert.match(app.item.text, /AI terminal/);
});

test('migration removes identified plaintext secrets while preserving unrelated settings', async () => {
  const app = await setup({ legacy: { 'terminal.integrated.env.windows': {
    ANTHROPIC_AUTH_TOKEN: 'test-secret', ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]', CUSTOM: 'keep', CLAUDE_CODE_EFFORT_LEVEL: 'custom',
  } } });
  assert.equal(app.writes.length, 1);
  assert.equal(JSON.stringify(app.writes[0].value), JSON.stringify({ CUSTOM: 'keep', CLAUDE_CODE_EFFORT_LEVEL: 'custom' }));
});

test('unrelated credentials and configuration are preserved', async () => {
  const app = await setup({ legacy: { 'terminal.integrated.env.windows': {
    ANTHROPIC_AUTH_TOKEN: 'other-secret', ANTHROPIC_BASE_URL: 'https://example.com',
  } } });
  assert.equal(app.writes.length, 0);
});

test('cancelled key replacement preserves the saved key', async () => {
  const app = await setup();
  await app.commands['claude-deepseek-switcher.resetDeepseekApiKey']();
  assert.equal(app.secret.get('deepseekApiKey'), 'test-secret');
  assert.equal(app.created.length, 0);
});

test('untrusted workspace cannot open a credential-bearing terminal', async () => {
  const app = await setup({ trusted: false });
  await app.commands['claude-deepseek-switcher.switchModel']();
  assert.equal(app.created.length, 0);
});

test('creation failure leaves status neutral and does not expose error details', async () => {
  const app = await setup();
  app.window.createTerminal = () => { throw new Error('test-secret'); };
  await app.commands['claude-deepseek-switcher.switchModel']();
  assert.match(app.item.text, /AI terminal/);
  assert.ok(!app.messages.join('').includes('test-secret'));
});
