# Provider Switcher

Switch the **Claude Code for VS Code chat panel** and the **Codex – OpenAI's coding agent** extension between configurable provider and model presets using status bar buttons. DeepSeek is included as an editable default preset for both. You can add other Anthropic-compatible endpoints, including local servers. The switcher configures the official extensions; it does not open a terminal.

The two targets are independent: each has its own status bar button, its own preset list, and switching one never changes the other. They do share credentials — one key is stored per endpoint host, so the DeepSeek key you enter once serves every preset that uses that endpoint, on both sides. The Claude Code side rewrites VS Code user settings; the Codex side rewrites `~/.codex/config.toml`, which the Codex extension, CLI, and desktop app all share.

## Requirements

- VS Code 1.94 or later, with a trusted workspace.
- **Claude Code for VS Code** by Anthropic (`anthropic.claude-code`). This is an extension dependency.
- Your existing Claude sign-in or Anthropic API configuration for Claude, and any API keys required by your presets.
- For Codex switching: the Codex extension or CLI, run at least once so `~/.codex` exists. Nothing needs to be installed for the Claude Code side alone.

The Claude Code extension bundles its own runtime. A separate `claude` command on PATH is not required for the chat panel.

## Install and use

1. Run `scripts\build.bat` on Windows or `bash scripts/build.sh` on macOS/Linux. Accept the installation prompt, or use **Extensions: Install from VSIX...** and select the rebuilt `dist/provider-switcher.vsix`.
2. Run **Developer: Reload Window**. Find **Provider Switcher** in Extensions (ID: `jacr.provider-switcher`).
3. Click the provider name in the bottom-right status bar, or run **Provider Switcher: Switch Preset** from the Command Palette.
4. Choose a preset (initially **DeepSeek**) and enter its key when prompted. The input shows the destination endpoint and explains where the key is stored.
5. Finish any active Claude work, choose **Reload Window** in the notification, and start a **new chat in the Claude Code panel**.
6. Choose **Claude** and reload again to restore the provider configuration saved before the first preset switch.

The shortcut is `Ctrl+Alt+M` on Windows/Linux or `Cmd+Alt+M` on macOS when the editor has focus. The provider setting applies to the current VS Code user profile, across projects using that profile. Other open windows may need reloading too.

### Upgrading from Claude Code Switcher

The rename changes the extension ID, its commands (`provider-switcher.*`), and its settings (`providerSwitcher.*`). VS Code keeps saved keys and settings per extension ID, so an upgrade does **not** carry over preset settings or stored API keys:

1. Before uninstalling the old extension, switch back to **Claude** and **ChatGPT** so it restores your original configuration. Otherwise the saved backup stays behind and you restore those values by hand.
2. Remove the old `claudeCodeSwitcher.*` settings from User `settings.json` and add the presets under `providerSwitcher.presets`, inside `claude` and `codex`. The built-in DeepSeek presets need no settings at all.
3. Re-enter the API key once per endpoint when prompted, or run **Provider Switcher: Reset Preset API Key** and **Reset Codex API Key**.

## Switch Codex models

Click the **Codex** status bar button, or run **Provider Switcher: Switch Codex Model**. Choose **DeepSeek Flash**, **DeepSeek V4 Pro**, or **ChatGPT** to restore the configuration saved before the first switch.

1. Choose a preset. If the DeepSeek key is already stored for the endpoint — because the panel side asked for it first, for example — nothing is prompted.
2. Reload the window and start a new Codex panel so the change takes effect.
3. Choose **ChatGPT** and reload to restore the exact configuration file saved before the first switch.

