'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getDeepseekRate } = require('./deepseek-rate');

const { resolveClaudePresets, resolveCodexPresets, splitPresets, isDeepseekEndpoint } = require('./presets');
const { BASE_MANAGED_KEYS, DEFAULT_PRESETS, DEFAULT_CODEX_BASE_URL } = require('./presets');
const { applyPreset, configuredPreset, detachPreset, codexHome, configPath, catalogPath } = require('./codex-config');
// DeepSeek's model catalog in Codex's catalog format, written to models.json.
const DEEPSEEK_CODEX_CATALOG = require('../resources/deepseek-codex-models.json');
const BACKUP_KEY = 'claudeExtensionSettingsBackup.v1';
const CODEX_BACKUP_KEY = 'codexConfigBackup.v1';
const CODEX_BACKUP_DIR = 'backup-provider-switcher';
const PANEL_BACKUP_FILE = 'claude-panel.json';
let secrets;
let statusBarItem;
let codexStatusBarItem;
let output;
let codexConfigText = null;
let busy = false;

// DeepSeek charges less outside its peak windows, so the status bar names the
// rate instead of the window: it reads at a glance and stays short.
const RATE_LABELS = { peak: 'High', 'off-peak': 'Low', unknown: 'Rate unknown' };

// DeepSeek's mark is a whale, and the codicon set has no whale to use, so the
// emoji stands in for the generic rocket on DeepSeek endpoints.
const endpointIcon = url => isDeepseekEndpoint(url) ? '🐳' : '$(rocket)';

// The restored configurations carry the service's own mark instead: Claude's is
// a starburst, which the sparkle codicon stands in for, and Codex gets OpenAI's
// blossom as an emoji since the codicon set has no flower.
const CODEX_ICON = '🌸';

const claudeConfig = () => vscode.workspace.getConfiguration('claudeCode');
const globalValue = (cfg, name) => cfg.inspect(name)?.globalValue;

// The panel's own copy lives beside Codex's, under the user's home unless an
// override is set, which tests and unusual setups use.
const backupHome = () => process.env.PROVIDER_SWITCHER_HOME || path.join(os.homedir(), '.provider-switcher');
const panelBackupPath = () => path.join(backupHome(), PANEL_BACKUP_FILE);

function getPresets(notify = false) {
  const { presets, errors } = resolveClaudePresets(presetsSetting().claude);
  if (notify && errors.length) vscode.window.showWarningMessage(errors[0]);
  return presets;
}

// Read user settings only: a project must not redirect a saved provider key.
// The preset setting holds one section per target.
function presetsSetting() {
  return splitPresets(vscode.workspace.getConfiguration('providerSwitcher').inspect('presets')?.globalValue);
}

// Keys live under one SecretStorage entry per endpoint host, so a single
// DeepSeek key serves every preset on both targets. Keys saved under the older
// per-preset names are adopted the first time the preset is used.
async function storedKey(preset) {
  const stored = await secrets.get(preset.key);
  if (stored) return stored;
  for (const previous of preset.previousKeys) {
    const value = await secrets.get(previous);
    if (!value) continue;
    try {
      await secrets.store(preset.key, value);
      await secrets.delete(previous);
    } catch { /* the key is still usable for this switch */ }
    return value;
  }
  return undefined;
}

// A key is shared by every preset on the same endpoint, so replacing it also
// refreshes whichever presets are showing it right now: the panel writes it into
// user settings and Codex writes it into its configuration file.
async function refreshConfiguredKeys(name, key, skip) {
  if (skip !== 'claude') {
    const panel = getPresets().find(preset => preset.id === configuredProvider());
    if (panel?.key === name) await setProvider(panel.id, key);
  }
  if (skip !== 'codex') {
    const codex = getCodexPresets().find(preset => preset.id === configuredPreset(codexConfigText || '', getCodexPresets()));
    if (codex?.key === name) await setCodexPreset(codex.id, key);
  }
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
  // The target comes first, so both buttons read the same way round. The whole
  // item carries one color, so the label cannot be tinted on its own.
  statusBarItem.text = `Claude: ${preset ? `${endpointIcon(preset.environment.ANTHROPIC_BASE_URL)} ${preset.label}`
    : provider === 'custom' ? '$(settings-gear) Custom' : '$(sparkle) Claude'}`;
  const colors = {
    claude: '#d97706', deepseek: '#a78bfa',
    ...vscode.workspace.getConfiguration('providerSwitcher').get('statusBarColors', {}),
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

// Without the saved original the panel cannot be put back exactly as it was, but
// the variables a preset wrote can be removed, which returns the panel to the
// sign-in it would otherwise use.
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
  ], { title: 'Provider Switcher: Switch Preset', placeHolder: 'Choose a preset for the Claude Code extension' });
  if (picked) await setProvider(picked.model);
}

