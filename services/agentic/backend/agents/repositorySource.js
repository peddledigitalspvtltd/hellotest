const integrations = require('@hellotest/integration/backend/services/integration.service');
const { resilientHttpRequest } = require('@hellotest/platform/backend/src/utils/resilientHttpClient');
const { SERVICE_ERROR_CODES } = require('@hellotest/platform/backend/src/utils/serviceErrors');

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_BUDGET_MS = 60_000;
const API_ORIGIN = 'https://api.github.com';
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

const sourceError = (message, statusCode = 400, code = 'REPOSITORY_SOURCE_INVALID') =>
  Object.assign(new Error(message), { statusCode, code });

function normalizeRef(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 255 || value !== value.trim()
    || /[\x00-\x20\x7f~^:?*\[\\%]/.test(value) || value.includes('..')
    || value.includes('@{') || value === '@' || value.endsWith('.')
    || value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw sourceError('Enter a valid GitHub branch, tag or commit SHA, without a URL or query string.');
  }
  return value;
}

/** Normalize without fetching or retaining arbitrary source fields or credentials. */
function normalizeGithubSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || source.type !== 'github') {
    throw sourceError('Select a GitHub repository source.');
  }
  const raw = source.repository_url;
  if (typeof raw !== 'string' || raw.length > 512 || /[\x00-\x20\x7f\\%?#]/.test(raw)) {
    throw sourceError('Use the repository URL https://github.com/owner/repository, without credentials or additional paths.');
  }
  // Validate the raw path before URL parsing can normalize traversal segments.
  const match = /^https:\/\/github\.com\/([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9._-]{1,104})\/?$/i.exec(raw);
  if (!match) throw sourceError('Use the repository URL https://github.com/owner/repository, without credentials or additional paths.');
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!repo || repo === '.' || repo === '..' || repo.length > 100) {
    throw sourceError('Enter a valid GitHub repository name.');
  }
  const integrationId = source.integration_id;
  if (integrationId !== undefined && integrationId !== null && integrationId !== ''
    && (typeof integrationId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(integrationId))) {
    throw sourceError('Select a valid saved GitHub integration.');
  }
  return {
    type: 'github',
    name: `${owner}/${repo}`,
    repository_url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    ref: normalizeRef(source.ref),
    ...(integrationId ? { integration_id: integrationId } : {})
  };
}

function throwIfAborted(signal, timedOut) {
  if (!signal.aborted) return;
  throw timedOut()
    ? sourceError('GitHub download exceeded 60 seconds. Retry, or upload a repository ZIP smaller than 20 MB.', 504, 'REPOSITORY_SOURCE_TIMEOUT')
    : sourceError('Repository download was cancelled.', 499, 'REPOSITORY_SOURCE_CANCELLED');
}

