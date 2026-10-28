const z = require('zod');

const id = z.string().min(1).max(255);
const evidenceScope = z.object(Object.fromEntries(
 require('@hellotest/platform/shared/agentEvidenceScopeFields.json').map(field => field.key)
  .map(field => [field, id.optional()])
)).strict();
const filters = z.object({
 requested_scopes: z.array(z.enum(['stories', 'test-cases', 'runs', 'bugs', 'automation', 'knowledge'])).max(6).optional(),
 evidence_scope: evidenceScope.optional(),
 collection_ids: z.array(id).max(100).optional(),
 source_ids: z.array(id).max(100).optional(),
 source_kinds: z.array(z.string().min(1).max(80)).max(20).optional(),
 agent_id: id.optional(),
 as_of: z.string().datetime().optional()
}).strict();
// The same ceilings as Knowledge's normalized retrieval contract. Zero disables
// a budgeted activity; it must not turn back into a default or a larger budget.
const budgetLimits = Object.freeze({
 deadline_ms:60000, max_rounds:4, max_retrieval_rounds:4, max_tool_calls:20,
 max_queries:10, max_candidates:1000, max_candidate_documents:1000,
 max_reranker_candidates:1000, max_evidence_items:30, max_context_tokens:32000,
 max_cost_usd:10, max_query_cost_usd:10
});
const budgets = z.object(Object.fromEntries(Object.entries(budgetLimits).map(([name,max]) =>
 [name,(name.includes('cost_usd') ? z.number() : z.number().int()).min(0).max(max).optional()]
))).strict();

function packetBudgets(input = {}) {
 return Object.fromEntries(Object.entries(budgetLimits).filter(([key]) => input[key] !== undefined)
  .map(([key,max]) => [key,Math.min(max,Math.max(0,Number(input[key])))]));
}

const contextSchema = z.object({
 question: z.string().min(1).max(8000),
 app_type_id: id.optional(),
 integration_id: id.optional(),
 token_budget: z.number().int().min(256).max(32000).default(6000),
 // Retain the original top-level source selector for existing MCP clients.
 source_ids: z.array(id).max(100).optional(),
 filters: filters.optional(),
 budgets: budgets.optional()
}).strict();

function contextRequestBudget(args = {}) {
 const configured = Number(args.budgets?.deadline_ms);
 return Number.isFinite(configured) && configured >= 0 ? Math.min(60000, configured) : 20000;
}

// Only the public context read can use the longer retrieval deadline. Action
// calls retain the original request budget and never inherit a model's timeout.
function requestTimeoutMs(body) {
 if (body?.method !== 'tools/call' || body.params?.name !== 'hellotest_context_build') return 30000;
 return contextRequestBudget(body.params.arguments) + 2000;
}

module.exports = { contextSchema, contextRequestBudget, requestTimeoutMs, packetBudgets };
