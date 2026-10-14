'use strict';

const vscode = require('vscode');
const { getDeepseekRate } = require('./deepseek-rate');

const { resolvePresets, secretKey, BASE_MANAGED_KEYS, DEFAULT_PRESETS } = require('./presets');
const BACKUP_KEY = 'claudeExtensionSettingsBackup.v1';
let secrets;
let statusBarItem;
let busy = false;

const claudeConfig = () => vscode.workspace.getConfiguration('claudeCode');
const globalValue = (cfg, name) => cfg.inspect(name)?.globalValue;

function getPresets(notify = false) {
  // Read user settings only: a project must not redirect a saved provider key.
  const config = vscode.workspace.getConfiguration('claudeCodeSwitcher').inspect('presets')?.globalValue;
  const { presets, errors } = resolvePresets(config);
  if (notify && errors.length) vscode.window.showWarningMessage(errors[0]);
  return presets;
}

function configuredProvider() {
  const env = Object.fromEntries(claudeConfig().get('environmentVariables', []).map(entry => [entry.name, entry.value]));
  const matches = getPresets().filter(preset => Object.entries(preset.environment).every(([name, value]) =>
    name === preset.apiKeyEnv || env[name] === value));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) return 'custom';
  if ((env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL !== 'https://api.anthropic.com') ||
      ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(key => /^(1|true)$/i.test(env[key] || ''))) return 'custom';
  return 'claude';
}

function updateStatusBar() {
  const provider = configuredProvider();
  const preset = getPresets().find(item => item.id === provider);
  statusBarItem.text = preset ? `$(rocket) ${preset.label}` : provider === 'custom' ? '$(settings-gear) Custom provider' : '$(sparkle) Claude';
  statusBarItem.name = 'Claude Code Provider';
  statusBarItem.tooltip = 'Provider configured for the Claude Code extension. Click to switch. Reload the window after switching; running chats may still use their previous provider. External Claude settings can override this configuration.';
  if (preset?.environment.ANTHROPIC_BASE_URL.replace(/\/$/, '') === DEFAULT_PRESETS.deepseek.environment.ANTHROPIC_BASE_URL) {
    const rate = getDeepseekRate();
    statusBarItem.text += ' | ' + { peak: 'Peak', 'off-peak': 'Off-peak', unknown: 'Rate unknown' }[rate];
    statusBarItem.tooltip += '\nRate estimate uses the bundled 2026 holiday calendar and your clock, not live billing.';
  }
  statusBarItem.show();
}

