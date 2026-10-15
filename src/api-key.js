'use strict';
const { isDeepseekEndpoint } = require('./presets');

// Model discovery checks credentials without sending a prompt or generating tokens.
async function checkApiKey(preset, key, request = globalThis.fetch) {
  const base = preset.baseUrl || preset.environment.ANTHROPIC_BASE_URL;
  const url = new URL(base);
  const headers = { Accept: 'application/json' };
  if (preset.apiKeyEnv === 'ANTHROPIC_API_KEY') headers['x-api-key'] = key;
  else headers.Authorization = `Bearer ${key}`;
  if (preset.environment) headers['anthropic-version'] = '2023-06-01';
  if (isDeepseekEndpoint(base) && /^\/(anthropic\/?|v1\/?|)$/.test(url.pathname)) {
    url.pathname = '/models';
  } else {
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix}${preset.environment && !prefix.endsWith('/v1') ? '/v1' : ''}/models`;
  }
  try {
    const response = await request(url, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) return { state: 'rejected', reason: 'The provider rejected this API key (HTTP 401).' };
    if (response.status === 403) return { state: 'unknown', reason: 'The provider denied access (HTTP 403). Check the key and account permissions.' };
    if (!response.ok) return { state: 'unknown', reason: `The provider returned HTTP ${response.status}.` };
    const body = await response.json();
    if (!Array.isArray(body?.data)) return { state: 'unknown', reason: 'The endpoint did not return a model list.' };
    return { state: 'accepted' };
  } catch {
    // Never surface network error details: they may contain credentials.
    return { state: 'unknown', reason: 'The connection failed or timed out.' };
  }
}

async function validateAndStoreKey(vscode, secrets, preset, key) {
  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Checking ${preset.label} API key…`,
  }, () => checkApiKey(preset, key));
  if (result.state === 'rejected') {
    await vscode.window.showErrorMessage(`${result.reason} Key not saved. Run the command again to enter another key.`);
    return null;
  }
  if (result.state === 'unknown') {
    const answer = await vscode.window.showWarningMessage(
      `Could not verify ${preset.label} API key. ${result.reason} Some providers do not support model discovery.`,
      'Save Without Verification', 'Cancel',
    );
    if (answer !== 'Save Without Verification') return null;
  }
  await secrets.store(preset.key, key);
  await vscode.window.showInformationMessage(result.state === 'accepted'
    ? `${preset.label} API key saved. Connection check passed: the provider returned its model list. Model access and available credit are not checked.`
    : `${preset.label} API key saved without verification.`);
  return key;
}
module.exports = { checkApiKey, validateAndStoreKey };
