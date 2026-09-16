const { createHash } = require('node:crypto');
const db = require('../db');
const agents = require('./repositoryAgents.service');
const permissionService = require('../services/permission.service');
const mobileFeatureService = require('../services/mobileFeature.service');
const { FINDING_KEYS, PUBLISH_PERMISSIONS, LIMITS, error } = require('./catalog');

const text = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const sourceNotes = finding => finding.evidence.map(e => `${e.path}:${e.line}`).join('\n');
const parameter = name => /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? `@t.${name}` : `@t.[${name.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
const bodyParameters = value => {
  if (typeof value === 'string') { const placeholder = /^\{\{([^{}\r\n]+)\}\}$/.exec(value); return placeholder ? parameter(placeholder[1]) : value; }
  if (Array.isArray(value)) return value.map(bodyParameters);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bodyParameters(item)]));
  return value;
};
const hasRequestBody = finding => finding.body != null || Boolean(finding.body_schema && Object.keys(finding.body_schema).length);
const needsTypedWireBody = schema => {
  if (!schema || typeof schema !== 'object') return false;
  if (schema.properties && typeof schema.properties === 'object') return Object.values(schema.properties).some(field => field?.type === 'object' ? needsTypedWireBody(field) : field?.type !== 'string');
  return true;
};
const apiBodyDraft = finding => {
  if (!hasRequestBody(finding)) return { body_mode: 'none', body: '', headers: [] };
  if (finding.body_media_type_established === false) return null;
  const contentType = text(finding.content_type, 200) || 'application/json';
  if (/[\r\n]/.test(contentType)) return null;
  const media = contentType.split(';')[0].trim().toLowerCase();
  const headers = [{ key: 'Content-Type', value: contentType }];
  if (media === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(media)) return { body_mode: 'json', body: finding.body == null || needsTypedWireBody(finding.body_schema) ? '@t.request_body' : JSON.stringify(bodyParameters(finding.body), null, 2), headers };
  const bodyMode = media === 'application/x-www-form-urlencoded' ? 'form'
    : media === 'application/xml' || media === 'text/xml' || /^application\/[a-z0-9.+-]+\+xml$/.test(media) ? 'xml'
    : /^text\/[a-z0-9.+-]+$/.test(media) ? 'text' : null;
  // A schema does not establish XML structure, encoded form serialization or
  // multipart boundaries. Supported raw formats require reviewed wire content.
  return bodyMode ? { body_mode: bodyMode, body: '@t.request_body', headers } : null;
};
function apiDraftRequest(finding) {
  if (!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(finding.method) || typeof finding.path !== 'string' || !finding.path.startsWith('/')) return null;
  const body = apiBodyDraft(finding);
  if (!body) return null;
  let url = '@r.base_url' + finding.path.replace(/\{([^{}]+)\}|:([a-zA-Z_][a-zA-Z0-9_-]*)/g, (_, bracket, colon) => parameter(bracket || colon));
  const query = (finding.parameters || []).filter(item => item.in === 'query' && item.required && typeof item.name === 'string');
  if (query.length) url += (url.includes('?') ? '&' : '?') + query.map(item => `${encodeURIComponent(item.name)}=${parameter(item.name)}`).join('&');
  const headers = [...body.headers];
  // Authentication-negative drafts must not accidentally receive credentials.
  // Required headers on these drafts remain an explicit review step.
  if (finding.case_kind !== 'authentication') for (const item of finding.parameters || []) {
    if (item.in !== 'header' || !item.required || typeof item.name !== 'string'
      || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(item.name)
      || /^(host|content-length|transfer-encoding|connection)$/i.test(item.name)
      || headers.some(header => header.key.toLowerCase() === item.name.toLowerCase())) continue;
    headers.push({ key: item.name, value: parameter(item.name) });
  }
  return { method: finding.method, url, ...body, headers,
    validations: Number.isInteger(finding.expected_status) ? [{ kind: 'status', expected: String(finding.expected_status) }] : [], captures: [] };
}
function casePayload(run, finding, user, key) {
  const title = text(finding.title || finding.name, 500);
  if (!title) throw error('The selected test contract has no title.');
  const observations = [finding.description, ...(finding.assumptions || []), ...(finding.review_reasons || []),
    run.agent_type === 'api_tests' ? 'Set @r.base_url, supply typed test data, review authentication and confirm assertions before execution. Omitted expectations were not established by source evidence.' : null,
    finding.case_kind === 'authentication' ? 'Request headers are omitted from this missing-authentication draft except the declared body content type. Review noncredential header requirements while keeping authentication absent.' : null,
    finding.content_type ? `Declared request content type: ${finding.content_type}.` : null,
    hasRequestBody(finding) && apiBodyDraft(finding)?.body === '@t.request_body' ? 'Set @t.request_body to the complete reviewed wire payload in the declared format, including URL encoding for form data and native number/boolean types for JSON. Preserve any deliberately omitted field in a negative scenario. The JSON schema preview is not the serialized request body.' : null,
    hasRequestBody(finding) && !apiBodyDraft(finding) ? 'This request body format requires manual setup. The request remains a manual draft step; configure its declared media type, file data and boundaries before execution.' : null,
    finding.body_schema ? `Request schema: ${JSON.stringify(finding.body_schema, null, 2)}` : null,
    'Generated from static repository evidence. Review before execution.', sourceNotes(finding)].filter(Boolean).map(value => text(value, 10000)).join('\n\n');
  const steps = (Array.isArray(finding.steps) && finding.steps.length ? finding.steps : [{ action: finding.description || title, expected_result: 'Review the component contract and confirm the expected behavior in the application.' }]).slice(0, 100).map((step, index) => ({
    action: `<p>${escapeHtml(text(step.action, 10000))}</p>`,
    expected_result: `<p>${escapeHtml(text(step.expected_result, 10000))}</p>`,
    step_type: 'web', sort_order: index + 1
  }));
  if (run.agent_type === 'api_tests') {
    const request = apiDraftRequest(finding);
    const requestIndex = Math.max(0, (finding.steps || []).findIndex(step => /^send\b/i.test(step.action || '')));
    if (request && steps[requestIndex]) Object.assign(steps[requestIndex], { step_type: 'api', api_request: request });
  }
  // Preserve actionable request structure, but keep the case in draft until
  // its environment, typed data and runtime expectations have been reviewed.
  return {
    app_type_id: run.app_type_id, title, description: `<p>${escapeHtml(observations).replace(/\n/g, '<br>')}</p>`,
    status: 'draft', automated: 'no', automation_status: 'not_automated', authoring_mode: 'structured',
    test_case_type: run.agent_type === 'api_tests' ? 'integration' : 'functional',
    steps, labels: ['repository-agent', run.agent_type], source_idempotency_key: key,
    ai_generation_source: 'repository', ai_generation_review_status: 'pending',
    reviewer_id: user.id, review_status: 'pending', created_by: user.id, updated_by: user.id, author_id: user.id
  };
}
async function publishRun(id, input, user) {
  const publicRun = await agents.getRun(id, user, 'agentic_workflow.run');
  const permission = PUBLISH_PERMISSIONS[publicRun.agent_type];
  if (!await permissionService.hasPermission(user, permission, publicRun.project_id)) throw error(`Permission required to publish: ${permission}`, 403);
  if (publicRun.agent_type !== 'repository_knowledge' && !publicRun.app_type_id) throw error('Run this agent in an application scope before publishing its results.');
  if (['api_tests', 'component_tests'].includes(publicRun.agent_type)
    && await mobileFeatureService.appTypeUsesMobile(publicRun.app_type_id)
    && !await permissionService.hasPermission(user, 'mobile.manage', publicRun.project_id)) {
    throw error('Permission required to publish test cases in a mobile application: mobile.manage', 403);
  }
  if (!Array.isArray(input.item_ids) || !input.item_ids.length || input.item_ids.length > LIMITS.max_selected_items || input.item_ids.some(id => typeof id !== 'string' || !id)) throw error('Select between 1 and 50 findings to publish.');
  if (new Set(input.item_ids).size !== input.item_ids.length) throw error('Each selected finding must appear only once.');
  if (input.module_id && !['api_tests', 'component_tests'].includes(publicRun.agent_type)) throw error('Modules can only receive test case drafts.');
  if (input.module_id) {
    if (!await permissionService.hasPermission(user, 'testcase.update', publicRun.project_id)) throw error('Test Case update permission is required to assign a module.', 403);
    const module = await require('../services/testCaseModule.service').getModule(input.module_id);
    if (module.app_type_id !== publicRun.app_type_id) throw error('The module must belong to this analysis application.', 403);
  }
  return db.transaction(async () => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext(?))', [`repository-agent-publish:${publicRun.project_id}:${publicRun.app_type_id || ''}`]);
    const run = await db.prepare('SELECT * FROM repository_agent_runs WHERE id = ? FOR UPDATE').get(id);
    if (!run || !['completed','partial'].includes(run.status) || !run.result) throw error('Complete repository analysis before publishing findings.', 409);
    const findings = run.result.findings[FINDING_KEYS[run.agent_type]];
    const selected = input.item_ids.map(id => findings.find(item => item.id === id));
    if (selected.some(item => !item)) throw error('One of the selected findings is not part of this run. Refresh the results.', 409);
    const saved = [...(run.published?.items || [])], items = [], skippedItems = [], caseIds = [];
    for (const finding of selected) {
      const prior = saved.find(item => item.finding_id === finding.id);
      if (prior) { items.push(prior); continue; }
      const digest = createHash('sha256').update(JSON.stringify([run.project_id, run.app_type_id, run.agent_type, finding])).digest('hex');
      const key = `repository-agent:${digest}`;
      let target;
      if (run.agent_type === 'object_repository') {
        const screen = text(finding.screen_name || finding.page_key, 500), name = text(finding.object_name || finding.locator_intent, 500), locator = text(finding.locator, 4000);
        if (!screen || !name || !locator) { skippedItems.push({ finding_id: finding.id, reason: 'This finding does not contain a complete screen or field definition.' }); continue; }
        const existing = await db.prepare("SELECT id, locator FROM automation_learning_cache WHERE app_type_id = ? AND (page_key = ? OR metadata->>'screen_name' = ?) AND (locator = ? OR LOWER(locator_intent) = LOWER(?)) LIMIT 1").get(run.app_type_id, screen, screen, locator, name);
        if (existing) {
          skippedItems.push({ finding_id: finding.id, reason: existing.locator === locator ? 'This locator already exists in the screen.' : 'An object with this name already exists. Review it in Object Repository.' });
          continue;
        }
        const entry = await require('../services/aiAutomationBuilder.service').createLearningCacheEntry({
          project_id: run.project_id, app_type_id: run.app_type_id, screen_name: screen, page_key: screen,
          object_name: name, locator_intent: name, locator, locator_kind: text(finding.locator_kind, 80) || 'css',
          object_role: text(finding.object_role, 80) || 'field', page_url: null,
          confidence: Math.max(0, Math.min(1, Number(finding.confidence) || 0)), source: 'repository_agent',
          metadata: { ...(finding.metadata || {}), repository_agent_key: key, agent_run_id: run.id, evidence: finding.evidence, runtime_verified: false, review_required: true }
        });
        target = { target_type: 'object_repository', target_id: entry.id, url: `/object-repository?app_type_id=${encodeURIComponent(run.app_type_id)}${finding.object_role === 'screen' ? '' : `&repository=${encodeURIComponent(entry.id)}`}` };
      } else if (run.agent_type === 'repository_knowledge') {
        const previous = await db.prepare("SELECT id FROM ai_knowledge_repo WHERE project_id = ? AND app_type_id IS NOT DISTINCT FROM ? AND metadata->>'repository_agent_key' = ? LIMIT 1").get(run.project_id, run.app_type_id, key);
        const entry = previous || await require('../services/aiKnowledge.service').createKnowledge(run.project_id, {
          app_type_id: run.app_type_id, title: text(finding.title, 500), content: text(finding.content, 200000), content_type: 'text',
          source: 'Repository agent', source_uri: `repository-agent://${run.id}/${finding.id}`, asset_type: 'document',
          metadata: { ...(finding.metadata && typeof finding.metadata === 'object' && !Array.isArray(finding.metadata) ? finding.metadata : {}), repository_agent_key: key, agent_run_id: run.id, repository: run.source.repository_url || run.source.name, revision: run.source.commit_sha || null, evidence: finding.evidence, static_analysis: true, runtime_verified: false, review_required: true },
          is_active: true
        }, user.id);
        target = { target_type: 'knowledge', target_id: entry.id, url: `/knowledge-repo?item=${encodeURIComponent(entry.id)}` };
      } else {
        const entry = await require('../services/testCase.service').createTestCase(casePayload(run, finding, user, key));
        caseIds.push(entry.id);
        target = { target_type: 'test_case', target_id: entry.id, url: `/test-cases?case=${encodeURIComponent(entry.id)}` };
      }
      const published = { finding_id: finding.id, ...target, published_by: user.id, published_at: new Date().toISOString() };
      items.push(published); saved.push(published);
    }
    if (input.module_id && caseIds.length) await require('../services/testCaseModule.service').assignCases(input.module_id, caseIds, { append: true });
    await db.prepare('UPDATE repository_agent_runs SET published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run({ items: saved }, run.id);
    return { items, skipped: skippedItems.length, skipped_items: skippedItems, ...(run.agent_type === 'repository_knowledge' ? { indexing: 'queued', message: 'Published documents are queued for Knowledge Repo indexing.' } : {}) };
  })();
}
module.exports = { publishRun, casePayload, apiDraftRequest };