async function promptKey(preset) {
  const key = await vscode.window.showInputBox({
    title: `${preset.label} key for the Claude Code extension`,
    prompt: `Endpoint: ${preset.environment.ANTHROPIC_BASE_URL}. Saved in SecretStorage and copied to local VS Code user settings while selected. Do not share those settings.`,
    password: true, ignoreFocusOut: true,
    validateInput: value => value?.trim() ? null : 'API key cannot be empty',
  });
  if (!key?.trim()) return null;
  await secrets.store(secretKey(preset), key.trim());
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
  if (provider !== 'claude' && cfg.get('claudeProcessWrapper')) {
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
  const backup = saved ? JSON.parse(saved) : {
    environmentVariables: current,
    disableLoginPrompt: globalValue(cfg, 'disableLoginPrompt'),
  };
  const managed = new Set(backup.managedKeys || BASE_MANAGED_KEYS);
  if (provider !== 'claude') {
    const preset = getPresets(true).find(item => item.id === provider);
    if (!preset) return;
    const key = preset.apiKeyEnv === 'none' ? null : replacementKey || await secrets.get(secretKey(preset)) || await promptKey(preset);
    if (preset.apiKeyEnv !== 'none' && !key) return;
    const nextKeys = Object.keys(preset.environment);
    // Capture newly claimed variables when first touched, including edits made
    // while another preset was active. Keep the original provider baseline.
    const newlyManaged = new Set(nextKeys.filter(name => !managed.has(name)));
    if (saved && newlyManaged.size) {
      const original = [
        ...(backup.environmentVariables || []).filter(entry => !newlyManaged.has(entry.name)),
        ...(current || []).filter(entry => newlyManaged.has(entry.name)),
      ];
      backup.environmentVariables = original.length || backup.environmentVariables !== undefined ? original : undefined;
    }
    nextKeys.forEach(name => managed.add(name));
    backup.managedKeys = [...managed];
    // Persist ownership before writing, so reloads and partial failures remain recoverable.
    await secrets.store(BACKUP_KEY, JSON.stringify(backup));
    const env = (current || []).filter(entry => !managed.has(entry.name));
    const environment = { ...preset.environment };
    if (preset.apiKeyEnv !== 'none') environment[preset.apiKeyEnv] = key;
    env.push(...Object.entries(environment).map(([name, value]) => ({ name, value })));
    try {
      await writeSettings(cfg, [['environmentVariables', env], ['disableLoginPrompt', true], ['useTerminal', false]]);
    } catch (error) {
      if (error.rolledBack) {
        if (saved) await secrets.store(BACKUP_KEY, saved);
        else await secrets.delete(BACKUP_KEY);
      }
      throw error;
    }
    await offerReload(preset.label);
  } else {
    if (!saved && configuredProvider() !== 'claude') {
      vscode.window.showWarningMessage('This provider was configured outside the switcher, so there is no saved Claude configuration to restore. Review Claude Code user settings first.');
      return;
    }
    const changes = [];
    if (saved) {
      // Keep unrelated entries added or edited while a preset was selected.
      const env = (current || []).filter(entry => !managed.has(entry.name));
      env.push(...(backup.environmentVariables || []).filter(entry => managed.has(entry.name)));
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
    ...getPresets(true).map(preset => ({ label: `$(rocket) ${preset.label}`, description: preset.environment.ANTHROPIC_BASE_URL, model: preset.id })),
  ], { title: 'Claude Code Switcher: Switch Preset', placeHolder: 'Choose a preset for the Claude Code extension' });
  if (picked) await setProvider(picked.model);
}

async function resetApiKey(presetId) {
  if (!canConfigure(presetId || 'preset')) return;
  const presets = getPresets(true).filter(preset => preset.apiKeyEnv !== 'none');
  const picked = presetId ? { model: presetId } : await vscode.window.showQuickPick(
    presets.map(preset => ({ label: preset.label, description: preset.environment.ANTHROPIC_BASE_URL, model: preset.id })),
    { title: 'Claude Code Switcher: Reset Preset API Key', placeHolder: 'Choose the preset whose key you want to replace' },
  );
  const preset = presets.find(item => item.id === picked?.model);
  if (!preset) return;
  const active = configuredProvider() === preset.id;
  const key = await promptKey(preset);
  if (!key) return;
  if (active) await setProvider(preset.id, key);
  else vscode.window.showInformationMessage(`${preset.label} key saved for the next provider switch.`);
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
  const cfg = vscode.workspace.getConfiguration('claudeCodeSwitcher');
  statusBarItem = vscode.window.createStatusBarItem('claude-code-provider', cfg.get('statusBarAlignment') === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claude-code-switcher.switchModel';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  const timer = setInterval(updateStatusBar, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('claudeCode') || event.affectsConfiguration('claudeCodeSwitcher')) updateStatusBar();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('claude-code-switcher.switchModel', guarded(switchModel)));
  context.subscriptions.push(vscode.commands.registerCommand('claude-code-switcher.resetApiKey', guarded(() => resetApiKey())));
  // Keep a direct DeepSeek key-reset command for custom keybindings.
  context.subscriptions.push(vscode.commands.registerCommand('claude-code-switcher.resetDeepseekApiKey', guarded(() => resetApiKey('deepseek'))));
  context.subscriptions.push(vscode.commands.registerCommand('claude-code-switcher.configurePresets', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCodeSwitcher.presets')));
}

function deactivate() {}

module.exports = { activate, deactivate };
