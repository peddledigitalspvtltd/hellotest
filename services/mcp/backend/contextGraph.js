const z = require('zod');
const { withDeadline } = require('./mcpDeadline');
const traceContext = require('@hellotest/platform/backend/src/utils/llmTraceContext');

const id = z.string().min(1).max(255);
const listSchema = z.object({
  app_type_id: id.optional(), feature_id: z.string().min(1).max(160).optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(20).default(12), cursor: z.string().min(1).max(2048).optional()
}).strict();
const exploreSchema = z.object({ trace_id: id, app_type_id: id.optional() }).strict();
const nativeService = () => require('@hellotest/knowledge/backend/services/knowledgeContextGraph.service');
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\x00-\x1f]/.test(value);

function createContextGraph({ permit, fail, db, bounded, service = nativeService }) {
  async function scope(actor, application, signal) {
    await permit(actor, 'knowledge.view'); signal?.throwIfAborted();
    if (application) {
      const app = await db.prepare('SELECT project_id FROM app_types WHERE id=?').get(application);
      if (app?.project_id !== actor.projectId) throw fail('Application is outside this MCP project.', 403, 'MCP_CONTEXT_GRAPH_SCOPE');
    }
  }
  async function list(actor, args, signal) {
    return withDeadline(async boundedSignal => {
      await scope(actor, args.app_type_id, boundedSignal);
      const value = await service().list({ projectId: actor.projectId, user: actor.user,
        appTypeId: args.app_type_id, featureId: args.feature_id, from: args.from, to: args.to,
        limit: args.limit, cursor: args.cursor, signal: boundedSignal });
      boundedSignal.throwIfAborted();
      if (value?.project_id !== actor.projectId || !Array.isArray(value.items) || value.items.length > args.limit
        || value.items.some(item => !validId(item.trace_id) || item.project_id && item.project_id !== actor.projectId)) {
        throw fail('Context history returned an invalid scoped projection.', 502, 'MCP_CONTEXT_GRAPH_CONTRACT');
      }
      const safe = bounded(value);
      if (safe.items?.length !== value.items.length || safe.items.some((item, index) => item.trace_id !== value.items[index].trace_id)) throw fail('Narrow the context history page.', 413, 'MCP_CONTEXT_GRAPH_BUDGET');
      return safe;
    }, { signal, timeoutMs: 8000 });
  }
  async function explore(actor, args, signal) {
    return withDeadline(async boundedSignal => {
      await scope(actor, args.app_type_id, boundedSignal);
      const graph = await service().explore({ projectId: actor.projectId, user: actor.user,
        appTypeId: args.app_type_id, traceId: args.trace_id, signal: boundedSignal });
      boundedSignal.throwIfAborted();
      if (graph?.contract_type !== 'ContextGraph' || graph.project_id !== actor.projectId
        || !Array.isArray(graph.nodes) || graph.nodes.length > 64 || !Array.isArray(graph.edges) || graph.edges.length > 100
        || !Array.isArray(graph.timeline) || graph.timeline.length > 100) {
        throw fail('Context graph returned an invalid scoped projection.', 502, 'MCP_CONTEXT_GRAPH_CONTRACT');
      }
      const nodes = new Set(graph.nodes.map(node => node.id));
      if (nodes.size !== graph.nodes.length || graph.nodes.some(node => !validId(node.id) || node.project_id && node.project_id !== actor.projectId)
        || graph.edges.some(edge => !nodes.has(edge.source) || !nodes.has(edge.target) || edge.project_id && edge.project_id !== actor.projectId)
        || graph.timeline.some(event => event.project_id && event.project_id !== actor.projectId)) {
        throw fail('Context graph returned an unavailable endpoint or foreign scope.', 502, 'MCP_CONTEXT_GRAPH_CONTRACT');
      }
      const safe = bounded(graph), delivered = new Set(safe.nodes.map(node => node.id));
      if (safe.nodes.length !== graph.nodes.length || safe.edges.length !== graph.edges.length || safe.timeline.length !== graph.timeline.length
        || delivered.size !== safe.nodes.length || safe.nodes.some((node, index) => node.id !== graph.nodes[index].id)
        || safe.edges.some((edge, index) => !delivered.has(edge.source) || !delivered.has(edge.target)
          || ['id','source','target'].some(key => edge[key] !== graph.edges[index][key]))
        || safe.timeline.some((event, index) => event.node_id !== graph.timeline[index].node_id)) {
        throw fail('Context graph delivery omitted required records. Narrow the selected trace.', 413, 'MCP_CONTEXT_GRAPH_BUDGET');
      }
      return safe;
    }, { signal, timeoutMs: 10000 });
  }
  return { list, explore };
}

// Capture the final delivered packet, after MCP redaction/packing. The ledger
// retains exact references and observed checks; it does not copy source content
// or make an old answer authoritative in a later task.
async function rememberContext(actor, packet, { appTypeId, request, signal, service = nativeService } = {}) {
  if (packet?.contract_type !== 'ContextPacket' || !validId(packet.context_packet_id || packet.packet_id)) return packet;
  const scope = traceContext.current();
  const selected = { projectId: actor.projectId, user: actor.user, packet,
    featureId: scope.feature || (request?.conversation?.session_id ? 'ai.knowledge.assistant' : 'mcp.context'),
    appTypeId: appTypeId || packet.applied_filters?.app_type_id || null,
    taskRef: scope.task_id || scope.request_id || packet.request_id || null,
    sessionId: scope.session_id || request?.conversation?.session_id || null,
    traceId: scope.trace_id || packet.trace_id || null };
  let receipt;
  try {
    receipt = await withDeadline(boundedSignal => service().recordContext({ ...selected, signal: boundedSignal }), { signal, timeoutMs: 1500 });
    if (!validId(receipt?.trace_id)) throw new Error('Context graph receipt is unavailable.');
    receipt = { status: 'recorded', trace_id: receipt.trace_id, recorded_at: receipt.recorded_at };
  } catch (error) {
    signal?.throwIfAborted();
    receipt = { status: 'unavailable', code: 'CONTEXT_GRAPH_RECORD_UNAVAILABLE' };
  }
  return { ...packet, retrieval: { ...packet.retrieval, context_graph: receipt } };
}

// Called only after the source feature has persisted its own terminal result.
// Failed optional memory writes must not replay or invalidate that saved work.
async function rememberDecision({ projectId, user, packet, event, signal, service = nativeService }) {
  const trace = packet?.retrieval?.context_graph;
  if (trace?.status !== 'recorded' || !validId(trace.trace_id)) return { status: 'not_recorded' };
  try {
    const receipt = await withDeadline(boundedSignal => service().recordDecision({ projectId, user,
      contextTraceId: trace.trace_id, event, signal: boundedSignal }), { signal, timeoutMs: 1500 });
    return { status: 'recorded', trace_id: receipt.trace_id, event_id: receipt.event_id };
  } catch {
    return { status: 'unavailable', code: 'CONTEXT_GRAPH_EVENT_UNAVAILABLE' };
  }
}

module.exports = { listSchema, exploreSchema, createContextGraph, rememberContext, rememberDecision };
