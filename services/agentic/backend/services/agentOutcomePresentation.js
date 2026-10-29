// Validate presentation data before it reaches React or a revision request.
// Task guidance is managed in AI Controls; these are native display contracts.
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/^\s*(?:null|undefined|\[object Object\])\s*$/i.test(value);
const list = (value, max, test) => Array.isArray(value) && value.length <= max && value.every(test);
function presentationIssues(candidate, citations = []) {
  const issues = [];
  const add = (path, issue) => { if (issues.length < 20) issues.push({ path, issue }); };
  if (!record(candidate)) return [{ path: '$', issue: 'object_required' }];
  if (candidate.no_changes_required != null && typeof candidate.no_changes_required !== 'boolean') add('no_changes_required', 'boolean_required');
  if (!text(candidate.response, 32000)) add('response', 'nonempty_string_required');
  for (const field of ['headline', 'executive_summary', 'activity_summary']) {
    if (candidate[field] != null && !text(candidate[field], field === 'headline' ? 300 : 2400)) add(field, 'text_required');
  }
  for (const field of ['recommendations', 'assumptions', 'evidence_gaps', 'suggested_handoffs', 'citation_ids']) {
    if (candidate[field] != null && !list(candidate[field], field === 'citation_ids' ? 36 : 20, value => text(value, 2400))) add(field, 'bounded_text_array_required');
  }
  for (const field of ['findings', 'deliverables']) {
    if (candidate[field] == null) continue;
    if (!list(candidate[field], 20, record)) { add(field, 'bounded_object_array_required'); continue; }
    candidate[field].forEach((item, index) => {
      if (!text(item.title || item.label, 300)) add(`${field}[${index}].title`, 'nonempty_text_required');
      if (!text(item.detail || item.content || item.summary, field === 'findings' ? 8000 : 16000)) add(`${field}[${index}].detail`, 'nonempty_text_required');
      if (item.id != null && !text(item.id, 120)) add(`${field}[${index}].id`, 'bounded_text_identifier_required');
      if (item.citation_ids != null && !list(item.citation_ids, 36, id => text(id, 255))) add(`${field}[${index}].citation_ids`, 'text_identifier_array_required');
      if (item.artifact_kind != null && !['story', 'test_case', 'defect', 'run', 'automation'].includes(item.artifact_kind)) add(`${field}[${index}].artifact_kind`, 'supported_artifact_kind_required');
      if (item.requires_proposal != null && typeof item.requires_proposal !== 'boolean') add(`${field}[${index}].requires_proposal`, 'boolean_required');
      if (item.priority != null && !['critical', 'high', 'medium', 'low', 'info'].includes(item.priority)) add(`${field}[${index}].priority`, 'supported_finding_priority_required');
      if (item.type != null && !text(item.type, 80)) add(`${field}[${index}].type`, 'bounded_text_required');
      for (const key of ['observation', 'gap', 'impact', 'proposed_action', 'acceptance_check']) if (item[key] != null && (typeof item[key] !== 'string' || item[key].length > 2400)) add(`${field}[${index}].${key}`, 'bounded_text_required');
    });
  }
  const ids = (Array.isArray(candidate.findings) ? candidate.findings : []).map((item, index) => item?.id || `finding-${index + 1}`);
  if (new Set(ids).size !== ids.length) add('findings', 'unique_finding_identifiers_required');
  const allowed = new Set(citations.map(item => item.id));
  // Identifiers must resolve to the supplied context; a well-shaped reference
  // must never be presented as evidence when it names an invented source.
  for (const [path, ids] of [
    ['citation_ids', candidate.citation_ids],
    ...['findings', 'deliverables'].flatMap(field => Array.isArray(candidate[field]) ? candidate[field].map((item, index) => [`${field}[${index}].citation_ids`, item?.citation_ids]) : [])
  ]) if (Array.isArray(ids) && ids.some(id => !allowed.has(id))) add(path, 'supplied_citations_required');
  const cited = item => list(item.citation_ids, 36, id => text(id, 255) && allowed.has(id)) && item.citation_ids.length > 0;
  for (const field of ['sections', 'tables', 'charts']) {
    if (candidate[field] == null) continue;
    if (!list(candidate[field], 8, record)) { add(field, 'bounded_object_array_required'); continue; }
    candidate[field].forEach((item, index) => {
      const path = `${field}[${index}]`;
      if (!text(item.title, 300) || !cited(item)) add(path, 'title_and_supplied_citations_required');
      if (field === 'sections' && !text(item.body, 8000)) add(`${path}.body`, 'nonempty_text_required');
      if (field === 'tables') {
        if (!list(item.columns, 8, value => text(value, 160)) || !item.columns.length
          || !list(item.rows, 50, row => list(row, item.columns.length, cell => typeof cell === 'string' && cell.length <= 2000) && row.length === item.columns.length)) add(path, 'rectangular_text_table_required');
      }
      if (field === 'charts') {
        if (item.type !== 'bar' || !text(item.unit, 80) || !list(item.series, 20, entry => record(entry) && text(entry.label, 160) && typeof entry.value === 'number' && Number.isFinite(entry.value)) || !item.series.length) add(path, 'finite_labelled_bar_series_with_unit_required');
      }
    });
  }
  const bytes = Buffer.byteLength(JSON.stringify({ sections: candidate.sections, tables: candidate.tables, charts: candidate.charts }));
  if (bytes > 64000) add('presentation', 'maximum_64kb');
  return issues;
}
function normalizePresentation(candidate = {}) {
  return Object.fromEntries(['sections', 'tables', 'charts'].map(field => [field, candidate[field] || []]));
}
module.exports = { presentationIssues, normalizePresentation };
