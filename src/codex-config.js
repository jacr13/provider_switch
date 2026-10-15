'use strict';

const os = require('node:os');
const kimi = require('./providers/kimi');
const path = require('node:path');

const PROVIDER_DEFAULT = 'deepseek';
const BASE_URL_DEFAULT = 'https://api.deepseek.com/';
// The desktop app reads its reasoning-effort list from this key, and a duplicate
// [desktop] table would make the file invalid, so it is written exactly once.
const DESKTOP_KEY = 'enabled-reasoning-efforts';
const DESKTOP_VALUE = '["low", "medium", "high", "xhigh", "ultra", "max"]';
// Top-level keys that must be replaced in place (before the first [section]).
const TARGET_KEYS = [
  'model', 'model_provider', 'preferred_auth_method', 'forced_login_method',
  'model_reasoning_effort', 'web_search', 'show_raw_agent_reasoning', 'model_catalog_json',
];
// Keys that mask or redirect the selected provider.
const MASKING_KEYS = ['profile', 'oss_provider', 'openai_base_url'];
// Keys that contradict the model catalog (context window, instructions, compaction).
const CONFLICTING_KEYS = [
  'model_context_window', 'model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope',
  'base_instructions', 'model_instructions_file', 'compact_prompt', 'experimental_compact_prompt_file',
  'service_tier', 'model_verbosity', 'model_reasoning_summary', 'plan_mode_reasoning_effort',
  'experimental_use_unified_exec_tool',
];
// Kept, but reported: they may fall back to metadata for another model.
const WARN_KEYS = [
  'review_model', 'experimental_thread_config_endpoint',
  'experimental_thread_store_endpoint', 'experimental_thread_store',
];

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const configPath = home => path.join(home, 'config.toml');
const catalogPath = home => path.join(home, 'models.json');

const trim = value => value.trim();
const unquote = value => {
  const text = trim(value || '');
  if (text.startsWith('"') && text.endsWith('"') && text.length > 1) {
    return text.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (match, escape) =>
      escape === 'n' ? '\n' : escape === 't' ? '\t' : escape === 'r' ? '\r' : escape.startsWith('u') ? String.fromCharCode(parseInt(escape.slice(1), 16)) : escape);
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length > 1) return text.slice(1, -1);
  return text;
};
// Backslashes are escape characters in TOML basic strings, so Windows paths and
// quotes must be escaped or the file fails to parse.
const tomlString = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const normalizeUrl = value => String(value || '').replace(/\/+$/, '').toLowerCase();

// Character-level state machine: locates comment starts and tracks bracket depth
// and multi-line strings so multi-line arrays are never mistaken for new keys.
function scanner() {
  let depth = 0, ml = '';
  return {
    scan(line) {
      let index = 0, inString = '';
      while (index < line.length) {
        const char = line[index];
        const three = line.slice(index, index + 3);
        if (ml) {
          if (ml === 'basic' && three === '"""') { ml = ''; index += 3; continue; }
          if (ml === 'literal' && three === "'''") { ml = ''; index += 3; continue; }
          if (ml === 'basic' && char === '\\') { index += 2; continue; }
          index += 1; continue;
        }
        if (inString) {
          if (inString === 'basic') {
            if (char === '\\') { index += 2; continue; }
            if (char === '"') inString = '';
          } else if (char === "'") inString = '';
          index += 1; continue;
        }
        if (three === '"""') { ml = 'basic'; index += 3; continue; }
        if (three === "'''") { ml = 'literal'; index += 3; continue; }
        if (char === '#') return;
        if (char === '"') inString = 'basic';
        else if (char === "'") inString = 'literal';
        else if (char === '[') depth += 1;
        else if (char === ']' && depth > 0) depth -= 1;
        index += 1;
      }
    },
    open: () => ml !== '' || depth !== 0,
  };
}

function keyOf(line) {
  const text = trim(line);
  if (!text || text.startsWith('#') || !text.includes('=')) return '';
  let key = trim(text.slice(0, text.indexOf('=')));
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  return key;
}

