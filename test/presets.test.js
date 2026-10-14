'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitPresets, apiKeyName, resolveClaudePresets, resolveCodexPresets } = require('../src/presets');

test('the preset setting is split per target, and the older flat shape is read as the panel section', () => {
  assert.deepEqual(splitPresets(undefined), { claude: {}, codex: {} });
  assert.deepEqual(splitPresets({ claude: { one: {} }, codex: { two: {} } }), { claude: { one: {} }, codex: { two: {} } });
  // Settings written before the sections existed held the panel presets directly.
  assert.deepEqual(splitPresets({ deepseek: { label: 'kept' } }), { claude: { deepseek: { label: 'kept' } }, codex: {} });
  // A section that is missing or not an object falls back to the built-in presets.
  assert.deepEqual(splitPresets({ claude: null, codex: [] }), { claude: {}, codex: {} });
});

test('DeepSeek overrides merge and null removes inherited environment values', () => {
  const { presets, errors } = resolveClaudePresets({ deepseek: { label: 'My DeepSeek', environment: {
    ANTHROPIC_MODEL: 'another-model', CLAUDE_CODE_AUTO_COMPACT_WINDOW: null,
  } } });
  assert.deepEqual(errors, []);
  assert.equal(presets[0].label, 'My DeepSeek');
  assert.equal(presets[0].environment.ANTHROPIC_MODEL, 'another-model');
  assert.equal(presets[0].environment.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-flash');
  assert.equal(Object.hasOwn(presets[0].environment, 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'), false);
  assert.equal(resolveClaudePresets().presets[0].environment.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
});

test('new presets have independent environments and built-ins can be hidden', () => {
  const { presets, errors } = resolveClaudePresets({ deepseek: null, local: {
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
    const result = resolveClaudePresets({ deepseek: definition });
    assert.equal(result.presets.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(!result.errors.join('').includes('test-secret'));
  }
  assert.equal(resolveClaudePresets({ claude: {}, custom: {}, 'BAD ID': {} }).errors.length, 3);
  assert.equal(resolveClaudePresets([]).errors.length, 1);
});

test('one key per endpoint host is shared by every preset on both targets', () => {
  const [panel] = resolveClaudePresets().presets;
  const [flash, pro] = resolveCodexPresets().presets;
  assert.equal(panel.key, 'deepseekApiKey');
  assert.equal(flash.key, 'deepseekApiKey');
  assert.equal(pro.key, 'deepseekApiKey');
  // Panel and Codex reach DeepSeek through different paths on the same host.
  assert.equal(apiKeyName('https://api.deepseek.com/anthropic'), apiKeyName('https://api.deepseek.com/'));
  // Other hosts keep their own key, and a host with no key is never prompted.
  assert.equal(apiKeyName('http://localhost:8080'), 'apiKey:http://localhost:8080');
  assert.notEqual(apiKeyName('https://other.example/anthropic'), 'deepseekApiKey');
  // The built-in DeepSeek preset already used the shared name, so it has nothing
  // to adopt; a preset added on the same host adopts the older per-preset name.
  assert.deepEqual(panel.previousKeys, []);
  const added = resolveClaudePresets({ second: { environment: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' } } })
    .presets.find(preset => preset.id === 'second');
  assert.equal(added.key, 'deepseekApiKey');
  assert.deepEqual(added.previousKeys, ['presetApiKey:["second","https://api.deepseek.com/anthropic","ANTHROPIC_AUTH_TOKEN"]']);
});

test('auto-mode server default can be overridden or omitted independently per preset', () => {
  assert.equal(resolveClaudePresets().presets[0].environment.CLAUDE_CODE_AUTO_MODE_SERVER, '0');
  for (const value of ['1', null]) {
    const { presets, errors } = resolveClaudePresets({ deepseek: { environment: { CLAUDE_CODE_AUTO_MODE_SERVER: value } } });
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
    key: 'deepseekApiKey', previousKeys: ['codexApiKey:["deepseek","https://api.deepseek.com"]'],
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

test('Codex presets share the endpoint key and adopt the older provider-based name', () => {
  const [flash] = resolveCodexPresets().presets;
  const [pro] = resolveCodexPresets().presets.slice(1);
  // Switching between the two DeepSeek models never re-prompts.
  assert.equal(flash.key, pro.key);
  const local = resolveCodexPresets({ local: { model: 'qwen3', provider: 'local', baseUrl: 'http://localhost:8080/v1' } })
    .presets.find(preset => preset.id === 'local');
  assert.equal(local.key, 'apiKey:http://localhost:8080');
  assert.deepEqual(local.previousKeys, ['codexApiKey:["local","http://localhost:8080/v1"]']);
});
