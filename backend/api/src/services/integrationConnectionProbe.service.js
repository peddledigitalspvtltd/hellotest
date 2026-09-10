const nodemailer = require('nodemailer');
const { resilientHttpRequest } = require('../utils/resilientHttpClient');

const text = value => typeof value === 'string' ? value.trim() : '';
const masked = value => /^(?:\*|•|●){6,}$/.test(text(value));
const invalid = message => Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_CONNECTION_SETTINGS' });
const fail = (detail, nextStep) => Object.assign(new Error(detail), { connectionDetail: detail, nextStep });
const requireValue = (value, label) => { if (!text(value) || masked(value)) throw invalid(`${label} is required. Enter a real value or test an existing saved profile.`); return text(value); };
function baseUrl(value, label = 'Base URL') {
  let url;
  try { url = new URL(requireValue(value, label)); } catch (error) { if (error.statusCode) throw error; throw invalid(`${label} must be an absolute HTTP or HTTPS URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalid(`${label} must use HTTP or HTTPS without embedded credentials, a query string or fragment.`);
  return url.toString().replace(/\/+$/, '');
}
function servicePath(base, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n?#]/.test(path)) throw invalid('Service paths must be same-origin absolute paths without query strings or fragments.');
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) throw invalid('Service paths must stay on the configured host.');
  return url.toString();
}
const basic = (username, key) => `Basic ${Buffer.from(`${requireValue(username, 'Username')}:${requireValue(key, 'Access key')}`).toString('base64')}`;
const bearer = key => ({ Authorization: `Bearer ${requireValue(key, 'API key or access token')}` });
const httpFailure = (status, body) => {
  const quota = /insufficient_quota|quota.exceeded|exceeded.{0,25}quota|billing|credit.{0,20}(?:exhaust|balance)/i.test(body);
  if (quota && [400, 402, 403, 429].includes(status)) return fail('The provider reports exhausted quota or a billing restriction.', 'Restore provider quota or billing, then test again.');
  if (status === 401) return fail('The provider rejected the credentials (HTTP 401).', 'Replace the expired or invalid credential and check the configured account.');
  if (status === 403) return fail('The provider denied access (HTTP 403).', 'Check token scopes, account permissions and provider restrictions for this resource.');
  if (status === 404) return fail('The configured resource or API endpoint was not found (HTTP 404).', 'Check the API base URL, model, repository, branch, folder or project. Private resources may also require additional access.');
  if (status === 429) return fail('The provider is rate limiting requests (HTTP 429).', 'Wait for the provider rate limit to reset, then test again.');
  if (status >= 300 && status < 400) return fail('The endpoint redirected the connection check.', 'Use the final API endpoint directly. Credentials are not forwarded through redirects.');
  return fail(`The provider rejected the check (HTTP ${status}).`, status >= 500 ? 'The provider may be temporarily unavailable. Try again shortly.' : 'Review the provider settings and API compatibility.');
};
const cleanFailure = error => {
  if (error.connectionDetail) return { detail: error.connectionDetail, next: error.nextStep };
  if (error.code === 'EAUTH') return { detail: 'SMTP authentication was rejected.', next: 'Check the SMTP username, password or app password and whether SMTP authentication is enabled.' };
  if (error.name === 'AbortError' || error.name === 'TimeoutError' || /TIMEOUT|DEADLINE|ETIMEDOUT/.test(error.code || '')) return { detail: 'The connection check timed out.', next: 'Check the host, port and network reachability from the backend, then try again.' };
  if (/CERT|TLS|SSL/.test(error.code || '')) return { detail: 'The provider TLS certificate or secure connection could not be verified.', next: 'Correct the certificate, hostname, port and TLS settings.' };
  return { detail: 'The backend could not complete a valid provider response.', next: 'Check the API endpoint, TLS settings and network access from the backend, then try again.' };
};

async function testConnection(input, options = {}) {
  const started = Date.now();
  const checks = [];
  const metadata = {};
  const config = input.config || {};
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || (input.type === 'llm' ? 30_000 : 20_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let current = { id: 'configuration', label: 'Connection settings' };
  let nextStep;
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const step = async (id, label, action, detail) => { current = { id, label }; const value = await action(); add(id, label, 'passed', detail); return value; };
  const json = async (url, init = {}) => {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0 || controller.signal.aborted) throw Object.assign(new Error(), { name: 'TimeoutError' });
    const response = await resilientHttpRequest(url, { ...init, redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json', ...init.headers } }, {
      dependency: `integration-check-${input.type}`, operation: 'connection.test', deadlineMs: remaining,
      maxAttempts: 1, maxConcurrent: 4, maxResponseBytes: 128 * 1024, bufferResponse: true
    });
    const body = await response.text();
    if (!response.ok) { const error = httpFailure(response.status, body); error.upstreamStatus = response.status; error.body = body; throw error; }
    let payload;
    try { payload = JSON.parse(body); } catch { throw fail('The endpoint returned a non-JSON response instead of the expected API response.', 'Use the API endpoint rather than the provider website or sign-in page.'); }
    if (!payload || typeof payload !== 'object' || payload.error || payload.status === 'error') throw fail('The provider returned an error or an unexpected response.', 'Check the endpoint and provider configuration.');
    return payload;
  };
  const expect = (condition, detail) => { if (!condition) throw fail(detail, 'Review the configured endpoint and provider capability, then test again.'); };
  try {
    if (input.type === 'llm') {
      const base = baseUrl(input.base_url || 'https://api.openai.com/v1');
      const model = requireValue(input.model, 'Model');
      const headers = { ...bearer(input.api_key), 'Content-Type': 'application/json' };
      const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
      let tokenField = /^(gpt-5|o[1-9])/.test(model) ? 'max_completion_tokens' : 'max_tokens';
      let payload;
      current = { id: 'generation', label: 'Model authentication and generation' };
      const request = () => json(endpoint, { method: 'POST', headers, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], [tokenField]: 256, stream: false }) });
      try { payload = await request(); } catch (error) {
        if ([400, 422].includes(error.upstreamStatus) && /max_tokens/.test(error.body || '') && /max_completion_tokens/.test(error.body || '')) {
          tokenField = tokenField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'; payload = await request();
        } else throw error;
      }
      expect(Array.isArray(payload.choices) && payload.choices.length > 0, 'The endpoint did not return a chat completion for the selected model.');
      const content = payload.choices[0]?.message?.content;
      const hasContent = typeof content === 'string' ? Boolean(content.trim()) : Array.isArray(content) && content.some(part => text(part?.text));
      add('generation', 'Model authentication and generation', hasContent ? 'passed' : 'warning', hasContent ? 'The configured model authenticated and generated a response within the small test budget.' : 'The model accepted the request but returned no visible text within the small test budget. Full generation is not verified.');
      if (!hasContent) nextStep = 'Review model compatibility and output-token requirements before using it for AI answers.';
    } else if (input.type === 'email') {
      const host = requireValue(config.host, 'SMTP host');
      if (/[\s/@?#]/.test(host)) throw invalid('SMTP host must be a hostname or IP address without a URL scheme.');
      const port = Number(config.port || 587);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid('SMTP port must be between 1 and 65535.');
      const transport = nodemailer.createTransport({ host, port, secure: config.secure === true, auth: { user: requireValue(input.username, 'SMTP username'), pass: requireValue(config.password, 'SMTP password') }, connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs, dnsTimeout: timeoutMs, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
      try {
        await step('smtp', 'SMTP connection and authentication', () => new Promise((resolve, reject) => {
          const abort = () => { transport.close(); reject(Object.assign(new Error(), { name: 'TimeoutError' })); };
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
          else transport.verify().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
        }), 'The SMTP server accepted the connection and authentication. No email was sent.');
      } finally { transport.close(); }
      nextStep = 'Sender-address acceptance and email delivery require a separate real email; this check does not send one.';
    } else if (input.type === 'google_auth') {
      const clientId = requireValue(config.client_id, 'Google client ID');
      if (!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw invalid('Enter a Google OAuth web client ID ending in .apps.googleusercontent.com.');
      await step('discovery', 'Google OpenID configuration', async () => {
        const data = await json('https://accounts.google.com/.well-known/openid-configuration');
        expect(data.issuer === 'https://accounts.google.com' && typeof data.jwks_uri === 'string', 'Google OpenID discovery returned unexpected metadata.');
      }, 'Google OpenID discovery is reachable.');
      add('signin', 'Browser sign-in verification', 'warning', 'The client ID format is valid. Client existence, authorized JavaScript origins and actual sign-in cannot be verified without the browser sign-in flow.');
      nextStep = 'Complete Google sign-in from this application to verify the OAuth client and allowed origins.';
    } else if (input.type === 'google_drive') {
      const folder = requireValue(config.folder_id, 'Drive folder ID');
      const data = await step('folder', 'Drive token and folder access', async () => {
        const payload = await json(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder)}?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`, { headers: bearer(input.api_key) });
        expect(payload.id === folder && payload.mimeType === 'application/vnd.google-apps.folder' && payload.trashed !== true, 'The configured Drive resource is not an accessible, active folder.');
        return payload;
      }, 'The access token can read the configured Drive folder.');
      current = { id: 'backup_access', label: 'Backup write capability' };
      if (data.capabilities?.canAddChildren === false) throw fail('The token cannot add files to the configured folder.', 'Grant folder write access to the token account before enabling backups.');
      add('backup_access', 'Backup write capability', data.capabilities?.canAddChildren === true ? 'passed' : 'warning', data.capabilities?.canAddChildren === true ? 'Drive reports folder-write capability. Token write scopes still apply; no backup was uploaded.' : 'Drive did not report folder write capability. No backup was uploaded.');
    } else if (input.type === 'github') {
      const base = baseUrl(input.base_url || 'https://api.github.com');
      const owner = requireValue(config.owner, 'Repository owner');
      const repo = requireValue(config.repo, 'Repository name');
      const headers = { ...bearer(input.api_key), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      const repository = `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const data = await step('repository', 'GitHub token and repository access', async () => { const value = await json(repository, { headers }); expect(value.id != null && text(value.full_name).toLowerCase() === `${owner}/${repo}`.toLowerCase(), 'GitHub did not return the configured repository.'); return value; }, 'The configured token can access the selected repository. Repository-scoped and installation tokens are supported.');
      if (data.archived || data.disabled) throw fail('The repository is archived or disabled.', 'Select an active repository for code synchronization.');
      await step('branch', 'Configured branch', async () => { const branch = text(config.branch) || 'main'; const value = await json(`${repository}/git/ref/heads/${encodeURIComponent(branch)}`, { headers }); expect(Boolean(value.object?.sha), 'The configured branch could not be resolved.'); }, 'The configured branch exists. No commit was created.');
      add('sync', 'Code synchronization permission', data.permissions?.push === true ? 'passed' : 'warning', data.permissions?.push === true ? 'The account has repository push access. Token content-write scopes and branch policies still apply; no write was attempted.' : 'Repository write access was not confirmed. Check token content-write scopes and branch protection before syncing.');
    } else if (input.type === 'jira') {
      const base = baseUrl(input.base_url);
      const headers = { Authorization: input.username ? basic(input.username, input.api_key) : bearer(input.api_key).Authorization };
      // REST v2 supports the existing Cloud and Data Center integration profiles.
      await step('identity', 'Work-tracker authentication', async () => { const data = await json(`${base}/rest/api/2/myself`, { headers }); expect(Boolean(data.accountId || data.name || data.key), 'The work tracker did not return an authenticated user.'); }, 'The work-tracker API authenticated the configured account.');
      if (text(input.project_key)) await step('project', 'Configured project access', async () => { const data = await json(`${base}/rest/api/2/project/${encodeURIComponent(text(input.project_key))}`, { headers }); expect(Boolean(data.id && data.key), 'The work tracker did not return the configured project.'); }, 'The configured project is readable. No work item was changed.');
      else add('project', 'Project scope', 'warning', 'Account access is verified. Enter a project key to check project-specific access.');
    } else if (input.type === 'testengine' || input.type === 'local-desktop') {
      const base = baseUrl(input.base_url, 'Engine host URL');
      const headers = text(input.api_key) ? bearer(input.api_key) : {};
      await step('health', 'Engine health', async () => { const value = await json(servicePath(base, '/health'), { headers }); expect(value.ok === true, 'The configured engine is not reporting healthy status.'); }, 'The configured engine reports healthy status.');
      const data = await step('capabilities', 'Execution capabilities', async () => { const value = await json(servicePath(base, '/api/v1/capabilities'), { headers }); expect(typeof value.runner === 'string' && Boolean(value.runner.trim()), 'The endpoint does not report HelloTest execution capabilities.'); return value; }, 'HelloTest runtime capabilities were returned. No test run was started.');
      Object.assign(metadata, { base_url: base, health_url: servicePath(base, '/health'), capabilities_url: servicePath(base, '/api/v1/capabilities'), service: 'HelloTest Test Engine',
        runner: ['hybrid', 'local', 'remote', 'api', 'web', 'android', 'ios'].includes(data.runner) ? data.runner : 'unknown',
        control_plane: data.control_plane === 'hellotest' ? 'hellotest' : 'unknown', ui: 'unknown', execution_scope: ['api+web', 'api+web+android', 'api', 'web', 'android', 'ios'].includes(data.execution_scope) ? data.execution_scope : 'unknown',
        supported_step_types: (Array.isArray(data.supported_step_types) ? data.supported_step_types : []).filter(value => ['api', 'web', 'android', 'ios'].includes(value)),
        supported_web_engines: (Array.isArray(data.supported_web_engines) ? data.supported_web_engines : []).filter(value => ['playwright', 'selenium'].includes(value)),
        hellotest_result_log_compatibility: data.hellotest_result_log_compatibility === 'execution_results.logs.v1' ? data.hellotest_result_log_compatibility : null
      });
      const engines = Array.isArray(data.supported_web_engines) ? data.supported_web_engines : [];
      const selected = text(config.active_web_engine) || 'playwright';
      if (engines.length && !engines.includes(selected)) throw fail('The configured web engine is not supported by this runtime.', 'Select a supported engine or update the runtime configuration.');
      add('dispatch', 'Dispatch readiness', 'warning', 'The runtime is reachable. Worker capacity, callbacks and actual execution require a test run.');
    } else if (input.type === 'ops') {
      const base = baseUrl(input.base_url, 'OPS host URL');
      const name = text(config.api_key_header) || 'Authorization';
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || ['host', 'content-length', 'connection', 'accept', 'cookie'].includes(name.toLowerCase())) throw invalid('Use a valid authentication header name for OPS.');
      const prefix = config.api_key_prefix === undefined ? 'Bearer' : String(config.api_key_prefix).trim();
      if (/[\r\n]/.test(prefix) || prefix.length > 64) throw invalid('OPS authentication prefix is invalid.');
      const headers = text(input.api_key) ? { [name]: `${prefix ? `${prefix} ` : ''}${requireValue(input.api_key, 'API key')}` } : {};
      await step('health', 'Telemetry health', async () => { const value = await json(servicePath(base, config.health_path || '/health'), { headers }); expect(value.ok === true || ['ok', 'healthy'].includes(value.status), 'The configured telemetry service did not report healthy status.'); }, 'The configured telemetry service reports healthy status.');
      await step('events', 'Events endpoint', () => json(servicePath(base, config.events_path || '/api/v1/events'), { headers }), 'The events endpoint returned a readable API response.');
      Object.assign(metadata, { base_url: base, health_url: servicePath(base, config.health_path || '/health'), events_url: servicePath(base, config.events_path || '/api/v1/events'), events_path: config.events_path || '/api/v1/events', board_url: servicePath(base, '/ops-telemetry'), service: 'OPS service' });
      add('delivery', 'Event delivery', 'warning', 'Read access is verified. Event ingestion and delivery were not tested because no event was written.');
    } else if (input.type === 'cloudrun') {
      const base = baseUrl(config.remote_url || input.base_url, 'Remote hub URL');
      const provider = text(config.provider) || 'browserstack';
      const host = new URL(base).hostname;
      const headers = { Authorization: basic(input.username, input.api_key) };
      let accountUrl, checkPayload;
      if (provider === 'browserstack') {
        if (!['hub.browserstack.com', 'hub-cloud.browserstack.com'].includes(host)) throw invalid('BrowserStack profiles require a BrowserStack remote hub. Select Other for a custom grid.');
        accountUrl = 'https://api.browserstack.com/automate/plan.json';
        checkPayload = data => Number.isFinite(data.parallel_sessions_max_allowed);
      } else if (provider === 'lambdatest') {
        if (!['hub.lambdatest.com', 'mobile-hub.lambdatest.com'].includes(host)) throw invalid('LambdaTest profiles require a LambdaTest remote hub. Select Other for a custom grid.');
        accountUrl = 'https://api.lambdatest.com/automation/api/v1/user-files';
        checkPayload = data => Array.isArray(data.data) && data.Meta != null;
      } else if (provider === 'saucelabs') {
        const region = /^ondemand\.(us-west-1|us-east-4|eu-central-1)\.saucelabs\.com$/.exec(host)?.[1] || (host === 'ondemand.saucelabs.com' ? 'us-west-1' : null);
        if (!region) throw invalid('Use the Sauce Labs ondemand hub for your account region.');
        accountUrl = `https://api.${region}.saucelabs.com/rest/v1/${encodeURIComponent(input.username)}/jobs?limit=1`;
        checkPayload = Array.isArray;
      } else if (provider === 'crossbrowser') {
        if (host !== 'hub.crossbrowsertesting.com') throw invalid('Use the CrossBrowserTesting remote hub or select Other for a custom grid.');
        accountUrl = 'https://crossbrowsertesting.com/api/v3/account/activeTestCounts';
        checkPayload = data => typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0;
      } else if (provider !== 'other') throw invalid('Choose a supported cloud provider.');
      if (accountUrl) {
        await step('account', 'Cloud account authentication', async () => { const data = await json(accountUrl, { headers }); expect(checkPayload(data), 'The cloud provider did not return its expected authenticated account response.'); }, 'The provider accepted the account credentials. No test session was started.');
        current = { id: 'hub', label: 'Configured remote hub' };
        try {
          const hub = await json(`${base}/status`, { headers });
          const ready = hub.value?.ready === true || (hub.status === 0 && hub.value?.ready !== false);
          add('hub', 'Configured remote hub', ready ? 'passed' : 'warning', ready ? 'The configured remote hub returned a ready WebDriver status.' : 'The hub responded but did not confirm WebDriver readiness.');
        } catch (error) {
          if ([401, 403].includes(error.upstreamStatus)) throw error;
          add('hub', 'Configured remote hub', 'warning', 'Account access is verified, but the configured hub did not expose a readable WebDriver status. Check the hub URL and provider status.');
        }
        add('session', 'Remote session readiness', 'warning', 'Selected devices, browsers and available session capacity still require a test session. No session was started.');
      } else {
        const statusUrl = `${base}/status`;
        await step('grid', 'WebDriver grid status', async () => { const data = await json(statusUrl, { headers }); expect(data.value?.ready === true || (data.status === 0 && data.value?.ready !== false), 'The configured WebDriver grid is not reporting ready status.'); }, 'The configured WebDriver status endpoint reports ready.');
        add('authentication', 'Custom grid authentication', 'warning', 'A public status endpoint cannot prove that these credentials can start a session. No session was started.');
      }
    } else throw invalid('This integration type does not support connection checks.');
  } catch (error) {
    if (error.statusCode === 400 && !checks.length) throw error;
    const failure = cleanFailure(error);
    add(`${current.id}_failure`, current.label, 'failed', failure.detail);
    nextStep = failure.next;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
  const status = checks.some(check => check.status === 'failed') ? 'failed' : checks.some(check => check.status === 'warning') ? 'warning' : 'passed';
  return { ...metadata, ok: status !== 'failed', type: input.type, status, summary: status === 'failed' ? 'Connection check failed.' : status === 'warning' ? 'Connection verified with the limitations below.' : 'Connection checks passed.', checks, latency_ms: Math.max(1, Date.now() - started), checked_at: new Date().toISOString(), ...(nextStep ? { next_step: nextStep } : {}) };
}
module.exports = { testConnection, baseUrl, invalid, masked, text };
