'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { resolveClaudePresets, resolveCodexPresets } = require('../src/presets');

// Load the entry point the way VS Code does, with relative requires resolved
// from its own directory.
const EXTENSION = path.join(__dirname, '..', 'src', 'extension.js');
const requireFromExtension = createRequire(EXTENSION);
const extensionSource = fs.readFileSync(EXTENSION, 'utf8');

const BACKUP = 'claudeExtensionSettingsBackup.v1';
const CODEX_BACKUP = 'codexConfigBackup.v1';
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Every test reads and writes Codex configuration inside its own home directory.
function codexHome({ config, catalog = new Map(), wsl = false, copy } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-switcher-test-'));
  process.env.CODEX_HOME = home;
  if (config !== undefined) fs.writeFileSync(path.join(home, 'config.toml'), config);
  for (const [name, content] of catalog) fs.writeFileSync(path.join(home, name), content);
  if (copy !== undefined) {
    fs.mkdirSync(path.join(home, 'backup-provider-switch'), { recursive: true });
    fs.writeFileSync(path.join(home, 'backup-provider-switch', 'config.toml'), copy);
  }
  return home;
}

async function setup({ initial = {}, trusted = true, installed = true, codexInstalled = true, overrides = {}, presets, codexPresets, rawSetting, workspacePresets, switcherSettings = {}, secret = new Map([['deepseekApiKey', 'test-secret']]), codex = {}, backupHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switcher-backup-test-')) } = {}) {
  const values = copy(initial), writes = [], commands = {}, messages = [], executed = [], events = {};
  const statusItems = [], outputLines = [];
  const home = codexHome(codex);
  process.env.PROVIDER_SWITCH_HOME = backupHome;
  const hooks = {};
  const window = {
    withProgress: async (_options, task) => {
      const original = globalThis.fetch;
      globalThis.fetch = async () => ({ ok: !hooks.keyStatus || hooks.keyStatus === 200, status: hooks.keyStatus || 200, json: async () => ({ data: [] }) });
      try { return await task(); } finally { globalThis.fetch = original; }
    },
    createOutputChannel: () => ({ appendLine: line => outputLines.push(line), dispose() {} }),
    createStatusBarItem: (id, alignment, priority) => {
      const created = { id, alignment, priority, shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
      statusItems.push(created);
      return created;
    },
    showWarningMessage: message => { messages.push(message); return hooks.warning?.(message); },
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
    window, ProgressLocation: { Notification: 15 }, StatusBarAlignment: { Left: 1, Right: 2 }, ConfigurationTarget: { Global: 1 },
    extensions: { getExtension: id => {
      assert.ok(['anthropic.claude-code', 'openai.chatgpt'].includes(id));
      if (id === 'anthropic.claude-code') return (hooks.claudeInstalled ?? installed) ? {} : undefined;
      return (hooks.codexInstalled ?? codexInstalled) ? {} : undefined;
    } },
    workspace: {
      isTrusted: trusted,
      getConfiguration: section => {
        assert.ok(['claudeCode', 'providerSwitch', 'chatgpt'].includes(section));
        if (section === 'claudeCode') return cfg;
        if (section === 'chatgpt') return { get: (name, fallback) => Object.hasOwn(switcherSettings, name) ? switcherSettings[name] : fallback };
        // One setting, one section per target.
        const setting = rawSetting ?? (presets === undefined && codexPresets === undefined ? undefined : {
          ...(presets === undefined ? {} : { claude: presets }),
          ...(codexPresets === undefined ? {} : { codex: codexPresets }),
        });
        return {
          get: (name, fallback) => name === 'presets' ? workspacePresets ?? setting ?? fallback :
            Object.hasOwn(switcherSettings, name) ? switcherSettings[name] : fallback,
          inspect: name => ({ globalValue: name === 'presets' ? setting : undefined, workspaceValue: workspacePresets }),
        };
      },
      onDidChangeConfiguration: fn => { events.config = fn; return { dispose() {} }; },
    },
    commands: {
      registerCommand: (name, fn) => { commands[name] = fn; return { dispose() {} }; },
      executeCommand: async name => executed.push(name),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(extensionSource, {
    module, require: name => name === 'vscode' ? vscode : requireFromExtension(name),
    setInterval: () => 1, clearInterval() {}, process,
  });
  await module.exports.activate({ subscriptions: [], secrets: {
    get: async key => { if (hooks.failSecret) throw new Error('test-secret'); return secret.get(key); },
    store: async (key, value) => { if (hooks.failSecret) throw new Error('test-secret'); secret.set(key, value); },
    delete: async key => secret.delete(key),
  } });
  return {
    values, writes, commands, window, events, secret, messages, executed, hooks, home, backupHome, outputLines,
    item: statusItems[0], codexItem: statusItems[1],
    read: () => fs.readFileSync(path.join(home, 'config.toml'), 'utf8'),
    env: () => Object.fromEntries((values.environmentVariables || []).map(entry => [entry.name, entry.value])),
    switch: async model => { window.showQuickPick = async () => ({ model }); await commands['provider-switch.switchModel'](); },
    switchCodex: async model => { window.showQuickPick = async () => ({ model }); await commands['provider-switch.switchCodexModel'](); },
    reset: () => commands['provider-switch.resetDeepseekApiKey'](),
    resetCodex: () => commands['provider-switch.resetCodexApiKey'](),
  };
}

test('activation is read-only and provider comes from extension settings', async () => {
  const environment = resolveClaudePresets().presets[0].environment;
  const app = await setup({ initial: { environmentVariables: Object.entries(environment).map(([name, value]) => ({ name, value })) } });
  assert.equal(app.writes.length, 0);
  assert.match(app.item.text, /DeepSeek/);
  assert.equal(app.item.color, '#a78bfa');
  app.values.environmentVariables = [];
  app.events.config({ affectsConfiguration: () => true });
  assert.match(app.item.text, /Claude/);
  assert.equal(app.item.color, '#d97706');
});

test('Claude status button follows extension availability without changing settings', async () => {
  const app = await setup({ installed: false });
  assert.equal(app.item.shown, false);
  assert.equal(app.codexItem.shown, true);
  app.hooks.claudeInstalled = true;
  await app.events.config({ affectsConfiguration: () => true });
  assert.equal(app.item.shown, true);
  assert.match(app.item.text, /^Claude:/);
  app.hooks.claudeInstalled = false;
  await app.events.config({ affectsConfiguration: () => true });
  assert.equal(app.item.shown, false);
  assert.equal(app.codexItem.shown, true);
  assert.equal(app.writes.length, 0);
});

test('Codex status button follows extension availability even with an existing configuration', async () => {
  const original = 'model = "gpt-6-astra"\n';
  const app = await setup({ codexInstalled: false, codex: { config: original } });
  assert.equal(app.codexItem.shown, false);
  assert.equal(app.item.shown, true);
  app.hooks.codexInstalled = true;
  await app.events.config({ affectsConfiguration: () => true });
  assert.equal(app.codexItem.shown, true);
  assert.match(app.codexItem.text, /^Codex:/);
  app.hooks.codexInstalled = false;
  await app.events.config({ affectsConfiguration: () => true });
  assert.equal(app.codexItem.shown, false);
  assert.equal(app.item.shown, true);
  assert.equal(app.read(), original);
  assert.equal(app.writes.length, 0);
});

test('DeepSeek configures the native chat panel and preserves unrelated settings', async () => {
  const app = await setup({ initial: { environmentVariables: [{ name: 'CUSTOM', value: 'keep' }], useTerminal: true } });
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'test-secret');
  assert.equal(app.env().ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(app.env().ANTHROPIC_MODEL, 'deepseek-flash[1m]');
  assert.equal(app.env().CLAUDE_CODE_AUTO_MODE_SERVER, '0');
  assert.equal(app.env().ANTHROPIC_API_KEY, '');
  assert.equal(app.env().CLAUDE_CODE_USE_BEDROCK, '0');
  assert.equal(app.env().CUSTOM, 'keep');
  assert.equal(app.values.disableLoginPrompt, true);
  assert.equal(app.values.useTerminal, false);
  // The previous settings are kept outside secret storage too, because an
  // uninstall clears it.
  const kept = JSON.parse(fs.readFileSync(path.join(app.backupHome, 'claude-panel.json'), 'utf8'));
  assert.deepEqual(kept.environmentVariables, [{ name: 'CUSTOM', value: 'keep' }]);
  assert.ok(app.item.text.startsWith('Claude: \u{1F433} DeepSeek'), app.item.text);
  assert.equal(app.executed.length, 0);
  assert.ok(app.secret.has(BACKUP));
});

test('the status bar names the target and keeps the DeepSeek rate compact', async () => {
  const app = await setup({ codex: { config: 'model = "gpt-6-astra"\n' } });
  await app.switch('deepseek');
  await app.switchCodex('deepseek-flash');
  // The rate depends on the clock, so only its compact shape is fixed here.
  const suffix = '( \\| (Low|High|Rate unknown))?';
  const whale = '\u{1F433}';
  assert.match(app.item.text, new RegExp(`^Claude: ${whale} DeepSeek Flash${suffix}$`));
  assert.match(app.codexItem.text, new RegExp(`^Codex: ${whale} DeepSeek Flash${suffix}$`));
  assert.ok(!/(Peak|Off-peak)/.test(app.item.text + app.codexItem.text));

  // Another endpoint keeps the rocket and gets no rate suffix at all.
  const local = await setup({ presets: { local: localPreset } });
  await local.switch('local');
  assert.equal(local.item.text, 'Claude: $(rocket) Local model');
  // Restored configurations carry the service's own mark.
  assert.equal(local.codexItem.text, 'Codex: \u{1F338} ChatGPT');
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
  await app.commands['provider-switch.switchModel']();
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
  assert.match(app.item.text, /Custom/);
  assert.match(app.messages[0], /no saved Claude configuration/);
});

const localPreset = { label: 'Local model', apiKeyEnv: 'none', environment: {
  ANTHROPIC_BASE_URL: 'http://localhost:8080', ANTHROPIC_MODEL: 'local-model', LOCAL_OPTION: 'preset-value',
} };

test('custom preset clears DeepSeek values and restores all owned variables after reload and deletion', async () => {
  const initial = { environmentVariables: [{ name: 'LOCAL_OPTION', value: 'before' }, { name: 'UNRELATED', value: 'keep' }] };
  const presets = { local: localPreset };
  const app = await setup({ initial, presets });
  await app.switch('deepseek');
  app.values.environmentVariables.find(entry => entry.name === 'LOCAL_OPTION').value = 'edited-before-local';
  await app.switch('local');
  assert.equal(app.env().ANTHROPIC_MODEL, 'local-model');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(app.env().CLAUDE_CODE_EFFORT_LEVEL, undefined);
  assert.equal(app.env().CLAUDE_CODE_AUTO_MODE_SERVER, undefined);
  assert.equal(app.env().ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
  assert.equal(app.env().LOCAL_OPTION, 'preset-value');
  assert.match(app.item.text, /Local model/);
  assert.ok(!/(Low|High|Rate unknown)/.test(app.item.text));
  await app.switch('deepseek');
  assert.equal(app.env().LOCAL_OPTION, undefined);
  const reloaded = await setup({ initial: app.values, secret: app.secret, presets: { deepseek: null } });
  await reloaded.switch('claude');
  assert.deepEqual(reloaded.env(), { LOCAL_OPTION: 'edited-before-local', UNRELATED: 'keep' });
  assert.equal(reloaded.secret.has(BACKUP), false);
});

test('preset-specific credentials and reset do not reuse another provider key', async () => {
  const presets = { other: { ...localPreset, apiKeyEnv: 'ANTHROPIC_API_KEY' } };
  const app = await setup({ presets });
  let prompts = 0;
  app.window.showInputBox = async () => { prompts++; return 'other-key'; };
  await app.switch('other');
  assert.equal(prompts, 1);
  assert.equal(app.env().ANTHROPIC_API_KEY, 'other-key');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(app.secret.get('deepseekApiKey'), 'test-secret');
  app.window.showInputBox = async () => 'replacement';
  app.window.showQuickPick = async () => ({ model: 'other' });
  await app.commands['provider-switch.resetApiKey']();
  assert.equal(app.env().ANTHROPIC_API_KEY, 'replacement');
  const other = resolveClaudePresets(presets).presets.find(preset => preset.id === 'other');
  assert.equal(app.secret.get(other.key), 'replacement');
  await app.switch('deepseek');
  await app.switch('other');
  assert.equal(app.env().ANTHROPIC_API_KEY, 'replacement');
});

test('editing an endpoint requires a new key and workspace preset overrides are ignored', async () => {
  const presets = { deepseek: { environment: { ANTHROPIC_BASE_URL: 'https://other.example' } } };
  const app = await setup({ presets });
  await app.switch('deepseek');
  assert.equal(app.writes.length, 0);
  const user = await setup({ workspacePresets: presets });
  await user.switch('deepseek');
  assert.equal(user.env().ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
});

test('the older flat preset setting still configures the panel', async () => {
  // Settings written before the sections existed held the panel presets directly.
  const app = await setup({ rawSetting: { deepseek: null, local: localPreset } });
  await app.switch('local');
  assert.equal(app.env().ANTHROPIC_BASE_URL, 'http://localhost:8080');
  assert.match(app.item.text, /Local model/);
});

test('changed preset values apply only on reselection and status reflects actual configuration', async () => {
  const presets = { deepseek: { environment: { ANTHROPIC_MODEL: 'first-model' } } };
  const app = await setup({ presets });
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_MODEL, 'first-model');
  presets.deepseek.environment.ANTHROPIC_MODEL = 'second-model';
  app.events.config({ affectsConfiguration: section => section === 'providerSwitch' });
  assert.match(app.item.text, /Custom/);
  assert.equal(app.env().ANTHROPIC_MODEL, 'first-model');
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_MODEL, 'second-model');
  assert.match(app.item.text, /DeepSeek/);
});

test('failed preset-to-preset switch restores settings and ownership backup', async () => {
  const app = await setup({ presets: { local: localPreset } });
  await app.switch('deepseek');
  const before = copy(app.values), backup = app.secret.get(BACKUP);
  app.hooks.failWrite = name => name === 'disableLoginPrompt';
  await app.switch('local');
  assert.deepEqual(app.values, before);
  assert.equal(app.secret.get(BACKUP), backup);
  app.hooks.failWrite = undefined;
  await app.switch('claude');
  assert.equal(app.values.environmentVariables, undefined);
});

test('old backups restore and invalid presets do not block restoration', async () => {
  const secret = new Map([[BACKUP, JSON.stringify({ environmentVariables: [{ name: 'ANTHROPIC_API_KEY', value: 'original' }] })]]);
  const app = await setup({ secret, presets: { deepseek: { environment: { ANTHROPIC_MODEL: 123 } } }, initial: {
    environmentVariables: [{ name: 'ANTHROPIC_BASE_URL', value: 'https://api.deepseek.com/anthropic' }],
  } });
  await app.switch('claude');
  assert.deepEqual(app.env(), { ANTHROPIC_API_KEY: 'original' });
});

test('picker lists configured presets and configure command opens settings', async () => {
  const app = await setup({ presets: { deepseek: null, local: localPreset } });
  app.window.showQuickPick = async items => {
    assert.deepEqual(Array.from(items.filter(item => item.model), item => item.model), ['claude', 'local']);
    return undefined;
  };
  await app.commands['provider-switch.switchModel']();
  assert.equal(app.writes.length, 0);
  await app.commands['provider-switch.configurePresets']();
  assert.deepEqual(app.executed, ['workbench.action.openSettings']);
});

test('restoring after multiple presets preserves an originally unset environment setting', async () => {
  const app = await setup({ presets: { local: localPreset } });
  await app.switch('deepseek');
  await app.switch('local');
  await app.switch('claude');
  assert.equal(Object.hasOwn(app.values, 'environmentVariables'), false);
});

test('partial rollback retains custom-variable ownership for recovery after reload', async () => {
  const presets = { local: localPreset };
  const app = await setup({ presets });
  await app.switch('deepseek');
  let environmentWrites = 0;
  app.hooks.failWrite = name => name === 'disableLoginPrompt' ||
    (name === 'environmentVariables' && ++environmentWrites > 1);
  await app.switch('local');
  assert.equal(app.env().LOCAL_OPTION, 'preset-value');
  assert.ok(app.secret.has(BACKUP));
  const reloaded = await setup({ initial: app.values, secret: app.secret, presets: { deepseek: null } });
  await reloaded.switch('claude');
  assert.equal(Object.hasOwn(reloaded.values, 'environmentVariables'), false);
  assert.equal(reloaded.secret.has(BACKUP), false);
});

test('presets sharing an endpoint are distinguished by their environment', async () => {
  const presets = { local: localPreset, other: { ...localPreset, label: 'Other model', environment: {
    ...localPreset.environment, ANTHROPIC_MODEL: 'other-model',
  } } };
  const app = await setup({ presets });
  await app.switch('local');
  assert.match(app.item.text, /Local model/);
  await app.switch('other');
  assert.match(app.item.text, /Other model/);
});

test('status colors update live without provider writes and clear when falling back to the theme', async () => {
  const colors = { claude: '#123456', local: '#00ff88', custom: '#aaaaaa' };
  const app = await setup({ presets: { local: localPreset }, switcherSettings: { statusBarColors: colors } });
  assert.equal(app.item.color, '#123456');
  await app.switch('deepseek');
  assert.equal(app.item.color, '#a78bfa');
  await app.switch('local');
  assert.equal(app.item.color, '#00ff88');
  const writes = app.writes.length;
  colors.local = '#ff8800';
  app.events.config({ affectsConfiguration: section => section === 'providerSwitch' });
  assert.equal(app.item.color, '#ff8800');
  colors.local = null;
  app.events.config({ affectsConfiguration: section => section === 'providerSwitch' });
  assert.equal(app.item.color, undefined);
  assert.equal(app.writes.length, writes);
  colors.local = 'invalid';
  app.events.config({ affectsConfiguration: () => true });
  assert.equal(app.item.color, undefined);
  app.values.environmentVariables.find(entry => entry.name === 'ANTHROPIC_MODEL').value = 'unmatched';
  app.events.config({ affectsConfiguration: () => true });
  assert.equal(app.item.color, '#aaaaaa');
  delete colors.custom;
  app.events.config({ affectsConfiguration: () => true });
  assert.equal(app.item.color, undefined);
  await app.switch('claude');
  assert.equal(app.item.color, '#123456');
});

test('auto-mode server setting restores its previous value and is not claimed by legacy backups', async () => {
  const initial = { environmentVariables: [{ name: 'CLAUDE_CODE_AUTO_MODE_SERVER', value: '1' }] };
  const app = await setup({ initial });
  await app.switch('deepseek');
  assert.equal(app.env().CLAUDE_CODE_AUTO_MODE_SERVER, '0');
  await app.switch('claude');
  assert.equal(app.env().CLAUDE_CODE_AUTO_MODE_SERVER, '1');

  const secret = new Map([[BACKUP, JSON.stringify({})]]);
  const legacy = await setup({ initial, secret });
  await legacy.switch('claude');
  assert.equal(legacy.env().CLAUDE_CODE_AUTO_MODE_SERVER, '1');
});

const codexFixture = `model = "gpt-6-astra"
model_reasoning_effort = "high"

service_tier = "default"
notify = [ "C:\\\\tools\\\\notify.exe", "turn-ended" ]

[projects.'c:\\users\\test\\app']
trust_level = "trusted"
`;

test('Codex preset rewrites config.toml, keeps unrelated settings, and installs the catalog', async () => {
  const app = await setup({ codex: { config: codexFixture }, secret: new Map() });
  app.window.showInputBox = async () => ' sk-codex ';
  assert.match(app.codexItem.text, /ChatGPT/);
  await app.switchCodex('deepseek-v4-pro');
  const written = app.read();
  assert.match(written, /^model = "deepseek-v4-pro"$/m);
  assert.match(written, /^model_provider = "deepseek"$/m);
  assert.match(written, /^model_catalog_json = ".*models\.json"$/m);
  assert.ok(!written.includes('service_tier'));
  assert.ok(!written.includes('gpt-6-astra'));
  assert.match(written, /\[projects\.'c:\\users\\test\\app'\]\ntrust_level = "trusted"/);
  assert.match(written, /notify = \[ "C:\\\\tools\\\\notify\.exe", "turn-ended" \]/);
  assert.match(written, /\[model_providers\.deepseek\]\nname = "deepseek"\nbase_url = "https:\/\/api\.deepseek\.com\/"\nwire_api = "responses"\nexperimental_bearer_token = "sk-codex"/);
  assert.match(written, /\[desktop\]\nenabled-reasoning-efforts = \[/);
  assert.ok(fs.existsSync(path.join(app.home, 'models.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.home, 'models.json'), 'utf8')).models.length, 2);
  assert.ok(app.secret.has(CODEX_BACKUP));
  assert.match(app.codexItem.text, /DeepSeek V4 Pro/);
  assert.equal(app.writes.length, 0);
  // Adjustments are reported without echoing removed values.
  assert.ok(app.outputLines.some(line => line.includes('Codex -> DeepSeek V4 Pro')));
  assert.ok(app.outputLines.includes('  Removed service_tier'));
  assert.ok(!app.outputLines.join('').includes('sk-codex'));
});

test('an existing Codex catalog is never overwritten and survives restore', async () => {
  const original = '{"models":[]}\n';
  const app = await setup({ codex: { config: codexFixture, catalog: new Map([['models.json', original]]) } });
  app.window.showInputBox = async () => 'sk-codex';
  await app.switchCodex('deepseek-flash');
  assert.equal(fs.readFileSync(path.join(app.home, 'models.json'), 'utf8'), original);
  await app.switchCodex('chatgpt');
  assert.equal(fs.readFileSync(path.join(app.home, 'models.json'), 'utf8'), original);
  assert.ok(!app.secret.has(CODEX_BACKUP));
  assert.equal(app.read(), codexFixture);
  assert.match(app.codexItem.text, /ChatGPT/);
});

test('Codex restore returns the exact original file and removes only its own catalog', async () => {
  const app = await setup({ codex: { config: codexFixture } });
  app.window.showInputBox = async () => 'sk-codex';
  await app.switchCodex('deepseek-flash');
  await app.switchCodex('chatgpt');
  assert.equal(app.read(), codexFixture);
  assert.ok(!fs.existsSync(path.join(app.home, 'models.json')));
  assert.ok(!app.secret.has(CODEX_BACKUP));
});

test('a copy of the original configuration is kept in both places', async () => {
  const app = await setup({ codex: { config: codexFixture }, secret: new Map() });
  app.window.showInputBox = async () => 'sk-codex';
  const copy = path.join(app.home, 'backup-provider-switch', 'config.toml');
  const central = path.join(app.backupHome, 'codex-config.toml');
  await app.switchCodex('deepseek-flash');
  assert.equal(fs.readFileSync(copy, 'utf8'), codexFixture);
  assert.equal(fs.readFileSync(central, 'utf8'), codexFixture);
  assert.ok(app.outputLines.some(line => line.includes('backup-provider-switch')));
  // Restoring keeps the copies, and the next baseline never overwrites them.
  await app.switchCodex('chatgpt');
  assert.equal(fs.readFileSync(copy, 'utf8'), codexFixture);
  assert.equal(fs.readFileSync(central, 'utf8'), codexFixture);
  fs.writeFileSync(copy, 'kept');
  fs.writeFileSync(central, 'kept too');
  await app.switchCodex('deepseek-v4-pro');
  assert.equal(fs.readFileSync(copy, 'utf8'), 'kept');
  assert.equal(fs.readFileSync(central, 'utf8'), 'kept too');

  // A machine where Codex never wrote a file has nothing to copy.
  const fresh = await setup({ secret: new Map() });
  fresh.window.showInputBox = async () => 'sk-codex';
  await fresh.switchCodex('deepseek-flash');
  assert.equal(fs.existsSync(path.join(fresh.home, 'backup-provider-switch')), false);
  assert.equal(fs.existsSync(path.join(fresh.backupHome, 'codex-config.toml')), false);
});

test('the copy is kept on activation, before anything switches', async () => {
  const app = await setup({ codex: { config: codexFixture } });
  assert.equal(fs.readFileSync(path.join(app.home, 'backup-provider-switch', 'config.toml'), 'utf8'), codexFixture);
  assert.equal(fs.readFileSync(path.join(app.backupHome, 'codex-config.toml'), 'utf8'), codexFixture);
  // Activation still writes no settings of its own.
  assert.equal(app.writes.length, 0);
  assert.match(app.codexItem.text, /ChatGPT/);

  // A Codex home without a configuration file has nothing to copy.
  const bare = await setup({ secret: new Map() });
  assert.equal(fs.existsSync(path.join(bare.home, 'backup-provider-switch')), false);
});

test('no copy is kept of a file that already selects one of our presets', async () => {
  const first = await setup({ codex: { config: codexFixture }, secret: new Map() });
  first.window.showInputBox = async () => 'sk-codex';
  await first.switchCodex('deepseek-flash');
  const app = await setup({ codex: { config: first.read() }, secret: new Map() });
  // That is this extension's own output, not the configuration Codex came with.
  assert.equal(fs.existsSync(path.join(app.home, 'backup-provider-switch')), false);
  assert.equal(fs.existsSync(path.join(app.backupHome, 'codex-config.toml')), false);
  // A configuration the user built themselves is still worth keeping a copy of.
  const own = await setup({ codex: { config: 'model = "gpt-6-astra"\nmodel_provider = "mycorp"\n\n[model_providers.mycorp]\nbase_url = "https://proxy.example/"\n' } });
  assert.ok(fs.existsSync(path.join(own.home, 'backup-provider-switch', 'config.toml')));
});

test('Codex is handed back to its own sign-in when the saved original is gone', async () => {
  const first = await setup({ codex: { config: codexFixture }, secret: new Map() });
  first.window.showInputBox = async () => 'sk-codex';
  await first.switchCodex('deepseek-flash');
  const switched = first.read();

  // A reinstall: the file still selects the preset, with no saved original left.
  const catalog = `${JSON.stringify(require('../resources/deepseek-codex-models.json'), null, 2)}\n`;
  const app = await setup({ codex: { config: switched, catalog: new Map([['models.json', catalog]]) }, secret: new Map() });
  fs.mkdirSync(path.join(app.home, 'backup-provider-switch'), { recursive: true });
  fs.writeFileSync(path.join(app.home, 'backup-provider-switch', 'config.toml'), switched);

  // Cancelling changes nothing.
  await app.switchCodex('chatgpt');
  assert.equal(app.read(), switched);
  assert.equal(app.writes.length, 0);

  app.hooks.warning = () => 'Remove the settings it wrote';
  // The panel's copy shares the folder the second Codex copy sits in, and it
  // must outlive the detach.
  fs.writeFileSync(path.join(app.backupHome, 'claude-panel.json'), '{"environmentVariables":[]}');
  await app.switchCodex('chatgpt');
  const written = app.read();
  assert.ok(!written.includes('model_provider'));
  assert.ok(!written.includes('[model_providers.deepseek]'));
  assert.ok(!written.includes('experimental_bearer_token'));
  assert.ok(!written.includes('enabled-reasoning-efforts'));
  // Everything the switcher did not write survives.
  assert.match(written, /notify = \[ "C:\\\\tools\\\\notify\.exe", "turn-ended" \]/);
  assert.match(written, /\[projects\.'c:\\users\\test\\app'\]/);
  assert.equal(fs.existsSync(path.join(app.home, 'models.json')), false);
  // The copy held the same configuration, so it was the extension's own and goes too.
  assert.equal(fs.existsSync(path.join(app.home, 'backup-provider-switch')), false);
  assert.equal(fs.existsSync(path.join(app.backupHome, 'codex-config.toml')), false);
  assert.ok(fs.existsSync(path.join(app.backupHome, 'claude-panel.json')));
  assert.match(app.codexItem.text, /ChatGPT/);
  assert.ok(app.messages.some(message => /no record of the file/.test(message)));
});

test('the panel is handed back to Claude when the saved original is gone', async () => {
  const environment = resolveClaudePresets().presets[0].environment;
  const initial = {
    environmentVariables: [{ name: 'CUSTOM', value: 'keep' }, ...Object.entries(environment).map(([name, value]) => ({ name, value }))],
    disableLoginPrompt: true, useTerminal: false,
  };
  const app = await setup({ initial, secret: new Map() });
  assert.match(app.item.text, /DeepSeek/);
  // Cancelling changes nothing.
  await app.switch('claude');
  assert.equal(app.writes.length, 0);

  app.hooks.warning = () => 'Remove the variables it wrote';
  await app.switch('claude');
  assert.deepEqual(app.env(), { CUSTOM: 'keep' });
  assert.equal(Object.hasOwn(app.values, 'disableLoginPrompt'), false);
  assert.equal(Object.hasOwn(app.values, 'useTerminal'), false);
  assert.match(app.item.text, /Claude/);
  assert.ok(app.messages.some(message => /no record of the settings/.test(message)));
});

test('a reinstall adopts the copies on disk and switches back', async () => {
  // Codex: the live file selects the preset, the original survives beside it.
  const switched = 'model = "deepseek-flash"\nmodel_provider = "deepseek"\n\n[model_providers.deepseek]\nbase_url = "https://api.deepseek.com/"\n';
  const codex = await setup({ codex: { config: switched, copy: codexFixture }, secret: new Map() });
  assert.ok(codex.outputLines.some(line => line.includes('Adopted the Codex configuration')));
  await codex.switchCodex('chatgpt');
  assert.equal(codex.read(), codexFixture);
  assert.ok(!codex.messages.some(message => /no record of the file/.test(message)));

  // Either copy is enough on its own: here only the one beside the panel's is left.
  const central = fs.mkdtempSync(path.join(os.tmpdir(), 'switcher-backup-test-'));
  fs.writeFileSync(path.join(central, 'codex-config.toml'), codexFixture);
  const alone = await setup({ backupHome: central, codex: { config: switched }, secret: new Map() });
  assert.ok(alone.outputLines.some(line => line.includes('Adopted the Codex configuration')));
  await alone.switchCodex('chatgpt');
  assert.equal(alone.read(), codexFixture);

  // The panel: the copy the previous install wrote is adopted on the next one.
  const backupHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switcher-backup-test-'));
  const before = await setup({ backupHome, initial: { environmentVariables: [{ name: 'CUSTOM', value: 'keep' }] } });
  await before.switch('deepseek');
  const panel = await setup({ backupHome, initial: before.values, secret: new Map() });
  assert.match(panel.item.text, /DeepSeek/);
  assert.ok(panel.outputLines.some(line => line.includes('Adopted the Claude Code settings')));
  await panel.switch('claude');
  assert.deepEqual(panel.env(), { CUSTOM: 'keep' });
  assert.ok(!panel.messages.some(message => /no record of the settings/.test(message)));
});

test('the copy comes from the saved original, not from the live file', async () => {
  // A configuration already switched before the copy existed: the live file holds
  // the preset, and only the saved baseline knows what the original looked like.
  const applied = 'model = "deepseek-flash"\nmodel_provider = "deepseek"\n';
  const saved = JSON.stringify({ config: codexFixture, catalogCreated: false });
  const app = await setup({ codex: { config: applied }, secret: new Map([[CODEX_BACKUP, saved]]) });
  app.window.showInputBox = async () => 'sk-codex';
  await app.switchCodex('deepseek-v4-pro');
  assert.equal(fs.readFileSync(path.join(app.home, 'backup-provider-switch', 'config.toml'), 'utf8'), codexFixture);
  // The live file is the switched configuration; only the copy is the original.
  assert.match(app.read(), /^model = "deepseek-v4-pro"$/m);
  assert.notEqual(app.read(), codexFixture);
});

test('Codex guards prevent writes and report once', async () => {
  const untrusted = await setup({ trusted: false, codex: { config: codexFixture } });
  await untrusted.switchCodex('deepseek-flash');
  assert.equal(untrusted.read(), codexFixture);
  assert.equal(untrusted.messages.length, 1);

  const missing = await setup({ codex: { config: codexFixture } });
  process.env.CODEX_HOME = path.join(missing.home, 'does-not-exist');
  await missing.switchCodex('deepseek-flash');
  assert.match(missing.messages[0], /has not created its configuration directory/);

  const wsl = await setup({ codex: { config: codexFixture }, switcherSettings: { runCodexInWindowsSubsystemForLinux: true } });
  await wsl.switchCodex('deepseek-flash');
  assert.equal(wsl.read(), codexFixture);
  assert.match(wsl.messages[0], /inside WSL/);

  // A machine that never ran Codex gets no Codex status entry.
  const absent = await setup({ codexInstalled: false });
  assert.equal(absent.codexItem.shown, false);
});

test('cancelled Codex key entry leaves the configuration and secrets untouched', async () => {
  const app = await setup({ codex: { config: codexFixture }, secret: new Map() });
  await app.switchCodex('deepseek-flash');
  assert.equal(app.read(), codexFixture);
  assert.ok(!app.secret.has(CODEX_BACKUP));
  assert.equal(fs.existsSync(path.join(app.home, 'models.json')), false);
});

test('failed Codex write rolls back the catalog and the ownership backup', async () => {
  const app = await setup({ codex: { config: codexFixture } });
  app.window.showInputBox = async () => 'sk-codex';
  const promises = require('node:fs/promises');
  const real = promises.writeFile;
  promises.writeFile = async () => { throw new Error('test-secret'); };
  try { await app.switchCodex('deepseek-flash'); }
  finally { promises.writeFile = real; }
  assert.equal(app.read(), codexFixture);
  assert.ok(!app.secret.has(CODEX_BACKUP));
  assert.equal(fs.existsSync(path.join(app.home, 'models.json')), false);
  assert.ok(!app.messages.join('').includes('test-secret'));
});

test('Codex preset-to-preset switching reuses the key and the original backup', async () => {
  const app = await setup({ codex: { config: codexFixture }, secret: new Map() });
  let prompts = 0;
  app.window.showInputBox = async () => { prompts += 1; return 'sk-codex'; };
  await app.switchCodex('deepseek-flash');
  const backup = app.secret.get(CODEX_BACKUP);
  await app.switchCodex('deepseek-v4-pro');
  assert.equal(prompts, 1);
  assert.equal(app.secret.get(CODEX_BACKUP), backup);
  const written = app.read();
  assert.equal(written.match(/\[model_providers\.deepseek\]/g).length, 1);
  assert.equal(written.match(/^model = /gm).length, 1);
  assert.equal(written.match(/^\[desktop\]$/gm).length, 1);
  assert.match(written, /^model = "deepseek-v4-pro"$/m);
  // Both DeepSeek presets share the key stored for the endpoint.
  const flash = resolveCodexPresets().presets.find(preset => preset.id === 'deepseek-flash');
  assert.equal(flash.key, 'deepseekApiKey');
  assert.equal(app.secret.get(flash.key), 'sk-codex');
});

test('Codex key reset replaces the shared key and refreshes the live configuration', async () => {
  const app = await setup({ codex: { config: codexFixture }, secret: new Map() });
  app.window.showInputBox = async () => 'sk-first';
  await app.switchCodex('deepseek-flash');
  assert.match(app.read(), /experimental_bearer_token = "sk-first"/);
  // The picker chooses deepseek-v4-pro, but both DeepSeek presets share one key,
  // so the configuration that is live keeps working after the replacement.
  app.window.showQuickPick = async () => ({ model: 'deepseek-v4-pro' });
  app.window.showInputBox = async () => 'sk-replaced';
  await app.commands['provider-switch.resetCodexApiKey']();
  const pro = resolveCodexPresets().presets.find(preset => preset.id === 'deepseek-v4-pro');
  assert.equal(app.secret.get(pro.key), 'sk-replaced');
  assert.match(app.read(), /experimental_bearer_token = "sk-replaced"/);
  assert.equal(app.read().match(/^model = "deepseek-flash"$/m).length, 1);
});

test('a key for a preset on another endpoint waits for the next switch', async () => {
  const local = { label: 'Local', model: 'qwen3', provider: 'local', baseUrl: 'http://localhost:9999/v1', apiKey: true };
  const app = await setup({ codex: { config: codexFixture }, codexPresets: { local }, secret: new Map() });
  app.window.showInputBox = async () => 'sk-codex';
  await app.switchCodex('deepseek-flash');
  app.window.showQuickPick = async () => ({ model: 'local' });
  app.window.showInputBox = async () => 'sk-local';
  await app.commands['provider-switch.resetCodexApiKey']();
  assert.equal(app.secret.get('apiKey:http://localhost:9999'), 'sk-local');
  // The endpoint in use is untouched, and the key is waiting for the next switch.
  assert.match(app.read(), /experimental_bearer_token = "sk-codex"/);
  assert.ok(app.messages.some(message => /saved for the next Codex switch/.test(message)));
});

test('a DeepSeek key entered once serves the panel and Codex', async () => {
  const app = await setup({ codex: { config: codexFixture }, secret: new Map() });
  let prompts = 0;
  app.window.showInputBox = async () => { prompts += 1; return 'sk-shared'; };
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'sk-shared');
  await app.switchCodex('deepseek-v4-pro');
  // Same endpoint, so the Codex side reuses the panel's key without asking.
  assert.equal(prompts, 1);
  assert.match(app.read(), /experimental_bearer_token = "sk-shared"/);
  assert.equal(app.secret.get('deepseekApiKey'), 'sk-shared');
});

test('a panel key saved under the older per-preset name is adopted', async () => {
  const presets = { second: { label: 'Second', environment: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' } } };
  const legacy = 'presetApiKey:["second","https://api.deepseek.com/anthropic","ANTHROPIC_AUTH_TOKEN"]';
  const app = await setup({ presets, secret: new Map([[legacy, 'sk-panel']]) });
  let prompts = 0;
  app.window.showInputBox = async () => { prompts += 1; return 'sk-new'; };
  await app.switch('second');
  assert.equal(prompts, 0);
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'sk-panel');
  assert.equal(app.secret.get('deepseekApiKey'), 'sk-panel');
  assert.equal(app.secret.has(legacy), false);
});

test('keys saved under the older per-target names are adopted once', async () => {
  const legacy = 'codexApiKey:["deepseek","https://api.deepseek.com"]';
  const app = await setup({ codex: { config: codexFixture }, secret: new Map([[legacy, 'sk-old']]) });
  let prompts = 0;
  app.window.showInputBox = async () => { prompts += 1; return 'sk-new'; };
  await app.switchCodex('deepseek-flash');
  assert.equal(prompts, 0);
  assert.match(app.read(), /experimental_bearer_token = "sk-old"/);
  assert.equal(app.secret.get('deepseekApiKey'), 'sk-old');
  assert.equal(app.secret.has(legacy), false);
});

test('Codex switches and restores without Claude Code installed', async () => {
  const manifest = require('../package.json');
  assert.ok(!(manifest.extensionDependencies || []).includes('anthropic.claude-code'));
  const app = await setup({ installed: false, codex: { config: codexFixture } });
  await app.switchCodex('deepseek-flash');
  assert.match(app.read(), /model = "deepseek-flash"/);
  assert.match(app.codexItem.text, /DeepSeek Flash/);
  assert.equal(app.writes.length, 0);
  await app.switchCodex('chatgpt');
  assert.equal(app.read(), codexFixture);
  assert.equal(app.writes.length, 0);
  assert.ok(!app.messages.some(message => /Install and enable Claude Code/.test(message)));
});

test('Codex state is read from the file and stays independent of the Claude panel', async () => {
  const app = await setup({ codex: { config: codexFixture } });
  app.window.showInputBox = async () => 'sk-codex';
  await app.switchCodex('deepseek-flash');
  // A Codex switch never touches Claude Code settings.
  assert.equal(app.writes.length, 0);
  await app.switch('deepseek');
  assert.match(app.item.text, /DeepSeek/);
  assert.match(app.codexItem.text, /DeepSeek Flash/);
  fs.writeFileSync(path.join(app.home, 'config.toml'), app.read().replace('https://api.deepseek.com/', 'https://proxy.example/'));
  await app.events.config({ affectsConfiguration: () => true });
  assert.match(app.codexItem.text, /Custom/);
  fs.writeFileSync(path.join(app.home, 'config.toml'), 'model = "gpt-6-astra"\n');
  await app.events.config({ affectsConfiguration: () => true });
  assert.match(app.codexItem.text, /ChatGPT/);
});

test('Kimi shares one key across Claude and Codex and clears its variables on switching away', async () => {
  const app = await setup({ initial: { environmentVariables: [{ name: 'KEEP', value: 'yes' }] }, codex: { config: codexFixture } });
  let prompts = 0;
  app.window.showInputBox = async () => { prompts++; return 'kimi-test-key'; };
  await app.switch('kimi');
  assert.equal(app.env().ANTHROPIC_API_KEY, 'kimi-test-key');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(app.env().ANTHROPIC_DEFAULT_FABLE_MODEL, 'k3-256k');
  assert.equal(app.env().CLAUDE_CODE_MAX_CONTEXT_TOKENS, '262144');
  assert.match(app.item.text, /Kimi K3 256K/);
  assert.ok(!app.item.text.includes(' | '));
  await app.switchCodex('kimi');
  assert.equal(prompts, 1);
  assert.match(app.read(), /^model_provider = "kimi"$/m);
  assert.match(app.read(), /experimental_bearer_token = "kimi-test-key"/);
  assert.match(app.codexItem.text, /Kimi K3 256K/);
  const catalog = JSON.parse(fs.readFileSync(path.join(app.home, 'provider-switch-kimi-models.json'), 'utf8'));
  assert.deepEqual(catalog.models.map(model => model.slug), ['k3', 'k3-256k']);
  assert.deepEqual(catalog.models[1].supported_reasoning_levels.map(level => level.effort), ['low', 'high', 'max']);
  await app.switch('kimi-k3');
  await app.switchCodex('kimi-k3');
  assert.equal(prompts, 1);
  assert.equal(app.env().ANTHROPIC_MODEL, 'k3[1m]');
  assert.match(app.read(), /^model = "k3"$/m);
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_API_KEY, '');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'test-secret');
  assert.equal(app.env().ANTHROPIC_DEFAULT_FABLE_MODEL, undefined);
  assert.equal(app.env().CLAUDE_CODE_MAX_CONTEXT_TOKENS, undefined);
  await app.switchCodex('deepseek-flash');
  assert.match(app.read(), /^web_search = "disabled"$/m);
  await app.switch('claude');
  await app.switchCodex('chatgpt');
  assert.deepEqual(app.values.environmentVariables, [{ name: 'KEEP', value: 'yes' }]);
  assert.equal(app.read(), codexFixture);
  assert.equal(fs.existsSync(path.join(app.home, 'provider-switch-kimi-models.json')), false);
  assert.equal(fs.existsSync(path.join(app.home, 'models.json')), false);
});

test('Kimi leaves existing Codex catalogs untouched and restores the original configuration', async () => {
  const originalCatalog = '{"models":[{"slug":"custom-model"}]}';
  const app = await setup({ codex: { config: codexFixture, catalog: new Map([['models.json', originalCatalog]]) } });
  app.window.showInputBox = async () => 'kimi-test-key';
  await app.switchCodex('kimi');
  assert.match(app.read(), /model_catalog_json = ".*provider-switch-kimi-models.json"/);
  assert.equal(fs.readFileSync(path.join(app.home, 'models.json'), 'utf8'), originalCatalog);
  await app.switchCodex('chatgpt');
  assert.equal(app.read(), codexFixture);
  assert.equal(fs.readFileSync(path.join(app.home, 'models.json'), 'utf8'), originalCatalog);
});

test('Kimi catalog collisions leave user files and configuration untouched', async () => {
  const app = await setup({ codex: { config: codexFixture, catalog: new Map([['provider-switch-kimi-models.json', 'user content']]) } });
  app.window.showInputBox = async () => 'kimi-test-key';
  await app.switchCodex('kimi');
  assert.equal(app.read(), codexFixture);
  assert.equal(fs.readFileSync(path.join(app.home, 'provider-switch-kimi-models.json'), 'utf8'), 'user content');
  assert.equal(app.secret.has(CODEX_BACKUP), false);
  assert.ok(app.messages.some(message => message.includes('Could not update')));
  assert.ok(!app.messages.join('').includes('kimi-test-key'));
});

test('Kimi backup adoption survives reinstall and preserves a subsequently edited catalog', async () => {
  const app = await setup({ codex: { config: codexFixture } });
  app.window.showInputBox = async () => 'kimi-test-key';
  await app.switchCodex('kimi');
  const catalog = fs.readFileSync(path.join(app.home, 'provider-switch-kimi-models.json'), 'utf8');
  const reinstalled = await setup({ secret: new Map(), backupHome: app.backupHome,
    codex: { config: app.read(), catalog: new Map([['provider-switch-kimi-models.json', catalog]]) } });
  assert.equal(JSON.parse(reinstalled.secret.get(CODEX_BACKUP)).kimiCatalogCreated, true);
  fs.writeFileSync(path.join(reinstalled.home, 'provider-switch-kimi-models.json'), 'user edited');
  await reinstalled.switchCodex('chatgpt');
  assert.equal(reinstalled.read(), codexFixture);
  assert.equal(fs.readFileSync(path.join(reinstalled.home, 'provider-switch-kimi-models.json'), 'utf8'), 'user edited');
});

test('Claude DeepSeek Pro uses Pro for every model role and reuses the Flash key', async () => {
  const app = await setup();
  app.window.showInputBox = async () => { throw new Error('Must reuse the DeepSeek key'); };
  await app.switch('deepseek-v4-pro');
  for (const name of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL']) {
    assert.equal(app.env()[name], 'deepseek-v4-pro[1m]');
  }
  assert.equal(app.env().ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-v4-pro');
  assert.equal(app.env().CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-v4-pro');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'test-secret');
  assert.match(app.item.text, /DeepSeek V4 Pro/);
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_MODEL, 'deepseek-flash[1m]');
  assert.match(app.item.text, /DeepSeek Flash/);
  await app.switch('claude');
  assert.equal(app.values.environmentVariables, undefined);
});

test('status buttons share placement and visibility settings update independently without disabling commands', async () => {
  const settings = { showClaudeStatusBar: false, showCodexStatusBar: false };
  const app = await setup({ switcherSettings: settings });
  assert.equal(app.item.shown, false);
  assert.equal(app.codexItem.shown, false);
  assert.equal(app.item.alignment, app.codexItem.alignment);
  assert.equal(app.item.priority, app.codexItem.priority);
  assert.notEqual(app.item.command, app.codexItem.command);
  await app.switch('deepseek');
  assert.equal(app.env().ANTHROPIC_AUTH_TOKEN, 'test-secret');
  assert.equal(app.item.shown, false);
  settings.showClaudeStatusBar = true;
  await app.events.config({ affectsConfiguration: name => name === 'providerSwitch' });
  assert.equal(app.item.shown, true);
  assert.equal(app.codexItem.shown, false);
  settings.showClaudeStatusBar = false;
  settings.showCodexStatusBar = true;
  await app.events.config({ affectsConfiguration: name => name === 'providerSwitch' });
  assert.equal(app.item.shown, false);
  assert.equal(app.codexItem.shown, true);
  app.hooks.codexInstalled = false;
  await app.events.config({ affectsConfiguration: name => name === 'providerSwitch' });
  assert.equal(app.codexItem.shown, false);
});

for (const target of ['claude', 'codex']) {
  test(`${target} rejected replacement leaves saved key and configuration unchanged`, async () => {
    const app = await setup();
    app.hooks.keyStatus = 401;
    app.window.showInputBox = async () => 'bad-key';
    app.window.showQuickPick = async () => ({ model: target === 'claude' ? 'deepseek' : 'deepseek-flash' });
    await app.commands[target === 'claude' ? 'provider-switch.resetApiKey' : 'provider-switch.resetCodexApiKey']();
    assert.equal(app.secret.get('deepseekApiKey'), 'test-secret');
    assert.equal(app.writes.length, 0);
    assert.ok(app.messages.some(message => message.includes('Key not saved')));
  });
}
test('inconclusive check requires explicit save without verification', async () => {
  const app = await setup();
  app.hooks.keyStatus = 429;
  app.window.showInputBox = async () => 'replacement';
  await app.commands['provider-switch.resetApiKey']();
  assert.equal(app.secret.get('deepseekApiKey'), 'test-secret');
  app.hooks.warning = () => 'Save Without Verification';
  await app.commands['provider-switch.resetApiKey']();
  assert.equal(app.secret.get('deepseekApiKey'), 'replacement');
  assert.ok(app.messages.some(message => message.includes('saved without verification')));
});

for (const target of ['claude', 'codex']) {
  test(`${target} picker reconnects Kimi with a replacement key`, async () => {
    const app = await setup();
    app.window.showInputBox = async () => 'old-kimi-key';
    await (target === 'claude' ? app.switch('kimi') : app.switchCodex('kimi'));
    app.window.showInputBox = async () => 'new-kimi-key';
    let step = 0;
    app.window.showQuickPick = async items => {
      if (step++ === 0) {
        assert.ok(items.some(item => item.label === 'K Kimi K3 256K'));
        return items.find(item => item.action === 'reconnect');
      }
      return items.find(item => item.model === 'kimi');
    };
    await app.commands[target === 'claude' ? 'provider-switch.switchModel' : 'provider-switch.switchCodexModel']();
    assert.equal(app.secret.get('apiKey:https://api.kimi.ai'), 'new-kimi-key');
    if (target === 'claude') assert.equal(app.env().ANTHROPIC_API_KEY, 'new-kimi-key');
    else assert.match(app.read(), /experimental_bearer_token = "new-kimi-key"/);
    // Selecting the provider afterwards reuses the replacement.
    await (target === 'claude' ? app.switch('kimi') : app.switchCodex('kimi'));
    assert.match(target === 'claude' ? app.item.text : app.codexItem.text, /: K Kimi/);
    assert.ok(app.messages.some(message => message.includes('Connection check passed')));
  });
}
