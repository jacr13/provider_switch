# Changelog

## [1.3.0] - 2026-10-14

- Switch the official Claude Code extension's chat panel between Claude and DeepSeek through its user settings.
- Restore the previous provider configuration from SecretStorage while preserving unrelated environment edits.
- Use the native chat panel, offer a reload after switching, and update the status bar from the configured provider.
- Document the plaintext credential copy required in local Claude Code extension settings while DeepSeek is selected.
- Add provider-switching regression tests and declare the official Claude Code extension dependency.

## [1.2.0] - 2026-10-14

- Synchronize the JACR fork's package identity, version, and local installation instructions.

All notable changes to **Claude Deepseek Switcher** will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] — 2026-05-16

### Added
- Marketplace icon

## [1.0.0] — 2026-05-16

### Added
- Status bar button showing the active model (`✦ Claude` or `🚀 Deepseek`)
- Quick-pick model selector — click the button to choose between Claude and Deepseek
- Keyboard shortcut `Cmd+Alt+M` (Mac) / `Ctrl+Alt+M` (Windows/Linux) to open the model picker
- Full Deepseek environment setup: injects `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, all default model overrides, and `ANTHROPIC_AUTH_TOKEN` into the VS Code terminal profile
- Automatic terminal recycling after every switch so new env vars take effect immediately
- Secure Deepseek API key storage via VS Code's `SecretStorage` (OS keychain — never plaintext)
- `Reset Deepseek API Key` command to clear and re-enter the stored key
- Visual theme indicator — status bar turns orange when Claude is active and purple when Deepseek is active
- Configurable status bar alignment (`left` or `right`)
- Graceful install check: prompts with an install link if Claude Code CLI is not found in `PATH`

---

## [Unreleased]

_No unreleased changes yet._
