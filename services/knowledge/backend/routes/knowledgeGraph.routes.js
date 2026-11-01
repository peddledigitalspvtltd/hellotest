const graph = require('../services/knowledgeGraph.service');
const management = require('../services/knowledgeGraphManagement.service');
const extraction = require('../services/knowledgeGraphExtraction.service');
const contextGraph = require('../services/knowledgeContextGraph.service');
const execution = require('../services/knowledgeExecution.service');
const { validateAppTypeScope, createProjectAccess } = require('../http/requestScope');

const id = { type: 'string', minLength: 1, maxLength: 255 };
const object = properties => ({ type: 'object', additionalProperties: false, properties });
// The app's shared Ajv strips additional properties. Reject them before that
// normalization so an approval flag or scope override cannot be silently lost.
const closedBody = schema => ({ schema: { body: schema }, preValidation: async req => {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      && Object.keys(req.body).some(key => !Object.hasOwn(schema.properties, key))) {
    throw Object.assign(new Error('Unsupported context graph input field.'), { statusCode: 400, code: 'KNOWLEDGE_GRAPH_INVALID' });
  }
} });
const options = {
  app_type_id: id, hops: { type: 'integer', minimum: 0, maximum: 3 },
  fanout: { type: 'integer', minimum: 1, maximum: 12 }, max_nodes: { type: 'integer', minimum: 1, maximum: 100 },
  max_edges: { type: 'integer', minimum: 0, maximum: 100 }, max_evidence: { type: 'integer', minimum: 0, maximum: 30 },
  token_budget: { type: 'integer', minimum: 256, maximum: 8000 },
  direction: { type: 'string', enum: ['both', 'outbound', 'inbound'] },
  relation_types: { type: 'array', maxItems: 8, items: { type: 'string', enum: management.RELATIONS } }
};
module.exports = async function registerKnowledgeGraph(fastify) {
  const ensureProjectAccess = createProjectAccess(fastify);
  const authorize = async (req, reply, manage = false) => {
    await connected(req, reply, async signal => {
      await fastify.authenticate(req); signal.throwIfAborted();
      await ensureProjectAccess(req, req.params.project_id, manage ? 'knowledge.manage' : 'knowledge.view'); signal.throwIfAborted();
      await validateAppTypeScope(req.params.project_id, req.body?.app_type_id); signal.throwIfAborted();
    }, 5000);
    reply.header('Cache-Control', 'no-store');
  };
  const connected = async (req, reply, task, timeoutMs = 10_000) => {
    const controller = new AbortController();
    const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
    req.raw.once('aborted', disconnect); reply.raw.once('close', disconnect);
    if (req.raw.aborted || reply.raw.destroyed) controller.abort();
    try { return await execution.bounded(signal => task(signal), { signal: controller.signal, timeoutMs }); }
    finally { req.raw.removeListener('aborted', disconnect); reply.raw.removeListener('close', disconnect); }
  };
  const base = '/projects/:project_id/knowledge/graph';
  const contextBase = '/projects/:project_id/knowledge/context-graph';
  fastify.get(contextBase, { schema: { querystring: object({
    app_type_id: id, feature_id: { type: 'string', minLength: 1, maxLength: 160 },
    from: { type: 'string', minLength: 1, maxLength: 80 }, to: { type: 'string', minLength: 1, maxLength: 80 },
    limit: { type: 'integer', minimum: 1, maximum: 20 }, cursor: { type: 'string', minLength: 1, maxLength: 2048 }
  }) } }, async (req, reply) => {
    await authorize(req, reply);
    return connected(req, reply, signal => contextGraph.list({ projectId: req.params.project_id, user: req.user,
      appTypeId: req.query.app_type_id, featureId: req.query.feature_id, from: req.query.from, to: req.query.to,
      limit: req.query.limit ?? 20, cursor: req.query.cursor, signal }));
  });
  fastify.post(`${contextBase}/explore`, closedBody({ ...object({ trace_id: id, app_type_id: id }), required: ['trace_id'] }), async (req, reply) => {
    await authorize(req, reply);
    return connected(req, reply, signal => contextGraph.explore({ projectId: req.params.project_id, user: req.user,
      traceId: req.body.trace_id, appTypeId: req.body.app_type_id, signal }));
  });
  fastify.get(base, async (req, reply) => {
    await authorize(req, reply);
    return graph.describe();
  });
  fastify.post(`${base}/resolve`, closedBody({ ...object({
    identifiers: { type: 'array', maxItems: 20, items: id }, query: { type: 'string', maxLength: 255 },
    limit: { type: 'integer', minimum: 1, maximum: 30 }, app_type_id: id
  }) }), async (req, reply) => {
    await authorize(req, reply);
    return connected(req, reply, async signal => {
      const result = await graph.resolveNodes({ projectId: req.params.project_id, user: req.user,
        identifiers: req.body.identifiers, query: req.body.query, limit: req.body.limit || 30, appTypeId: req.body.app_type_id, signal, timeoutMs: 8000 });
      return { ...result, nodes: result.nodes.map(node => ({ ...node, alias_revision: management.aliasRevision(node) })) };
    });
  });
  fastify.post(`${base}/expand`, closedBody({ ...object({
    seeds: { type: 'array', minItems: 1, maxItems: 6, items: id }, ...options
  }), required: ['seeds'] }), async (req, reply) => {
    await authorize(req, reply);
    const body = req.body;
    return connected(req, reply, signal => graph.expand({ projectId: req.params.project_id, user: req.user,
      seeds: body.seeds, appTypeId: body.app_type_id, hops: body.hops, fanout: body.fanout,
      maxNodes: body.max_nodes, maxEdges: body.max_edges, maxEvidence: body.max_evidence, maxTokens: body.token_budget,
      direction: body.direction, relationTypes: body.relation_types, signal, timeoutMs: 8000 }));
  });
  fastify.post(`${base}/reconcile`, closedBody(object({ cursor: { type: 'string', maxLength: 255 } })), async (req, reply) => {
    await authorize(req, reply, true);
    return connected(req, reply, signal => graph.reconcilePage({ projectId: req.params.project_id, user: req.user,
      cursor: req.body?.cursor, limit: 20, signal }));
  });
  fastify.put(`${base}/nodes/:node_id/aliases`, closedBody({ ...object({
    aliases: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 120 } },
    expected_revision: { type: 'string', minLength: 64, maxLength: 64 }
  }), required: ['aliases', 'expected_revision'] }), async (req, reply) => {
    await authorize(req, reply, true);
    return management.setAliases({ projectId: req.params.project_id, user: req.user, nodeId: req.params.node_id, input: req.body });
  });
  fastify.get(`${base}/candidates`, async (req, reply) => {
    await authorize(req, reply, true);
    return connected(req, reply, () => management.listCandidates({ projectId: req.params.project_id, user: req.user }));
  });
  fastify.post(`${base}/candidates`, closedBody({ ...object({
    source_node_id: id, target_node_id: id, relation_type: { type: 'string', enum: management.RELATIONS }, chunk_id: id,
    excerpt: { type: 'string', minLength: 3, maxLength: 1500 }
  }), required: ['source_node_id', 'target_node_id', 'relation_type', 'chunk_id', 'excerpt'] }), async (req, reply) => {
    await authorize(req, reply, true);
    return management.propose({ projectId: req.params.project_id, user: req.user, input: req.body });
  });
  fastify.post(`${base}/candidates/:edge_id/review`, closedBody({ ...object({
    decision: { type: 'string', enum: ['approve', 'reject'] }, expected_revision: { type: 'string', minLength: 64, maxLength: 64 }
  }), required: ['decision', 'expected_revision'] }), async (req, reply) => {
    await authorize(req, reply, true);
    return management.review({ projectId: req.params.project_id, user: req.user, edgeId: req.params.edge_id, input: req.body });
  });
  fastify.post(`${base}/extract`, closedBody({ ...object({ node_ids: { type: 'array', minItems: 2, maxItems: 12, uniqueItems: true, items: id } }), required: ['node_ids'] }), async (req, reply) => {
    await authorize(req, reply, true);
    return connected(req, reply, signal => extraction.extract({ projectId: req.params.project_id, user: req.user, input: req.body, signal }), 25_000);
  });
};
