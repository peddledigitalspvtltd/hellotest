// Persistent, owner-private task memory layered over canonical Knowledge sources.
// This ledger stores observed selections/events, never prompts, source bodies,
// provider reasoning, credentials or inferred approvals/causality.
const { randomUUID, createHash } = require('node:crypto');
const db = require('@hellotest/platform/backend/src/db');
const projectAccess = require('@hellotest/platform/backend/public/projectAccess');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const authorization = require('./knowledgeAuthorization.service');
const management = require('./knowledgeGraphManagement.service');
const execution = require('./knowledgeExecution.service');
const { KINDS, PERMISSIONS } = require('./knowledgeGraphContracts');
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { aggregateContextHealth, refKey: contextEvidenceKey } = require('./knowledgeContextHealth');

const VERSION = 'context-trace/2';
const EVENT_TYPES = Object.freeze(['REQUESTED', 'CONTEXT_SELECTED', 'CONTEXT_SENT', 'CITATIONS_RECORDED', 'POLICY_CHECKED', 'PROPOSAL_PREPARED', 'REVIEW_RECORDED', 'OPERATION_SUBMITTED', 'OUTCOME_RECORDED']);
const EVENT_LABELS = Object.freeze({ REQUESTED: 'Task requested', CONTEXT_SELECTED: 'Context selected', CONTEXT_SENT: 'Evidence sent to model', CITATIONS_RECORDED: 'Citations recorded', POLICY_CHECKED: 'Policy checked', PROPOSAL_PREPARED: 'Proposal prepared', REVIEW_RECORDED: 'Review recorded', OPERATION_SUBMITTED: 'Operation submitted', OUTCOME_RECORDED: 'Operation outcome recorded' });
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
// Structural IDs are opaque stable UUIDs, so transport redaction cannot mistake
// numeric segments in compound trace/event identifiers for personal data.
function graphId(...parts) {
  const chars=hash(parts).slice(0,32).split('');chars[12]='4';chars[16]=(parseInt(chars[16],16)&3|8).toString(16);
  const hex=chars.join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const fail = (message, statusCode = 400, code = 'CONTEXT_GRAPH_INVALID') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const iso = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
function identifier(value, optional = false, max = 255) {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw fail('Use a bounded visible identifier.');
  return value.trim();
}
function timestamp(value, optional = true) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || value.length > 80 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !iso(value)) throw fail('Use an ISO date and time with a time zone.');
  return iso(value);
}
const digestField = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
const featureConfigKey = (prefix, featureId) => `${prefix}_${String(featureId||'general').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').toUpperCase()}`;
const retentionDaysForFeature = (featureId, env = process.env) => {
  const feature = String(featureId || '').toLowerCase();
  const defaults = feature.includes('assistant') || feature.startsWith('mcp.') ? 30 : feature.startsWith('agent.') ? 90 : 60;
  const configured = Number(env[featureConfigKey('HELLOTEST_CONTEXT_TRACE_RETENTION_DAYS',featureId)] ?? env.HELLOTEST_CONTEXT_TRACE_RETENTION_DAYS);
  return Number.isInteger(configured) && configured >= 7 && configured <= 365 ? configured : defaults;
};
const traceSampleRateForFeature = (featureId, env = process.env) => {
  const feature=String(featureId||'').toLowerCase(),chat=feature.includes('assistant')||feature.includes('chat')||feature.startsWith('mcp.');
  const fallback=chat?1:feature.startsWith('agent.')?0.2:0.1;
  const configured=Number(env[featureConfigKey('HELLOTEST_CONTEXT_TRACE_SAMPLE_RATE',featureId)] ?? env.HELLOTEST_CONTEXT_TRACE_SAMPLE_RATE);
  return Number.isFinite(configured)&&configured>=0&&configured<=1?configured:fallback;
};
const sampleFeatureTrace = (featureId, packetId, env = process.env) => {
  const rate=traceSampleRateForFeature(featureId,env);
  if(rate>=1)return true;if(rate<=0)return false;
  const bucket=parseInt(hash([featureId,packetId]).slice(0,8),16)/0xffffffff;
  return bucket<rate;
};
const retentionPolicyForFeature = featureId => {
  const feature = String(featureId || '').toLowerCase();
  return feature.includes('assistant') ? 'assistant' : feature.startsWith('mcp.') ? 'mcp' : feature.startsWith('agent.') ? 'agent' : 'general';
};
function filterDigest(filters) {
  let visited = 0;
  const canonical = (value, depth = 0) => {
    if (++visited > 4096 || depth > 8) throw fail('The applied context filters exceed their metadata budget.', 422, 'CONTEXT_GRAPH_BUDGET');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.length <= 8192) return value;
    if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
    if (object(value)) return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key], depth + 1)]));
    throw fail('Use JSON values in the applied context filters.');
  };
  const serialized = JSON.stringify(canonical(object(filters) ? filters : {}));
  if (Buffer.byteLength(serialized) > 65536) throw fail('The applied context filters exceed their metadata budget.', 422, 'CONTEXT_GRAPH_BUDGET');
  return hash(serialized);
}
const LIVE_SCOPES = Object.freeze({ 'project-overview': { label:'Live project snapshot', permissions:[],conservative:[] }, stories:{label:'Live Stories snapshot',permissions:['requirement.view'],conservative:['requirement.view','testcase.view','comment.view','attachment.view']},
  'test-cases':{label:'Live Test Cases snapshot',permissions:['testcase.view'],conservative:['testcase.view','requirement.view','suite.view','shared_step.view']},runs:{label:'Live Runs snapshot',permissions:['run.view'],conservative:['run.view','result.view']},
  bugs:{label:'Live Defects snapshot',permissions:['feedback.view']},'object-repository':{label:'Live object repository snapshot',permissions:['automation.view']},
  'execution-context':{label:'Live execution configuration snapshot',permissions:[],conservative:['environment.view','configuration.view']},
  'run-failures':{label:'Live failure snapshot',permissions:['run.view','result.view','testcase.view'],conservative:['run.view','result.view','testcase.view','comment.view','attachment.view']} });