Switching writes these keys in `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), replacing them in place and leaving everything else — projects, trust levels, MCP servers, plugins, notifications — untouched:

| Key | Value |
|---|---|
| `model` | The preset's model, for example `deepseek-flash` |
| `model_provider` | The preset's provider ID, for example `deepseek` |
| `model_reasoning_effort` | The preset's reasoning effort, `high` by default |
| `model_catalog_json` | The bundled model catalog, written to `models.json` only when absent |
| `preferred_auth_method`, `forced_login_method` | `apikey` and `api`, so the API key is used instead of the ChatGPT sign-in |
| `web_search`, `show_raw_agent_reasoning` | `disabled` and `true`, matching DeepSeek's setup |
| `[model_providers.<provider>]` | `base_url`, `wire_api`, and the API key |
| `[desktop] enabled-reasoning-efforts` | The reasoning levels offered by the desktop app |

Keys that would silently redirect or mask the selection (`profile`, `oss_provider`, `openai_base_url`) and keys that contradict the bundled catalog (`service_tier`, `model_context_window`, `base_instructions`, and similar) are removed while a preset is selected, and restored by **ChatGPT**. A `wire_api = "chat"` value is corrected to `"responses"`, which current Codex versions require. Every change is listed in the **Provider Switcher** output panel (View → Output), with removed values left out so a credential cannot be echoed there.

A running conversation is not switched in place. The status bar reports the configured provider, not a verified live request. Existing conversations can retain their previous model selection. Workspace or managed Claude settings and inherited environment variables can also affect routing.

## Configure presets

Run **Provider Switcher: Configure Presets**, then choose **Edit in settings.json** for the presets setting. Everything lives in the single `providerSwitcher.presets` setting in **User** settings, under a section per target: `claude` for the panel and `codex` for Codex. Workspace definitions are ignored. Presets are machine-scoped and are not synced by VS Code Settings Sync.

Each property of `claude` is a stable preset ID. Override `deepseek` to change its defaults, or add an ID to create a preset. For example:

```json
{
  "providerSwitcher.presets": {
    "claude": {
      "deepseek": {
        "label": "DeepSeek",
        "environment": {
          "ANTHROPIC_MODEL": "deepseek-flash[1m]",
          "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-flash[1m]",
          "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-flash[1m]",
          "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-flash",
          "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-flash",
          "CLAUDE_CODE_EFFORT_LEVEL": "max",
          "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "786432",
          "CLAUDE_CODE_AUTO_MODE_SERVER": "0"
        }
      },
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
    }
  }
}
```

The local URL and model ID are placeholders for your server. It must support the Anthropic Messages API; an OpenAI-only endpoint needs a compatible gateway. Direct Bedrock, Vertex, and Foundry routing is not supported by these presets.

| Field | Behavior |
|---|---|
| Preset ID | A property of `claude`. Lowercase letters, digits, and hyphens; start with a letter. `claude` and `custom` are reserved. |
| `label` | Picker and status bar name; defaults to the ID for new presets. |
| `apiKeyEnv` | `ANTHROPIC_AUTH_TOKEN` (default), `ANTHROPIC_API_KEY`, or `none` for a server requiring no key. |
| `environment` | Environment variable names mapped to string values. New presets require `ANTHROPIC_BASE_URL`. Set model roles explicitly when needed. |

DeepSeek overrides merge with the bundled defaults; other presets start independently. Use `null` for an environment value to remove a bundled value, or `"deepseek": null` to hide the built-in preset. Routing flags for Bedrock, Vertex, and Foundry remain `"0"`. Credential variables cannot be entered in `environment`; use the key prompt instead. Invalid presets are skipped with a warning when you open the picker.

The DeepSeek preset defaults `CLAUDE_CODE_AUTO_MODE_SERVER` to `"0"`. This tells Claude Code not to request server-side auto-mode classifier checks and suppresses the eligibility notice. Auto mode still uses Claude Code's own classifier requests, which remain billable; it does not disable the classifier or make those requests free. The variable is temporary and may be removed by Claude Code in a future release. See [Auto mode classifier request charges](https://code.claude.com/docs/en/auto-mode-classifier-billing). You can add this variable to other presets' `environment` objects, or set it to `null` in the DeepSeek override to omit it. JSON values must be strings such as `"0"`, not shell `export` statements.

After editing a preset, select it again, reload the window, and start a new chat. Editing settings alone does not apply the preset. Renaming or deleting a preset does not prevent restoring the original configuration. A saved key belongs to the endpoint host, so moving a preset to a new endpoint prompts for a key, while adding another preset on the same endpoint reuses the stored one.

## Configure Codex presets

Run **Provider Switcher: Configure Codex Presets** and edit the `codex` section of `providerSwitcher.presets` in **User** settings. Workspace definitions are ignored and the setting is machine-scoped.

```json
{
  "providerSwitcher.presets": {
    "codex": {
      "deepseek-v4-pro": { "model": "deepseek-v4-pro" },
      "local": {
        "label": "Local model",
        "model": "qwen3-coder",
        "provider": "local",
        "baseUrl": "http://localhost:8080/v1",
        "wireApi": "chat",
        "reasoningEffort": "low",
        "apiKey": false
      }
    }
  }
}
```

| Field | Behavior |
|---|---|
| Preset ID | A property of `codex`. Lowercase letters, digits, and hyphens; start with a letter. `chatgpt` and `custom` are reserved. |
| `label` | Picker and status bar name. |
| `model` | Model name sent to the endpoint. |
| `provider` | ID of the `[model_providers.<id>]` table, `deepseek` by default. |
| `baseUrl` | OpenAI-compatible endpoint, `https://api.deepseek.com/` by default. Credentials, query strings, and fragments are rejected. |
| `wireApi` | `responses` (default) or `chat`. DeepSeek uses `responses`. |
| `reasoningEffort` | One of `low`, `medium`, `high`, `xhigh`, `ultra`, `max`. Defaults to `high`. |
| `apiKey` | Whether the endpoint needs a key. Defaults to `true`; use `false` for a local endpoint that accepts none. |

