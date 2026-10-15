'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { splitPresets, isDeepseekEndpoint } = require('./presets');
const { getDeepseekRate } = require('./deepseek-rate');
const RATE_LABELS = { peak: 'High', 'off-peak': 'Low', unknown: 'Rate unknown' };
const endpointIcon = url => isDeepseekEndpoint(url) ? '🐳' : '$(rocket)';
const globalValue = (cfg, name) => cfg.inspect(name)?.globalValue;
const backupHome = () => process.env.PROVIDER_SWITCH_HOME || path.join(os.homedir(), '.provider-switch');

function createServices(vscode, secrets, output) {
  let targets = [];
  function presetsSetting() {
    return splitPresets(vscode.workspace.getConfiguration('providerSwitch').inspect('presets')?.globalValue);
  }

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

  async function readText(file) {
    try { return await fs.readFile(file, 'utf8'); }
    catch { return undefined; }
  }
  async function refreshConfiguredKeys(name, key, skip) {
    for (const target of targets) {
      const preset = target.currentPreset();
      if (target.id !== skip && preset?.key === name) await target.setPreset(preset.id, key);
    }
  }
  return { vscode, secrets, output, fs, path, globalValue, backupHome, readText,
    presetsSetting, storedKey, refreshConfiguredKeys, getDeepseekRate, RATE_LABELS, endpointIcon,
    setTargets(value) { targets = value; } };
}
module.exports = { createServices };
