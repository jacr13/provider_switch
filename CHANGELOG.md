# Changelog

All notable changes to **Claude Code Switcher** will be documented here.

## [0.1.0] - 2026-10-14

- Initial release of Claude Code Switcher by JACR13, based on the original Claude Deepseek Switcher.
- Switch the official Claude Code chat panel between Claude and configurable Anthropic-compatible provider presets.
- Include an editable DeepSeek preset and allow additional presets in `claudeCodeSwitcher.presets`.
- Add commands to switch presets, configure presets, and reset preset API keys.
- Store keys separately per preset and endpoint, and restore the previous provider configuration while preserving unrelated environment edits.
- Track preset variables across switches, reloads, and removed presets, with recovery after failed settings updates.
- Show the configured provider in the status bar, with peak/off-peak estimates for the default DeepSeek endpoint.
- Include cross-platform packaging scripts and regression tests for switching, credentials, validation, and restoration.
