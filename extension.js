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
  ANTHROPIC_API_KEY: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  CLAUDE_CODE_USE_BEDROCK: '0',
  CLAUDE_CODE_USE_VERTEX: '0',
  CLAUDE_CODE_USE_FOUNDRY: '0',
};
const MANAGED_KEYS = new Set([...Object.keys(DEEPSEEK_ENV), 'ANTHROPIC_AUTH_TOKEN']);
const BACKUP_KEY = 'claudeExtensionSettingsBackup.v1';
let secrets;
let statusBarItem;
let busy = false;

const claudeConfig = () => vscode.workspace.getConfiguration('claudeCode');
const globalValue = (cfg, name) => cfg.inspect(name)?.globalValue;

function configuredProvider() {
  const env = Object.fromEntries(claudeConfig().get('environmentVariables', []).map(entry => [entry.name, entry.value]));
  if (env.ANTHROPIC_BASE_URL?.replace(/\/$/, '') === DEEPSEEK_ENV.ANTHROPIC_BASE_URL) return 'deepseek';
  if ((env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL !== 'https://api.anthropic.com') ||
      ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(key => /^(1|true)$/i.test(env[key] || ''))) return 'custom';
  return 'claude';
}

function updateStatusBar() {
  const provider = configuredProvider();
  statusBarItem.text = provider === 'deepseek' ? '$(rocket) DeepSeek' : provider === 'custom' ? '$(settings-gear) Custom provider' : '$(sparkle) Claude';
  statusBarItem.name = 'Claude Code Provider';
  statusBarItem.tooltip = 'Provider configured for the Claude Code extension. Click to switch. Reload the window after switching; running chats may still use their previous provider. External Claude settings can override this configuration.';
  if (provider === 'deepseek') {
    const rate = getDeepseekRate();
    statusBarItem.text += ' | ' + { peak: 'Peak', 'off-peak': 'Off-peak', unknown: 'Rate unknown' }[rate];
    statusBarItem.tooltip += '\nRate estimate uses the bundled 2026 holiday calendar and your clock, not live billing.';
  }
  statusBarItem.show();
}

async function promptKey() {
  const key = await vscode.window.showInputBox({
    title: 'DeepSeek key for the Claude Code extension',
    prompt: 'Saved in SecretStorage and copied to local VS Code user settings while DeepSeek is selected. Do not share those settings.',
    password: true, ignoreFocusOut: true,
    validateInput: value => value?.trim() ? null : 'API key cannot be empty',
  });
  if (!key?.trim()) return null;
  await secrets.store('deepseekApiKey', key.trim());
  return key.trim();
}

function canConfigure(provider) {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('Trust this workspace before changing Claude Code provider settings.');
    return false;
  }
  if (!vscode.extensions.getExtension('anthropic.claude-code')) {
    vscode.window.showWarningMessage('Install and enable Claude Code for VS Code by Anthropic first.');
    return false;
  }
  const cfg = claudeConfig();
  // Never write credentials into a workspace or silently override its preferences.
  for (const name of ['environmentVariables', 'disableLoginPrompt', 'useTerminal']) {
    const inspected = cfg.inspect(name);
    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      vscode.window.showWarningMessage(`Remove the workspace override for claudeCode.${name} before switching providers. The switcher updates user settings only.`);
      return false;
    }
  }
  if (provider === 'deepseek' && cfg.get('claudeProcessWrapper')) {
    vscode.window.showWarningMessage('A custom Claude process wrapper is configured. Remove it before using the provider switcher so it cannot override the selected provider.');
    return false;
  }
  return true;
}

// Configuration errors can contain credentials. Roll back without logging details.
async function writeSettings(cfg, changes) {
  const completed = [];
  try {
    for (const [name, value] of changes) {
      const previous = globalValue(cfg, name);
      await cfg.update(name, value, vscode.ConfigurationTarget.Global);
      completed.push([name, previous]);
    }
  } catch {
    let restored = true;
    for (const [name, value] of completed.reverse()) {
      try { await cfg.update(name, value, vscode.ConfigurationTarget.Global); }
      catch { restored = false; }
    }
    if (!restored) vscode.window.showWarningMessage('Some Claude Code settings could not be restored. The saved configuration is retained; retry switching to Claude before continuing a chat.');
    const error = new Error('Could not update Claude Code settings');
    error.rolledBack = restored;
    throw error;
  }
}

