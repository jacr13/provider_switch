'use strict';

const vscode = require('vscode');
const { getDeepseekRate } = require('./deepseek-rate');

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


let secrets;
let statusBarItem;
let busy = false;
const terminals = new Map();

function updateStatusBar() {
  const model = terminals.get(vscode.window.activeTerminal);
  statusBarItem.text = model === 'deepseek' ? '$(rocket) DeepSeek' : model === 'claude' ? '$(sparkle) Claude' : '$(terminal) AI terminal';
  statusBarItem.color = model === 'deepseek' ? '#a78bfa' : model === 'claude' ? '#d97706' : undefined;
  statusBarItem.tooltip = model
    ? `Terminal configured for ${model}. Run claude here. Provider is not verified against live requests. Click to open another terminal.`
    : 'Select a provider to open a dedicated terminal. Existing terminals are not managed.';
  if (model === 'deepseek') {
    const rate = getDeepseekRate();
    statusBarItem.text += ' | ' + { peak: 'Peak', 'off-peak': 'Off-peak (50%)', unknown: 'Rate unknown' }[rate];
    statusBarItem.tooltip += '\nPeak: Mon-Fri 01:00-04:00 and 06:00-10:00 UTC, excluding Chinese holidays. Off-peak is 50% of peak rates. Holiday calendar: 2026.';
    if (rate === 'unknown') statusBarItem.tooltip += '\nHoliday data unavailable for this year.';
  }
  statusBarItem.show();
}

async function promptKey() {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your DeepSeek API key', password: true, ignoreFocusOut: true,
    validateInput: value => value?.trim() ? null : 'API key cannot be empty',
  });
  if (!key?.trim()) return null;
  await secrets.store('deepseekApiKey', key.trim());
  return key.trim();
}

// Only remove values identifiable as this extension's old global configuration.
// Never copy effective workspace settings into user settings.
async function cleanLegacySettings() {
  const stored = await secrets.get('deepseekApiKey');
  const cfg = vscode.workspace.getConfiguration();
  let cleaned = false;
  for (const platform of ['windows', 'osx', 'linux']) {
    const name = `terminal.integrated.env.${platform}`;
    const original = cfg.inspect(name)?.globalValue;
    if (!original) continue;
    const env = { ...original };
    if (stored && env.ANTHROPIC_AUTH_TOKEN === stored) delete env.ANTHROPIC_AUTH_TOKEN;
    if (original.ANTHROPIC_BASE_URL === DEEPSEEK_ENV.ANTHROPIC_BASE_URL) {
      for (const [key, value] of Object.entries(DEEPSEEK_ENV)) {
        if (env[key] === value || (key.includes('MODEL') && ['deepseek-v4-pro[1m]', 'deepseek-v4-flash'].includes(env[key]))) delete env[key];
      }
    }
    if (JSON.stringify(env) !== JSON.stringify(original)) {
      await cfg.update(name, Object.keys(env).length ? env : undefined, vscode.ConfigurationTarget.Global);
      cleaned = true;
    }
    if (original.ANTHROPIC_BASE_URL === DEEPSEEK_ENV.ANTHROPIC_BASE_URL && env.ANTHROPIC_AUTH_TOKEN) {
      vscode.window.showWarningMessage('A legacy terminal token could not be identified safely. Review terminal.integrated.env settings and remove any old DeepSeek key.');
    }
  }
  if (cleaned) vscode.window.showWarningMessage('Removed identifiable legacy DeepSeek terminal settings. Existing terminals retain their environment: close old terminals manually. Consider rotating the old key because earlier versions saved it in settings.');
}

async function openTerminal(model) {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('Trust this workspace before opening an AI terminal with credentials.');
    return;
  }
  let key;
  if (model === 'deepseek') {
    key = await secrets.get('deepseekApiKey') || await promptKey();
    if (!key) return;
  }
  // Null removes inherited routing overrides from this terminal only.
  const env = Object.fromEntries(MANAGED_ENV_KEYS.map(name => [name, null]));
  if (model === 'deepseek') Object.assign(env, DEEPSEEK_ENV, { ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: null });
  const terminal = vscode.window.createTerminal({
    name: `Claude Code (${model === 'deepseek' ? 'DeepSeek' : 'Claude'})`,
    env, isTransient: true,
  });
  terminals.set(terminal, model);
  terminal.show();
  updateStatusBar();
}

async function switchModel() {
  const picked = await vscode.window.showQuickPick([
    { label: '$(sparkle) Claude', model: 'claude' },
    { label: '$(rocket) DeepSeek', model: 'deepseek' },
  ], { title: 'Open AI Terminal', placeHolder: 'Choose a provider, then run claude in the new terminal' });
  if (picked) await openTerminal(picked.model);
}

async function resetDeepseekApiKey() {
  if (!vscode.workspace.isTrusted) return;
  // Cancel keeps the existing secret intact.
  if (await promptKey()) vscode.window.showInformationMessage('DeepSeek key updated for new terminals. Close old DeepSeek terminals manually; they still hold the previous key.');
}

function guarded(action) {
  return async () => {
    if (busy) return;
    busy = true;
    try { await action(); }
    catch { vscode.window.showErrorMessage('Could not complete the AI terminal operation. Check your VS Code settings and try again.'); }
    finally { busy = false; }
  };
}

async function activate(context) {
  secrets = context.secrets;
  await cleanLegacySettings();
  const cfg = vscode.workspace.getConfiguration('claudeDeepseekSwitcher');
  statusBarItem = vscode.window.createStatusBarItem(cfg.get('statusBarAlignment') === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claude-deepseek-switcher.switchModel';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  const timer = setInterval(updateStatusBar, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.window.onDidChangeActiveTerminal(updateStatusBar));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => { terminals.delete(terminal); updateStatusBar(); }));
  context.subscriptions.push(vscode.commands.registerCommand('claude-deepseek-switcher.switchModel', guarded(switchModel)));
  context.subscriptions.push(vscode.commands.registerCommand('claude-deepseek-switcher.resetDeepseekApiKey', guarded(resetDeepseekApiKey)));
}

function deactivate() {
  // Do not terminate running user work. Transient terminals are not revived.
  terminals.clear();
}

module.exports = { activate, deactivate };
