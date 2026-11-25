const { parseJsonValue, validateGeneratedApiRequest } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

const symbolic = /(?:@[tsr]\.|\{\{|\$\{)/i;
const httpUrl = (value, base) => {
  if (typeof value !== 'string' || !value || /[\s\\#]|^\/\//.test(value) || symbolic.test(value.split('?')[0])) return null;
  try {
    const url = value.startsWith('/') && base ? new URL(value, base) : new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
};

function executableRequest(step) {
  if (step?.step_type !== 'api') return null;
  try { return validateGeneratedApiRequest(step.api_request); }
  catch { return null; }
}

function authoredTargets(step, baseUrl) {
  const request = executableRequest(step);
  const saved = httpUrl(request?.url, baseUrl);
  if (!saved) return [];
  const prose = String(step.action || '').replace(/<[^>]*>/g, ' ');
  const targets = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?:request\s+(?:to\s+)?)?["'`]?(https?:\/\/[^\s"'`<>]+|\/[^\s"'`<>]+)/gi;
  return [...new Set([...prose.matchAll(targets)].flatMap(match => {
    if (match[1].toUpperCase() !== request.method) return [];
    const target = httpUrl(match[2], saved.origin);
    if (!target || target.origin !== saved.origin || target.pathname === saved.pathname || target.search && target.search !== saved.search) return [];
    return [request.url.startsWith('/') ? target.pathname : target.origin + target.pathname];
  }))];
}

function applyUrl(step, endpoint) {
  const raw = parseJsonValue(step.api_request, null);
  const query = raw.url.indexOf('?');
  return { ...raw, url: endpoint + (query < 0 ? '' : raw.url.slice(query)) };
}

function apiAssertionReceipt(step, logs, { failure, requireAuthored = false, baseUrl } = {}) {
  const request = executableRequest(step);
  const detail = logs?.stepApiDetails?.[step.snapshot_step_id];
  if (!request || !detail || detail.request?.method !== request.method || !Number.isInteger(detail.response?.status)
    || detail.response.status < 100 || detail.response.status > 599 || !Array.isArray(detail.assertions)) return false;
  const endpoint = httpUrl(request.url, baseUrl);
  if (endpoint) {
    const observed = httpUrl(detail.request?.url);
    if (!observed || observed.origin !== endpoint.origin || observed.pathname !== endpoint.pathname) return false;
  }
  if (requireAuthored && !request.validations.length) return false;
  const assertions = request.validations.length ? request.validations : [{ kind: 'status' }];
  if (assertions.length !== detail.assertions.length) return false;
  if (!detail.assertions.every((row, index) => {
    if (!row || row.kind !== assertions[index].kind || typeof row.passed !== 'boolean' || symbolic.test(String(row.expected || '')) || symbolic.test(String(row.target || ''))) return false;
    if (row.kind === 'status') {
      const expected = Number(row.expected);
      return /^\d{3}$/.test(row.expected) && expected >= 100 && expected <= 599
        && Number(row.actual) === detail.response.status && row.passed === (detail.response.status === expected);
    }
    if (row.kind === 'response_time') return Number(row.expected) > 0 && Number.isFinite(Number(row.expected))
      && typeof row.actual === 'string' && Boolean(row.actual.trim()) && Number.isFinite(Number(row.actual));
    return true;
  })) return false;
  return failure ? detail.assertions.some(row => !row.passed) : detail.assertions.every(row => row.passed);
}

function assertionBindings(step, logs) {
  const assertions = step && logs?.stepApiDetails?.[step.snapshot_step_id]?.assertions;
  return Array.isArray(assertions) ? assertions.map(row => [row?.kind, row?.target ?? null, row?.expected ?? null]) : null;
}

module.exports = { executableRequest, authoredTargets, applyUrl, apiAssertionReceipt, assertionBindings };
