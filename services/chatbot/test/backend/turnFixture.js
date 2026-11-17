// Real-schema fixture for full chat turns. Everything is real (sessions, messages,
// idempotency, retrieval over a seeded corpus, the MCP context backplane,
// authorization, answer contracts) except the language model, which is a fake
// adapter registered with the model gateway. The gateway's own call counting and
// budgets therefore apply exactly as in production.
const assert = require("node:assert/strict");

const FAKE_PROTOCOL = "turn_test_fake_model";
const OPERATIONS = { "knowledge.assistant.plan-intent": "plan", "knowledge.assistant.read-tool-continuation":"continue", "knowledge.assistant.synthesize": "synthesize", "knowledge.assistant.verify": "verify" };

exports.CORPUS = [
  { key: "refunds", title: "Checkout refund policy",
    content: "Checkout refunds are issued within five business days. The checkout flow must reject expired credit cards and show a retry message to returning customers." },
  { key: "releases", title: "Release checklist",
    content: "A release requires passing regression tests and an approved sign-off. Deployments happen on Tuesday after the freeze." },
  { key: "suites", title: "Regression suite guidance",
    content: "A stable regression suite avoids shared state, isolates test data per run and retries only infrastructure failures." }
];

exports.setupTurnFixture = async (t) => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_knowledge_retrieval_[0-9]+$/);
  const db = require("@hellotest/platform/backend/src/db");
  const obsDb = require("../../../platform/backend/src/obsDb");
  await require("../../../platform/backend/src/migrate").migrate();
  const rag = require("@hellotest/knowledge/backend/services/knowledgeRag.service");
  const modelGateway = require("@hellotest/knowledge/backend/services/knowledgeModelGateway.service");
  const selection = require("@hellotest/integration/backend/services/aiLlmSelection.service");
  // Loading the MCP server installs the in-process context transport, exactly as
  // the API plugin does at startup.
  require("@hellotest/mcp/backend/server");
  const assistant = require("../../backend/services/knowledgeAssistant.service");
  t.after(async () => { await Promise.allSettled([db.close(), obsDb.close()]); });

  const project = "turn-project";
  const user = { id: "turn-user" };
  const permissions = ["project.view", "app_type.view", "knowledge.view", "knowledge.manage", "requirement.view", "testcase.view", "run.view", "feedback.view"];
  await db.query("INSERT INTO roles(id,name) VALUES ('turn-role','Turn role')");
  await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'turn-role',id FROM permissions WHERE code IN (SELECT jsonb_array_elements_text($1::jsonb))", [permissions]);
  await db.query("INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES ('turn-user','turn@example.test','x','Turn','turn-role')");
  await db.query("INSERT INTO projects(id,name,visibility,created_by) VALUES ('turn-project','Turn project','private','turn-user')");
  await db.query("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('turn-m','turn-project','turn-user','turn-role')");
  await db.query("INSERT INTO app_types(id,project_id,name,type) VALUES ('turn-app','turn-project','Turn application','web')");
  await db.query("INSERT INTO test_cases(id,app_type_id,title,status) VALUES ('turn-case','turn-app','Checkout card retry','ready')");

  const sources = {};
  for (const [index, doc] of exports.CORPUS.entries()) {
    const id = `turn-source-${doc.key}`, revision = `rev-${index}`;
    await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,required_permission,revision_token,metadata)
      VALUES (?,?,'text',?,'processing',NULL,?,'{}'::jsonb)`).run(id, project, doc.title, revision);
    await db.prepare(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
      VALUES (?,?,?,'PROJECT',?,'ALLOW',TRUE)`).run(`${id}:project-read`, project, id, project);
    await rag._internals.persistDocument({ projectId: project, content: `${doc.title}\n\n${doc.content}`, embeddingRuntime: { configured: false },
      source: { id, project_id: project, title: doc.title, source_kind: "text", revision_token: revision, metadata: {}, required_permission: null } });
    sources[doc.key] = id;
  }

  // --- the fake model -------------------------------------------------------
  const calls = [];
  const script = {};
  const evidenceOf = (input) => JSON.parse(input.messages[1].content).context_packet?.evidence || [];
  const defaults = {
    plan: (input) => {
      const question = JSON.parse(input.messages[1].content).question || "";
      return { search_queries: [question], source_kinds: ["text"], information_needs: ["the behaviour the question asks about"], retrieval_strategy: "hybrid_evidence" };
    },
    continue: () => ({read_tools:[]}),
    synthesize: (input) => {
      const [first] = evidenceOf(input);
      if (!first) return { status: "insufficient_context", executive_summary: "No supporting evidence was retrieved.", findings: [], recommendations: [],
        evidence_gaps: ["No authorized evidence matched the question."], citation_ids: [], supported_claims: [] };
      const statement = String(first.content).split(/(?<=[.!?])\s+/).find((sentence) => sentence.length > 20) || String(first.content);
      return { status: "answered", executive_summary: statement, findings: [], recommendations: [], evidence_gaps: [],
        citation_ids: [first.evidence_id], supported_claims: [{ statement, citation_ids: [first.evidence_id] }] };
    },
    verify: (input) => defaults.synthesize(input)
  };
  modelGateway.registerAdapter(FAKE_PROTOCOL, async (input) => {
    const kind = OPERATIONS[input.operation] || input.operation;
    calls.push({ operation: input.operation, kind, question: (() => { try { return JSON.parse(input.messages[1].content).question; } catch { return undefined; } })() });
    const handler = script[kind] || defaults[kind];
    if (!handler) throw Object.assign(new Error(`Unexpected model operation ${input.operation}`), { code: "MODEL_UNEXPECTED_OPERATION" });
    return handler(input, { calls });
  });
  const integration = { id: "turn-integration", type: "llm", is_active: true, model: "fake-model-1", name: "Fake model", base_url: "http://model.invalid/v1",
    api_key: "sk-turn-test-0123456789abcdef", config: { protocol: FAKE_PROTOCOL } };
  t.mock.method(selection, "resolveLlmIntegrationForUsage", async () => integration);

  let sessionCounter = 0;
  const newSession = async (filters = {}) => (await assistant.createSession({ projectId: project, title: `Turn session ${++sessionCounter}`, filters, user })).id;
  return { db, rag, assistant, modelGateway, project, user, sources, calls, script, defaults, integration, newSession,
    reset: () => { calls.length = 0; for (const key of Object.keys(script)) delete script[key]; },
    modelCalls: (kind) => calls.filter((call) => !kind || call.kind === kind).length };
};
