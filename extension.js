'use strict';

const vscode = require('vscode');
const { exec } = require('child_process');
const { getDeepseekRate } = require('./deepseek-rate');

const CLAUDE_CODE_INSTALL_URL = 'https://docs.anthropic.com/en/docs/claude-code/getting-started';

const DEEPSEEK_ENV = {
  ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
  ANTHROPIC_MODEL: 'deepseek-flash[1m]',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash[1m]',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
  CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
  CLAUDE_CODE_EFFORT_LEVEL: 'max',
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432',
};

const MANAGED_ENV_KEYS = [...Object.keys(DEEPSEEK_ENV), 'ANTHROPIC_AUTH_TOKEN'];

const MANAGED_COLOR_TOKENS = [
  'statusBar.background',
  'statusBar.foreground',
  'statusBar.hoverBackground',
];
const MODEL_COLORS = {
  claude: {
    'statusBar.background': '#d97706',
    'statusBar.foreground': '#ffffff',
    'statusBar.hoverBackground': '#b45309',
  },
  deepseek: {
    'statusBar.background': '#7c3aed',
    'statusBar.foreground': '#ffffff',
    'statusBar.hoverBackground': '#6d28d9',
  },
};

const PLATFORM_ENV_KEY = {
  darwin: 'terminal.integrated.env.osx',
  linux: 'terminal.integrated.env.linux',
  win32: 'terminal.integrated.env.windows',
};

let statusBarItem;
let secrets;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function terminalEnvKey() {
  return PLATFORM_ENV_KEY[process.platform] ?? 'terminal.integrated.env.linux';
}

function getTerminalEnv() {
  return { ...(vscode.workspace.getConfiguration().get(terminalEnvKey()) ?? {}) };
}

async function setTerminalEnv(env) {
  await vscode.workspace.getConfiguration().update(
    terminalEnvKey(), env, vscode.ConfigurationTarget.Global
  );
}

function currentModel() {
  return vscode.workspace.getConfiguration('claudeDeepseekSwitcher').get('currentModel');
}

function updateStatusBar(model) {
  const labels = { claude: '$(sparkle) Claude', deepseek: '$(rocket) Deepseek' };
  statusBarItem.text = labels[model] ?? model;
  statusBarItem.tooltip = `Active model: ${model} — click to switch`;
  if (model === 'deepseek') {
    const rate = getDeepseekRate();
    const rateLabel = { peak: 'Peak', 'off-peak': 'Off-peak (50%)', unknown: 'Rate unknown' }[rate];
    statusBarItem.text += ` | ${rateLabel}`;
    statusBarItem.tooltip += '\nPeak: Mon-Fri 01:00-04:00 and 06:00-10:00 UTC, excluding Chinese public holidays.\nOff-peak: 50% of peak rates. Holiday calendar: 2026.';
    if (rate === 'unknown') statusBarItem.tooltip += '\nHoliday calendar unavailable for this year; rate cannot be confirmed.';
  }
  statusBarItem.show();
}

async function applyStatusBarTheme(model) {
  const wc = vscode.workspace.getConfiguration('workbench');
  const existing = { ...(wc.get('colorCustomizations') ?? {}) };
  for (const key of MANAGED_COLOR_TOKENS) delete existing[key];
  Object.assign(existing, MODEL_COLORS[model] ?? {});
  await wc.update('colorCustomizations', existing, vscode.ConfigurationTarget.Global);
}

function checkClaudeCodeInstalled() {
  return new Promise(resolve => {
    exec(process.platform === 'win32' ? 'where claude' : 'which claude', err => resolve(!err));
  });
}

async function ensureClaudeCodeInstalled() {
  if (await checkClaudeCodeInstalled()) return true;
  const action = await vscode.window.showWarningMessage(
    'Claude Code CLI not found. Please install it first.',
    'Install Claude Code', 'Dismiss'
  );
  if (action === 'Install Claude Code') {
    vscode.env.openExternal(vscode.Uri.parse(CLAUDE_CODE_INSTALL_URL));
  }
  return false;
}