const liveDefinition = scope => LIVE_SCOPES[scope] || (/^run-failure-(?:[1-9]|1[0-9]|20)$/.test(scope) ? LIVE_SCOPES['run-failures'] : null);
function selectionMetadata(packet) {
  const request = object(packet.interpreted_request) ? packet.interpreted_request : {}, retrieval = object(packet.retrieval) ? packet.retrieval : {};
  const select = (value, max) => typeof value === 'string' && value.length <= max && /^[\w .:+/-]+$/.test(value) ? value : null;
  const strategy = retrieval.retrieval_strategy;
  const safeStrategy = object(strategy) && ['hybrid_evidence','graph_expand'].includes(strategy.requested)
    && ['hybrid_evidence','graph_expand'].includes(strategy.applied)
    && ['not_requested','skipped','completed','failed'].includes(strategy.graph_expansion_status) ? {
      requested: strategy.requested, applied: strategy.applied, graph_expansion_status: strategy.graph_expansion_status,
      graph_expansion_reason: select(strategy.graph_expansion_reason, 100),
      ...Object.fromEntries([['graph_tool_calls',1],['graph_evidence_count',30],['graph_relationship_count',100]].map(([key,max])=>
        [key,Number.isSafeInteger(strategy[key])&&strategy[key]>=0&&strategy[key]<=max?strategy[key]:null]))
    } : null;
  return {stage:'retrieval_result',model_input_verified:false,query_category: select(request.query_category, 80), input_type: select(request.input_type, 80), agent_id: select(request.agent_id, 160),
    effective_scopes: Array.isArray(request.effective_scopes) ? [...new Set(request.effective_scopes.filter(scope => ['stories','test-cases','runs','bugs','automation','knowledge'].includes(scope)))] : [],
    chain_strategy: select(retrieval.chain_strategy, 160), termination_reason: select(retrieval.termination_reason, 100),
    ...(safeStrategy ? {retrieval_strategy:safeStrategy} : {}),
    authorization: { project_scope_enforced: packet.authorization?.project_scope_enforced === true, source_acl_enforced: packet.authorization?.source_acl_enforced === true } };
}
function evidenceReferences(packet, projectId) {
  const evidence = packet.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.length > 30) throw fail('Context memory accepts at most 30 selected evidence references.');
  const relationships = Array.isArray(packet.relationships) ? packet.relationships : [];
  const refs = [], ids = new Set();let relationshipsRetained=0;
  for (const raw of evidence) {
    if (!object(raw)) throw fail('Use typed context evidence references.');
    const citation = object(raw.citation) ? raw.citation : {}, freshness = object(raw.freshness) ? raw.freshness : {}, integrity = object(raw.integrity) ? raw.integrity : {};
    const ref = {
      evidence_id: identifier(raw.evidence_id || citation.id || raw.id),
      source_id: identifier(raw.source_id || citation.source_id, false, 500),
      source_kind: identifier(raw.source_kind || citation.source_kind || 'unknown', false, 80),
      source_ref_id: identifier(raw.source_ref_id || citation.source_ref_id, true, 500),
      document_id: identifier(raw.document_id || citation.document_id, true),
      chunk_id: identifier(raw.chunk_id || raw.fragment_id || citation.chunk_id || citation.fragment_id, true),
      source_version: identifier(freshness.source_version || raw.source_version || citation.source_version ? String(freshness.source_version || raw.source_version || citation.source_version) : null, true, 100),
      version_hash: digestField(integrity.version_hash || citation.version_hash),
      source_hash: digestField(integrity.source_hash || citation.source_hash),
      chunk_hash: digestField(integrity.chunk_hash || citation.chunk_hash),
      effective_from: iso(freshness.effective_from || raw.effective_from || citation.effective_from),
      effective_to: iso(freshness.effective_to || raw.effective_to || citation.effective_to),
      observed_freshness: ['CURRENT', 'STALE', 'HISTORICAL', 'UNKNOWN'].includes(freshness.status) ? freshness.status : 'UNKNOWN'
    };
    const linkedRelationships=relationships.filter(edge=>Array.isArray(edge.evidence_ids)&&edge.evidence_ids.includes(ref.evidence_id)
      &&typeof edge.knowledge_edge_id==='string'&&typeof edge.source==='string'&&typeof edge.target==='string');
    const available=Math.max(0,12-relationshipsRetained);
    const safeRelationships=linkedRelationships.slice(0,available).map(edge=>({knowledge_edge_id:edge.knowledge_edge_id.trim(),
      source_canonical_id:edge.source.trim(),target_canonical_id:edge.target.trim(),relationship_type:typeof edge.type==='string'?edge.type.slice(0,80):'RELATED_TO'}))
      .filter(edge=>edge.knowledge_edge_id&&edge.source_canonical_id&&edge.target_canonical_id&&edge.source_canonical_id!==edge.target_canonical_id);
    relationshipsRetained+=safeRelationships.length;
    ref.knowledge_relationships=safeRelationships;
    ref.knowledge_edge_ids=safeRelationships.map(edge=>edge.knowledge_edge_id);
    if (ref.source_kind === 'live_project') {
      const prefix = `live-project-${projectId}-`, scope = ref.source_id.startsWith(prefix) ? ref.source_id.slice(prefix.length) : '';
      const definition=liveDefinition(scope);
      if (definition && ref.source_ref_id === projectId) {
        let payload; try { payload = JSON.parse(raw.content); } catch { payload = {}; }
        const reported = Array.isArray(payload.evidence_permissions) ? payload.evidence_permissions : [];
        // Source text may only tighten access to a retained snapshot. It cannot
        // remove its fixed native permission or grant a permission to anyone.
        const supported=definition.conservative||definition.permissions;
        const declared=reported.length>0&&reported.every(value=>supported.includes(value));
        const required = [...new Set([...definition.permissions,...(declared?reported:supported)])];
        if (reported.length <= 20) ref.live_snapshot = { scope, required_permissions: required };
      }
    }
    if (ids.has(ref.evidence_id)) throw fail('Selected evidence identifiers must be unique.');
    ids.add(ref.evidence_id); refs.push(ref);
  }
  if (Buffer.byteLength(JSON.stringify(refs)) > 48 * 1024) throw fail('The context memory reference budget was exceeded.', 422, 'CONTEXT_GRAPH_BUDGET');
  return refs;
}
function summary(row) {
  const coverage = object(row.coverage) ? row.coverage : {};
  return { id: row.id, trace_id: row.id, feature_id: row.feature_id, app_type_id: row.app_type_id || null,
    context_packet_id: row.context_packet_id, task_ref: row.task_ref || null, session_id: row.session_id || null,
    recorded_at: iso(row.recorded_at), evidence_count: Number(coverage.evidence_count) || 0,
    expires_at: iso(row.expires_at), retention_policy: row.retention_policy || 'standard-90d',
    source_count: Number(coverage.source_count) || 0, status: coverage.retrieval_status || 'UNKNOWN' };
}