// Database lookups do not support AbortSignal; release the caller promptly while
// keeping both eventual outcomes handled and never using credentials after abort.
async function waitWithSignal(promise, signal, timedOut) {
  throwIfAborted(signal, timedOut);
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => { try { throwIfAborted(signal, timedOut); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function resolveCredential(source, projectId, signal, timedOut) {
  if (!source.integration_id) return null;
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw sourceError('Select a project before using a saved GitHub integration.', 403, 'REPOSITORY_SOURCE_FORBIDDEN');
  }
  let profile;
  try {
    profile = await waitWithSignal(integrations.getIntegration(source.integration_id), signal, timedOut);
  } catch (error) {
    throwIfAborted(signal, timedOut);
    throw sourceError('The saved GitHub integration is unavailable. Select an accessible GitHub integration for this project.', 403, 'REPOSITORY_SOURCE_FORBIDDEN');
  }
  throwIfAborted(signal, timedOut);
  const config = profile?.config || {};
  if (profile?.type !== 'github' || config.project_id !== projectId) {
    throw sourceError('The saved GitHub integration must belong to the selected project.', 403, 'REPOSITORY_SOURCE_FORBIDDEN');
  }
  if (String(config.owner || '').toLowerCase() !== source.owner.toLowerCase()
    || String(config.repo || '').toLowerCase() !== source.repo.toLowerCase()) {
    throw sourceError('The saved GitHub integration is configured for a different repository. Select the matching integration.', 403, 'REPOSITORY_SOURCE_FORBIDDEN');
  }
  if (profile.base_url && !/^https:\/\/api\.github\.com\/?$/i.test(profile.base_url)) {
    throw sourceError('This source requires a GitHub.com integration using https://api.github.com. Upload a ZIP for other GitHub hosts.', 400);
  }
  const token = profile.api_key;
  if (typeof token !== 'string' || !token.trim() || token.length > 8192
    || /[\x00-\x20\x7f]/.test(token) || /^[*•●]{6,}$/.test(token)) {
    throw sourceError('The saved GitHub integration has no usable access token. Update its credentials in Integrations.', 400);
  }
  return token;
}

function httpFailure(response, operation) {
  const status = response.status;
  if (status === 401) return sourceError('GitHub rejected the saved access token. Update the integration credentials and retry.', 422, 'REPOSITORY_SOURCE_AUTH');
  if ((status === 403 && response.headers.get('x-ratelimit-remaining') === '0') || status === 429) {
    return sourceError('GitHub is rate limiting repository access. Retry later, or select a matching GitHub integration for a higher allowance.', 429, 'REPOSITORY_SOURCE_RATE_LIMIT');
  }
  if (status === 403) return sourceError('GitHub denied repository access. Check Contents read permission, repository selection and any organization SSO authorization.', 422, 'REPOSITORY_SOURCE_AUTH');
  if (status === 404) return sourceError(operation === 'commit'
    ? 'GitHub could not find this repository or revision. Check the branch, tag or commit and private repository access.'
    : 'GitHub could not find or read this repository archive. Check the repository URL, private access and that the repository contains commits.', 422, 'REPOSITORY_SOURCE_NOT_FOUND');
  if (status === 409) return sourceError('The GitHub repository has no readable commit. Add source files and retry.', 422);
  if (status === 422) return sourceError('GitHub could not resolve this revision. Enter an existing branch, tag or commit SHA.', 422);
  if (status >= 300 && status < 400) return sourceError('GitHub redirected to an unsupported location. Use the current canonical repository URL or upload a ZIP.', 422);
  return sourceError('GitHub could not complete the repository download. Retry shortly, or upload a repository ZIP.', 502, 'REPOSITORY_SOURCE_UNAVAILABLE');
}

function normalizeArchiveRedirect(location, source, sha) {
  if (typeof location !== 'string' || location.length > 8192 || /[\x00-\x20\x7f\\]/.test(location)) {
    throw sourceError('GitHub returned an invalid archive download location. Retry or upload a ZIP.', 502);
  }
  let url;
  try { url = new URL(location); } catch { throw sourceError('GitHub returned an invalid archive download location. Retry or upload a ZIP.', 502); }
  const expectedPaths = [`/${source.owner}/${source.repo}/legacy.zip/${sha}`, `/${source.owner}/${source.repo}/zip/${sha}`];
  if (url.protocol !== 'https:' || url.hostname !== 'codeload.github.com' || url.port
    || url.username || url.password || url.hash || !expectedPaths.some(path => path.toLowerCase() === url.pathname.toLowerCase())) {
    throw sourceError('GitHub returned an unexpected archive host or revision. Retry or upload a repository ZIP.', 502);
  }
  // Private archive URLs may contain a short-lived signed query. It is used only
  // for this request, never persisted, returned, logged or combined with a token.
  return url.toString();
}

/**
 * Download a pinned snapshot; never clone, execute, extract or mutate a repository.
 * The caller must authorize integration.view before supplying integration_id.
 * Public repositories require no integration. Saved credentials remain bound to
 * their project, repository and GitHub.com API. Global profiles are not accepted.
 *
 * GitHub documents SHA-only commit responses and temporary ZIP redirects:
 * https://docs.github.com/en/rest/commits/commits#get-a-commit
 * https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip
 */
async function downloadGithubSource(input, { signal: externalSignal, projectId } = {}) {
  const source = normalizeGithubSource(input);
  const controller = new AbortController();
  let timedOut = false;
  const started = Date.now();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, DOWNLOAD_BUDGET_MS);
  timeout.unref?.();
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  const signal = controller.signal;
  const didTimeOut = () => timedOut;
  try {
    throwIfAborted(signal, didTimeOut);
    const token = await resolveCredential(source, projectId, signal, didTimeOut);
    const apiHeaders = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HelloTest-Repository-Agents',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
    const request = async (url, operation, { archive = false, headers = apiHeaders } = {}) => {
      throwIfAborted(signal, didTimeOut);
      const remaining = DOWNLOAD_BUDGET_MS - (Date.now() - started);
      if (remaining <= 0) { timedOut = true; controller.abort(); throwIfAborted(signal, didTimeOut); }
      return resilientHttpRequest(url, { method: 'GET', headers, redirect: 'manual', signal }, {
        dependency: 'repository-source-github',
        operation: `repository.${operation}`,
        deadlineMs: remaining,
        maxAttempts: 2,
        maxResponseBytes: archive ? MAX_ARCHIVE_BYTES : operation === 'commit' ? 1024 : 128 * 1024,
        maxConcurrent: 2,
        baseDelayMs: 100,
        maxDelayMs: 500,
        bufferResponse: true
      });
    };
    const repoApi = `${API_ORIGIN}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
    let ref = source.ref;
    if (!ref) {
      const response = await request(repoApi, 'metadata');
      if (!response.ok) throw httpFailure(response, 'metadata');
      let metadata;
      try { metadata = await response.json(); } catch { throw sourceError('GitHub returned invalid repository metadata. Retry or upload a ZIP.', 502); }
      if (String(metadata?.full_name || '').toLowerCase() !== source.name.toLowerCase()) {
        throw sourceError('The repository identity changed. Use its current GitHub URL and matching integration.', 422);
      }
      try { ref = normalizeRef(metadata.default_branch); } catch { /* Report a safe provider error below. */ }
      if (!ref) throw sourceError('GitHub did not report a valid default branch. Specify an existing branch, tag or commit SHA.', 422);
    }
    // SHA media avoids downloading commit diffs just to identify a snapshot.
    const commit = await request(`${repoApi}/commits/${encodeURIComponent(ref)}`, 'commit', {
      headers: { ...apiHeaders, Accept: 'application/vnd.github.sha' }
    });
    if (!commit.ok) throw httpFailure(commit, 'commit');
    const sha = (await commit.text()).trim().toLowerCase();
    if (!SHA_PATTERN.test(sha)) throw sourceError('GitHub did not return a valid commit identity. Retry or upload a repository ZIP.', 502);
    if (SHA_PATTERN.test(ref) && ref.toLowerCase() !== sha) throw sourceError('GitHub returned a different commit than requested. Retry with the correct commit SHA.', 502);
    let archive = await request(`${repoApi}/zipball/${sha}`, 'archive', { archive: true });
    if ([301, 302, 303, 307, 308].includes(archive.status)) {
      const downloadUrl = normalizeArchiveRedirect(archive.headers.get('location'), source, sha);
      // Do not forward the integration token, cookies or API headers to codeload.
      archive = await request(downloadUrl, 'archive', { archive: true, headers: { Accept: 'application/zip', 'User-Agent': 'HelloTest-Repository-Agents' } });
    }
    if (!archive.ok) throw httpFailure(archive, 'archive');
    throwIfAborted(signal, didTimeOut);
    const buffer = Buffer.from(await archive.arrayBuffer());
    throwIfAborted(signal, didTimeOut);
    if (buffer.length < 4 || ![0x04034b50, 0x06054b50].includes(buffer.readUInt32LE(0))) {
      throw sourceError('GitHub returned an invalid ZIP archive. Retry or upload a repository ZIP.', 502);
    }
    return { buffer, source: { type: 'github', name: source.name, repository_url: source.repository_url, ref, commit_sha: sha } };
  } catch (error) {
    if (error?.code === SERVICE_ERROR_CODES.RESPONSE_TOO_LARGE) {
      throw sourceError('The repository download exceeds its size limit (20 MB for ZIP archives). Upload a smaller source archive.', 413, 'REPOSITORY_SOURCE_TOO_LARGE');
    }
    throwIfAborted(signal, didTimeOut);
    if (String(error?.code || '').startsWith('REPOSITORY_SOURCE_')) throw error;
    if (error?.code === SERVICE_ERROR_CODES.TIMEOUT) throw sourceError('GitHub did not respond in time. Retry, or upload a repository ZIP smaller than 20 MB.', 504, 'REPOSITORY_SOURCE_TIMEOUT');
    throw sourceError('The GitHub download could not complete. Check connectivity and retry, or upload a repository ZIP.', 502, 'REPOSITORY_SOURCE_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

module.exports = { normalizeGithubSource, downloadGithubSource, MAX_ARCHIVE_BYTES, DOWNLOAD_BUDGET_MS };
