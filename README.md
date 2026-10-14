# Claude Deepseek Switcher

A VS Code extension that lets you seamlessly switch between **Anthropic Claude** and **Deepseek** AI models inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started) — directly from your status bar.

---

## Features

- **One-click model switching** — click the status bar button to open a model picker
- **Visual theme indicator** — status bar turns 🟠 orange for Claude and 🟣 purple for Deepseek so you always know which model is active
- **Secure API key storage** — your Deepseek API key is stored in VS Code's built-in secret store, never in plaintext
- **Automatic terminal reload** — all terminals are recycled after a switch so the new environment variables take effect immediately
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

---

## How It Works

When you switch to **Deepseek**, the extension injects the following environment variables into every new VS Code integrated terminal:

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

When you switch back to **Claude**, all of those variables are removed so Claude Code uses its default Anthropic configuration.

---

## Commands

| Command | Keyboard Shortcut | Description |
|---|---|---|
| `Claude Deepseek Switcher: Switch Model` | `Cmd+Alt+M` / `Ctrl+Alt+M` | Open the model picker |
| `Claude Deepseek Switcher: Reset Deepseek API Key` | — | Delete the stored key and enter a new one |

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `claudeDeepseekSwitcher.currentModel` | `claude` | The currently active model (`claude` or `deepseek`) |
| `claudeDeepseekSwitcher.claudeModel` | `claude-sonnet-4-6` | Claude model variant label |
| `claudeDeepseekSwitcher.deepseekModel` | `deepseek-chat` | Deepseek model variant label |
| `claudeDeepseekSwitcher.statusBarAlignment` | `right` | Position of the status bar button (`left` or `right`) |

---

## Development

Press **F5** in VS Code to launch the Extension Development Host and test the extension locally.

---

## Privacy & Security

- Your Deepseek API key is stored using VS Code's [SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) and is never written to disk in plaintext
- No telemetry or analytics of any kind are collected

---

## Contributing

Issues and pull requests are welcome at [github.com/shivam-agrawal/claude-deepseek-switcher](https://github.com/shivam-agrawal/claude-deepseek-switcher).

---

## License

MIT © [Shivam Agrawal](https://github.com/shivam-agrawal)
