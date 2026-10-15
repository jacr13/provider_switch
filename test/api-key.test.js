'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkApiKey } = require('../src/api-key');
const { resolveClaudePresets, resolveCodexPresets } = require('../src/presets');

for (const [target, presets] of [['Claude', resolveClaudePresets().presets], ['Codex', resolveCodexPresets().presets]]) {
  for (const preset of presets) {
    test(`${target} ${preset.id} checks model discovery with the correct credentials`, async () => {
      const result = await checkApiKey(preset, 'test-key', async (url, options) => {
        assert.equal(url.pathname, preset.id.startsWith('kimi') ? '/coding/v1/models' : '/models');
        assert.equal(options.headers[preset.apiKeyEnv === 'ANTHROPIC_API_KEY' ? 'x-api-key' : 'Authorization'],
          preset.apiKeyEnv === 'ANTHROPIC_API_KEY' ? 'test-key' : 'Bearer test-key');
        assert.equal(options.redirect, 'manual');
        assert.ok(options.signal instanceof AbortSignal);
        return { ok: true, json: async () => ({ data: [{ id: 'model' }] }) };
      });
      assert.equal(result.state, 'accepted');
    });
  }
}
for (const [status, state] of [[401, 'rejected'], [403, 'unknown'], [429, 'unknown'], [500, 'unknown'], [404, 'unknown'], [302, 'unknown']]) {
  test(`HTTP ${status} is ${state}`, async () => {
    assert.equal((await checkApiKey({ baseUrl: 'https://example.com/v1' }, 'secret', async () => ({ status, ok: false }))).state, state);
  });
}
test('network errors never expose credentials', async () => {
  const result = await checkApiKey({ baseUrl: 'https://example.com' }, 'secret', async () => { throw Error('secret'); });
  assert.equal(result.state, 'unknown');
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('HTML and unexpected JSON responses cannot pass verification', async () => {
  for (const json of [async () => { throw Error('HTML'); }, async () => ({})]) {
    assert.equal((await checkApiKey({ baseUrl: 'https://example.com' }, 'secret', async () => ({ ok: true, json }))).state, 'unknown');
  }
});
