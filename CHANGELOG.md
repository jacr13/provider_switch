# Changelog

All notable changes to **Provider Switcher** will be documented here.

## [Unreleased]

## [0.2.0] - 2026-10-14

- Rename the extension to **Provider Switcher** (ID `jacr.provider-switcher`) with the description "Switch the Claude Code chat panel and the Codex extension between AI provider and model presets, with DeepSeek included." Commands move to `provider-switcher.*` and settings to `providerSwitcher.*`; upgrading from **Claude Code Switcher** means re-applying preset settings and re-entering saved keys.
- Switch the Codex extension, CLI, and desktop app between model presets by rewriting `~/.codex/config.toml`, with DeepSeek Flash and DeepSeek V4 Pro included.
- Keep Codex and Claude Code switching fully independent: separate status bar buttons, preset lists (`providerSwitcher.codexPresets`), and saved keys.
- Preserve unrelated Codex configuration during switches, remove keys that mask or contradict the selected provider, install the bundled model catalog only when absent, and restore the file's original bytes exactly.
- Report every Codex change to a new **Provider Switcher** output panel without echoing removed values.
- Default the DeepSeek preset's `CLAUDE_CODE_AUTO_MODE_SERVER` to `"0"`, with support for overriding or omitting it through preset environment settings.
- Restore orange Claude and purple DeepSeek status bar colors, with configurable colors for every preset through `providerSwitcher.statusBarColors`.
- Apply color changes immediately and allow the VS Code theme default with `null`.

## [0.1.0] - 2026-10-14

- Initial release of Claude Code Switcher by JACR13, based on the original Claude Deepseek Switcher.
- Switch the official Claude Code chat panel between Claude and configurable Anthropic-compatible provider presets.
- Include an editable DeepSeek preset and allow additional presets in `claudeCodeSwitcher.presets`.
- Add commands to switch presets, configure presets, and reset preset API keys.
- Store keys separately per preset and endpoint, and restore the previous provider configuration while preserving unrelated environment edits.
- Track preset variables across switches, reloads, and removed presets, with recovery after failed settings updates.
- Show the configured provider in the status bar, with peak/off-peak estimates for the default DeepSeek endpoint.
- Include cross-platform packaging scripts and regression tests for switching, credentials, validation, and restoration.
