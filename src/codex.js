'use strict';
const { validateAndStoreKey } = require('./api-key');
const { resolveCodexPresets, DEFAULT_CODEX_BASE_URL } = require('./presets');
const { applyPreset, configuredPreset, detachPreset, codexHome, configPath, catalogPath } = require('./codex-config');
const kimi = require('./providers/kimi');
const KIMI_CODEX_CATALOG = require('../resources/kimi-codex-models.json');
const DEEPSEEK_CODEX_CATALOG = require('../resources/deepseek-codex-models.json');
const CODEX_BACKUP_KEY = 'codexConfigBackup.v1';
const CODEX_ICON = '🌸';
const catalogText = catalog => `${JSON.stringify(catalog, null, 2)}\n`;


function createCodexTarget(services, codexStatusBarItem) {
  const { vscode, secrets, output, fs, path, backupHome, readText,
    presetsSetting, storedKey, refreshConfiguredKeys, getDeepseekRate, RATE_LABELS, endpointIcon } = services;
  let codexConfigText = null;
  const kimiCatalogPath = home => path.join(home, 'provider-switch-kimi-models.json');
  const selectedCatalogPath = (home, preset) => kimi.isEndpoint(preset.baseUrl) ? kimiCatalogPath(home) : catalogPath(home);

  async function removeOwnedCatalogs(home, backup) {
    for (const [owned, file, catalog] of [
      [backup.catalogCreated, catalogPath(home), DEEPSEEK_CODEX_CATALOG],
      [backup.kimiCatalogCreated, kimiCatalogPath(home), KIMI_CODEX_CATALOG],
    ]) {
      if (owned && await readText(file) === catalogText(catalog)) await fs.rm(file, { force: true });
    }
  }

  const codexCopyPaths = home => [path.join(home, 'backup-provider-switch', 'config.toml'),
    path.join(backupHome(), 'codex-config.toml')];

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
    if (!vscode.workspace.getConfiguration('providerSwitch').get('showCodexStatusBar', true) ||
        !vscode.extensions.getExtension('openai.chatgpt')) {
      codexStatusBarItem.hide();
      return;
    }
    const presets = getCodexPresets();
    const provider = configuredPreset(codexConfigText || '', presets);
    const preset = presets.find(item => item.id === provider);
    codexStatusBarItem.text = `Codex: ${preset ? `${endpointIcon(preset.baseUrl)} ${preset.label}`
      : provider === 'custom' ? '$(settings-gear) Custom' : `${CODEX_ICON} ChatGPT`}`;
    const colors = {
      chatgpt: '#10a37f', kimi: '#38bdf8', 'kimi-k3': '#0ea5e9', 'deepseek-flash': '#a78bfa', 'deepseek-v4-pro': '#8b5cf6',
      ...vscode.workspace.getConfiguration('providerSwitch').get('statusBarColors', {}),
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
    return validateAndStoreKey(vscode, secrets, preset, key.trim());
  }

  async function offerCodexReload(label) {
    await updateCodexStatusBar();
    const answer = await vscode.window.showInformationMessage(
      `${label} configured for Codex. Finish active work, then reload this window and start a new Codex panel to apply it.`,
      'Reload Window',
    );
    if (answer === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  async function writeCodexCatalog(home, backup, preset) {
    const isKimi = kimi.isEndpoint(preset.baseUrl);
    const file = selectedCatalogPath(home, preset);
    const content = catalogText(isKimi ? KIMI_CODEX_CATALOG : DEEPSEEK_CODEX_CATALOG);
    const existing = await readText(file);
    if (existing !== undefined) {
      // Never replace a user's catalog or select unrelated metadata for Kimi.
      if (isKimi && existing !== content) throw new Error('Kimi catalog path is already in use');
      return false;
    }
    const ownershipKey = isKimi ? 'kimiCatalogCreated' : 'catalogCreated';
    backup[ownershipKey] = true;
    await secrets.store(CODEX_BACKUP_KEY, JSON.stringify(backup));
    await fs.writeFile(file, content, { flag: 'wx' });
    return true;
  }

  async function copyCodexBackup(home, config) {
    if (config === null) return;
    for (const target of codexCopyPaths(home)) {
      if (await readText(target) !== undefined) continue;
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, config);
        output.appendLine(`Kept the original ${configPath(home)} at ${target}`);
      } catch {
        output.appendLine(`Could not copy the original configuration to ${target}`);
      }
    }
  }

  async function adoptCodexCopy() {
    if (await secrets.get(CODEX_BACKUP_KEY)) return;
    const home = codexHome(), catalog = `${JSON.stringify(DEEPSEEK_CODEX_CATALOG, null, 2)}\n`;
    for (const file of codexCopyPaths(home)) {
      const saved = await readText(file);
      if (saved === undefined) continue;
      const active = configuredPreset(saved, getCodexPresets());
      if (active !== 'chatgpt' && active !== 'custom') continue;
      const owned = await readText(catalogPath(home)) === catalog;
      await secrets.store(CODEX_BACKUP_KEY, JSON.stringify({ config: saved, catalogCreated: owned,
        kimiCatalogCreated: await readText(kimiCatalogPath(home)) === catalogText(KIMI_CODEX_CATALOG) }));
      output.appendLine(`Adopted the Codex configuration kept at ${file}`);
      return;
    }
  }

  async function detachCodex(home, current) {
    const active = configuredPreset(current || '', getCodexPresets());
    const preset = getCodexPresets().find(item => item.id === active);
    const { text, report } = detachPreset(current || '', preset?.provider);
    output.appendLine(`Codex -> detached (${configPath(home)})`);
    report.forEach(line => output.appendLine(`  ${line}`));
    await fs.writeFile(configPath(home), text);
    await removeOwnedCatalogs(home, { catalogCreated: true, kimiCatalogCreated: true });
    // The copy beside the file sits in a folder of its own; the one beside the
    // panel's copy must not take that folder down with it.
    const [beside, central] = codexCopyPaths(home);
    for (const file of [beside, central]) {
      if (await readText(file) !== current) continue;
      await fs.rm(file === beside ? path.dirname(file) : file, { recursive: true, force: true });
      output.appendLine(`  Removed the copy it kept at ${file}`);
    }
    await offerCodexReload('Codex');
  }

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
      await removeOwnedCatalogs(home, backup);
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
      createdCatalog = await writeCodexCatalog(home, backup, preset);
      const { text, report } = applyPreset(current || '', preset, { apiKey: key, catalogPath: selectedCatalogPath(home, preset) });
      await fs.writeFile(file, text);
      output.appendLine(`Codex -> ${preset.label} (${file})`);
      report.forEach(line => output.appendLine(`  ${line}`));
    } catch (error) {
      if (createdCatalog) await fs.rm(selectedCatalogPath(home, preset), { force: true });
      if (saved) await secrets.store(CODEX_BACKUP_KEY, saved);
      if (!saved) await secrets.delete(CODEX_BACKUP_KEY);
      throw error;
    }
    await offerCodexReload(preset.label);
  }

  async function switchCodexModel() {
    const picked = await vscode.window.showQuickPick([
      { label: '$(sparkle) ChatGPT', description: 'Restore the Codex configuration saved before the first switch', model: 'chatgpt' },
      ...getCodexPresets(true).map(preset => ({ label: `${endpointIcon(preset.baseUrl)} ${preset.label}`, description: preset.model, model: preset.id })),
      { label: '$(key) Reconnect / Change API Key…', description: 'Enter a replacement key for DeepSeek, Kimi, or another provider', action: 'reconnect' },
    ], { title: 'Provider Switch: Switch Codex Model', placeHolder: 'Choose the model for the Codex extension' });
    if (picked?.action === 'reconnect') await resetCodexApiKey();
    else if (picked) await setCodexPreset(picked.model);
  }

  async function resetCodexApiKey(provider) {
    if (!await canConfigureCodex()) return;
    const presets = getCodexPresets(true).filter(preset => preset.apiKey);
    const picked = provider ? { model: provider } : await vscode.window.showQuickPick(
      presets.map(preset => ({ label: `${endpointIcon(preset.baseUrl)} ${preset.label}`, description: preset.model, model: preset.id })),
      { title: 'Provider Switch: Reset Codex API Key', placeHolder: 'Choose the preset whose key you want to replace' },
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
  return { id: 'codex', updateStatus: updateCodexStatusBar, adoptBackup: adoptCodexCopy,
    keepBackup: keepCodexCopyOnActivation,
    currentPreset: () => getCodexPresets().find(preset => preset.id === configuredPreset(codexConfigText || '', getCodexPresets())),
    setPreset: setCodexPreset, switchModel: switchCodexModel, resetApiKey: resetCodexApiKey };
}
module.exports = { createCodexTarget };