The built-in `deepseek-flash` and `deepseek-v4-pro` presets merge with your overrides; `"deepseek-v4-pro": null` hides one. Both point at the DeepSeek endpoint, so they share one saved key and switching between models never prompts again. Invalid presets are skipped with a warning when you open the picker. After editing, select the preset again and reload the window.

DeepSeek's own setup script and this switcher both edit `~/.codex/config.toml`, but they keep separate backups. If you installed DeepSeek with that script, run its **9** option to undo it before using this switcher, or **ChatGPT** here will return you to the script's configuration rather than to a stock Codex setup.

## What changes

The switcher updates these **VS Code user settings** for the Claude Code panel:

| Setting | Select a preset | Switch back |
|---|---|---|
| `claudeCode.environmentVariables` | Replace the previous preset's variables with the selected preset's environment and credentials, preserving unrelated entries | Restore saved values for all variables managed during the switching session, preserving unrelated edits |
| `claudeCode.disableLoginPrompt` | `true` | Restore previous value, including an unset value |
| `claudeCode.useTerminal` | `false` | Keep `false` to use the chat panel |

The bundled DeepSeek preset uses `https://api.deepseek.com/anthropic`, with `deepseek-flash[1m]` for the main, Opus, and Sonnet roles, and `deepseek-flash` for Haiku and subagents. Its effort (`max`) and compaction window (`786432`) are editable defaults. Every preset blanks competing API key and OAuth credentials and disables Bedrock, Vertex, and Foundry routing. The selected key is then supplied through `apiKeyEnv`.

Before the first preset switch, the original environment and login preference are backed up in SecretStorage. Switching between presets and replacing keys preserve that baseline. Custom variables are tracked as each preset takes ownership, so removing a preset or reloading the extension still allows restoration. If your original configuration used another provider, switching back restores that provider. An external provider configuration without a saved backup is left intact with an explanation.

For the Codex panel, the switcher edits exactly one file: `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`). Before the first switch it saves the file's original bytes and restores them when you choose **ChatGPT**. It never touches Codex session data, plugins, MCP server definitions, or the model catalog once that file exists. Switching is refused while Codex is configured to run inside WSL, where the file lives elsewhere, and while `~/.codex` has not been created yet.

The switcher does not edit `~/.claude/settings.json`, workspace files, terminal settings, permission modes, or Claude's installed files. Conflicting workspace settings and custom process wrappers are reported before changing providers. Failed updates attempt to restore the previous settings.

## Credentials and privacy

- Preset API keys and the original configuration backups use VS Code SecretStorage. **One key is stored per endpoint host and shared by every preset that uses it, on both sides**, so the DeepSeek key you enter for the panel is also what Codex uses. Keys saved by earlier builds were kept per preset; the switcher adopts them under the shared name the first time a preset uses one.
- **While a preset is selected, a copy of its key is stored as plaintext in the local VS Code user setting `claudeCode.environmentVariables`.** This is how the Claude Code extension receives it. Do not share or commit your user settings. That setting is machine-scoped in the official extension.
- **A Codex preset's key is likewise written as plaintext into `~/.codex/config.toml`** while it is selected, which is how Codex accepts it. Do not share that file. Choosing **ChatGPT**, or switching to a preset without a key, removes it from the file.
- Switching back removes the switcher's preset entries and restores the saved values. Settings backups and already-running processes may retain old credentials.
- **Provider Switcher: Reset Preset API Key** and **Reset Codex API Key** ask which preset to update. Because the key is shared, replacing it also refreshes whichever preset is configured with it on either side; a replacement for a preset on a different endpoint is stored and used on the next switch. Cancel keeps the existing key. Reload after replacing an active key.
- Switch back to Claude before disabling or uninstalling the switcher: disabling an extension does not undo user settings.
- The selected endpoint receives the prompts, code, and context sent through chats configured for it. This switcher collects no telemetry.

