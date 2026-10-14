# Claude Code Switcher

Switch the **Claude Code for VS Code chat panel** between Anthropic Claude and configurable provider presets using a status bar button. DeepSeek is included as an editable default preset. You can add other Anthropic-compatible endpoints, including local servers. The switcher configures the official Anthropic extension; it does not open a terminal.

## Requirements

- VS Code 1.94 or later, with a trusted workspace.
- **Claude Code for VS Code** by Anthropic (`anthropic.claude-code`). This is an extension dependency.
- Your existing Claude sign-in or Anthropic API configuration for Claude, and any API keys required by your presets.

The Claude Code extension bundles its own runtime. A separate `claude` command on PATH is not required for the chat panel.

## Install and use

1. Run `scripts\build.bat` on Windows or `bash scripts/build.sh` on macOS/Linux. Accept the installation prompt, or use **Extensions: Install from VSIX...** and select the rebuilt `claude-code-switcher.vsix`.
2. Run **Developer: Reload Window**. Find **Claude Code Switcher** in Extensions (ID: `jacr.claude-code-switcher`).
3. Click the provider name in the bottom-right status bar, or run **Claude Code Switcher: Switch Preset** from the Command Palette.
4. Choose a preset (initially **DeepSeek**) and enter its key when prompted. The input shows the destination endpoint and explains where the key is stored.
5. Finish any active Claude work, choose **Reload Window** in the notification, and start a **new chat in the Claude Code panel**.
6. Choose **Claude** and reload again to restore the provider configuration saved before the first preset switch.

The shortcut is `Ctrl+Alt+M` on Windows/Linux or `Cmd+Alt+M` on macOS when the editor has focus. The provider setting applies to the current VS Code user profile, across projects using that profile. Other open windows may need reloading too.

A running conversation is not switched in place. The status bar reports the configured provider, not a verified live request. Existing conversations can retain their previous model selection. Workspace or managed Claude settings and inherited environment variables can also affect routing.

## Configure presets

Run **Claude Code Switcher: Configure Presets**, then choose **Edit in settings.json** for the presets setting. Put `claudeCodeSwitcher.presets` in **User** settings. Workspace definitions are ignored. Presets are machine-scoped and are not synced by VS Code Settings Sync.

Each property is a stable preset ID. Override `deepseek` to change its defaults, or add an ID to create a preset. For example:

```json
{
  "claudeCodeSwitcher.presets": {
    "deepseek": {
      "label": "DeepSeek",
      "environment": {
        "ANTHROPIC_MODEL": "deepseek-flash[1m]",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-flash[1m]",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-flash[1m]",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-flash",
        "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-flash",
        "CLAUDE_CODE_EFFORT_LEVEL": "max",
        "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "786432"
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
```

The local URL and model ID are placeholders for your server. It must support the Anthropic Messages API; an OpenAI-only endpoint needs a compatible gateway. Direct Bedrock, Vertex, and Foundry routing is not supported by these presets.

| Field | Behavior |
|---|---|
| Preset ID | Lowercase letters, digits, and hyphens; start with a letter. `claude` and `custom` are reserved. |
| `label` | Picker and status bar name; defaults to the ID for new presets. |
| `apiKeyEnv` | `ANTHROPIC_AUTH_TOKEN` (default), `ANTHROPIC_API_KEY`, or `none` for a server requiring no key. |
| `environment` | Environment variable names mapped to string values. New presets require `ANTHROPIC_BASE_URL`. Set model roles explicitly when needed. |

DeepSeek overrides merge with the bundled defaults; other presets start independently. Use `null` for an environment value to remove a bundled value, or `"deepseek": null` to hide the built-in preset. Routing flags for Bedrock, Vertex, and Foundry remain `"0"`. Credential variables cannot be entered in `environment`; use the key prompt instead. Invalid presets are skipped with a warning when you open the picker.

