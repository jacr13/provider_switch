'use strict';

// Kimi Code membership keys (not Moonshot API keys).
// https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html
// https://www.kimi.com/code/docs/en/third-party-tools/codex.html
const models = [
  { id: 'kimi', label: 'Kimi K3 256K', model: 'k3-256k', claudeModel: 'k3-256k', context: 262144 },
  { id: 'kimi-k3', label: 'Kimi K3 1M', model: 'k3', claudeModel: 'k3[1m]', context: 1048576 },
];
const claude = Object.fromEntries(models.map(({ id, label, claudeModel: model, context }) => [id, {
  // The VS Code panel checks AUTH_TOKEN before a saved Claude OAuth login,
  // but checks API_KEY after it. Use bearer auth so Kimi owns the panel account.
  label, apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
  environment: {
    ANTHROPIC_BASE_URL: 'https://api.kimi.ai/coding/',
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_FABLE_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_EFFORT_LEVEL: 'high',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(context),
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(context),
  },
}]));
const codex = Object.fromEntries(models.map(({ id, label, model }) => [id, {
  label, model, provider: 'kimi', baseUrl: 'https://api.kimi.ai/coding/v1',
  wireApi: 'responses', reasoningEffort: 'high', apiKey: true,
}]));
const isEndpoint = url => ['api.kimi.ai', 'api.kimi.com'].includes(new URL(url).hostname);
const reasoningLevels = ['low', 'high', 'max'];
module.exports = { claude, codex, isEndpoint, reasoningLevels };