## Status indicator

Both buttons name their target, so a glance tells them apart: the panel reads **Claude: DeepSeek** and the Codex button **Codex: DeepSeek Flash**. The panel shows its preset label when the environment matches the current configuration; changed, removed, or ambiguous preset definitions show **Claude: Custom** for non-Anthropic endpoints until you reselect a matching preset.

Presets on DeepSeek's own endpoint carry a whale (🐳) where other presets have the generic rocket, on both buttons. VS Code's icon set has no whale, so this is an emoji: it keeps its own color instead of taking the preset's status bar color.

The restored configurations carry the service's own mark: a starburst for Claude and OpenAI's blossom (🌸) for Codex, which stands in for the flower mark the same way.

The Codex button behaves the same way against the configuration file: it shows the preset whose model, provider, and endpoint match, **Codex: Custom** when the file points elsewhere, and **Codex: ChatGPT** when no custom provider is selected. It is hidden entirely on machines where Codex has never run and the Codex extension is not installed.

Presets using the default DeepSeek endpoint append a compact rate estimate: **Low** inside DeepSeek's off-peak discount window and **High** during peak hours. It refreshes every second using the supplied schedule: Monday-Friday, 01:00-04:00 and 06:00-10:00 UTC, excluding Chinese holidays. This is an estimate from your clock, not live billing information.

The bundled holiday calendar covers 2026. Update `HOLIDAYS` in `src/deepseek-rate.js` for later years. Unsupported years show **Rate unknown** during possible peak windows.

Set `providerSwitcher.statusBarAlignment` to `left` or `right` (default) and reload to reposition the button. Settings from earlier versions of the extension, such as `claudeCodeSwitcher.statusBarAlignment`, are no longer read.

Claude uses orange and DeepSeek uses purple for the status bar text and icon. Customize colors by preset ID in `providerSwitcher.statusBarColors`:

```json
{
  "providerSwitcher.statusBarColors": {
    "claude": "#d97706",
    "deepseek": "#a78bfa",
    "local": "#00ff88",
    "chatgpt": "#10a37f",
    "custom": null
  }
}
```

Both status buttons read the same map: `claude` and `chatgpt` style the restored configurations, and `custom` covers unmatched providers on either side.

Use six-digit hex colors, or `null` to use your VS Code theme's default. `custom` applies when no preset matches the current provider. Additional presets use the theme color unless configured here. Color edits apply immediately without switching providers or reloading.

## Repository layout

| Path | Contents |
|---|---|
| `src/` | Extension modules: `extension.js` (activation, commands, status bar), `presets.js` (preset schema and credential keys), `codex-config.js` (rewrites `~/.codex/config.toml`), and `deepseek-rate.js` (low/high rate estimate). |
| `test/` | Node test suite, one file per module. |
| `resources/` | `deepseek-codex-models.json`, the DeepSeek model catalog written to `$CODEX_HOME/models.json` when a Codex preset is selected. |
| `images/` | Extension icon and status bar asset. |
| `scripts/` | Build and install scripts for Windows and macOS/Linux. |
| `dist/` | Build output (`provider-switcher.vsix`). Not tracked by Git. |
| `.vscode/` | Launch configuration for running the extension from source. |

Set up with `npm ci`, then `npm test` runs the suites, `npm run lint` syntax-checks the modules, and `npm run package` writes `dist/provider-switcher.vsix`.

## References

- [Claude Code extension settings](https://code.claude.com/docs/en/vs-code#extension-settings)
- [DeepSeek Anthropic-compatible API](https://api-docs.deepseek.com/guides/anthropic_api/)
- [DeepSeek Codex setup](https://api-docs.deepseek.com/quick_start/agent_integrations/codex) — the configuration this switcher's Codex presets follow. `resources/deepseek-codex-models.json` is the DeepSeek-only model catalog from that setup script.

## License

MIT. Copyright (c) 2026 JACR13. See [LICENSE](LICENSE) for the full license and original copyright notice.

## Credits

Based originally on [shivampip/claude-deepseek-switcher](https://github.com/shivampip/claude-deepseek-switcher).