async function getOrPromptDeepseekKey() {
  const stored = await secrets.get('deepseekApiKey');
  if (stored) return stored;
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your Deepseek API key',
    placeHolder: 'sk-...',
    password: true,
    ignoreFocusOut: true,
    validateInput: v => (v?.trim() ? null : 'API key cannot be empty'),
  });
  if (!key?.trim()) return null;
  await secrets.store('deepseekApiKey', key.trim());
  return key.trim();
}

async function reloadTerminals(model) {
  await vscode.commands.executeCommand('workbench.action.terminal.killAll');
  vscode.window.createTerminal(`Claude Code (${model})`).show();
}

// ─── Switch logic ─────────────────────────────────────────────────────────────

async function switchToDeepseek() {
  if (!(await ensureClaudeCodeInstalled())) return false;
  const apiKey = await getOrPromptDeepseekKey();
  if (!apiKey) return false;

  const env = getTerminalEnv();
  for (const [k, v] of Object.entries(DEEPSEEK_ENV)) env[k] = v;
  env['ANTHROPIC_AUTH_TOKEN'] = apiKey;

  await setTerminalEnv(env);
  await vscode.workspace.getConfiguration('claudeDeepseekSwitcher')
    .update('currentModel', 'deepseek', vscode.ConfigurationTarget.Global);

  updateStatusBar('deepseek');
  await applyStatusBarTheme('deepseek');
  await reloadTerminals('Deepseek');
  return true;
}

async function switchToClaude() {
  const env = getTerminalEnv();
  for (const key of MANAGED_ENV_KEYS) delete env[key];

  await setTerminalEnv(env);
  await vscode.workspace.getConfiguration('claudeDeepseekSwitcher')
    .update('currentModel', 'claude', vscode.ConfigurationTarget.Global);

  updateStatusBar('claude');
  await applyStatusBarTheme('claude');
  await reloadTerminals('Claude');
  return true;
}

// ─── switchModel ──────────────────────────────────────────────────────────────

async function switchModel() {
  const current = currentModel();

  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(sparkle) Claude',   description: current === 'claude'   ? '● active' : '', model: 'claude' },
      { label: '$(rocket) Deepseek',  description: current === 'deepseek' ? '● active' : '', model: 'deepseek' },
    ],
    { title: 'Switch AI Model', placeHolder: 'Select a model for Claude Code' }
  );

  if (!picked || picked.model === current) return;
  if (picked.model === 'deepseek') await switchToDeepseek();
  else await switchToClaude();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function resetDeepseekApiKey() {
  await secrets.delete('deepseekApiKey');
  const key = await getOrPromptDeepseekKey();
  if (!key) return;

  if (currentModel() === 'deepseek') {
    const env = getTerminalEnv();
    env['ANTHROPIC_AUTH_TOKEN'] = key;
    await setTerminalEnv(env);
    await reloadTerminals('Deepseek');
  } else {
    vscode.window.showInformationMessage('Deepseek API key updated.');
  }
}

// ─── Activation ───────────────────────────────────────────────────────────────

function activate(context) {
  secrets = context.secrets;

  const cfg = vscode.workspace.getConfiguration('claudeDeepseekSwitcher');
  const alignment = cfg.get('statusBarAlignment') === 'left'
    ? vscode.StatusBarAlignment.Left
    : vscode.StatusBarAlignment.Right;

  statusBarItem = vscode.window.createStatusBarItem(alignment, 100);
  statusBarItem.command = 'claude-deepseek-switcher.switchModel';
  const model = cfg.get('currentModel');
  updateStatusBar(model);
  applyStatusBarTheme(model);
  context.subscriptions.push(statusBarItem);
  const rateTimer = setInterval(() => updateStatusBar(currentModel()), 1000);
  context.subscriptions.push({ dispose: () => clearInterval(rateTimer) });

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-deepseek-switcher.switchModel', switchModel)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-deepseek-switcher.resetDeepseekApiKey', resetDeepseekApiKey)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeDeepseekSwitcher.currentModel')) {
        const m = currentModel();
        updateStatusBar(m);
        applyStatusBarTheme(m);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
