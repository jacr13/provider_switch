'use strict';
const vscode = require('vscode');
const { createServices } = require('./shared');
const { createClaudeTarget } = require('./claude');
const { createCodexTarget } = require('./codex');
let claude, codex, busy = false;
const CODEX_FAILURE = 'Could not update the Codex configuration. Check that its configuration file is writable and SecretStorage is available, then try again.';

function guarded(action, failure = 'Could not update the Claude Code provider. Check that user settings are writable and SecretStorage is available, then try again.') {
  return async () => {
    if (busy) return;
    busy = true;
    try { await action(); }
    catch { vscode.window.showErrorMessage(failure); }
    finally { busy = false; claude.updateStatus(); await codex.updateStatus(); }
  };
}

async function activate(context) {
  const cfg = vscode.workspace.getConfiguration('providerSwitch');
  const output = vscode.window.createOutputChannel('Provider Switch');
  context.subscriptions.push(output);
  const alignment = cfg.get('statusBarAlignment') === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
  // Equal priorities let VS Code group these by extension instead of interleaving other items.
  const statusBarPriority = 100;
  const statusBarItem = vscode.window.createStatusBarItem('claude-code-provider', alignment, statusBarPriority);
  statusBarItem.command = 'provider-switch.switchModel';
  context.subscriptions.push(statusBarItem);
  const codexStatusBarItem = vscode.window.createStatusBarItem('codex-provider', alignment, statusBarPriority);
  codexStatusBarItem.command = 'provider-switch.switchCodexModel';
  context.subscriptions.push(codexStatusBarItem);
  const services = createServices(vscode, context.secrets, output);
  claude = createClaudeTarget(services, statusBarItem);
  codex = createCodexTarget(services, codexStatusBarItem);
  services.setTargets([claude, codex]);
  claude.updateStatus();
  await codex.updateStatus();
  await codex.adoptBackup();
  await claude.adoptBackup();
  await codex.keepBackup();
  const timer = setInterval(() => { claude.updateStatus(); void codex.updateStatus(); }, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
    if (event.affectsConfiguration('claudeCode') || event.affectsConfiguration('providerSwitch')) {
      claude.updateStatus();
      await codex.updateStatus();
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switch.switchModel', guarded(claude.switchModel)));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switch.resetApiKey', guarded(() => claude.resetApiKey())));
  // Keep a direct DeepSeek key-reset command for custom keybindings.
  context.subscriptions.push(vscode.commands.registerCommand('provider-switch.resetDeepseekApiKey', guarded(() => claude.resetApiKey('deepseek'))));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switch.configurePresets', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'providerSwitch.presets')));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switch.switchCodexModel', guarded(codex.switchModel, CODEX_FAILURE)));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switch.resetCodexApiKey', guarded(() => codex.resetApiKey(), CODEX_FAILURE)));
  context.subscriptions.push(vscode.commands.registerCommand('provider-switch.configureCodexPresets', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'providerSwitch.presets')));
}

function deactivate() {}
module.exports = { activate, deactivate };
