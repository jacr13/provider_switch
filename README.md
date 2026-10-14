# Provider Switcher

**Use DeepSeek or another compatible AI provider inside the Claude Code and Codex extensions for VS Code.** Provider Switcher adds a status bar button for each extension. Click a button to choose a saved provider and model, or return to your previous configuration.

For example, you can use DeepSeek in Claude Code while keeping Codex on ChatGPT. Switching one does not change the other. If both use DeepSeek, you only need to enter your DeepSeek API key once.

A **preset** is a saved set of connection settings: the provider’s API address, model, and any other options needed to use it.

## Install

### Download

Download `provider-switcher.vsix` from the latest [GitHub Release](https://github.com/jacr13/Provider-Switcher/releases). In VS Code, use **Extensions: Install from VSIX...** to install it, then run **Developer: Reload Window**.

### Build locally

You need VS Code **1.94 or later** and a trusted workspace. Install **Claude Code for VS Code** (`anthropic.claude-code`) if you want to switch Claude Code providers. It is optional for Codex-only use.

To switch Codex, also run its extension, CLI, or desktop app at least once so its configuration folder exists. Provider Switcher runs inside VS Code and edits the Codex configuration shared by those applications.

To build and install this extension, you also need Node.js and npm:

1. Run `scripts\build.bat` on Windows or `bash scripts/build.sh` on macOS/Linux.
2. Accept the installation prompt. You can also run **Extensions: Install from VSIX...** in VS Code and select `dist/provider-switcher.vsix`.
3. Run **Developer: Reload Window**.

## Choose a provider

Click **Claude: …** or **Codex: …** in the VS Code status bar, then choose an option:

| Button | Included options | Return to your previous setup | Command Palette command |
|---|---|---|---|
| Claude | DeepSeek | **Claude** | **Provider Switcher: Switch Preset** |
| Codex | DeepSeek Flash, DeepSeek V4 Pro | **ChatGPT** | **Provider Switcher: Switch Codex Model** |

Enter the provider’s API key when prompted. Finish any active work, reload VS Code, and **start a new chat**. An existing conversation may keep using its previous model.

The **Claude** and **ChatGPT** options restore the settings saved before your first switch. If you previously used a custom provider, that provider is restored.

You can also open the Claude picker with `Ctrl+Alt+M` on Windows/Linux or `Cmd+Alt+M` on macOS when the editor has focus.

## Edit or add presets

All presets live in **User settings.json** under `providerSwitcher.presets`. Put Claude Code presets in `claude` and Codex presets in `codex`. Open this setting with **Provider Switcher: Configure Presets** or **Configure Codex Presets**, then choose **Edit in settings.json**.

The included DeepSeek presets work without adding any settings. This example changes their reasoning effort:

```json
{
  "providerSwitcher.presets": {
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
  "providerSwitcher.presets": {
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
| Codex | `provider` | Provider identifier in Codex’s configuration. Defaults to `deepseek`. |
| Codex | `baseUrl` | API address. Defaults to `https://api.deepseek.com/`. |
| Codex | `wireApi` | API protocol: `responses` (default) or `chat`. The switcher also corrects existing `chat` configuration entries to `responses`. |
| Codex | `reasoningEffort` | `low`, `medium`, `high` (default), `xhigh`, `ultra`, or `max`. |
| Codex | `apiKey` | Whether a key is required. Defaults to `true`; use `false` for a server that needs no key. |

Preset names must start with a lowercase letter and contain only lowercase letters, digits, or hyphens. Claude reserves `claude` and `custom`; Codex reserves `chatgpt` and `custom`. API addresses cannot contain credentials, query strings, or fragments.

Changes to an included preset keep its other defaults. Set a preset to `null` to hide it, or a Claude environment value to `null` to remove that default. Invalid presets are skipped with a warning. Workspace presets and Settings Sync are not supported.

**After editing, select the preset again, reload VS Code, and start a new chat.**

Claude’s included DeepSeek preset uses `deepseek-flash[1m]` for main, Opus, and Sonnet roles, and `deepseek-flash` for Haiku and subagents. Its effort is `max` and compaction window is `786432`. It also sets `CLAUDE_CODE_AUTO_MODE_SERVER` to `"0"` to suppress server-side auto-mode eligibility checks; classifier requests can still incur charges. Direct Bedrock, Vertex, and Foundry routing is unsupported.

## Configuration and backups

| Extension | What the switcher changes | Backup files |
|---|---|---|
| Claude Code | VS Code user environment and login settings; keeps terminal mode disabled for the chat panel | `~/.provider-switcher/claude-panel.json` |
| Codex | `~/.codex/config.toml`, or `$CODEX_HOME/config.toml` when set | `~/.codex/backup-provider-switcher/config.toml` and `~/.provider-switcher/codex-config.toml` |

Codex’s configuration is shared by its VS Code extension, CLI, and desktop app, so a switch affects all three. Unrelated settings such as projects and MCP servers are preserved. Conflicting model and profile options are temporarily removed; choosing **ChatGPT** restores the saved file. The bundled model catalog is created only if absent. Codex switching is unavailable when configured to run in WSL.

Claude changes apply across projects using the current VS Code user profile. The switcher does not edit `~/.claude/settings.json` or workspace files.

Original settings are saved in VS Code SecretStorage and the backup files above. The file copies survive reinstalling. If no backup is available, choosing **Claude** or **ChatGPT** offers to remove the switcher’s settings, but overwritten values cannot be recovered.

**Restore both extensions before disabling or uninstalling Provider Switcher.** If you used DeepSeek’s own Codex setup script, undo that setup with its option **9** before using this extension; otherwise, the backup will contain that script’s configuration.

## API keys and privacy

Keys are saved in VS Code SecretStorage and reused for presets using the same endpoint. Use **Provider Switcher: Reset Preset API Key** or **Reset Codex API Key** to replace one. Reload after replacing a key used by an active preset.

**While a preset is active, its key is also written in plaintext to Claude’s VS Code user settings or Codex’s configuration file. Backup files may contain original credentials. Do not share or commit these files.**

The selected provider receives the prompts, code, and context sent through its chats. Provider Switcher collects no telemetry.

## Status bar appearance

Each button appears only when its VS Code extension is available: Claude Code (`anthropic.claude-code`) or Codex (`openai.chatgpt`). Button visibility refreshes automatically.

The buttons show the selected preset, such as **Claude: DeepSeek** or **Codex: DeepSeek Flash**. **Custom** means the current configuration does not match a preset.

DeepSeek’s **Low / High** label estimates its rate period from your computer’s clock. It is not live billing information. The included holiday calendar covers 2026.

Set `providerSwitcher.statusBarAlignment` to `left` or `right` (default), then reload. Set colors by preset name in `providerSwitcher.statusBarColors`, using a six-digit hex color or `null` for the theme color. Color changes apply immediately.

## Development

```sh
npm ci
npm test
npm run lint
npm run package
```

Code is in `src/`, tests in `test/`, and the bundled Codex model catalog in `resources/`. Packaging creates `dist/provider-switcher.vsix`.

## License and credits

[MIT](LICENSE). Copyright (c) 2026 JACR13. Originally based on [shivampip/claude-deepseek-switcher](https://github.com/shivampip/claude-deepseek-switcher).
