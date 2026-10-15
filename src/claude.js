'use strict';
const { resolveClaudePresets, BASE_MANAGED_KEYS, DEFAULT_PRESETS } = require('./presets');
const BACKUP_KEY = 'claudeExtensionSettingsBackup.v1';

function createClaudeTarget(services, statusBarItem) {
  const { vscode, secrets, output, fs, path, globalValue, backupHome, readText,
    presetsSetting, storedKey, refreshConfiguredKeys, getDeepseekRate, RATE_LABELS, endpointIcon } = services;
  const claudeConfig = () => vscode.workspace.getConfiguration('claudeCode');
  const panelBackupPath = () => path.join(backupHome(), 'claude-panel.json');

  function getPresets(notify = false) {
    const { presets, errors } = resolveClaudePresets(presetsSetting().claude);
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
    if (!vscode.workspace.getConfiguration('providerSwitch').get('showClaudeStatusBar', true) ||
        !vscode.extensions.getExtension('anthropic.claude-code')) {
      statusBarItem.hide();
      return;
    }
    const provider = configuredProvider();
    const preset = getPresets().find(item => item.id === provider);
    // The target comes first, so both buttons read the same way round. The whole
    // item carries one color, so the label cannot be tinted on its own.
    statusBarItem.text = `Claude: ${preset ? `${endpointIcon(preset.environment.ANTHROPIC_BASE_URL)} ${preset.label}`
      : provider === 'custom' ? '$(settings-gear) Custom' : '$(sparkle) Claude'}`;
    const colors = {
      claude: '#d97706', deepseek: '#a78bfa', 'deepseek-v4-pro': '#8b5cf6', kimi: '#38bdf8', 'kimi-k3': '#0ea5e9',
      ...vscode.workspace.getConfiguration('providerSwitch').get('statusBarColors', {}),
    };
    const color = colors[provider];
    // Clear the previous preset's color when the theme default is selected.
    statusBarItem.color = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
    statusBarItem.name = 'Claude Code Provider';
    if (preset?.environment.ANTHROPIC_BASE_URL.replace(/\/$/, '') === DEFAULT_PRESETS.deepseek.environment.ANTHROPIC_BASE_URL) {
      const rate = getDeepseekRate();
      statusBarItem.text += ' | ' + RATE_LABELS[rate];
    }
    statusBarItem.show();
  }

  async function promptKey(preset) {
    const key = await vscode.window.showInputBox({
      title: `${preset.label} key for the Claude Code extension`,
      prompt: `Endpoint: ${preset.environment.ANTHROPIC_BASE_URL}. One key is stored per endpoint host and reused by every preset that uses it, including Codex presets. Copied to local VS Code user settings while selected; do not share those.`,
      password: true, ignoreFocusOut: true,
      validateInput: value => value?.trim() ? null : 'API key cannot be empty',
    });
    if (!key?.trim()) return null;
    await secrets.store(preset.key, key.trim());
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
      vscode.window.showWarningMessage('A custom Claude process wrapper is configured. Remove it before using Provider Switch so it cannot override the selected provider.');
      return false;
    }
    return true;
  }

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

  async function detachPanel(cfg, preset) {
    const current = globalValue(cfg, 'environmentVariables') || [];
    const owned = new Set([...Object.keys(preset.environment), preset.apiKeyEnv].filter(name => name && name !== 'none'));
    const environment = current.filter(entry => !owned.has(entry.name));
    output.appendLine(`Claude Code -> detached (${owned.size} preset variables removed)`);
    await writeSettings(cfg, [
      ['environmentVariables', environment.length ? environment : undefined],
      ['disableLoginPrompt', undefined],
      ['useTerminal', undefined],
    ]);
    await offerReload('Claude');
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
      const key = preset.apiKeyEnv === 'none' ? null : replacementKey || await storedKey(preset) || await promptKey(preset);
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
      await copyPanelBackup(backup);
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
        const preset = getPresets().find(item => item.id === configuredProvider());
        if (!preset) {
          vscode.window.showWarningMessage('This provider was configured outside the switcher, so there is no saved Claude configuration to restore. Review Claude Code user settings first.');
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          `There is no saved Claude Code configuration to restore: this extension has no record of the settings from before the ${preset.label} preset was selected, which happens once it is reinstalled or its secret storage is cleared. Removing the variables it wrote hands the panel back to your usual Claude sign-in, but anything it replaced cannot be recovered.`,
          { modal: true }, 'Remove the variables it wrote');
        if (choice !== 'Remove the variables it wrote') return;
        await detachPanel(cfg, preset);
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
    ], { title: 'Provider Switch: Switch Preset', placeHolder: 'Choose a preset for the Claude Code extension' });
    if (picked) await setProvider(picked.model);
  }

  async function resetApiKey(presetId) {
    if (!canConfigure(presetId || 'preset')) return;
    const presets = getPresets(true).filter(preset => preset.apiKeyEnv !== 'none');
    const picked = presetId ? { model: presetId } : await vscode.window.showQuickPick(
      presets.map(preset => ({ label: preset.label, description: preset.environment.ANTHROPIC_BASE_URL, model: preset.id })),
      { title: 'Provider Switch: Reset Preset API Key', placeHolder: 'Choose the preset whose key you want to replace' },
    );
    const preset = presets.find(item => item.id === picked?.model);
    if (!preset) return;
    const active = configuredProvider() === preset.id;
    const key = await promptKey(preset);
    if (!key) return;
    if (active) await setProvider(preset.id, key);
    await refreshConfiguredKeys(preset.key, key, active ? 'claude' : undefined);
    if (!active) vscode.window.showInformationMessage(`${preset.label} key saved for the next provider switch.`);
  }

  async function copyPanelBackup(backup) {
    const file = panelBackupPath();
    if (await readText(file) !== undefined) return;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify(backup, null, 2)}\n`);
      output.appendLine(`Kept the previous Claude Code settings at ${file}`);
    } catch {
      output.appendLine(`Could not copy the previous Claude Code settings to ${file}`);
    }
  }

  function looksLikePreset(environment) {
    return getPresets().some(preset => Object.entries(preset.environment).every(([name, value]) =>
      name === preset.apiKeyEnv || environment[name] === value));
  }

  async function adoptPanelCopy() {
    if (await secrets.get(BACKUP_KEY)) return;
    const saved = await readText(panelBackupPath());
    if (saved === undefined) return;
    try {
      const backup = JSON.parse(saved);
      if (typeof backup !== 'object' || backup === null) return;
      const environment = Object.fromEntries((backup.environmentVariables || []).map(entry => [entry.name, entry.value]));
      if (looksLikePreset(environment)) return;
      await secrets.store(BACKUP_KEY, saved);
      output.appendLine(`Adopted the Claude Code settings kept at ${panelBackupPath()}`);
    } catch { /* an unreadable copy is not a record of anything */ }
  }
  return { id: 'claude', updateStatus: updateStatusBar, adoptBackup: adoptPanelCopy,
    currentPreset: () => getPresets().find(preset => preset.id === configuredProvider()),
    setPreset: setProvider, switchModel, resetApiKey };
}
module.exports = { createClaudeTarget };
