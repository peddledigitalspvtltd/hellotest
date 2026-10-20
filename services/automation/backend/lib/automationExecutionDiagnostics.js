const SECRET_KEY = /(?:password|passwd|secret|token|credential|api.?key|authorization|cookie|private.?key|passcode|(?:^|[._-])pin(?:$|[._-])|otp|verification.?code|one.?time.?code)/i;
const HEADER_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|passwd|secret|token|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key)$/i;
const IDENTITY_KEYS = new Set(['id', 'step_id', 'engine_run_id', 'hellotest_run_id', 'hellotest_execution_id', 'hellotest_test_case_id',
  'attachment_id', 'attachmentId', 'checksum', 'checksum_sha256', 'trace_path', 'video_path', 'summary_path', 'status', 'state', 'event',
  'error_code', 'code', 'provider', 'browser', 'mime_type', 'mimeType', 'content_type', 'kind', 'operation_kind', 'action_outcome', 'assertion_outcome']);
const APPLICATION_KEYS = new Set(['request', 'response', 'body', 'json', 'console', 'network', 'headers', 'captures', 'stepCaptures', 'captured_values', 'values']);
const hostIdentity = (path, key) => IDENTITY_KEYS.has(key) && (
  path === '' && ['engine_run_id', 'hellotest_run_id', 'hellotest_execution_id', 'hellotest_test_case_id', 'status', 'state', 'event'].includes(key)
  || /^(?:case_result|step_outcomes\.\d+)$/.test(path) && ['step_id', 'status'].includes(key)
  || /^(?:case_result\.logs\.)?stepAutomationDetails\.[^.]+$/.test(path) && ['step_id', 'status', 'provider', 'error_code'].includes(key)
  || /^(?:artifact_bundle(?:\.|$)|artifact_refs\.\d+$)/.test(path)
);
const keyOf = value => String(value || '').replace(/^@+/, '').toLowerCase();
const baseKey = value => keyOf(value).replace(/^[trs]\./, '');

/** Frozen execution/envelope sources and actual captures only. No generator,
 * mutable case lookup or private-data retrieval is authorized by redaction. */
function createExecutionDiagnosticRedactor(...sources) {
  const names = new Set(), secrets = new Set();
  const scan = (visit, value, seen = new WeakSet(), depth = 0) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 32) return;
    seen.add(value);
    visit(value);
    for (const item of Object.values(value)) scan(visit, item, seen, depth + 1);
  };
  for (const source of sources) scan(value => {
    for (const name of Array.isArray(value.private_parameter_names) ? value.private_parameter_names : []) names.add(baseKey(name));
  }, source);
  const add = value => {
    if (typeof value === 'string' && value) secrets.add(value);
    else if (typeof value === 'number' || typeof value === 'boolean') secrets.add(String(value));
  };
  for (const source of sources) scan(value => {
    for (const [key, entry] of Object.entries(value)) if (SECRET_KEY.test(key) || names.has(baseKey(key))) add(entry);
    if (value.is_secret === true || SECRET_KEY.test(String(value.key || value.name || '')) || names.has(baseKey(value.key || value.name))) add(value.value);
  }, source);
  const variants = new Set();
  for (const value of secrets) {
    variants.add(value); variants.add(JSON.stringify(value).slice(1, -1));
    try { variants.add(encodeURIComponent(value)); } catch { /* Raw malformed Unicode remains covered. */ }
  }
  const ordered = [...variants].filter(Boolean).sort((left, right) => right.length - left.length);
  const text = value => {
    if (/^data:(?:image|video)\/[\w.+-]+;base64,/i.test(value)) return value;
    let result = value;
    for (const secret of ordered) {
      if (secret.length >= 4) result = result.split(secret).join('[REDACTED]');
      else result = result.replace(new RegExp(`(?<![A-Za-z0-9])${secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'g'), '[REDACTED]');
    }
    return result.replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [REDACTED]')
      .replace(/((?:[?&]|\b)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[:=]\s*["']?)[^&#\s,"']*/gi, '$1[REDACTED]')
      .replace(/\b(https?|postgres(?:ql)?):\/\/[^\s/@]+:[^\s/@]+@/gi, '$1://[REDACTED]@');
  };
  return payload => {
    const seen = new WeakSet();
    const visit = (value, depth = 0, captures = false, application = false, path = '') => {
      if (typeof value === 'string') return text(value);
      if (!value || typeof value !== 'object') return application && secrets.has(String(value)) ? '[REDACTED]' : value;
      if (seen.has(value) || depth > 32) return '[DIAGNOSTIC_LIMIT]';
      seen.add(value);
      try {
        if (Array.isArray(value)) return value.map((item, index) => visit(item, depth + 1, captures, application, `${path}.${index}`.replace(/^\./, '')));
        const secretEntry = value.is_secret === true || HEADER_KEY.test(String(value.key || value.name || ''));
        const originalKeys = new Set(Object.keys(value)), outputKeys = new Set();
        let redactedKey = 0;
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
          let publicKey = key;
          if (application && text(key) !== key) {
            do { publicKey = `[REDACTED_KEY_${++redactedKey}]`; } while (originalKeys.has(publicKey) || outputKeys.has(publicKey));
          }
          outputKeys.add(publicKey);
          return [publicKey,
          !application && (hostIdentity(path, key) || /^(?:case_result\.logs\.)?stepStatuses$/.test(path)) ? entry
            : HEADER_KEY.test(key) || SECRET_KEY.test(key) || captures && names.has(baseKey(key)) || secretEntry && key === 'value' ? '[REDACTED]'
              : visit(entry, depth + 1, captures || ['captures', 'stepCaptures', 'captured_values'].includes(key),
                application || APPLICATION_KEYS.has(key), path ? `${path}.${key}` : key)];
        }));
      } finally { seen.delete(value); }
    };
    return visit(payload);
  };
}

module.exports = { createExecutionDiagnosticRedactor };
