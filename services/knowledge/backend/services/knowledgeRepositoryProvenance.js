const { sanitizeAiText, fingerprint } = require('@hellotest/platform/backend/src/security/aiTextPolicy');

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, max) => typeof value === 'string' ? sanitizeAiText(value.trim().slice(0, max)).text : '';
const path = value => {
  if (typeof value !== 'string' || !value || value.length > 500) return null;
  const normalized = value.normalize('NFC').replace(/\\/g, '/');
  if (/^(?:\/|[A-Za-z]:)/.test(normalized) || /[\x00-\x1f\x7f]/.test(normalized)
    || normalized.split('/').some(part => !part || ['.', '..'].includes(part))) return null;
  return text(normalized, 500) || null;
};
const line = value => Number.isSafeInteger(value) && value > 0 && value <= 10000000 ? value : null;
const repository = value => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return text(url.toString(), 1000) || null;
  } catch { return text(value, 240) || null; }
};

// Repository provenance is evidence, never an authorization or graph relation.
// Deliberately exclude arbitrary client metadata, security bindings, grants,
// application context profiles, native record links and model instructions.
function repositoryProvenanceMetadata(value) {
  const raw = object(value);
  if (!/^repository-agent:[a-f0-9]{64}$/.test(raw.repository_agent_key || '')
    || typeof raw.agent_run_id !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(raw.agent_run_id)) return {};
  const safe = {
    repository_agent_key: raw.repository_agent_key, agent_run_id: raw.agent_run_id,
    static_analysis: true, runtime_verified: false, review_required: true,
    repository_provenance_version: 1
  };
  if (['repository_overview','repository_source','repository_documentation'].includes(raw.kind)) safe.kind = raw.kind;
  const file = path(raw.repository_file); if (file) safe.repository_file = file;
  const origin = repository(raw.repository); if (origin) safe.repository = origin;
  if (typeof raw.revision === 'string' && /^[a-f0-9]{7,64}$/i.test(raw.revision)) safe.revision = raw.revision.toLowerCase();
  if (typeof raw.content_hash === 'string' && /^[a-f0-9]{64}$/i.test(raw.content_hash)) safe.content_hash = raw.content_hash.toLowerCase();
  if (line(raw.start_line)) safe.start_line = raw.start_line;
  if (line(raw.end_line) && raw.end_line >= (safe.start_line || 1)) safe.end_line = raw.end_line;
  if (typeof raw.truncated === 'boolean') safe.truncated = raw.truncated;
  if (Number.isSafeInteger(raw.source_files) && raw.source_files >= 0 && raw.source_files <= 30000) safe.source_files = raw.source_files;
  if (typeof raw.language === 'string' && /^[A-Za-z0-9_+-]{1,40}$/.test(raw.language)) safe.language = raw.language;
  if (Array.isArray(raw.symbols)) safe.symbols = [...new Set(raw.symbols.filter(item => typeof item === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(item)))].slice(0, 40);
  if (Array.isArray(raw.evidence)) safe.evidence = raw.evidence.slice(0, 50).flatMap(item => {
    const entry = object(item), filename = path(entry.path), number = line(entry.line);
    if (!filename || !number) return [];
    return [{ path: filename, line: number, ...(typeof entry.excerpt === 'string' ? { excerpt: text(entry.excerpt, 240) } : {}) }];
  });
  safe.repository_provenance_fingerprint = fingerprint(JSON.stringify(safe));
  return safe;
}

module.exports = { repositoryProvenanceMetadata };
