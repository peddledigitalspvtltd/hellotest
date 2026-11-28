const evidenceAccess = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const { safeMessage } = require('./runtimeEvents');

const sourceKinds = { objects: 'object_repository', api: 'api_tests' };
const array = value => Array.isArray(value) ? value : [];
const brief = (value, max = 180) => typeof value === 'string' && value.trim() ? safeMessage(value).slice(0, max) : undefined;
const apiPath = path => typeof path === 'string' && /^\/(?!\/)[a-z0-9_./:{}-]{0,299}$/i.test(path) ? path : undefined;
const boundLocator = value => typeof value === 'string' && value.length <= 280 && !/[\x00-\x1f\x7f]/.test(value)
  && !/(?:\bvalue|token|password|secret|authorization|credential)\s*[:=]/i.test(value) && safeMessage(value) === value ? value : undefined;
const apiMethods = new Set(['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']);
const parameters = item => array(item.parameters).filter(row => /^[a-z][\w.-]{0,70}$/i.test(row?.name || '')
  && ['path', 'query', 'header', 'cookie'].includes(row.in) && row.required === true)
  .slice(0, 8).map(row => ({ name: row.name, location: row.in }));
const mediaType = value => typeof value === 'string' && /^[\w!#$&^.+-]{1,60}\/[\w!#$&^.+-]{1,60}$/i.test(value) ? value : undefined;
const reference = item => array(item.evidence).find(row => typeof row?.path === 'string' && Number.isInteger(row.line));
const sourceReference = item => {
  const source = reference(item);
  return source ? { path: brief(source.path, 220), line: source.line } : undefined;
};

function sourceFindingSummary(kind, findings) {
  const field = kind === 'object_repository' ? 'objects' : 'test_cases';
  const items = array(findings?.[field]);
  const secured = new Set(items.filter(item => item?.case_kind === 'authentication').map(item => item.contract_id).filter(Boolean));
  const records = [];
  // Complete artifacts are stored by the source worker. Workflow results carry
  // bounded references instead of duplicating archives, schemas or payloads.
  for (const item of items) {
    if (records.length >= 40) break;
    if (!item) continue;
    const evidence = sourceReference(item);
    if (!evidence) continue;
    const record = kind === 'object_repository'
      ? { id: brief(item.id, 100), screen: brief(item.screen_name || item.page_key), name: brief(item.object_name || item.locator_intent),
          locator: boundLocator(item.locator), locator_kind: brief(item.locator_kind, 40), evidence }
      : { id: brief(item.id, 100), title: brief(item.title || item.name), method: apiMethods.has(item.method) ? item.method : undefined, path: apiPath(item.path),
          case_kind: brief(item.case_kind, 40), request_media_type: mediaType(item.content_type), required_parameters: parameters(item),
          expected_status: Number.isInteger(item.expected_status) && item.expected_status >= 100 && item.expected_status <= 599 ? item.expected_status : undefined,
          requires_authentication: secured.has(item.contract_id) ? true : undefined, evidence };
    if (kind === 'object_repository' ? record.name : record.method && record.path) records.push(record);
  }
  return { [field]: records, total_findings: items.length, omitted_findings: items.length - records.length };
}

function predecessorIds(run, nodeId) {
  const ids = new Set(), pending = [nodeId], edges = array(run.workflow_snapshot?.edges);
  while (pending.length) {
    const target = pending.pop();
    for (const edge of edges) if (edge.target === target && edge.targetHandle !== 'continue' && !ids.has(edge.source)) {
      ids.add(edge.source);
      pending.push(edge.source);
    }
  }
  return ids;
}

const meaningfulTokens = text => (text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(word => !['the','and','with','from','test','case','when','then','should','http','https'].includes(word));

function relevant(rows, story) {
  const text = [story.title, story.description, story.specification_content, ...array(story.acceptance_criteria)].slice(0, 12).join(' ').slice(0, 12000);
  const visiblePaths = new Set();
  const relativeText = text.replace(/https?:\/\/[^\s'"<>\])]+/gi, value => {
    try { visiblePaths.add(new URL(value.replace(/[.,;!]+$/, '')).pathname); } catch { /* Text is not a URL. */ }
    return ' ';
  });
  for (const path of relativeText.match(/\/(?!\/)[a-z0-9_./:{}-]+/gi) || []) visiblePaths.add(path.replace(/[.]+$/, ''));
  const explicitApi = rows.filter(item => visiblePaths.has(item.path));
  const words = new Set(meaningfulTokens(text));
  return (explicitApi.length ? explicitApi : rows).map(item => ({ item,
    score: new Set(meaningfulTokens(JSON.stringify(item)).filter(word => words.has(word))).size }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map(({ item }) => item);
}

async function loadSourceEvidence({ run, node, user, story }) {
  const settings = run.workflow_snapshot?.settings;
  const configured = settings?.source_evidence_nodes;
  if (settings?.template_id !== 'spec-to-script' || !configured || typeof configured !== 'object') return undefined;
  const ancestors = predecessorIds(run, node.id);
  const byId = id => typeof id === 'string' && ancestors.has(id) && array(run.node_results).find(result => result.node_id === id && result.status === 'completed')?.output;
  const allowed = await evidenceAccess.getOptionalEvidenceAccess(user, run.project_id, ['testcase.view', 'automation.view', 'automation.code.view']);
  const sources = {};
  for (const [key, kind] of Object.entries(sourceKinds)) {
    if (!allowed['automation.view'] || key === 'api' && (!allowed['testcase.view'] || !allowed['automation.code.view'])) continue;
    const output = byId(configured[key]);
    const definition = array(run.workflow_snapshot?.nodes).find(item => item.id === configured[key]);
    if (definition?.data?.kind !== 'repositoryAgent' || definition.data.repositoryAgentType !== kind
        || output?.repository_agent_type !== kind || !['completed','partial'].includes(output.status) || !output.repository_run_id) continue;
    const summary = output.source_evidence;
    const candidates = relevant(array(summary?.[key === 'objects' ? 'objects' : 'test_cases']), story);
    if (candidates.length) sources[key] = {
      attachment: { kind: 'repository_agent_result', id: output.repository_run_id },
      provenance: 'static_repository_evidence_for_review', candidates
    };
  }
  const curator = allowed['automation.view'] && byId(configured.curator);
  const curatorDefinition = array(run.workflow_snapshot?.nodes).find(item => item.id === configured.curator);
  if (sources.objects && curatorDefinition?.data?.kind === 'agent' && curatorDefinition.data.agentId === 'repository-curator'
      && curator?.specialist_id === 'repository-curator' && curator.session_id) {
    sources.objects.curation = { attachment: { kind: 'agent_review', id: curator.session_id },
      provenance: 'model_generated_analysis_for_review', summary: brief(curator.response, 350) };
  }
  return Object.keys(sources).length ? sources : undefined;
}

module.exports = { sourceFindingSummary, loadSourceEvidence };
