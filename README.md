# Provider Switch

**Use DeepSeek, Kimi, or another compatible AI provider inside the Claude Code and Codex extensions for VS Code.** Provider Switch adds a status bar button for each extension. Click a button to choose a saved provider and model, or return to your previous configuration.

For example, you can use DeepSeek in Claude Code while keeping Codex on ChatGPT. Switching one does not change the other. When both use the same endpoint, you only need to enter its API key once.

A **preset** is a saved set of connection settings: the provider’s API address, model, and any other options needed to use it.

## Migrating from Provider Switcher

Before uninstalling the old extension, choose **Claude** and **ChatGPT** in its pickers to restore both original configurations. Disable or uninstall it before enabling Provider Switch (`jacr.provider-switch`). Rename your User Settings keys from `providerSwitcher.*` to `providerSwitch.*`, then re-enter API keys in the new extension. Keep the old backup files until migration is complete; the new extension uses the backup locations documented below.

## Install

### Download

Download `provider-switch.vsix` from the latest [GitHub Release](https://github.com/jacr13/Provider-Switch/releases). In VS Code, use **Extensions: Install from VSIX...** to install it, then run **Developer: Reload Window**.

### Build locally

You need VS Code **1.94 or later** and a trusted workspace. Install **Claude Code for VS Code** (`anthropic.claude-code`) if you want to switch Claude Code providers. It is optional for Codex-only use.

To switch Codex, also run its extension, CLI, or desktop app at least once so its configuration folder exists. Provider Switch runs inside VS Code and edits the Codex configuration shared by those applications.

To build and install this extension, you also need Node.js and npm:

1. Run `scripts\build.bat` on Windows or `bash scripts/build.sh` on macOS/Linux.
2. Accept the installation prompt. You can also run **Extensions: Install from VSIX...** in VS Code and select `dist/provider-switch.vsix`.
3. Run **Developer: Reload Window**.

## Choose a provider

Click **Claude: …** or **Codex: …** in the VS Code status bar, then choose an option:

| Button | Included options | Return to your previous setup | Command Palette command |
|---|---|---|---|
| Claude | DeepSeek Flash, DeepSeek V4 Pro, Kimi K3 256K, Kimi K3 1M | **Claude** | **Provider Switch: Switch Preset** |
| Codex | DeepSeek Flash, DeepSeek V4 Pro, Kimi K3 256K, Kimi K3 1M | **ChatGPT** | **Provider Switch: Switch Codex Model** |

Enter the provider’s API key when prompted. A connection check reports whether the provider returns its model list. Rejected keys are not saved; if the check cannot complete, you can cancel or save without verification. The check does not generate tokens or confirm model access or available credit. Finish any active work, reload VS Code, and **start a new chat**. An existing conversation may keep using its previous model.

The **Claude** and **ChatGPT** options restore the settings saved before your first switch. If you previously used a custom provider, that provider is restored.

You can also open the Claude picker with `Ctrl+Alt+M` on Windows/Linux or `Cmd+Alt+M` on macOS when the editor has focus.

### Kimi setup

Use a **Kimi Code membership API key**. The built-in `kimi` preset selects **K3 256K**; `kimi-k3` selects **K3 1M**, which requires a membership tier with 1M K3 access. Both targets share the key for `api.kimi.ai`.

Claude uses `https://api.kimi.ai/coding/`, `ANTHROPIC_AUTH_TOKEN` for bearer authentication, and the model/context variables from [Kimi’s Claude Code guide](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html). Provider Switch uses the token variable so the VS Code panel prioritizes Kimi over a saved Claude login, and applies these through VS Code’s Claude environment settings. It does not run the guide’s onboarding script or modify `~/.claude` files. Conflicting entries in `~/.claude/settings.json` may need manual cleanup. If login keeps appearing, follow the guide’s terminal API-key and workspace confirmations, then fully quit and reopen VS Code.

Codex uses `https://api.kimi.ai/coding/v1`, Responses, live web search, and the `low`, `high`, and `max` effort levels. It uses the `experimental_bearer_token` alternative documented in [Kimi’s Codex guide](https://www.kimi.com/code/docs/en/third-party-tools/codex.html), so no shell environment setup is needed. Its separate `provider-switch-kimi-models.json` catalog leaves your existing `models.json` untouched.

## Edit or add presets

All presets live in **User settings.json** under `providerSwitch.presets`. Put Claude Code presets in `claude` and Codex presets in `codex`. Open this setting with **Provider Switch: Configure Presets** or **Configure Codex Presets**, then choose **Edit in settings.json**.

The included DeepSeek and Kimi presets work without adding any settings. This example changes their reasoning effort:

```json
{
  "providerSwitch.presets": {
    "claude": {
      "deepseek": {
        "environment": { "CLAUDE_CODE_EFFORT_LEVEL": "max" }
      }
    },
    "codex": {
      "deepseek-flash": { "reasoningEffort": "high" },
      "deepseek-v4-pro": { "reasoningEffort": "high" }
    }
  }
}
```

To add your own provider, create a new preset name in the relevant section. For example, these local presets use placeholder server addresses and model names; replace them with your server’s values:

```json
{
  "providerSwitch.presets": {
    "claude": {
      "local": {
        "label": "Local model",
        "apiKeyEnv": "none",
        "environment": {
          "ANTHROPIC_BASE_URL": "http://localhost:8080",
          "ANTHROPIC_MODEL": "your-model-id",
          "ANTHROPIC_DEFAULT_OPUS_MODEL": "your-model-id",
          "ANTHROPIC_DEFAULT_SONNET_MODEL": "your-model-id",
          "ANTHROPIC_DEFAULT_HAIKU_MODEL": "your-model-id",
          "CLAUDE_CODE_SUBAGENT_MODEL": "your-model-id"
        }
      }
    },
    "codex": {
      "local": {
        "label": "Local model",
        "model": "your-model-id",
        "provider": "local",
        "baseUrl": "http://localhost:8080/v1",
        "wireApi": "responses",
        "reasoningEffort": "low",
        "apiKey": false
      }
    }
  }
}
```

Claude servers must support the **Anthropic Messages API**. Codex servers must support the configured API protocol. For the local examples above, neither server requires an API key.

| Applies to | Setting | What it does |
|---|---|---|
| Both | `label` | Name shown in the picker and status bar. Defaults to the preset name. |
| Claude | `apiKeyEnv` | Variable used to pass the saved key: `ANTHROPIC_AUTH_TOKEN` (default), `ANTHROPIC_API_KEY`, or `none`. |
| Claude | `environment` | Environment variables with string values. A new preset needs `ANTHROPIC_BASE_URL`. Use the key prompt for credentials. |
| Codex | `model` | Model to request. Defaults to the preset name. |
| Codex | `provider` | Provider identifier in Codex’s configuration. New presets default to `deepseek`; Kimi presets keep `kimi`. |
| Codex | `baseUrl` | API address. New presets default to `https://api.deepseek.com/`; built-ins keep their own endpoint. |
| Codex | `wireApi` | API protocol: `responses` (default) or `chat`. The switcher also corrects existing `chat` configuration entries to `responses`. |
| Codex | `reasoningEffort` | `low`, `medium`, `high` (default), `xhigh`, `ultra`, or `max`. Kimi accepts only `low`, `high`, and `max`. |
| Codex | `apiKey` | Whether a key is required. Defaults to `true`; use `false` for a server that needs no key. |

Preset names must start with a lowercase letter and contain only lowercase letters, digits, or hyphens. Claude reserves `claude` and `custom`; Codex reserves `chatgpt` and `custom`. API addresses cannot contain credentials, query strings, or fragments.

Changes to an included preset keep its other defaults. Set a preset to `null` to hide it, or a Claude environment value to `null` to remove that default. Invalid presets are skipped with a warning. Workspace presets and Settings Sync are not supported.

**After editing, select the preset again, reload VS Code, and start a new chat.**

Claude’s DeepSeek Flash preset (`deepseek`) uses `deepseek-flash[1m]` for main, Opus, and Sonnet roles, and `deepseek-flash` for Haiku and subagents. The Pro preset (`deepseek-v4-pro`) uses `deepseek-v4-pro[1m]` for main, Opus, and Sonnet roles, and `deepseek-v4-pro` for Haiku and subagents. Both share the same DeepSeek key. Their effort is `max` and compaction window is `786432`. It also sets `CLAUDE_CODE_AUTO_MODE_SERVER` to `"0"` to suppress server-side auto-mode eligibility checks; classifier requests can still incur charges. Direct Bedrock, Vertex, and Foundry routing is unsupported.

## Configuration and backups

| Extension | What the switcher changes | Backup files |
|---|---|---|
| Claude Code | VS Code user environment and login settings; keeps terminal mode disabled for the chat panel | `~/.provider-switch/claude-panel.json` |
| Codex | `~/.codex/config.toml`, or `$CODEX_HOME/config.toml` when set | `~/.codex/backup-provider-switch/config.toml` and `~/.provider-switch/codex-config.toml` |

Codex’s configuration is shared by its VS Code extension, CLI, and desktop app, so a switch affects all three. Unrelated settings such as projects and MCP servers are preserved. Conflicting model and profile options are temporarily removed; choosing **ChatGPT** restores the saved file. Bundled catalogs are created only if absent: DeepSeek uses `models.json`, and Kimi uses `provider-switch-kimi-models.json` in the same Codex folder. A conflicting Kimi catalog file stops the switch. Restoration removes generated catalogs only if their content is unchanged. Codex switching is unavailable when configured to run in WSL.

Claude changes apply across projects using the current VS Code user profile. The switcher does not edit `~/.claude/settings.json` or workspace files.

Original settings are saved in VS Code SecretStorage and the backup files above. The file copies survive reinstalling. If no backup is available, choosing **Claude** or **ChatGPT** offers to remove the switcher’s settings, but overwritten values cannot be recovered.

**Restore both extensions before disabling or uninstalling Provider Switch.** If you used DeepSeek’s own Codex setup script, undo that setup with its option **9** before using this extension; otherwise, the backup will contain that script’s configuration.

## API keys and privacy

Keys are saved in VS Code SecretStorage and reused for presets using the same endpoint. To reconnect with another key, click either status bar button, choose **Reconnect / Change API Key…**, then select a DeepSeek, Kimi, or custom preset and enter the replacement key. You can also use **Provider Switch: Reset Preset API Key** or **Reset Codex API Key**. The replacement is shared with presets on the same endpoint, including the other extension. Reload after replacing a key used by an active preset.

**While a preset is active, its key is also written in plaintext to Claude’s VS Code user settings or Codex’s configuration file. Backup files may contain original credentials. Do not share or commit these files.**

The selected provider receives the prompts, code, and context sent through its chats. Provider Switch collects no telemetry.

## Status bar appearance

Each button appears only when its VS Code extension is available: Claude Code (`anthropic.claude-code`) or Codex (`openai.chatgpt`). Button visibility refreshes automatically. Hide either button in Settings with **Provider Switch: Show Claude Status Bar** or **Provider Switch: Show Codex Status Bar**, or set:

```json
{
  "providerSwitch.showClaudeStatusBar": false,
  "providerSwitch.showCodexStatusBar": false
}
```

Both default to `true`. Changes apply immediately, and Command Palette commands still work while the buttons are hidden. The buttons share the same alignment and priority so VS Code groups them together, with a separate click action for each.

The buttons show the selected preset, such as **Claude: DeepSeek** or **Codex: DeepSeek Flash**. **Custom** means the current configuration does not match a preset.

DeepSeek’s **Low / High** label estimates its rate period from your computer’s clock. It is not live billing information. The included holiday calendar covers 2026.

Set `providerSwitch.statusBarAlignment` to `left` or `right` (default), then reload. Set colors by preset name in `providerSwitch.statusBarColors`, using a six-digit hex color or `null` for the theme color. Color changes apply immediately.

## Development

```sh
npm ci
npm test
npm run lint
npm run package
```

The entry point `src/extension.js` registers commands and coordinates the targets. `src/claude.js` owns Claude settings, switching, and recovery; `src/codex.js` owns Codex switching, catalogs, and recovery. Shared credentials and settings helpers live in `src/shared.js`.

Built-in preset definitions are grouped by provider in `src/providers/deepseek.js` and `src/providers/kimi.js`. `src/presets.js` merges and validates user overrides; `src/codex-config.js` handles TOML edits. Bundled Codex model catalogs live in `resources/`, and tests in `test/`. Packaging creates `dist/provider-switch.vsix`.

## License and credits

[MIT](LICENSE). Copyright (c) 2026 JACR13. Originally based on [shivampip/claude-deepseek-switcher](https://github.com/shivampip/claude-deepseek-switcher).