After editing a preset, select it again, reload the window, and start a new chat. Editing settings alone does not apply the preset. Renaming or deleting a preset does not prevent restoring the original configuration. Saved keys belong to the preset ID, endpoint, and API key variable, so changing those may prompt for a new key. The existing DeepSeek key remains usable with its default endpoint.

## What changes

The switcher updates these **VS Code user settings**:

| Setting | Select a preset | Switch back |
|---|---|---|
| `claudeCode.environmentVariables` | Replace the previous preset's variables with the selected preset's environment and credentials, preserving unrelated entries | Restore saved values for all variables managed during the switching session, preserving unrelated edits |
| `claudeCode.disableLoginPrompt` | `true` | Restore previous value, including an unset value |
| `claudeCode.useTerminal` | `false` | Keep `false` to use the chat panel |

The bundled DeepSeek preset uses `https://api.deepseek.com/anthropic`, with `deepseek-flash[1m]` for the main, Opus, and Sonnet roles, and `deepseek-flash` for Haiku and subagents. Its effort (`max`) and compaction window (`786432`) are editable defaults. Every preset blanks competing API key and OAuth credentials and disables Bedrock, Vertex, and Foundry routing. The selected key is then supplied through `apiKeyEnv`.

Before the first preset switch, the original environment and login preference are backed up in SecretStorage. Switching between presets and replacing keys preserve that baseline. Custom variables are tracked as each preset takes ownership, so removing a preset or reloading the extension still allows restoration. If your original configuration used another provider, switching back restores that provider. An external provider configuration without a saved backup is left intact with an explanation.

The switcher does not edit `~/.claude/settings.json`, workspace files, terminal settings, permission modes, or Claude's installed files. Conflicting workspace settings and custom process wrappers are reported before changing providers. Failed updates attempt to restore the previous settings.

## Credentials and privacy

- Preset API keys and the original configuration backup use VS Code SecretStorage.
- **While a preset is selected, a copy of its key is stored as plaintext in the local VS Code user setting `claudeCode.environmentVariables`.** This is how the Claude Code extension receives it. Do not share or commit your user settings. That setting is machine-scoped in the official extension.
- Switching back removes the switcher's preset entries and restores the saved values. Settings backups and already-running processes may retain old credentials.
- **Claude Code Switcher: Reset Preset API Key** asks which preset to update. It applies the new key immediately only if that preset matches the current configuration. Cancel keeps the existing key. Reload after replacing an active key.
- Switch back to Claude before disabling or uninstalling the switcher: disabling an extension does not undo user settings.
- The selected endpoint receives the prompts, code, and context sent through chats configured for it. This switcher collects no telemetry.

## Status indicator

The status bar shows a preset label when its environment matches the current configuration. Changed, removed, or ambiguous preset definitions show **Custom provider** for non-Anthropic endpoints until you reselect a matching preset.

Presets using the default DeepSeek endpoint retain the existing peak/off-peak estimate. It refreshes every second using the supplied schedule: Monday-Friday, 01:00-04:00 and 06:00-10:00 UTC, excluding Chinese holidays. This is an estimate from your clock, not live billing information.

The bundled holiday calendar covers 2026. Update `HOLIDAYS` in `deepseek-rate.js` for later years. Unsupported years show `Rate unknown` during possible peak windows.

Set `claudeCodeSwitcher.statusBarAlignment` to `left` or `right` (default) and reload to reposition the button. If you customized alignment before the rename, update the setting key to this name.

## References

- [Claude Code extension settings](https://code.claude.com/docs/en/vs-code#extension-settings)
- [DeepSeek Anthropic-compatible API](https://api-docs.deepseek.com/guides/anthropic_api/)

## License

MIT. Copyright (c) 2026 JACR13. See [LICENSE](LICENSE) for the full license and original copyright notice.

## Credits

Based originally on [shivampip/claude-deepseek-switcher](https://github.com/shivampip/claude-deepseek-switcher).
