'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePresets, secretKey, resolveCodexPresets, codexSecretKey } = require('../src/presets');

test('DeepSeek overrides merge and null removes inherited environment values', () => {
  const { presets, errors } = resolvePresets({ deepseek: { label: 'My DeepSeek', environment: {
    ANTHROPIC_MODEL: 'another-model', CLAUDE_CODE_AUTO_COMPACT_WINDOW: null,
  } } });
  assert.deepEqual(errors, []);
  assert.equal(presets[0].label, 'My DeepSeek');
  assert.equal(presets[0].environment.ANTHROPIC_MODEL, 'another-model');
  assert.equal(presets[0].environment.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-flash');
  assert.equal(Object.hasOwn(presets[0].environment, 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'), false);
  assert.equal(resolvePresets().presets[0].environment.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
});

test('new presets have independent environments and built-ins can be hidden', () => {
  const { presets, errors } = resolvePresets({ deepseek: null, local: {
    label: 'Local', apiKeyEnv: 'none', environment: { ANTHROPIC_BASE_URL: 'http://localhost:8080', ANTHROPIC_MODEL: 'local-model' },
  } });
  assert.deepEqual(errors, []);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].id, 'local');
  assert.equal(presets[0].environment.ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(presets[0].environment.CLAUDE_CODE_EFFORT_LEVEL, undefined);
});

test('invalid definitions are skipped without leaking their contents', () => {
  const invalid = [
    [], 'test-secret', { label: '' }, { apiKeyEnv: 'OTHER' }, { typo: true },
    { environment: [] }, { environment: { ANTHROPIC_MODEL: 123 } },
    { environment: { ANTHROPIC_BASE_URL: null } },
    { environment: { ANTHROPIC_BASE_URL: 'file:///tmp/test-secret' } },
    { environment: { ANTHROPIC_BASE_URL: 'https://user:test-secret@example.com' } },
    { environment: { ANTHROPIC_BASE_URL: 'https://example.com?key=test-secret' } },
    { environment: { ANTHROPIC_AUTH_TOKEN: 'test-secret' } },
    { environment: { CLAUDE_CODE_USE_BEDROCK: '1' } },
  ];
  for (const definition of invalid) {
    const result = resolvePresets({ deepseek: definition });
    assert.equal(result.presets.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(!result.errors.join('').includes('test-secret'));
  }
  assert.equal(resolvePresets({ claude: {}, custom: {}, 'BAD ID': {} }).errors.length, 3);
  assert.equal(resolvePresets([]).errors.length, 1);
});

test('API keys are isolated by preset, endpoint and credential variable', () => {
  const original = resolvePresets().presets[0];
  assert.equal(secretKey(original), 'deepseekApiKey');
  assert.notEqual(secretKey({ ...original, id: 'other' }), secretKey(original));
  assert.notEqual(secretKey({ ...original, apiKeyEnv: 'ANTHROPIC_API_KEY' }), secretKey(original));
  assert.notEqual(secretKey({ ...original, environment: { ANTHROPIC_BASE_URL: 'https://other.example' } }), secretKey(original));
});

test('auto-mode server default can be overridden or omitted independently per preset', () => {
  assert.equal(resolvePresets().presets[0].environment.CLAUDE_CODE_AUTO_MODE_SERVER, '0');
  for (const value of ['1', null]) {
    const { presets, errors } = resolvePresets({ deepseek: { environment: { CLAUDE_CODE_AUTO_MODE_SERVER: value } } });
    assert.deepEqual(errors, []);
    assert.equal(presets[0].environment.CLAUDE_CODE_AUTO_MODE_SERVER, value === null ? undefined : value);
  }
});

test('Codex presets default to the DeepSeek models and can be overridden or hidden', () => {
  const { presets, errors } = resolveCodexPresets();
  assert.deepEqual(errors, []);
  assert.deepEqual(presets.map(preset => preset.id), ['deepseek-flash', 'deepseek-v4-pro']);
  assert.deepEqual(presets[0], {
    id: 'deepseek-flash', label: 'DeepSeek Flash', model: 'deepseek-flash', provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/', wireApi: 'responses', reasoningEffort: 'high', apiKey: true,
  });

  const custom = resolveCodexPresets({
    'deepseek-v4-pro': null,
    local: { label: 'Local', model: 'qwen3', provider: 'local', baseUrl: 'http://localhost:8080/v1', wireApi: 'chat', reasoningEffort: 'low', apiKey: false },
  });
  assert.deepEqual(custom.errors, []);
  assert.equal(custom.presets.length, 2);
  const local = custom.presets.find(preset => preset.id === 'local');
  assert.equal(local.apiKey, false);
  assert.equal(local.wireApi, 'chat');
  assert.equal(custom.presets.filter(preset => preset.id === 'deepseek-v4-pro').length, 0);
  // Overrides merge with the built-in defaults.
  assert.equal(resolveCodexPresets({ 'deepseek-flash': { model: 'other-model' } }).presets[0].label, 'DeepSeek Flash');
  assert.equal(resolveCodexPresets({ 'deepseek-flash': { model: 'other-model' } }).presets[0].model, 'other-model');
});

test('invalid Codex presets are skipped without leaking their contents', () => {
  const invalid = [
    { model: '' }, { model: 'bad model' }, { model: 'model;rm' }, { provider: 'Bad Provider' },
    { baseUrl: 'file:///tmp/test-secret' }, { baseUrl: 'https://user:test-secret@example.com' },
    { baseUrl: 'https://example.com?key=test-secret' }, { baseUrl: 'https://example.com#test-secret' },
    { wireApi: 'sse' }, { reasoningEffort: 'insane' }, { apiKey: 'yes' }, { typo: true }, [],
  ];
  for (const definition of invalid) {
    const result = resolveCodexPresets({ local: definition });
    assert.equal(result.presets.filter(preset => preset.id === 'local').length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(!result.errors.join('').includes('test-secret'));
  }
  assert.equal(resolveCodexPresets({ chatgpt: {}, custom: {}, 'BAD ID': {} }).errors.length, 3);
  assert.equal(resolveCodexPresets([]).errors.length, 1);
});

test('Codex keys are isolated by provider and endpoint', () => {
  const [flash] = resolveCodexPresets().presets;
  // Presets for the same provider and endpoint share one key, so switching
  // between models never re-prompts.
  assert.equal(codexSecretKey(flash), codexSecretKey({ ...flash, id: 'other' }));
  assert.notEqual(codexSecretKey(flash), codexSecretKey({ ...flash, provider: 'other' }));
  assert.notEqual(codexSecretKey(flash), codexSecretKey({ ...flash, baseUrl: 'https://other.example/' }));
  // A trailing slash names the same endpoint.
  assert.equal(codexSecretKey(flash), codexSecretKey({ ...flash, baseUrl: 'https://api.deepseek.com' }));
});