function createContextGraph(dependencies = {}) {
  const store = dependencies.db || db, projects = dependencies.projectAccess || projectAccess;
  const grants = dependencies.permissions || permissions, featureFlags = dependencies.flags || flags;
  const acl = dependencies.authorization || authorization, curation = dependencies.management || management;
  const active = signal => { execution.assertActive(); if (signal?.aborted) throw execution.abortError(); };
  async function authorize({ projectId, user, appTypeId, read = false, signal }) {
    active(signal); identifier(projectId);
    if (!user?.id) throw fail('Authentication is required.', 401, 'CONTEXT_GRAPH_FORBIDDEN');
    await projects.getProject(projectId, user.id); active(signal);
    if (!await store.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(user.id)) throw fail('The account is unavailable.', 403, 'CONTEXT_GRAPH_FORBIDDEN');
    if (read && (!await grants.hasPermission(user, 'knowledge.view', projectId)
      || !await featureFlags.areEnabled(featureFlags.getFeatureKeysForPermission('knowledge.view'), { user }))) throw fail('Permission required: knowledge.view', 403, 'CONTEXT_GRAPH_FORBIDDEN');
    if (appTypeId) {
      identifier(appTypeId);
      const app = await store.prepare('SELECT project_id FROM app_types WHERE id = ?').get(appTypeId);
      if (!app || app.project_id !== projectId) throw fail('Application is outside the selected project.', 403, 'CONTEXT_GRAPH_FORBIDDEN');
    }
    active(signal);
  }
  async function recordContext({ projectId, user, packet, featureId = 'mcp.context', appTypeId, taskRef, sessionId, traceId, signal } = {}) {
    if (!object(packet)) throw fail('A selected ContextPacket is required.');
    if (packet.project_id && packet.project_id !== projectId) throw fail('The context packet is outside this project.', 403, 'CONTEXT_GRAPH_FORBIDDEN');
    const packetId = identifier(packet.context_packet_id || packet.packet_id), feature = identifier(featureId, false, 160);
    if (!/^[A-Za-z0-9._:-]+$/.test(feature)) throw fail('Use the trusted AI feature identifier.');
    const refs = evidenceReferences(packet, projectId), app = appTypeId || packet.applied_filters?.app_type_id || null;
    await authorize({ projectId, user, appTypeId: app, signal });
    const sampleRate=traceSampleRateForFeature(feature);
    if(!sampleFeatureTrace(feature,packetId))return{trace_id:null,recorded_at:null,status:'sampled_out',sample_rate:sampleRate};
    const limitations = object(packet.limitations) ? packet.limitations : {};
    const coverage = { evidence_count: refs.length, source_count: new Set(refs.map(ref => ref.source_id)).size,
      retrieval_status: ['COMPLETE', 'PARTIAL', 'FAILED'].includes(limitations.retrieval_status) ? limitations.retrieval_status : 'UNKNOWN',
      budget_partial: limitations.budget_partial === true, authorization_partial: limitations.authorization_partial === true,
      unavailable_sources: Math.max(0, Math.min(1000000, Number(limitations.unavailable_sources) || 0)) };
    const query = packet.query?.original || packet.query?.text;
    const task = identifier(taskRef, true), session = identifier(sessionId, true), trace = identifier(traceId, true);
    const queryHash = typeof query === 'string' ? hash(query) : null;
    const selection = { ...selectionMetadata(packet), applied_filters_hash: filterDigest(packet.applied_filters) };
    const selectionHash = hash([app, feature, packetId, task, session, trace, queryHash, refs, coverage, selection]);
    const retentionDays = retentionDaysForFeature(feature);
    const retentionPolicy = `${retentionPolicyForFeature(feature)}-${retentionDays}d-sample-${sampleRate}`;
    const row = await store.transaction(async () => {
      const inserted = await store.prepare(`INSERT INTO ai_context_graph_traces
        (id,project_id,actor_id,app_type_id,feature_id,context_packet_id,task_ref,session_id,trace_ref,query_hash,evidence_refs,coverage,selection_hash,selection,expires_at,retention_policy)
        VALUES(?,?,?,?,?,?,?,?,?,NULL,'[]'::jsonb,'{}'::jsonb,?,'{}'::jsonb,CURRENT_TIMESTAMP+(?::INTEGER*INTERVAL '1 day'),?)
        ON CONFLICT(project_id,actor_id,context_packet_id,feature_id) DO NOTHING RETURNING id,recorded_at,selection_hash`)
        .get(randomUUID(), projectId, user.id, app, feature, packetId, task, session, trace, selectionHash, retentionDays, retentionPolicy);
      if (inserted) {
        const payload=await store.prepare(`INSERT INTO ai_context_graph_trace_payloads
          (trace_id,recorded_at,query_hash,evidence_refs,coverage,selection)
          SELECT traces.id,traces.recorded_at,?,?,?,? FROM ai_context_graph_traces traces WHERE traces.id=?
          ON CONFLICT(trace_id,recorded_at) DO NOTHING RETURNING trace_id`)
          .get(queryHash, refs, coverage, selection, inserted.id);
        if(!payload)throw fail('The context evidence payload could not be stored.',503,'CONTEXT_GRAPH_UNAVAILABLE');
      }
      return inserted;
    })();
    // Best-effort capture can outlive a canceled caller receipt after INSERT.
    // A committed row records observed retrieval, not a transactional promise
    // that the caller received it or that a provider consumed its evidence.
    active(signal);
    const saved = row || await store.prepare('SELECT id,recorded_at,selection_hash FROM ai_context_graph_traces WHERE project_id = ? AND actor_id = ? AND context_packet_id = ? AND feature_id = ? AND expires_at > CURRENT_TIMESTAMP')
      .get(projectId, user.id, packetId, feature);
    if (!saved) throw fail('The context memory receipt is unavailable.', 503, 'CONTEXT_GRAPH_UNAVAILABLE');
    if (saved.selection_hash !== selectionHash) throw fail('The context packet identity already has a different selection.', 409, 'CONTEXT_GRAPH_SELECTION_CONFLICT');
    return { trace_id: saved.id, recorded_at: iso(saved.recorded_at), status: 'recorded' };
  }
  async function recordDecision({ projectId, user, contextTraceId, event, signal } = {}) {
    if (!object(event) || !EVENT_TYPES.includes(event.type)) throw fail('Use a supported observed event type.');
    const trace = identifier(contextTraceId), eventId = identifier(event.id || randomUUID()), status = identifier(event.status, false, 80);
    const occurredAt = event.occurred_at == null ? null : timestamp(event.occurred_at, false);
    if (event.rationale != null && (typeof event.rationale !== 'string' || event.rationale.length > 600)) throw fail('Use a concise recorded rationale of at most 600 characters.');
    const rationale = event.rationale ? sanitizeAiText(event.rationale).text : null;
    const reference = identifier(event.reference_id, true);
    const rawMetadata = object(event.metadata) ? event.metadata : {};
    const evidenceIds = [...new Set((Array.isArray(rawMetadata.evidence_ids) ? rawMetadata.evidence_ids : [])
      .slice(0, 30).map(value => identifier(value)))];
    const relationships = (Array.isArray(rawMetadata.relationships) ? rawMetadata.relationships : []).slice(0, 100).flatMap(item => {
      if (!object(item)) return [];
      const edgeId = identifier(item.knowledge_edge_id);
      const edgeEvidence = [...new Set((Array.isArray(item.evidence_ids) ? item.evidence_ids : [])
        .slice(0, 30).map(value => identifier(value)))];
      return edgeEvidence.length && edgeEvidence.every(id => evidenceIds.includes(id))
        ? [{ knowledge_edge_id: edgeId, evidence_ids: edgeEvidence }] : [];
    });
    const safeMetadata = { ...(evidenceIds.length ? { evidence_ids: evidenceIds } : {}), ...(relationships.length ? { relationships } : {}) };
    if (Buffer.byteLength(JSON.stringify(safeMetadata)) > 12 * 1024) throw fail('The context event exceeds its reference budget.', 422, 'CONTEXT_GRAPH_BUDGET');
    const payloadHash = hash([event.type, status, rationale, reference, occurredAt, safeMetadata]);
    await authorize({ projectId, user, signal });
    return store.transaction(async () => {
      const owned = await store.prepare('SELECT id FROM ai_context_graph_traces WHERE id = ? AND project_id = ? AND actor_id = ? FOR UPDATE').get(trace, projectId, user.id);
      if (!owned) throw fail('Context trace is unavailable.', 404, 'CONTEXT_GRAPH_NOT_FOUND');
      await authorize({ projectId, user, signal });
      const saved = await store.prepare(`INSERT INTO ai_context_graph_events
        (id,trace_id,project_id,actor_id,event_type,status,rationale,reference_id,metadata,occurred_at,payload_hash)
        VALUES(?,?,?,?,?,?,?,?,?,COALESCE(?::timestamptz,CURRENT_TIMESTAMP),?) ON CONFLICT(trace_id,id) DO NOTHING RETURNING id,recorded_at,payload_hash`)
        .get(eventId, trace, projectId, user.id, event.type, status, rationale, reference, safeMetadata, occurredAt, payloadHash);
      const receipt = saved || await store.prepare('SELECT id,recorded_at,payload_hash FROM ai_context_graph_events WHERE trace_id = ? AND id = ? AND project_id = ? AND actor_id = ?')
        .get(trace, eventId, projectId, user.id);
      if (!receipt || receipt.payload_hash !== payloadHash) throw fail('The recorded event identity already has different data.', 409, 'CONTEXT_GRAPH_EVENT_CONFLICT');
      active(signal);
      return { trace_id: trace, event_id: receipt.id, recorded_at: iso(receipt.recorded_at), status: 'recorded' };
    })();
  }
  async function list({ projectId, user, appTypeId, featureId, from, to, limit = 20, cursor, signal } = {}) {
    await authorize({ projectId, user, appTypeId, read: true, signal });
    if (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 20) throw fail('Choose from one to twenty context traces.');
    limit = Number(limit); const start = timestamp(from), end = timestamp(to), feature = identifier(featureId, true, 160);
    if (start && end && start > end) throw fail('The start time must precede the end time.');
    const scopeHash = hash([projectId, user.id, appTypeId || null, feature, start, end]);
    const args = [projectId, user.id], conditions = ['traces.project_id = ?', 'traces.actor_id = ?'];
    if (appTypeId) { conditions.push('(traces.app_type_id = ? OR traces.app_type_id IS NULL)'); args.push(appTypeId); }
    if (feature) { conditions.push('traces.feature_id = ?'); args.push(feature); }
    if (start) { conditions.push('traces.recorded_at >= ?::timestamptz'); args.push(start); }
    if (end) { conditions.push('traces.recorded_at <= ?::timestamptz'); args.push(end); }
    if (cursor) {
      let parsed;
      try { if (typeof cursor !== 'string' || cursor.length > 2048) throw Error(); parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw fail('The context graph cursor is invalid.'); }
      if (!object(parsed) || parsed.scope !== scopeHash || !iso(parsed.at)) throw fail('The context graph cursor does not match these filters.');
      conditions.push('(traces.recorded_at,traces.id) < (?::timestamptz,?)'); args.push(parsed.at, identifier(parsed.id));
    }
    conditions.push('traces.expires_at > CURRENT_TIMESTAMP');
    const rows = await store.prepare(`SELECT traces.id,traces.app_type_id,traces.feature_id,traces.context_packet_id,traces.task_ref,traces.session_id,traces.recorded_at,
      traces.recorded_at::text AS cursor_recorded_at,payload.coverage,traces.expires_at,traces.retention_policy FROM ai_context_graph_traces traces
      JOIN ai_context_graph_trace_payloads payload ON payload.trace_id=traces.id AND payload.recorded_at=traces.recorded_at
      WHERE ${conditions.join(' AND ')} ORDER BY traces.recorded_at DESC,traces.id DESC LIMIT ?`)
      .all(...args, limit + 1);
    await authorize({ projectId, user, appTypeId, read: true, signal });
    active(signal);
    const selected = rows.slice(0, limit), last = selected.at(-1);
    return { schema_version: VERSION, project_id: projectId, items: selected.map(summary), next_cursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ scope: scopeHash, at: last.cursor_recorded_at || iso(last.recorded_at), id: last.id })).toString('base64url') : null,
      privacy: 'Only the signed-in user’s recorded task context is returned. Source details require fresh authorization.',
      retention:'Reference metadata follows feature-specific expiry and is removed by the retention worker. Source bodies, questions and prompts are not retained in this ledger.' };
  }
  async function health({ projectId,user,appTypeId,days=30,signal }={}) {
    await authorize({projectId,user,appTypeId,read:true,signal});
    if(!Number.isSafeInteger(Number(days))||Number(days)<7||Number(days)>90)throw fail('Choose a context health window from 7 to 90 days.');
    days=Number(days);const scanLimit=5000;
    const rows=await store.prepare(`SELECT traces.id,traces.actor_id,traces.app_type_id,traces.recorded_at,payload.evidence_refs,payload.coverage,payload.selection
      FROM ai_context_graph_traces traces JOIN ai_context_graph_trace_payloads payload
        ON payload.trace_id=traces.id AND payload.recorded_at=traces.recorded_at
      WHERE traces.project_id=? AND traces.expires_at>CURRENT_TIMESTAMP
        AND traces.recorded_at>=CURRENT_TIMESTAMP-(?::INTEGER*INTERVAL '1 day')
        ${appTypeId?'AND (traces.app_type_id=? OR traces.app_type_id IS NULL)':''}
      ORDER BY traces.recorded_at DESC,traces.id DESC LIMIT ?`).all(projectId,days,...(appTypeId?[appTypeId]:[]),scanLimit+1);
    const truncated=rows.length>scanLimit,selected=rows.slice(0,scanLimit),visibleEvidence=new Set(),sourceDetails=new Map();
    const grouped=new Map();
    for(const row of selected){const scope=appTypeId||row.app_type_id||null,key=scope||'';const bucket=grouped.get(key)||{scope,rows:[]};bucket.rows.push(row);grouped.set(key,bucket);}
    for(const group of grouped.values()){
      const originals=[],lookup=new Map();
      for(const row of group.rows)for(const ref of Array.isArray(row.evidence_refs)?row.evidence_refs:[]){
        const clone={...ref,evidence_id:`${row.id}\u001f${ref.evidence_id}`};lookup.set(clone.evidence_id,{row,ref});originals.push(clone);
      }
      if(!originals.length)continue;
      const before=await readableSources({projectId,user,refs:originals,appTypeId:group.scope,signal});
      await authorize({projectId,user,appTypeId:group.scope,read:true,signal});
      const current=await readableSources({projectId,user,refs:originals,appTypeId:group.scope,signal});
      const permittedNodeIds=new Set(current.nodes.filter(node=>before.nodes.some(old=>old.id===node.id)).map(node=>node.id));
      for(const id of permittedNodeIds){const node=current.nodes.find(item=>item.id===id);if(node)sourceDetails.set(id,node);}
      for(const [key,{row,ref}] of lookup){
        const allowed=ref.source_id==='hellotest-product-help'||before.readable.has(key)&&current.readable.has(key)||before.live.has(key)&&current.live.has(key);
        if(allowed)visibleEvidence.add(contextEvidenceKey(row.id,ref.evidence_id));
      }
    }
    const traceIds=selected.map(row=>row.id),events=[];let eventScanTruncated=false;
    for(let offset=0;offset<traceIds.length;offset+=500){
      const batch=traceIds.slice(offset,offset+500);
      const found=await store.prepare(`SELECT trace_id,event_type,status,metadata FROM ai_context_graph_events
        WHERE project_id=? AND trace_id IN (${batch.map(()=>'?').join(',')})
          AND event_type IN ('CONTEXT_SENT','CITATIONS_RECORDED') LIMIT 25000`).all(projectId,...batch);
      eventScanTruncated ||= found.length>=25000;events.push(...found);
    }
    await authorize({projectId,user,appTypeId,read:true,signal});
    active(signal);
    return aggregateContextHealth({projectId,rows:selected,events,visibleEvidence,sourceDetails,days,truncated:truncated||eventScanTruncated});
  }
  async function readableSources({ projectId, user, refs, appTypeId, signal }) {
    const indexed = refs.filter(ref => !['live_project', 'product_help', 'unknown'].includes(ref.source_kind) && ref.source_id !== 'hellotest-product-help');
    const allowed = await curation.allowedPermissions(projectId, user);
    const ids = [...new Set(indexed.map(ref => ref.source_id))];
    let nodes = ids.length ? await curation.getNodes(projectId, user, ids, allowed) : [];
    if (appTypeId && nodes.length) {
      const rows = await store.prepare(`SELECT id FROM ai_knowledge_sources WHERE project_id = ? AND id IN (${nodes.map(() => '?').join(',')}) AND (app_type_id = ? OR app_type_id IS NULL)`)
        .all(projectId, ...nodes.map(node => node.id), appTypeId);
      const scoped = new Set(rows.map(row => row.id)); nodes = nodes.filter(node => scoped.has(node.id));
    }
    const candidates = indexed.filter(ref => nodes.some(node => node.id === ref.source_id) && ref.chunk_id && ref.document_id && ref.version_hash && /^\d+$/.test(ref.source_version || ''));
    let readable = [], current = [];const states=new Map();
    if (candidates.length) {
      const policy = acl.predicate({ user, projectId, source:'sources', document:'documents', chunk:'chunks' });
      const kinds = KINDS.filter(kind => !PERMISSIONS[kind] || allowed.includes(PERMISSIONS[kind]));
      // Historical selection metadata is visible only while this exact
      // fragment/revision remains authorized. A different readable fragment in
      // the same source cannot declassify a revoked selected fragment.
      const matches = await store.prepare(`SELECT chunks.id AS chunk_id,chunks.document_id,chunks.source_id,documents.version,documents.checksum_sha256,documents.effective_from,documents.effective_to,
        (documents.is_active = TRUE AND indexes.is_current = TRUE AND indexes.required_indexes_ready = TRUE
          AND indexes.document_version = documents.version AND documents.effective_from <= CURRENT_TIMESTAMP
          AND (documents.effective_to IS NULL OR documents.effective_to > CURRENT_TIMESTAMP)) AS is_current
        FROM ai_knowledge_chunks chunks JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id AND documents.source_id = chunks.source_id AND documents.project_id = chunks.project_id
        JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id AND sources.project_id = chunks.project_id
        LEFT JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id AND indexes.project_id = documents.project_id AND indexes.source_id = sources.id
        JOIN jsonb_to_recordset(?::jsonb) AS refs(source_id TEXT,document_id TEXT,chunk_id TEXT,source_version TEXT,version_hash TEXT)
          ON refs.chunk_id = chunks.id AND refs.document_id = documents.id AND refs.source_id = sources.id
          AND refs.source_version = documents.version::text AND refs.version_hash = documents.checksum_sha256
        WHERE sources.project_id = ? AND chunks.project_id = ? AND sources.extraction_status = 'ready'
          AND sources.source_kind IN (${kinds.map(() => '?').join(',') || 'NULL'})
          AND (sources.required_permission IS NULL OR sources.required_permission IN (${allowed.map(() => '?').join(',') || 'NULL'}))
          ${appTypeId ? 'AND (sources.app_type_id = ? OR sources.app_type_id IS NULL)' : ''}
          AND ${acl.applicationContextPredicate({source:'sources',document:'documents'})}
          AND ${(acl.applicationRecordPredicate || authorization.applicationRecordPredicate)({source:'sources'})}
          AND ${policy.sql}`)
        .all(candidates, projectId, projectId, ...kinds, ...allowed, ...(appTypeId ? [appTypeId] : []), ...policy.params);
      readable = candidates.filter(ref => matches.some(row => row.chunk_id === ref.chunk_id && row.source_id === ref.source_id && row.document_id === ref.document_id
        && String(row.version) === ref.source_version && row.checksum_sha256 === ref.version_hash));
      current = readable.filter(ref => matches.some(row => row.chunk_id === ref.chunk_id && row.is_current === true));
      for(const ref of readable){const matched=matches.find(row=>row.chunk_id===ref.chunk_id);states.set(ref.evidence_id,
        matched.effective_from&&new Date(matched.effective_from).getTime()>Date.now()?'NOT_YET_VALID':matched.effective_to&&new Date(matched.effective_to).getTime()<=Date.now()?'EXPIRED'
          :matched.is_current===true?'CURRENT':matched.is_current===false?'STALE':'UNKNOWN');}
    }
    const live = [];
    for (const ref of refs.filter(item => item.source_kind === 'live_project' && item.live_snapshot)) {
      const definition = liveDefinition(ref.live_snapshot.scope);
      if (!definition || ref.source_id !== `live-project-${projectId}-${ref.live_snapshot.scope}` || ref.source_ref_id !== projectId) continue;
      let permitted = true;
      for (const permission of new Set([...definition.permissions, ...ref.live_snapshot.required_permissions])) {
        if (!await grants.hasPermission(user, permission, projectId) || !await featureFlags.areEnabled(featureFlags.getFeatureKeysForPermission(permission), { user })) { permitted = false; break; }
      }
      if (permitted) live.push(ref.evidence_id);
    }
    active(signal);
    return { nodes, readable:new Set(readable.map(ref=>ref.evidence_id)),current:new Set(current.map(ref=>ref.evidence_id)),live:new Set(live),states };
  }
  async function purgeExpired({ limit = 500, ownerQuota, projectQuota } = {}) {
    const bounded = Math.max(1, Math.min(5_000, Number(limit) || 500));
    const configured = (value, envName, fallback, maximum) => {
      const parsed = Number(value ?? process.env[envName] ?? fallback);
      return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
    };
    const perOwner = configured(ownerQuota, 'HELLOTEST_CONTEXT_TRACE_OWNER_QUOTA', 10_000, 1_000_000);
    const perProject = configured(projectQuota, 'HELLOTEST_CONTEXT_TRACE_PROJECT_QUOTA', 100_000, 10_000_000);
    return store.transaction(async () => {
      const purge = async (reason, sql, args) => {
        const rows = await store.prepare(sql).all(...args);
        const deleted = rows.reduce((total, row) => total + Number(row.deleted_count || 0), 0);
        if (deleted) {
          await store.prepare(`INSERT INTO ai_context_graph_retention_audit(project_id,purged_on,reason,deleted_count)
            SELECT project_id,CURRENT_DATE,?,deleted_count FROM jsonb_to_recordset(?::jsonb) AS item(project_id TEXT,deleted_count BIGINT)
            ON CONFLICT(project_id,purged_on,reason) DO UPDATE SET
              deleted_count=ai_context_graph_retention_audit.deleted_count+EXCLUDED.deleted_count,updated_at=CURRENT_TIMESTAMP`)
            .run(reason, JSON.stringify(rows));
        }
        return deleted;
      };
      let remaining = bounded, expired = 0, owner = 0, project = 0;
      const expiredSql = `WITH candidates AS (
        SELECT id FROM ai_context_graph_traces WHERE expires_at <= CURRENT_TIMESTAMP
        ORDER BY expires_at,id LIMIT ? FOR UPDATE SKIP LOCKED
      ), deleted AS (
        DELETE FROM ai_context_graph_traces traces USING candidates
        WHERE traces.id=candidates.id RETURNING traces.project_id
      ) SELECT project_id,COUNT(*)::BIGINT AS deleted_count FROM deleted GROUP BY project_id`;
      expired = await purge('ttl', expiredSql, [remaining]);
      remaining -= expired;
      if (remaining > 0) {
        const ownerSql = `WITH ranked AS MATERIALIZED (
          SELECT id,ROW_NUMBER() OVER (PARTITION BY project_id,actor_id ORDER BY recorded_at DESC,id DESC) AS position
          FROM ai_context_graph_traces WHERE expires_at > CURRENT_TIMESTAMP
        ), candidates AS (
          SELECT traces.id FROM ai_context_graph_traces traces JOIN ranked ON ranked.id=traces.id
          WHERE ranked.position > ? ORDER BY traces.recorded_at,traces.id
          LIMIT ? FOR UPDATE OF traces SKIP LOCKED
        ), deleted AS (
          DELETE FROM ai_context_graph_traces traces USING candidates
          WHERE traces.id=candidates.id RETURNING traces.project_id
        ) SELECT project_id,COUNT(*)::BIGINT AS deleted_count FROM deleted GROUP BY project_id`;
        owner = await purge('owner_quota', ownerSql, [perOwner, remaining]);
        remaining -= owner;
      }
      if (remaining > 0) {
        const projectSql = `WITH ranked AS MATERIALIZED (
          SELECT id,ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY recorded_at DESC,id DESC) AS position
          FROM ai_context_graph_traces WHERE expires_at > CURRENT_TIMESTAMP
        ), candidates AS (
          SELECT traces.id FROM ai_context_graph_traces traces JOIN ranked ON ranked.id=traces.id
          WHERE ranked.position > ? ORDER BY traces.recorded_at,traces.id
          LIMIT ? FOR UPDATE OF traces SKIP LOCKED
        ), deleted AS (
          DELETE FROM ai_context_graph_traces traces USING candidates
          WHERE traces.id=candidates.id RETURNING traces.project_id
        ) SELECT project_id,COUNT(*)::BIGINT AS deleted_count FROM deleted GROUP BY project_id`;
        project = await purge('project_quota', projectSql, [perProject, remaining]);
      }
      await store.prepare('DELETE FROM ai_context_graph_retention_audit WHERE purged_on < CURRENT_DATE - 400').run();
      return { deleted: expired + owner + project, expired, owner_quota: owner, project_quota: project,
        owner_quota_limit: perOwner, project_quota_limit: perProject };
    })();
  }
  async function explore({ projectId, user, traceId, appTypeId, signal } = {}) {
    await authorize({ projectId, user, appTypeId, read: true, signal });
    traceId = identifier(traceId);
    const row = await store.prepare(`SELECT traces.id,traces.project_id,traces.actor_id,traces.app_type_id,traces.feature_id,traces.context_packet_id,
      traces.task_ref,traces.session_id,traces.trace_ref,traces.recorded_at,traces.expires_at,traces.retention_policy,
      payload.query_hash,payload.evidence_refs,payload.coverage,payload.selection FROM ai_context_graph_traces traces
      JOIN ai_context_graph_trace_payloads payload ON payload.trace_id=traces.id AND payload.recorded_at=traces.recorded_at
      WHERE traces.id = ? AND traces.project_id = ? AND traces.actor_id = ? AND traces.expires_at > CURRENT_TIMESTAMP${appTypeId ? ' AND (traces.app_type_id = ? OR traces.app_type_id IS NULL)' : ''}`)
      .get(traceId, projectId, user.id, ...(appTypeId ? [appTypeId] : []));
    if (!row) throw fail('Context trace is unavailable.', 404, 'CONTEXT_GRAPH_NOT_FOUND');
    const refs = Array.isArray(row.evidence_refs) ? row.evidence_refs : [];
    if (refs.length > 30) throw fail('The stored context exceeds its graph budget.', 422, 'CONTEXT_GRAPH_BUDGET');
    const sourceScope = appTypeId || row.app_type_id || null;
    const visible = await readableSources({ projectId, user, refs, appTypeId: sourceScope, signal });
    const eventRows = await store.prepare('SELECT id,event_type,status,rationale,reference_id,metadata,occurred_at,recorded_at FROM ai_context_graph_events WHERE trace_id = ? AND project_id = ? AND actor_id = ? ORDER BY occurred_at DESC,id DESC LIMIT 31')
      .all(traceId, projectId, user.id);
    await authorize({ projectId, user, appTypeId: sourceScope, read: true, signal });
    const latest = await readableSources({ projectId, user, refs, appTypeId: sourceScope, signal });
    const nodes=[],edges=[],timeline=[],taskId=graphId('task',traceId),contextId=graphId('context',traceId),observedAt=iso(row.recorded_at);
    const currentlyVisibleEvidence = new Set(refs.filter(ref => ref.source_id === 'hellotest-product-help'
      || visible.readable.has(ref.evidence_id) && latest.readable.has(ref.evidence_id)
      || visible.live.has(ref.evidence_id) && latest.live.has(ref.evidence_id)).map(ref => ref.evidence_id));
    const relationshipMap=new Map();
    for(const ref of refs){
      if(!currentlyVisibleEvidence.has(ref.evidence_id))continue;
      for(const relation of Array.isArray(ref.knowledge_relationships)?ref.knowledge_relationships:[]){
        if(!object(relation)||typeof relation.knowledge_edge_id!=='string')continue;
        const saved=relationshipMap.get(relation.knowledge_edge_id)||{...relation,evidence_ids:[]};
        saved.evidence_ids.push(ref.evidence_id);relationshipMap.set(relation.knowledge_edge_id,saved);
      }
    }
    let witnessedRelationships={edges:[],nodes:[],limitations:{partial:false}},relationshipReadFailed=false;
    if(relationshipMap.size){
      try{witnessedRelationships=await require('./knowledgeGraph.service').readWitnessedEdges({projectId,user,relationships:[...relationshipMap.values()],appTypeId:sourceScope,signal});}
      catch(error){if(signal?.aborted)throw error;relationshipReadFailed=true;}
    }
    const contextSent = eventRows.some(event => event.event_type === 'CONTEXT_SENT' && event.status === 'submitted');
    const eventEvidence = type => new Set(eventRows.filter(event => event.event_type === type)
      .flatMap(event => Array.isArray(event.metadata?.evidence_ids) ? event.metadata.evidence_ids : [])
      .filter(id => currentlyVisibleEvidence.has(id)));
    const submittedEvidence = eventEvidence('CONTEXT_SENT'), citedEvidence = eventEvidence('CITATIONS_RECORDED');
    nodes.push({ id: taskId, kind: 'task', title: row.feature_id, observed_at: observedAt, metadata: { feature_id: row.feature_id, task_ref: row.task_ref || null, ...(row.selection || {}) } },
      { id: contextId, kind: 'context_packet', title: 'Retrieved context', observed_at: observedAt, metadata: { context_packet_id:row.context_packet_id,evidence_count:refs.length,source_status:row.coverage?.retrieval_status||'UNKNOWN',chain_strategy:row.selection?.chain_strategy||null,termination_reason:row.selection?.termination_reason||null,stage:contextSent?'model_input':'retrieval_result',model_input_recorded:contextSent,submitted_evidence_count:submittedEvidence.size,cited_evidence_count:citedEvidence.size,model_input_verified:false } });
    edges.push({id:graphId('selection',traceId),source:taskId,target:contextId,type:'SELECTED_CONTEXT',provenance_type:'OBSERVED_EVENT',observed_at:observedAt,evidence_ids:[]});
    if(row.session_id){
      const [previous,next]=await Promise.all([
        store.prepare(`SELECT id,feature_id,recorded_at FROM ai_context_graph_traces WHERE project_id=? AND actor_id=? AND session_id=?
          AND expires_at>CURRENT_TIMESTAMP AND (recorded_at,id)<(SELECT current.recorded_at,current.id FROM ai_context_graph_traces current
            WHERE current.id=? AND current.project_id=? AND current.actor_id=?) ORDER BY recorded_at DESC,id DESC LIMIT 1`).get(projectId,user.id,row.session_id,traceId,projectId,user.id),
        store.prepare(`SELECT id,feature_id,recorded_at FROM ai_context_graph_traces WHERE project_id=? AND actor_id=? AND session_id=?
          AND expires_at>CURRENT_TIMESTAMP AND (recorded_at,id)>(SELECT current.recorded_at,current.id FROM ai_context_graph_traces current
            WHERE current.id=? AND current.project_id=? AND current.actor_id=?) ORDER BY recorded_at,id LIMIT 1`).get(projectId,user.id,row.session_id,traceId,projectId,user.id)
      ]);
      for(const [related,type,label] of [[previous,'PRECEDES','Earlier context trace'],[next,'FOLLOWS','Later context trace']]){
        if(!related)continue;
        const relatedId=graphId('task',related.id);
        nodes.push({id:relatedId,kind:'task',title:label,observed_at:iso(related.recorded_at),metadata:{context_trace_id:related.id,feature_id:related.feature_id,session_order_only:true}});
        edges.push({id:graphId('session-order',related.id,traceId),source:type==='PRECEDES'?relatedId:taskId,target:type==='PRECEDES'?taskId:relatedId,
          type:'SESSION_ORDER',provenance_type:'OBSERVED_EVENT',observed_at:iso(related.recorded_at),evidence_ids:[]});
      }
    }
    const existingNodeIds=new Set(nodes.map(node=>node.id));
    for(const source of witnessedRelationships.nodes||[]){
      if(existingNodeIds.has(source.id))continue;
      existingNodeIds.add(source.id);
      nodes.push({id:source.id,kind:source.kind||source.type,title:sanitizeAiText(source.title||'Knowledge source').text,source_id:source.id,
        knowledge_node_id:source.id,observed_at:observedAt,metadata:{source_status:'CURRENT',relationship_endpoint:true}});
    }
    for(const relation of witnessedRelationships.edges||[]){
      const relationNode=graphId('knowledge-edge',traceId,relation.id);
      nodes.push({id:relationNode,kind:'knowledge_graph_edge',title:`${relation.type} relationship`,observed_at:observedAt,
        metadata:{knowledge_edge_id:relation.id,relationship_type:relation.type,provenance_type:relation.provenance_type}});
      edges.push({id:graphId('trace-used-relationship',traceId,relation.id),source:contextId,target:relationNode,type:'USES_KNOWLEDGE_RELATIONSHIP',
        provenance_type:'OBSERVED_EVENT',observed_at:observedAt,evidence_ids:relation.evidence_ids||[]});
      edges.push({id:graphId('trace-relationship-source',traceId,relation.id),source:relationNode,target:relation.source,type:'RELATIONSHIP_SOURCE',
        provenance_type:relation.provenance_type,observed_at:observedAt,evidence_ids:relation.evidence_ids||[]});
      edges.push({id:graphId('trace-relationship-target',traceId,relation.id),source:relationNode,target:relation.target,type:'RELATIONSHIP_TARGET',
        provenance_type:relation.provenance_type,observed_at:observedAt,evidence_ids:relation.evidence_ids||[]});
    }
    let currentCount=0,staleCount=0,hiddenCount=0,snapshotCount=0,unknownCount=0;
    const sourceMap = new Map(latest.nodes.filter(node => visible.nodes.some(before => before.id === node.id)).map(node => [node.id, node]));
    const seen = new Set(nodes.map(node => node.id));
    for (const ref of refs) {
      const builtin = ref.source_id === 'hellotest-product-help';
      const live = visible.live.has(ref.evidence_id) && latest.live.has(ref.evidence_id);
      const source = builtin ? { id: ref.source_id, entity_type: 'product_help', title: 'HelloTest product guide' }
        : live ? { id:ref.source_id,entity_type:'live_snapshot',title:liveDefinition(ref.live_snapshot.scope).label }
          : visible.readable.has(ref.evidence_id) && latest.readable.has(ref.evidence_id) ? sourceMap.get(ref.source_id) : null;
      if (!source) { hiddenCount++; continue; }
      const sourceStatus=live?'RECORDED_SNAPSHOT':ref.effective_from&&new Date(ref.effective_from).getTime()>Date.now()?'NOT_YET_VALID'
        :ref.effective_to&&new Date(ref.effective_to).getTime()<=Date.now()?'EXPIRED':builtin
          ?ref.source_version?ref.source_version===require('./knowledgeProductCatalog.service').PRODUCT_HELP_VERSION?'CURRENT':'STALE':'UNKNOWN'
          :latest.states.get(ref.evidence_id)||'UNKNOWN';
      if(live)snapshotCount++;else if(sourceStatus==='CURRENT')currentCount++;else if(sourceStatus==='UNKNOWN')unknownCount++;else staleCount++;
      if (!seen.has(source.id)) { seen.add(source.id); nodes.push({ id: source.id, kind: source.entity_type, title: sanitizeAiText(source.title || 'Knowledge source').text,
        source_id: source.id, knowledge_node_id: live ? null : source.id, observed_at: observedAt, metadata: { source_status:sourceStatus,source_version:ref.source_version,
          document_id:ref.document_id,version_hash:ref.version_hash,valid_from:ref.effective_from,valid_to:ref.effective_to,confidence:null,
          ...(live ? {scope:ref.live_snapshot.scope,current_content_verified:false,indexed:false} : {}) } }); }
      else {const existing=nodes.find(node=>node.id===source.id);if(existing.metadata.source_status!==sourceStatus)existing.metadata.source_status='MIXED';
        if(existing.metadata.source_version!==ref.source_version)existing.metadata.source_version=null;
        if(existing.metadata.document_id!==ref.document_id)existing.metadata.document_id=null;
        if(existing.metadata.version_hash!==ref.version_hash)existing.metadata.version_hash=null;}
      edges.push({id:graphId('evidence',traceId,ref.evidence_id),source:contextId,target:source.id,type:'RETRIEVED_EVIDENCE',provenance_type:'OBSERVED_EVENT',observed_at:observedAt,
        evidence_ids:[ref.evidence_id],metadata:{source_status:sourceStatus,source_version:ref.source_version,document_id:ref.document_id,version_hash:ref.version_hash,confidence:null} });
    }
    timeline.push({id:graphId('selection',traceId),node_id:contextId,type:'CONTEXT_SELECTED',status:row.coverage?.retrieval_status||'UNKNOWN',label:'Context selected',occurred_at:observedAt,recorded_at:observedAt,
      rationale: 'Recorded the evidence references returned by the authorized context service.' });
    if (row.selection?.authorization?.project_scope_enforced === true && row.selection?.authorization?.source_acl_enforced === true) {
      const policyId=graphId('policy',traceId);
      nodes.push({id:policyId,kind:'policy_check',title:'Context access boundaries',observed_at:observedAt,metadata:{project_scope_enforced:true,source_acl_enforced:true,status:'enforced'}});
      edges.push({id:graphId('access-policy',traceId),source:contextId,target:policyId,type:'APPLIED_ACCESS_POLICY',provenance_type:'OBSERVED_EVENT',observed_at:observedAt,evidence_ids:[]});
      timeline.push({id:graphId('access-policy',traceId),node_id:policyId,type:'POLICY_CHECKED',status:'enforced',label:'Context access boundaries',occurred_at:observedAt,recorded_at:observedAt,rationale:'The context service recorded project-scope and source-access enforcement. This is not approval of a proposed action.'});
    }
    for (const event of eventRows.slice(0, 30).reverse()) {
      if (!EVENT_TYPES.includes(event.event_type)) continue;
      const eventNode=graphId('event',traceId,event.id),occurredAt=iso(event.occurred_at),recordedAt=iso(event.recorded_at);
      const eventMetadata=object(event.metadata)?event.metadata:{};
      const eventEvidence=(Array.isArray(eventMetadata.evidence_ids)?eventMetadata.evidence_ids:[]).filter(id=>currentlyVisibleEvidence.has(id));
      const visibleRelationships=(Array.isArray(eventMetadata.relationships)?eventMetadata.relationships:[]).flatMap(item=>{
        if(!object(item)||typeof item.knowledge_edge_id!=='string')return [];
        const proofIds=(Array.isArray(item.evidence_ids)?item.evidence_ids:[]).filter(id=>currentlyVisibleEvidence.has(id));
        return proofIds.length?[{knowledge_edge_id:item.knowledge_edge_id,evidence_ids:proofIds}]:[];
      });
      nodes.push({ id:eventNode,kind:'decision_event',title:EVENT_LABELS[event.event_type],observed_at:recordedAt,occurred_at:occurredAt,recorded_at:recordedAt,
        metadata:{event_type:event.event_type,status:event.status,reference_id:event.reference_id||null,rationale:event.rationale?sanitizeAiText(event.rationale).text:null,
          evidence_ids:eventEvidence,knowledge_edge_ids:visibleRelationships.map(item=>item.knowledge_edge_id),occurred_at:occurredAt,recorded_at:recordedAt} });
      edges.push({id:graphId('recorded-event',traceId,event.id),source:contextId,target:eventNode,type:'RECORDED_EVENT',provenance_type:'OBSERVED_EVENT',observed_at:recordedAt,occurred_at:occurredAt,recorded_at:recordedAt,evidence_ids:[]});
      for(const relation of visibleRelationships){
        const relationNode=graphId('knowledge-edge',traceId,relation.knowledge_edge_id);
        if(!nodes.some(node=>node.id===relationNode))nodes.push({id:relationNode,kind:'knowledge_graph_edge',title:'Linked Knowledge relationship',observed_at:recordedAt,
          metadata:{knowledge_edge_id:relation.knowledge_edge_id,proof_evidence_ids:relation.evidence_ids}});
        edges.push({id:graphId('packet-relationship',traceId,event.id,relation.knowledge_edge_id),source:eventNode,target:relationNode,
          type:'REFERENCED_KNOWLEDGE_RELATIONSHIP',provenance_type:'OBSERVED_EVENT',observed_at:recordedAt,evidence_ids:relation.evidence_ids});
      }
      timeline.push({id:graphId('timeline',traceId,event.id),node_id:eventNode,type:event.event_type,status:event.status,label:EVENT_LABELS[event.event_type],occurred_at:occurredAt,recorded_at:recordedAt,
        rationale: event.rationale ? sanitizeAiText(event.rationale).text : null, reference_id: event.reference_id || null,evidence_ids:eventEvidence,
        knowledge_edge_ids:visibleRelationships.map(item=>item.knowledge_edge_id) });
    }
    timeline.sort((left, right) => String(left.occurred_at).localeCompare(String(right.occurred_at)) || left.id.localeCompare(right.id));
    const result = { contract_type: 'ContextGraph', schema_version: VERSION, project_id: projectId, trace: summary(row), nodes, edges, timeline,
      stats: {node_count:nodes.length,edge_count:edges.length,recorded_evidence_count:refs.length,current_evidence_count:currentCount,stale_evidence_count:staleCount,unknown_evidence_count:unknownCount,recorded_snapshot_count:snapshotCount,unavailable_evidence_count:hiddenCount,event_count:timeline.length-1,
        submitted_evidence_count:submittedEvidence.size,cited_evidence_count:citedEvidence.size,knowledge_relationship_count:witnessedRelationships.edges.length,
        unavailable_knowledge_relationship_count:Math.max(0,relationshipMap.size-witnessedRelationships.edges.length),session_neighbor_count:row.session_id?Math.max(0,nodes.filter(node=>node.metadata?.session_order_only).length):0},
      limitations: {partial:hiddenCount>0||staleCount>0||unknownCount>0||eventRows.length>30||relationshipReadFailed||witnessedRelationships.edges.length<relationshipMap.size,unavailable_evidence_count:hiddenCount,stale_evidence_count:staleCount,events_truncated:eventRows.length>30,
        knowledge_relationships_partial:relationshipReadFailed||witnessedRelationships.edges.length<relationshipMap.size,
        gaps: [...(hiddenCount ? ['Some recorded evidence is unavailable with current access or has no indexed source identity. Its identifiers and content are omitted.'] : []),
          ...(staleCount ? ['Some selected source revisions are no longer current. Their historical selection is recorded; they must not be used as current facts.'] : []),
          ...(relationshipReadFailed||witnessedRelationships.edges.length<relationshipMap.size?['Some graph relationships recorded with this packet are no longer visible or current. They are omitted from this trace view.']:[]),
          ...(snapshotCount ? ['Live project snapshots retain their original observation identity. Current access is rechecked, but their former content is not asserted to be current.'] : []),
          ...(unknownCount?['The current validity of some authorized recorded references is unknown.']:[]),
          ...(eventRows.length > 30 ? ['Only the thirty most recent recorded events are shown.'] : [])],
        semantics:'Edges record returned retrieval evidence and explicit server events. They do not expose private model reasoning or establish causality, approval, execution or correctness without a corresponding recorded event.',
        model_input_verified:false,stage:contextSent?'model_input':'retrieval_result',
        model_input_limitation:contextSent
          ? 'The application recorded these evidence identifiers as submitted to synthesis. This does not prove provider receipt, entailment, or causal support for the saved answer.'
          : 'No model submission event was recorded. Selected retrieval evidence does not prove model use or support for an outcome.' } };
    if (nodes.length > 128 || edges.length > 256 || Buffer.byteLength(JSON.stringify(result)) > 160 * 1024) throw fail('The recorded graph exceeds the bounded visualization budget.', 422, 'CONTEXT_GRAPH_BUDGET');
    active(signal); return result;
  }
  const maintainPartitions = async ({ monthsAhead = 24 } = {}) => {
    const months = Math.max(1, Math.min(60, Number(monthsAhead) || 24));
    const row = await store.prepare('SELECT maintain_ai_context_graph_trace_partitions(?::INTEGER) AS months_ensured').get(months);
    return { months_ensured: Number(row?.months_ensured) || 0 };
  };
  return { recordContext, recordDecision, list, explore, health, purgeExpired, maintainPartitions };
}
module.exports = { ...createContextGraph(), createContextGraph, EVENT_TYPES, retentionDaysForFeature, traceSampleRateForFeature, sampleFeatureTrace, _internals: { evidenceReferences,summary,graphId,retentionPolicyForFeature } };
