const z = require('zod');

const id = z.string().min(1).max(255);
const sourceKinds=['requirement','test_case','execution','bug','knowledge_item','file','text','chat','url','product_help'];
const evidenceScope = z.object(Object.fromEntries(
 require('@hellotest/platform/shared/agentEvidenceScopeFields.json').map(field => field.key)
  .map(field => [field, id.optional()])
)).strict();
const filters = z.object({
 requested_scopes: z.array(z.enum(['stories', 'test-cases', 'runs', 'bugs', 'automation', 'knowledge'])).max(6).optional().describe('Restrict retrieval to these permitted feature families. An explicit empty array disables retrieval; omit to infer relevant families from the question.'),
 evidence_scope: evidenceScope.optional().describe('Exact selected Story, Test Case, execution, release or sprint identities; filters narrow the verified project and cannot grant access.'),
 collection_ids: z.array(id).max(100).optional(),
 source_ids: z.array(id).max(100).optional(),
 source_kinds: z.array(z.enum(sourceKinds)).max(10).optional().describe('Indexed source types to search. product_help selects application documentation; live project facts follow requested_scopes.'),
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

// A caller may supply an already reviewed retrieval hint. It never chooses
// identity, permissions, tools, model credentials or a wider source boundary.
const intentPlan = z.object({
 queries:z.array(z.string().min(1).max(700)).max(3).optional(),
 search_queries:z.array(z.string().min(1).max(700)).max(3).optional(),
 source_kinds:z.array(z.enum(sourceKinds)).max(8).optional(),
 information_needs:z.array(z.string().min(1).max(400)).max(8).optional(),
 stop_if_sufficient:z.boolean().optional()
}).strict().refine(value=>(value.queries?.length||value.search_queries?.length||value.source_kinds?.length||value.information_needs?.length),'Provide at least one retrieval hint.');

function packetBudgets(input = {}) {
 return Object.fromEntries(Object.entries(budgetLimits).filter(([key]) => input[key] !== undefined)
  .map(([key,max]) => {
   const value=Number(input[key]);
   if(!Number.isFinite(value))throw Object.assign(new Error(`Invalid context budget: ${key}.`),{statusCode:400,code:'MCP_INVALID_ARGUMENT'});
   return [key,Math.min(max,Math.max(0,key.includes('cost_usd')?value:Math.floor(value)))];
  }));
}

const contextSchema = z.object({
 question: z.string().min(1).max(8000).describe('Original question or task objective. Retrieval returns permitted evidence and gaps, without executing actions or generating an answer.'),
 app_type_id: id.optional().describe('Application inside the connected project. Omit for project scope; never infer a project from this identifier.'),
 integration_id: id.optional(),
 token_budget: z.number().int().min(256).max(32000).default(6000),
 // Retain the original top-level source selector for existing MCP clients.
 source_ids: z.array(id).max(100).optional().describe('Exact indexed source IDs. When filters.source_ids is also supplied, only their intersection is searched. Omit for the permitted source set.'),
 filters: filters.optional(),
 budgets: budgets.optional(),
 intent_plan:intentPlan.optional()
}).strict();

const evidenceOutput = z.object({
 evidence_id:id,source_id:z.string().min(1).max(500),source_kind:z.string().min(1).max(80),
 content:z.string().max(128000),title:z.string().max(500).optional(),
 document_id:z.string().nullable().optional(),chunk_id:z.string().nullable().optional(),
 freshness:z.record(z.string(),z.unknown()).optional(),integrity:z.record(z.string(),z.unknown()).optional()
}).passthrough();
const packetOutput = z.object({
 project_id:id,evidence:z.array(evidenceOutput).max(30),
 packet_id:id.optional(),applied_filters:z.record(z.string(),z.unknown()).optional(),
 authorization:z.object({project_scope_enforced:z.literal(true),source_acl_enforced:z.literal(true)}).passthrough().optional(),
 relationships:z.array(z.record(z.string(),z.unknown())).max(100).optional(),
 retrieval:z.record(z.string(),z.unknown()).optional(),budget:z.record(z.string(),z.unknown()).nullable().optional()
}).passthrough();
// The API-process bridge retains the native retrieval result; remote/public
// context reads return the portable packet. Both retain provenance verbatim.
const contextOutputSchema=z.union([
 z.object({packet:packetOutput}).passthrough(),
 z.object({result:z.object({packet:packetOutput,hits:z.array(z.record(z.string(),z.unknown())).max(30),retrieval:z.record(z.string(),z.unknown()),budget:z.record(z.string(),z.unknown())}).passthrough()}).passthrough()
]);

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

module.exports = { contextSchema, contextOutputSchema, contextRequestBudget, requestTimeoutMs, packetBudgets, intentPlan };
