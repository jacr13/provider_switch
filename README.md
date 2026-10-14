# [JACR] Claude Deepseek Switcher

Switch the **Claude Code for VS Code chat panel** between Anthropic Claude and DeepSeek using a status bar button. The switcher configures the official Anthropic extension; it does not open a terminal.

## Requirements

- VS Code 1.94 or later, with a trusted workspace.
- **Claude Code for VS Code** by Anthropic (`anthropic.claude-code`). This is an extension dependency.
- Your existing Claude sign-in or Anthropic API configuration for Claude, and a DeepSeek API key for DeepSeek.

The Claude Code extension bundles its own runtime. A separate `claude` command on PATH is not required for the chat panel.

## Install and use

1. Run `scripts\build.bat` on Windows or `bash scripts/build.sh` on macOS/Linux. Accept the installation prompt, or use **Extensions: Install from VSIX...** and select the rebuilt `claude-deepseek-switcher.vsix`.
2. Run **Developer: Reload Window**. Find **[JACR] Claude Deepseek Switcher** in Extensions (ID: `shivampip.claude-switcher`).
3. Click **Claude** or **DeepSeek** in the bottom-right status bar, or run **Claude Deepseek Switcher: Switch Model** from the Command Palette.
4. Choose **DeepSeek** and enter your key when prompted. The input explains where the key is stored.
5. Finish any active Claude work, choose **Reload Window** in the notification, and start a **new chat in the Claude Code panel**.
6. Choose **Claude** and reload again to restore the provider configuration saved before switching to DeepSeek.

The shortcut is `Ctrl+Alt+M` on Windows/Linux or `Cmd+Alt+M` on macOS when the editor has focus. The provider setting applies to the current VS Code user profile, across projects using that profile. Other open windows may need reloading too.

A running conversation is not switched in place. The status bar reports the configured provider, not a verified live request. Existing conversations can retain their previous model selection. Workspace or managed Claude settings and inherited environment variables can also affect routing.

## What changes

The switcher updates these **VS Code user settings**:

| Setting | DeepSeek | Switch back |
|---|---|---|
| `claudeCode.environmentVariables` | Add DeepSeek routing and credentials, preserving unrelated entries | Restore saved routing and credentials, preserving unrelated edits |
| `claudeCode.disableLoginPrompt` | `true` | Restore previous value, including an unset value |
| `claudeCode.useTerminal` | `false` | Keep `false` to use the chat panel |

DeepSeek uses `https://api.deepseek.com/anthropic`, with `deepseek-flash[1m]` for the main, Opus, and Sonnet roles, and `deepseek-flash` for Haiku and subagents. The existing effort (`max`) and compaction window (`786432`) configuration is retained. The switcher supplies the DeepSeek key as `ANTHROPIC_AUTH_TOKEN`, blanks the competing API key and OAuth token, and disables Bedrock, Vertex, and Foundry flags for this configuration.

Before the first DeepSeek switch, the original environment and login preference are backed up in SecretStorage. Repeated DeepSeek selections and key replacements preserve that backup. If your original configuration used another provider, switching back restores that provider. An external provider configuration without a saved backup is left intact with an explanation.

The switcher does not edit `~/.claude/settings.json`, workspace files, terminal settings, permission modes, or Claude's installed files. Conflicting workspace settings and custom process wrappers are reported before changing providers. Failed updates attempt to restore the previous settings.

## Credentials and privacy

- The saved DeepSeek key and original configuration backup use VS Code SecretStorage.
- **While DeepSeek is selected, a copy of its key is stored as plaintext in the local VS Code user setting `claudeCode.environmentVariables`.** This is how the Claude Code extension receives it. Do not share or commit your user settings. That setting is machine-scoped in the official extension.
- Switching back removes the switcher's DeepSeek entries and restores the saved values. Settings backups and already-running processes may retain old credentials.
- **Reset Deepseek API Key** replaces the saved key and updates the active DeepSeek configuration. Cancel keeps the existing key. Reload after replacing an active key.
- Switch back to Claude before disabling or uninstalling the switcher: disabling an extension does not undo user settings.
- DeepSeek receives the prompts, code, and context sent through chats configured for it. This switcher collects no telemetry.

## Status indicator

The DeepSeek label retains the existing peak/off-peak estimate. It refreshes every second using the supplied schedule: Monday-Friday, 01:00-04:00 and 06:00-10:00 UTC, excluding Chinese holidays. Off-peak displays `50%`. This is an estimate from your clock, not live billing information.

The bundled holiday calendar covers 2026. Update `HOLIDAYS` in `deepseek-rate.js` for later years. Unsupported years show `Rate unknown` during possible peak windows.

Set `claudeDeepseekSwitcher.statusBarAlignment` to `left` or `right` (default) and reload to reposition the button.

## Development

The build scripts install dependencies, run tests, package the extension, and optionally install it using `code`. No compilation is needed.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run lint
npm.cmd run package -- --out claude-deepseek-switcher.vsix
code.cmd --install-extension .\claude-deepseek-switcher.vsix --force
```

On macOS/Linux, use `npm` and `code`. Press **F5** in VS Code to start an Extension Development Host. Tests mock the VS Code API and cover provider changes, restoration, cancellation, failures, key replacement, and reload behavior. A real DeepSeek request requires your key and is not part of the tests.

## References

- [Claude Code extension settings](https://code.claude.com/docs/en/vs-code#extension-settings)
- [DeepSeek Anthropic-compatible API](https://api-docs.deepseek.com/guides/anthropic_api/)

## License

MIT. Original project by Shivam Agrawal; JACR fork.
