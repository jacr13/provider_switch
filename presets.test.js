'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePresets, secretKey } = require('./presets');

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
