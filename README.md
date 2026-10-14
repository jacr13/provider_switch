# Claude Deepseek Switcher

A VS Code extension that lets you seamlessly switch between **Anthropic Claude** and **Deepseek** AI models inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started) — directly from your status bar.

---

## Features

- **One-click model switching** — click the status bar button to open a model picker
- **Terminal status indicator** ? shows the configured provider of the selected managed terminal, with DeepSeek peak/off-peak status
- **Secret storage** ? saves the DeepSeek key in VS Code SecretStorage and passes it only to a dedicated terminal
- **Preserves running work** ? opens a new terminal without closing existing terminals or modifying global colors
- **Keyboard shortcut** — `Cmd+Alt+M` (Mac) / `Ctrl+Alt+M` (Windows/Linux)

---

## Requirements

The DeepSeek status bar label includes `Peak` or `Off-peak (50%)` and refreshes every second. Peak windows are Monday-Friday, 01:00-04:00 and 06:00-10:00 UTC (end times excluded). Weekends and Chinese public holiday breaks are off-peak, including weekends designated as make-up working days.

The bundled holiday calendar covers 2026 using the [official Chinese holiday schedule](https://english.beijing.gov.cn/workinginbeijing/laborrights/publicholidays/). Update `HOLIDAYS` in `deepseek-rate.js` for future years. During possible peak windows in an unsupported year, the label shows `Rate unknown`. This indicator uses the supplied pricing schedule and your computer clock; it does not query billing information.

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started) installed and available in your `PATH`
- A [Deepseek API key](https://platform.deepseek.com/) (only required when switching to Deepseek)

---

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Look for the **✦ Claude** button in your status bar (bottom right by default)
3. Click it and select a model from the dropdown
4. If switching to Deepseek for the first time, you will be prompted to enter your Deepseek API key
5. Run `claude` in the new terminal (the CLI must already be installed).

---

## How It Works

When you switch to **Deepseek**, the extension injects the following environment variables only into the dedicated terminal it creates:

| Variable | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://api.deepseek.com/anthropic` |
| `ANTHROPIC_MODEL` | `deepseek-flash[1m]` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `deepseek-flash[1m]` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `deepseek-flash[1m]` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `deepseek-flash` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | `deepseek-flash` |
| `CLAUDE_CODE_EFFORT_LEVEL` | `max` |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `786432` |
| `ANTHROPIC_AUTH_TOKEN` | *(your Deepseek API key)* |

Choosing **Claude** opens a new terminal with these routing overrides removed from that terminal environment. Existing settings and terminals stay intact. The label describes the selected managed terminal configuration, not a verified live provider; Claude Code configuration and shell startup scripts can still affect routing. Unmanaged or restored terminals show `AI terminal`.

---

## Commands

| Command | Keyboard Shortcut | Description |
|---|---|---|
| `Claude Deepseek Switcher: Switch Model` | `Cmd+Alt+M` / `Ctrl+Alt+M` | Open the model picker |
| `Claude Deepseek Switcher: Reset Deepseek API Key` | — | Replace the stored key for future terminals; cancel preserves it |

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `claudeDeepseekSwitcher.statusBarAlignment` | `right` | Position of the status bar button (`left` or `right`) |

---

## Development

Press **F5** in VS Code to launch the Extension Development Host and test the extension locally.

---

## Privacy & Security

- New keys are persisted only using VS Code SecretStorage, not terminal settings or shell command history. Dedicated terminals are transient and are not revived across reloads.
- The key remains available in the dedicated terminal's process environment. Shell startup scripts, Claude Code subprocesses, and commands you run there can read it. Use trusted workspaces and trusted tools. This is not a security sandbox.
- DeepSeek receives the model requests and context sent by Claude Code when configured for DeepSeek.
- No telemetry or analytics are collected by this extension.
- On activation, migration removes global terminal tokens matching the stored DeepSeek key and recognized legacy DeepSeek routing values. Ambiguous tokens are left intact with a warning. Unrelated settings are preserved.
- Previously running terminals keep their old environment. Close them manually after migration or key replacement. Rotate a previously exposed key; settings backups may still contain it.
- Earlier versions did not save original configuration or colors, so overwritten values cannot be automatically recovered. Restore your preferred colors in VS Code settings if needed.
- Switching and disabling do not kill terminals. Close dedicated terminals yourself when finished; disabling the extension cannot revoke credentials already inherited by processes.

---

## Contributing

Issues and pull requests are welcome at [github.com/shivam-agrawal/claude-deepseek-switcher](https://github.com/shivam-agrawal/claude-deepseek-switcher).

---

## License

MIT © [Shivam Agrawal](https://github.com/shivam-agrawal)
