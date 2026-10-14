# Changelog

All notable changes to **Provider Switcher** will be documented here.

## [0.3.1] - 2026-10-14

- Use the custom Provider Switcher logo as the extension icon.
- Remove the unused switch SVG.
- Simplify release download instructions and build VSIX packages with GitHub Actions.

## [0.3.0] - 2026-10-14

- Keep the panel's previous settings in a file next to Codex's copy, keep the Codex copy in both locations so either survives losing the other, and adopt whichever file is found when secret storage is empty, so reinstalling can switch both sides back instead of only offering to detach.
- Offer to remove the settings the extension wrote when the saved original is gone, which is what an uninstall or cleared secret storage leaves behind, instead of only reporting that nothing can be restored. It hands the panel back to its usual Claude sign-in and Codex back to its own.
- Never keep a copy of a configuration that already selects one of the presets: that is the extension's own output, not what Codex came with, and copying it made a useless file look like a restore point.
- Keep a plain copy of `~/.codex/config.toml` at `~/.codex/backup-provider-switcher/config.toml`, like DeepSeek's own setup script does. It is written on activation and holds the configuration from before the first switch, comes from the saved baseline rather than the live file, is never overwritten, and survives uninstalling the extension.
- Give the restored Codex configuration OpenAI's blossom in place of the generic sparkle, matching the starburst the Claude side already uses.
- Show a whale instead of the generic rocket for presets on DeepSeek's own endpoint, on both status bar buttons.
- Name the target first in both status bar items, `Claude:` and `Codex:`, ahead of the icon and the model name, and shorten the DeepSeek rate suffix from Peak/Off-peak to High/Low.
- Merge the two preset settings into one `providerSwitcher.presets` object with a `claude` section for the panel and a `codex` section for Codex. Settings saved in the older flat shape are still read as the `claude` section.
- Store one API key per endpoint host instead of one per preset, so the DeepSeek key entered for the panel also serves Codex and vice versa. Replacing a key refreshes whichever presets are configured with it on either side, and keys saved by earlier builds are adopted under the shared name on first use.
- Move the extension modules to `src/`, the test suites to `test/`, and DeepSeek's Codex model catalog to `resources/deepseek-codex-models.json`; packaged builds now land in `dist/`.

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
