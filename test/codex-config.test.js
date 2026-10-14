'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPreset, configuredPreset, tomlString } = require('../src/codex-config');
const { resolveCodexPresets } = require('../src/presets');

const preset = resolveCodexPresets().presets.find(item => item.id === 'deepseek-flash');
const options = { apiKey: 'sk-test-secret', catalogPath: 'C:\\Users\\test\\.codex\\models.json' };
const apply = (text, overrides = {}) => applyPreset(text, { ...preset, ...overrides }, options);

// Mirrors the shape of a real ~/.codex/config.toml: leading keys, multi-line
// arrays, and sections whose contents must survive untouched.
const existing = `model = "gpt-6-astra"
model_reasoning_effort = "high"

service_tier = "default"
approval_policy = "never"
notify = [ "C:\\\\tools\\\\codex-notify.exe", "turn-ended" ]
profile = "work"
openai_base_url = "https://proxy.example"

[windows]
sandbox = "elevated"

[projects.'c:\\users\\test\\projects\\app']
trust_level = "trusted"

[mcp_servers.node_repl]
command = 'C:\\tools\\node_repl.exe'
env_vars = ["KEEP"]

[model_providers.deepseek]
name = "old"
base_url = "https://stale.example/"
wire_api = "chat"

[model_providers.other]
base_url = "https://other.example/"
`;

test('missing keys are inserted before the first section and unrelated content survives', () => {
  const { text, report } = apply('model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n\n[projects.\'c:\\app\']\ntrust_level = "trusted"\n');
  const sections = text.indexOf("[projects.'c:\\app']");
  assert.ok(text.indexOf('model = "deepseek-flash"') < sections);
  assert.ok(text.indexOf('model_provider = "deepseek"') < sections);
  assert.ok(text.indexOf('model_catalog_json = "C:\\\\Users\\\\test\\\\.codex\\\\models.json"') < sections);
  assert.ok(text.indexOf('web_search = "disabled"') < sections);
  assert.equal(text.match(/model_reasoning_effort/g).length, 1);
  assert.match(text, /\[projects\.'c:\\app'\]\ntrust_level = "trusted"/);
  assert.match(text, /\[model_providers\.deepseek\]\nname = "deepseek"\nbase_url = "https:\/\/api\.deepseek\.com\/"\nwire_api = "responses"\nexperimental_bearer_token = "sk-test-secret"/);
  assert.match(text, /\[desktop\]\nenabled-reasoning-efforts = \["low", "medium", "high", "xhigh", "ultra", "max"\]/);
  assert.ok(report.some(entry => entry.startsWith('Rewrote model:')));
});

test('masking and conflicting keys are removed, warn keys kept, provider table replaced', () => {
  const { text, report } = apply(existing);
  assert.ok(!text.includes('profile ='));
  assert.ok(!text.includes('oss_provider'));
  assert.ok(!text.includes('openai_base_url'));
  assert.ok(!text.includes('service_tier'));
  assert.match(text, /approval_policy = "never"/);
  assert.match(text, /notify = \[ "C:\\\\tools\\\\codex-notify\.exe", "turn-ended" \]/);
  assert.match(text, /sandbox = "elevated"/);
  assert.match(text, /env_vars = \["KEEP"\]/);
  assert.match(text, /\[model_providers\.other\]\nbase_url = "https:\/\/other\.example\/"/);
  assert.equal(text.match(/\[model_providers\.deepseek\]/g).length, 1);
  assert.ok(!text.includes('stale.example'));
  assert.ok(!text.includes('wire_api = "chat"'));
  assert.match(text, /wire_api = "responses"/);
  assert.ok(report.some(entry => entry.includes('Removed openai_base_url')));
  assert.ok(report.some(entry => entry.includes('Replaced the existing [model_providers.deepseek]')));
});

test('profiles section and duplicated desktop table are not produced', () => {
  const withProfiles = apply('[profiles.work]\nmodel = "gpt-6-astra"\n\n[desktop]\nenabled-reasoning-efforts = ["low"]\nother = "keep"\n');
  assert.ok(!withProfiles.text.includes('[profiles.work]'));
  assert.equal(withProfiles.text.match(/\[desktop\]/g).length, 1);
  assert.match(withProfiles.text, /enabled-reasoning-efforts = \["low", "medium", "high", "xhigh", "ultra", "max"\]\nother = "keep"/);
  assert.ok(withProfiles.report.some(entry => entry.includes('enabled-reasoning-efforts')));
  // A multi-line previous value is swallowed whole.
  const multiline = apply('[desktop]\nenabled-reasoning-efforts = [\n  "low",\n  "high",\n]\nkeep = "x"\n');
  assert.equal(multiline.text.match(/enabled-reasoning-efforts/g).length, 1);
  assert.match(multiline.text, /keep = "x"/);
});

test('applying twice is idempotent and keys land in the leading area once', () => {
  const first = apply(existing).text;
  const second = apply(first).text;
  assert.equal(second, first);
  assert.equal(first.match(/^model = /gm).length, 1);
  assert.equal(first.match(/\[model_providers\.deepseek\]/g).length, 1);
});

test('brackets inside multi-line strings and arrays never look like sections or keys', () => {
  const tricky = `model = "gpt-6-astra"
notes = """
[not_a_section]
model = "not-a-key"
"""

[windows]
sandbox = "elevated"
`;
  const { text } = apply(tricky);
  // The string body is untouched, and the inserted keys land after it, before the section.
  assert.match(text, /notes = """\n\[not_a_section\]\nmodel = "not-a-key"\n"""/);
  assert.ok(text.indexOf('model = "not-a-key"') < text.indexOf('model_provider = "deepseek"'));
  assert.ok(text.indexOf('model_provider = "deepseek"') < text.indexOf('[windows]'));
  // The identical-looking line inside the string is not mistaken for the real key.
  assert.equal(configuredPreset(text, [preset]), 'deepseek-flash');
});

test('values are escaped for TOML and detection matches only the configured preset', () => {
  assert.equal(tomlString('C:\\Users\\test'), '"C:\\\\Users\\\\test"');
  assert.equal(tomlString('a"b'), '"a\\"b"');
  const { text } = apply(existing);
  assert.equal(configuredPreset(text, [preset]), 'deepseek-flash');
  assert.equal(configuredPreset('model = "gpt-6-astra"\n', [preset]), 'chatgpt');
  assert.equal(configuredPreset(text.replace('model = "deepseek-flash"', 'model = "other"'), [preset]), 'custom');
  assert.equal(configuredPreset(text.replace('https://api.deepseek.com/', 'https://proxy.example/'), [preset]), 'custom');
  assert.equal(configuredPreset(text, resolveCodexPresets().presets), 'deepseek-flash');
  assert.equal(configuredPreset('model_provider = "deepseek"\n', [preset]), 'custom');
});