const valueOf = line => (line.includes('=') ? trim(line.slice(line.indexOf('=') + 1)) : '');
const headerOf = text => trim(trim(text).replace(/^\[+/, '').split(']')[0]).replace(/["']/g, '');
const dropTrailingBlanks = lines => { while (lines.length && !trim(lines[lines.length - 1])) lines.pop(); };

// Reads the leading top-level area (before the first section) or one section.
function readKeys(text, section) {
  const keys = {}, scan = scanner();
  let current = '', isLeading = true;
  for (const line of String(text || '').split('\n')) {
    if (!scan.open() && trim(line).startsWith('[')) {
      current = headerOf(line);
      isLeading = false;
    } else if (!scan.open()) {
      const key = keyOf(line);
      if (key && (isLeading ? !section : current === section)) keys[key] = valueOf(line);
    }
    scan.scan(line);
  }
  return keys;
}

const targetValue = (preset, key, options) => {
  switch (key) {
    case 'model': return tomlString(preset.model);
    case 'model_provider': return tomlString(preset.provider);
    case 'preferred_auth_method': return '"apikey"';
    case 'forced_login_method': return '"api"';
    case 'model_reasoning_effort': return tomlString(preset.reasoningEffort);
    case 'web_search': return kimi.isEndpoint(preset.baseUrl) ? '"live"' : '"disabled"';
    case 'show_raw_agent_reasoning': return 'true';
    case 'model_catalog_json': return tomlString(options.catalogPath);
    default: return '';
  }
};

// Rewrites a config.toml so Codex uses the preset's provider and model, keeping
// unrelated settings (projects, MCP servers, notify) byte-identical.
function applyPreset(text, preset, options = {}) {
  const desktopValue = kimi.isEndpoint(preset.baseUrl) ? JSON.stringify(kimi.reasoningLevels) : DESKTOP_VALUE;
  const lines = String(text || '').split('\n');
  const out = [], report = [];
  const scan = scanner();
  const skipped = `model_providers.${preset.provider}`;
  const seen = new Set();
  let index = 0, inLeading = true, section = '', skipSection = false, insertAt = 0, desktopDone = false, providerAt = -1;

  const consume = () => {
    scan.scan(lines[index]);
    index += 1;
    while (scan.open() && index < lines.length) {
      scan.scan(lines[index]);
      index += 1;
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!scan.open() && trim(line).startsWith('[')) {
      if (inLeading) {
        // Keys missing from the original file must land before the first section,
        // above any blank line, so they read as top-level settings.
        const missing = TARGET_KEYS.filter(key => !seen.has(key));
        if (missing.length) {
          dropTrailingBlanks(out);
          out.push(...missing.map(key => `${key} = ${targetValue(preset, key, options)}`), '');
          missing.forEach(key => seen.add(key));
        }
        inLeading = false;
      }
      section = headerOf(line);
      skipSection = section === skipped || section.startsWith(`${skipped}.`) ||
        section === 'profiles' || section.startsWith('profiles.');
      if (skipSection) {
        // A profile is dropped for good; the old provider table is rewritten in
        // place below, so switching back and forth stays byte-identical.
        if (providerAt < 0 && (section === skipped || section.startsWith(`${skipped}.`))) providerAt = out.length;
        report.push(`Replaced the existing [${section}] section`);
        scan.scan(line);
        index += 1;
        continue;
      }
      out.push(line);
      if (section === 'desktop' && !desktopDone) {
        // The desktop app reads its effort list from here, and a duplicate
        // [desktop] table would make the file invalid.
        out.push(`${DESKTOP_KEY} = ${desktopValue}`);
        desktopDone = true;
      }
      scan.scan(line);
      index += 1;
      continue;
    }
    if (!inLeading) {
      if (skipSection) {
        scan.scan(line);
        index += 1;
        continue;
      }
      const key = keyOf(line);
      if (section === 'desktop' && key === DESKTOP_KEY) {
        const previous = valueOf(line);
        consume();
        report.push(`Rewrote ${DESKTOP_KEY} in [desktop]: ${previous} -> ${desktopValue}`);
        continue;
      }
      if (key === 'wire_api' && /^["']chat["']/.test(valueOf(line))) {
        out.push(line.replace(/=\s*(["'])chat\1/, '= "responses"'));
        report.push(`Fixed wire_api in [${section}]: "chat" -> "responses" (this version refuses to start with chat)`);
        scan.scan(line);
        index += 1;
        continue;
      }
      out.push(line);
      scan.scan(line);
      index += 1;
      continue;
    }
    if (scan.open()) {
      // Continuation of a multi-line string or array: copy verbatim.
      out.push(line);
      scan.scan(line);
      if (!scan.open()) insertAt = out.length;
      index += 1;
      continue;
    }
    const key = keyOf(line);
    if (key && TARGET_KEYS.includes(key)) {
      const previous = valueOf(line);
      const next = targetValue(preset, key, options);
      consume();
      out.push(`${key} = ${next}`);
      insertAt = out.length;
      seen.add(key);
      if (previous !== next) report.push(`Rewrote ${key}: ${previous} -> ${next}`);
      continue;
    }
    if (key && (MASKING_KEYS.includes(key) || CONFLICTING_KEYS.includes(key))) {
      // Value is left out of the report: a removed URL could embed a credential.
      consume();
      report.push(`Removed ${key}`);
      continue;
    }
    if (key && WARN_KEYS.includes(key)) report.push(`Kept ${key} (it may override the model catalog)`);
    out.push(line);
    scan.scan(line);
    // Never insert missing keys inside an assignment that is still open.
    if (key && !scan.open()) insertAt = out.length;
    index += 1;
  }

  // A file without any section still gets every target key, before the tables below.
  const missing = TARGET_KEYS.filter(key => !seen.has(key));
  if (missing.length) {
    if (inLeading) dropTrailingBlanks(out);
    out.splice(inLeading ? out.length : insertAt, 0, ...missing.map(key => `${key} = ${targetValue(preset, key, options)}`));
  }
  if (!desktopDone) out.push('', '[desktop]', `${DESKTOP_KEY} = ${desktopValue}`);
  const provider = [`[model_providers.${preset.provider}]`, `name = ${tomlString(preset.provider)}`,
    `base_url = ${tomlString(preset.baseUrl)}`, `wire_api = ${tomlString(preset.wireApi)}`];
  if (options.apiKey) provider.push(`experimental_bearer_token = ${tomlString(options.apiKey)}`);
  if (providerAt < 0) {
    dropTrailingBlanks(out);
    out.push('', ...provider);
  } else {
    out.splice(providerAt, 0, ...provider);
  }
  report.push(`Wrote [model_providers.${preset.provider}]`);
  return { text: `${out.join('\n').replace(/\n*$/, '')}\n`, report };
}

// Which preset the file currently selects, for the status bar.
function configuredPreset(text, presets) {
  const leading = readKeys(text);
  const provider = unquote(leading.model_provider);
  if (!provider) return 'chatgpt';
  const model = unquote(leading.model);
  const table = readKeys(text, `model_providers.${provider}`);
  const endpoint = normalizeUrl(unquote(table.base_url));
  const match = presets.find(preset => preset.provider === provider && preset.model === model &&
    normalizeUrl(preset.baseUrl) === endpoint);
  return match ? match.id : 'custom';
}

// Puts the file back as far as it can without the original bytes: the keys this
// extension writes and the provider table it added are removed and everything
// else is left alone. Used when the saved original is gone, which happens when
// the extension is reinstalled or its secret storage is cleared.
function detachPreset(text, provider) {
  const lines = String(text || '').split('\n');
  const out = [], report = [];
  const scan = scanner();
  const skip = provider ? `model_providers.${provider}` : '';
  let index = 0, inLeading = true, section = '', skipSection = false;
  while (index < lines.length) {
    const line = lines[index];
    const consume = () => {
      scan.scan(lines[index]);
      index += 1;
      while (scan.open() && index < lines.length) {
        scan.scan(lines[index]);
        index += 1;
      }
    };
    if (!scan.open() && trim(line).startsWith('[')) {
      inLeading = false;
      section = headerOf(line);
      skipSection = Boolean(skip) && (section === skip || section.startsWith(`${skip}.`));
      if (skipSection) {
        report.push(`Removed [${section}]`);
        consume();
        continue;
      }
      out.push(line);
      scan.scan(line);
      index += 1;
      continue;
    }
    if (!inLeading && skipSection) {
      consume();
      continue;
    }
    const key = keyOf(line);
    if (inLeading && key && TARGET_KEYS.includes(key)) {
      report.push(`Removed ${key}`);
      consume();
      continue;
    }
    if (section === 'desktop' && key === DESKTOP_KEY) {
      report.push(`Removed ${DESKTOP_KEY} from [desktop]`);
      consume();
      continue;
    }
    out.push(line);
    scan.scan(line);
    index += 1;
  }
  dropTrailingBlanks(out);
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return { text: body ? `${body}\n` : '', report };
}

module.exports = {
  applyPreset, configuredPreset, detachPreset, codexHome, configPath, catalogPath, tomlString,
  DEFAULT_CODEX_PROVIDER: PROVIDER_DEFAULT, DEFAULT_CODEX_BASE_URL: BASE_URL_DEFAULT,
};
