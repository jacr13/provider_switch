'use strict';

const CLEAR_ENV = {
  ANTHROPIC_AUTH_TOKEN: '',
  ANTHROPIC_API_KEY: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  CLAUDE_CODE_USE_BEDROCK: '0',
  CLAUDE_CODE_USE_VERTEX: '0',
  CLAUDE_CODE_USE_FOUNDRY: '0',
};
const DEFAULT_PRESETS = {
  deepseek: {
    label: 'DeepSeek',
    apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
    environment: {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_MODEL: 'deepseek-flash[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash[1m]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432',
      CLAUDE_CODE_AUTO_MODE_SERVER: '0',
    },
  },
};
// Keep legacy backup ownership fixed. New preset variables are tracked when applied.
const BASE_MANAGED_KEYS = [
  ...Object.keys(CLEAR_ENV), 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
];
// Codex presets are independent from the Claude Code ones: they select a model
// for the OpenAI-compatible endpoint Codex talks to, via ~/.codex/config.toml.
const CODEX_BASE_URL = 'https://api.deepseek.com/';
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'ultra', 'max'];
const DEFAULT_CODEX_PRESETS = {
  'deepseek-flash': { label: 'DeepSeek Flash', model: 'deepseek-flash' },
  'deepseek-v4-pro': { label: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro' },
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function resolvePresets(config = {}) {
  const presets = [], errors = [];
  if (!object(config)) return { presets, errors: ['providerSwitcher.presets must be an object.'] };
  for (const [id, override] of Object.entries({ ...DEFAULT_PRESETS, ...config })) {
    if (override === null) continue;
    try {
      if (!/^[a-z][a-z0-9-]*$/.test(id) || ['claude', 'custom'].includes(id)) throw new Error();
      if (!object(override) || Object.keys(override).some(key => !['label', 'apiKeyEnv', 'environment'].includes(key))) throw new Error();
      const defaults = Object.hasOwn(DEFAULT_PRESETS, id) ? DEFAULT_PRESETS[id] : {};
      const label = override.label === undefined ? defaults.label ?? id : override.label;
      const apiKeyEnv = override.apiKeyEnv === undefined ? defaults.apiKeyEnv ?? 'ANTHROPIC_AUTH_TOKEN' : override.apiKeyEnv;
      if (typeof label !== 'string' || !label.trim() || !['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'none'].includes(apiKeyEnv)) throw new Error();
      if (override.environment !== undefined && !object(override.environment)) throw new Error();
      const environment = { ...CLEAR_ENV, ...defaults.environment };
      for (const [name, value] of Object.entries(override.environment || {})) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || (value !== null && typeof value !== 'string')) throw new Error();
        // Credentials belong in SecretStorage, not in the preset definition.
        if (['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(name)) throw new Error();
        if (value === null) delete environment[name]; else environment[name] = value;
      }
      const endpoint = new URL(environment.ANTHROPIC_BASE_URL);
      if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
      if (['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(key => environment[key] !== '0')) throw new Error();
      presets.push({ id, label: label.trim(), apiKeyEnv, environment });
    } catch {
      errors.push('Invalid preset in providerSwitcher.presets. Check its ID, label, API key variable, and environment (including ANTHROPIC_BASE_URL).');
    }
  }
  return { presets, errors };
}

function secretKey(preset) {
  // Preserve the existing DeepSeek key, but never reuse it for a different endpoint.
  const endpoint = preset.environment.ANTHROPIC_BASE_URL.replace(/\/$/, '');
  if (preset.id === 'deepseek' && endpoint === DEFAULT_PRESETS.deepseek.environment.ANTHROPIC_BASE_URL && preset.apiKeyEnv === 'ANTHROPIC_AUTH_TOKEN') return 'deepseekApiKey';
  return `presetApiKey:${JSON.stringify([preset.id, endpoint, preset.apiKeyEnv])}`;
}

function resolveCodexPresets(config = {}) {
  const presets = [], errors = [];
  if (!object(config)) return { presets, errors: ['providerSwitcher.codexPresets must be an object.'] };
  for (const [id, override] of Object.entries({ ...DEFAULT_CODEX_PRESETS, ...config })) {
    if (override === null) continue;
    try {
      if (!/^[a-z][a-z0-9-]*$/.test(id) || ['chatgpt', 'custom'].includes(id)) throw new Error();
      if (!object(override) || Object.keys(override).some(key =>
        !['label', 'model', 'provider', 'baseUrl', 'wireApi', 'reasoningEffort', 'apiKey'].includes(key))) throw new Error();
      const defaults = Object.hasOwn(DEFAULT_CODEX_PRESETS, id) ? DEFAULT_CODEX_PRESETS[id] : {};
      const label = override.label === undefined ? defaults.label ?? id : override.label;
      const model = override.model === undefined ? defaults.model ?? id : override.model;
      const provider = override.provider === undefined ? 'deepseek' : override.provider;
      const baseUrl = override.baseUrl === undefined ? CODEX_BASE_URL : override.baseUrl;
      const wireApi = override.wireApi === undefined ? 'responses' : override.wireApi;
      const reasoningEffort = override.reasoningEffort === undefined ? 'high' : override.reasoningEffort;
      const apiKey = override.apiKey === undefined ? true : override.apiKey;
      if (typeof label !== 'string' || !label.trim()) throw new Error();
      // Model and provider end up inside TOML strings; keep them to safe characters.
      if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/.test(model)) throw new Error();
      if (typeof provider !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(provider)) throw new Error();
      if (typeof baseUrl !== 'string') throw new Error();
      const endpoint = new URL(baseUrl);
      if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
          endpoint.search || endpoint.hash) throw new Error();
      if (!['responses', 'chat'].includes(wireApi) || !CODEX_EFFORTS.includes(reasoningEffort)) throw new Error();
      if (typeof apiKey !== 'boolean') throw new Error();
      presets.push({ id, label: label.trim(), model, provider, baseUrl, wireApi, reasoningEffort, apiKey });
    } catch {
      errors.push('Invalid preset in providerSwitcher.codexPresets. Check its ID, label, model, provider, base URL, wire API, and reasoning effort.');
    }
  }
  return { presets, errors };
}

function codexSecretKey(preset) {
  const endpoint = preset.baseUrl.replace(/\/+$/, '');
  return `codexApiKey:${JSON.stringify([preset.provider, endpoint])}`;
}

module.exports = {
  resolvePresets, secretKey, BASE_MANAGED_KEYS, DEFAULT_PRESETS,
  resolveCodexPresets, codexSecretKey, DEFAULT_CODEX_PRESETS, DEFAULT_CODEX_BASE_URL: CODEX_BASE_URL,
};
