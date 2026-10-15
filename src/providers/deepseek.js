'use strict';

const claude = {
  deepseek: {
    label: 'DeepSeek Flash',
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

// Preserve the existing Flash preset ID for saved settings and keybindings.
claude['deepseek-v4-pro'] = {
  label: 'DeepSeek V4 Pro',
  apiKeyEnv: claude.deepseek.apiKeyEnv,
  environment: Object.fromEntries(Object.entries(claude.deepseek.environment).map(([name, value]) =>
    [name, value.replace('deepseek-flash', 'deepseek-v4-pro')])),
};

const codex = {
  'deepseek-flash': { label: 'DeepSeek Flash', model: 'deepseek-flash' },
  'deepseek-v4-pro': { label: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro' },
};

module.exports = { claude, codex };