async function offerReload(provider) {
  updateStatusBar();
  const answer = await vscode.window.showInformationMessage(
    `${provider} configured for the Claude Code panel. Finish active work, then reload this window and start a new chat to apply the provider.`,
    'Reload Window',
  );
  if (answer === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

async function setProvider(provider, replacementKey) {
  if (!canConfigure(provider)) return;
  const cfg = claudeConfig();
  const current = globalValue(cfg, 'environmentVariables');
  const saved = await secrets.get(BACKUP_KEY);
  if (provider === 'deepseek') {
    const key = replacementKey || await secrets.get('deepseekApiKey') || await promptKey();
    if (!key) return;
    if (!saved) {
      // The original environment may contain an Anthropic key: encrypt the backup.
      await secrets.store(BACKUP_KEY, JSON.stringify({
        environmentVariables: current,
        disableLoginPrompt: globalValue(cfg, 'disableLoginPrompt'),
      }));
    }
    const env = (current || []).filter(entry => !MANAGED_KEYS.has(entry.name));
    env.push(...Object.entries({ ...DEEPSEEK_ENV, ANTHROPIC_AUTH_TOKEN: key }).map(([name, value]) => ({ name, value })));
    try {
      await writeSettings(cfg, [['environmentVariables', env], ['disableLoginPrompt', true], ['useTerminal', false]]);
    } catch (error) {
      // Do not retain a stale baseline after a fully rolled-back first switch.
      if (!saved && error.rolledBack) await secrets.delete(BACKUP_KEY);
      throw error;
    }
    await offerReload('DeepSeek');
  } else {
    if (!saved && configuredProvider() !== 'claude') {
      vscode.window.showWarningMessage('This provider was configured outside the switcher, so there is no saved Claude configuration to restore. Review Claude Code user settings first.');
      return;
    }
    const changes = [];
    if (saved) {
      const backup = JSON.parse(saved);
      // Keep unrelated entries added or edited while DeepSeek was selected.
      const env = (current || []).filter(entry => !MANAGED_KEYS.has(entry.name));
      env.push(...(backup.environmentVariables || []).filter(entry => MANAGED_KEYS.has(entry.name)));
      changes.push(['environmentVariables', env.length || backup.environmentVariables !== undefined ? env : undefined]);
      changes.push(['disableLoginPrompt', backup.disableLoginPrompt]);
    }
    changes.push(['useTerminal', false]);
    await writeSettings(cfg, changes);
    if (saved) await secrets.delete(BACKUP_KEY);
    await offerReload(configuredProvider() === 'claude' ? 'Claude' : 'Previous provider');
  }
}

async function switchModel() {
  const picked = await vscode.window.showQuickPick([
    { label: '$(sparkle) Claude', description: 'Restore your previous Claude Code configuration', model: 'claude' },
    { label: '$(rocket) DeepSeek', description: 'Use DeepSeek in the Claude Code chat panel', model: 'deepseek' },
  ], { title: 'Claude Code: Switch Provider', placeHolder: 'Choose the provider for the Claude Code extension' });
  if (picked) await setProvider(picked.model);
}

async function resetDeepseekApiKey() {
  if (!canConfigure('deepseek')) return;
  const key = await promptKey();
  if (!key) return;
  if (configuredProvider() === 'deepseek') await setProvider('deepseek', key);
  else vscode.window.showInformationMessage('DeepSeek key saved for the next provider switch.');
}

function guarded(action) {
  return async () => {
    if (busy) return;
    busy = true;
    try { await action(); }
    catch { vscode.window.showErrorMessage('Could not update the Claude Code provider. Check that user settings are writable and SecretStorage is available, then try again.'); }
    finally { busy = false; updateStatusBar(); }
  };
}

function activate(context) {
  secrets = context.secrets;
  const cfg = vscode.workspace.getConfiguration('claudeDeepseekSwitcher');
  statusBarItem = vscode.window.createStatusBarItem('claude-code-provider', cfg.get('statusBarAlignment') === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claude-deepseek-switcher.switchModel';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  const timer = setInterval(updateStatusBar, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('claudeCode')) updateStatusBar();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('claude-deepseek-switcher.switchModel', guarded(switchModel)));
  context.subscriptions.push(vscode.commands.registerCommand('claude-deepseek-switcher.resetDeepseekApiKey', guarded(resetDeepseekApiKey)));
}

function deactivate() {}

module.exports = { activate, deactivate };