async function resetApiKey(presetId) {
  if (!canConfigure(presetId || 'preset')) return;
  const presets = getPresets(true).filter(preset => preset.apiKeyEnv !== 'none');
  const picked = presetId ? { model: presetId } : await vscode.window.showQuickPick(
    presets.map(preset => ({ label: preset.label, description: preset.environment.ANTHROPIC_BASE_URL, model: preset.id })),
    { title: 'Provider Switcher: Reset Preset API Key', placeHolder: 'Choose the preset whose key you want to replace' },
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

// ---- Codex: switching rewrites ~/.codex/config.toml, which the Codex
// extension, CLI, and desktop app all read. Everything outside the keys this
// switcher owns is preserved byte for byte.

function getCodexPresets(notify = false) {
  const { presets, errors } = resolveCodexPresets(presetsSetting().codex);
  if (notify && errors.length) vscode.window.showWarningMessage(errors[0]);
  return presets;
}

async function readCodexConfig() {
  try { return await fs.readFile(configPath(codexHome()), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function updateCodexStatusBar() {
  try { codexConfigText = await readCodexConfig(); }
  catch { /* unreadable for now: keep showing the last known state */ }
  // Machines that never ran Codex have nothing to switch, so stay out of the way.
  if (codexConfigText === null && !vscode.extensions.getExtension('openai.chatgpt')) {
    codexStatusBarItem.hide();
    return;
  }
  const presets = getCodexPresets();
  const provider = configuredPreset(codexConfigText || '', presets);
  const preset = presets.find(item => item.id === provider);
  codexStatusBarItem.text = `Codex: ${preset ? `${endpointIcon(preset.baseUrl)} ${preset.label}`
    : provider === 'custom' ? '$(settings-gear) Custom' : `${CODEX_ICON} ChatGPT`}`;
  const colors = {
    chatgpt: '#10a37f', 'deepseek-flash': '#a78bfa', 'deepseek-v4-pro': '#8b5cf6',
    ...vscode.workspace.getConfiguration('providerSwitcher').get('statusBarColors', {}),
  };
  const color = colors[provider];
  codexStatusBarItem.color = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
  codexStatusBarItem.name = 'Codex Provider';
  if (preset && preset.baseUrl.replace(/\/+$/, '') === DEFAULT_CODEX_BASE_URL.replace(/\/+$/, '')) {
    const rate = getDeepseekRate();
    codexStatusBarItem.text += ' | ' + RATE_LABELS[rate];
  }
  codexStatusBarItem.show();
}

async function canConfigureCodex() {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('Trust this workspace before changing Codex settings.');
    return false;
  }
  const home = codexHome();
  try { await fs.access(home); }
  catch {
    vscode.window.showWarningMessage(`Codex has not created its configuration directory yet (${home}). Run Codex once, then try again.`);
    return false;
  }
  if (vscode.workspace.getConfiguration('chatgpt').get('runCodexInWindowsSubsystemForLinux')) {
    vscode.window.showWarningMessage('Codex is set to run inside WSL, where its configuration lives elsewhere. Turn that setting off before switching its provider from here.');
    return false;
  }
  return true;
}

async function promptCodexKey(preset) {
  const key = await vscode.window.showInputBox({
    title: `${preset.label} key for Codex`,
    prompt: `Endpoint: ${preset.baseUrl}. One key is stored per endpoint host and reused by every preset that uses it, including Claude Code presets. Written to ${configPath(codexHome())} while selected; do not share that file.`,
    password: true, ignoreFocusOut: true,
    validateInput: value => value?.trim() ? null : 'API key cannot be empty',
  });
  if (!key?.trim()) return null;
  await secrets.store(preset.key, key.trim());
  return key.trim();
}

async function offerCodexReload(label) {
  await updateCodexStatusBar();
  const answer = await vscode.window.showInformationMessage(
    `${label} configured for Codex. Finish active work, then reload this window and start a new Codex panel to apply it.`,
    'Reload Window',
  );
  if (answer === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

// Codex ships a catalog describing its models; without it the client falls back
// to generic metadata. An existing file is never touched.
async function writeCodexCatalog(home, backup) {
  try { await fs.access(catalogPath(home)); return false; }
  catch { /* not created by us yet */ }
  await fs.writeFile(catalogPath(home), `${JSON.stringify(DEEPSEEK_CODEX_CATALOG, null, 2)}\n`);
  backup.catalogCreated = true;
  await secrets.store(CODEX_BACKUP_KEY, JSON.stringify(backup));
  return true;
}

// DeepSeek's own setup script keeps a plain copy of the file it changed, and the
// same copy outlives this extension: secret storage is gone after an uninstall,
// while a file next to the original can always be copied back by hand. It holds
// the file as it was before the first switch and is never overwritten.
async function copyCodexBackup(home, config) {
  if (config === null) return;
  const target = path.join(home, CODEX_BACKUP_DIR, 'config.toml');
  try {
    await fs.access(target);
    return;
  } catch { /* no copy kept yet */ }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, config);
    output.appendLine(`Kept the original ${configPath(home)} at ${target}`);
  } catch {
    output.appendLine(`Could not copy the original configuration to ${target}`);
  }
}

async function readText(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch { return undefined; }
}

// Secret storage is cleared when an extension is uninstalled, so what it holds is
// mirrored into a file: that copy is what lets a later install hand the panel and
// Codex back instead of stranding whichever preset was selected.
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

// A copy that selects one of the presets is this extension's own output rather
// than a record of what was there before it, so it is not adopted.
function looksLikePreset(environment) {
  return getPresets().some(preset => Object.entries(preset.environment).every(([name, value]) =>
    name === preset.apiKeyEnv || environment[name] === value));
}

async function adoptFileBackups() {
  if (!await secrets.get(CODEX_BACKUP_KEY)) {
    const home = codexHome();
    const saved = await readText(path.join(home, CODEX_BACKUP_DIR, 'config.toml'));
    if (saved !== undefined) {
      const active = configuredPreset(saved, getCodexPresets());
      if (active === 'chatgpt' || active === 'custom') {
        const catalog = `${JSON.stringify(DEEPSEEK_CODEX_CATALOG, null, 2)}\n`;
        const owned = await readText(catalogPath(home)) === catalog;
        await secrets.store(CODEX_BACKUP_KEY, JSON.stringify({ config: saved, catalogCreated: owned }));
        output.appendLine('Adopted the Codex configuration kept beside it');
      }
    }
  }
  if (!await secrets.get(BACKUP_KEY)) {
    const saved = await readText(panelBackupPath());
    if (saved === undefined) return;
    try {
      const backup = JSON.parse(saved);
      if (typeof backup !== 'object' || backup === null) return;
      const environment = Object.fromEntries((backup.environmentVariables || []).map(entry => [entry.name, entry.value]));
      if (looksLikePreset(environment)) return;
      await secrets.store(BACKUP_KEY, saved);
      output.appendLine('Adopted the Claude Code settings kept beside the extension');
    } catch { /* an unreadable copy is not a record of anything */ }
  }
}

// The saved original is gone, so the file can only be returned to Codex by
// removing what this extension wrote. Everything it did not write is kept.
async function detachCodex(home, current) {
  const active = configuredPreset(current || '', getCodexPresets());
  const preset = getCodexPresets().find(item => item.id === active);
  const { text, report } = detachPreset(current || '', preset?.provider);
  output.appendLine(`Codex -> detached (${configPath(home)})`);
  report.forEach(line => output.appendLine(`  ${line}`));
  await fs.writeFile(configPath(home), text);
  // Only what this extension generated is removed, never something it found.
  const catalog = `${JSON.stringify(DEEPSEEK_CODEX_CATALOG, null, 2)}\n`;
  if (await readText(catalogPath(home)) === catalog) {
    await fs.rm(catalogPath(home), { force: true });
    output.appendLine('  Removed the model catalog it wrote');
  }
  const folder = path.join(home, CODEX_BACKUP_DIR);
  if (await readText(path.join(folder, 'config.toml')) === current) {
    await fs.rm(folder, { recursive: true, force: true });
    output.appendLine('  Removed the copy it kept, which held the same configuration');
  }
  await offerCodexReload('Codex');
}

// The copy prefers the saved original: the live file may already hold a preset,
// and the baseline is the only record of what the file looked like before that.
async function keepCodexCopy(home, live) {
  let baseline = live;
  try {
    const saved = await secrets.get(CODEX_BACKUP_KEY);
    if (saved) baseline = JSON.parse(saved).config;
  } catch { /* unreadable baseline: the live file is the best record left */ }
  // A file that already selects one of our presets is this extension's own work,
  // not what Codex had before it: copying that would look like a restore point
  // while being useless as one. A configuration pointing somewhere else is the
  // user's own and is worth keeping.
  const active = configuredPreset(baseline || '', getCodexPresets());
  if (active !== 'chatgpt' && active !== 'custom') return;
  await copyCodexBackup(home, baseline);
}

// Taken as early as possible, so the folder is there before the first switch. A
// machine that never ran Codex has no home directory to put it in, and gets none.
async function keepCodexCopyOnActivation() {
  const home = codexHome();
  try {
    await fs.access(home);
    await keepCodexCopy(home, codexConfigText);
  } catch { /* no Codex home yet, or nothing to read */ }
}

async function setCodexPreset(provider, replacementKey) {
  if (!await canConfigureCodex()) return;
  const home = codexHome(), file = configPath(home);
  const current = await readCodexConfig();
  const saved = await secrets.get(CODEX_BACKUP_KEY);
  const backup = saved ? JSON.parse(saved) : { config: current, catalogCreated: false };

  if (provider === 'chatgpt') {
    if (!saved && configuredPreset(current || '', getCodexPresets()) !== 'chatgpt') {
      const preset = getCodexPresets().find(item => item.id === configuredPreset(current || '', getCodexPresets()));
      const choice = await vscode.window.showWarningMessage(
        `There is no saved Codex configuration to restore: this extension has no record of the file from before ${preset ? `the ${preset.label} preset` : 'the current provider'} was selected, which happens once it is reinstalled or its secret storage is cleared. Removing the settings it wrote hands Codex back to its own sign-in, but the API key it stored and anything it removed cannot be recovered.`,
        { modal: true }, 'Remove the settings it wrote');
      if (choice !== 'Remove the settings it wrote') return;
      await detachCodex(home, current);
      return;
    }
    if (backup.config === null) await fs.rm(file, { force: true });
    else await fs.writeFile(file, backup.config);
    if (backup.catalogCreated) await fs.rm(catalogPath(home), { force: true });
    if (saved) await secrets.delete(CODEX_BACKUP_KEY);
    output.appendLine(`Codex -> ChatGPT (${file} restored)`);
    await offerCodexReload('ChatGPT');
    return;
  }

  const preset = getCodexPresets(true).find(item => item.id === provider);
  if (!preset) return;
  const key = preset.apiKey ? replacementKey || await storedKey(preset) || await promptCodexKey(preset) : null;
  if (preset.apiKey && !key) return;
  await keepCodexCopy(home, current);
  // Persist ownership before writing, so a partial failure stays recoverable.
  if (!saved) await secrets.store(CODEX_BACKUP_KEY, JSON.stringify(backup));
  let createdCatalog = false;
  try {
    createdCatalog = await writeCodexCatalog(home, backup);
    const { text, report } = applyPreset(current || '', preset, { apiKey: key, catalogPath: catalogPath(home) });
    await fs.writeFile(file, text);
    output.appendLine(`Codex -> ${preset.label} (${file})`);
    report.forEach(line => output.appendLine(`  ${line}`));
  } catch (error) {
    if (createdCatalog) await fs.rm(catalogPath(home), { force: true });
    if (!saved) await secrets.delete(CODEX_BACKUP_KEY);
    throw error;
  }
  await offerCodexReload(preset.label);
}

async function switchCodexModel() {
  const picked = await vscode.window.showQuickPick([
    { label: '$(sparkle) ChatGPT', description: 'Restore the Codex configuration saved before the first switch', model: 'chatgpt' },
    ...getCodexPresets(true).map(preset => ({ label: `$(rocket) ${preset.label}`, description: preset.model, model: preset.id })),
  ], { title: 'Provider Switcher: Switch Codex Model', placeHolder: 'Choose the model for the Codex extension' });
  if (picked) await setCodexPreset(picked.model);
}

async function resetCodexApiKey(provider) {
  if (!await canConfigureCodex()) return;
  const presets = getCodexPresets(true).filter(preset => preset.apiKey);
  const picked = provider ? { model: provider } : await vscode.window.showQuickPick(
    presets.map(preset => ({ label: preset.label, description: preset.model, model: preset.id })),
    { title: 'Provider Switcher: Reset Codex API Key', placeHolder: 'Choose the preset whose key you want to replace' },
  );
  const preset = presets.find(item => item.id === picked?.model);
  if (!preset) return;
  const active = configuredPreset(codexConfigText || '', getCodexPresets()) === preset.id;
  const key = await promptCodexKey(preset);
  if (!key) return;
  if (active) await setCodexPreset(preset.id, key);
  await refreshConfiguredKeys(preset.key, key, active ? 'codex' : undefined);
  if (!active) vscode.window.showInformationMessage(`${preset.label} key saved for the next Codex switch.`);
}

function guarded(action, failure = 'Could not update the Claude Code provider. Check that user settings are writable and SecretStorage is available, then try again.') {
  return async () => {
    if (busy) return;
    busy = true;
    try { await action(); }
    catch { vscode.window.showErrorMessage(failure); }
    finally { busy = false; updateStatusBar(); await updateCodexStatusBar(); }
  };
}

const CODEX_FAILURE = 'Could not update the Codex configuration. Check that its configuration file is writable and SecretStorage is available, then try again.';

async function activate(context) {
  secrets = context.secrets;
  const cfg = vscode.workspace.getConfiguration('providerSwitcher');
  output = vscode.window.createOutputChannel('Provider Switcher');
  context.subscriptions.push(output);
  const alignment = cfg.get('statusBarAlignment') === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
  statusBarItem = vscode.window.createStatusBarItem('claude-code-provider', alignment, 100);
  statusBarItem.command = 'provider-switcher.switchModel';
  context.subscriptions.push(statusBarItem);
  codexStatusBarItem = vscode.window.createStatusBarItem('codex-provider', alignment, 99);
  codexStatusBarItem.command = 'provider-switcher.switchCodexModel';
  context.subscriptions.push(codexStatusBarItem);
  updateStatusBar();
  await updateCodexStatusBar();
  await adoptFileBackups();
  await keepCodexCopyOnActivation();
  const timer = setInterval(() => { updateStatusBar(); void updateCodexStatusBar(); }, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
    if (event.affectsConfiguration('claudeCode') || event.affectsConfiguration('providerSwitcher')) {
      updateStatusBar();
      await updateCodexStatusBar();
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switcher.switchModel', guarded(switchModel)));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switcher.resetApiKey', guarded(() => resetApiKey())));
  // Keep a direct DeepSeek key-reset command for custom keybindings.
  context.subscriptions.push(vscode.commands.registerCommand('provider-switcher.resetDeepseekApiKey', guarded(() => resetApiKey('deepseek'))));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switcher.configurePresets', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'providerSwitcher.presets')));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switcher.switchCodexModel', guarded(switchCodexModel, CODEX_FAILURE)));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switcher.resetCodexApiKey', guarded(() => resetCodexApiKey(), CODEX_FAILURE)));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switcher.configureCodexPresets', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'providerSwitcher.presets')));
}

function deactivate() {}

module.exports = { activate, deactivate };
