// Compatibility receipts are written only after a complete migration commits.
// Versions are minimum additive-schema versions; destructive changes require a
// separately reviewed compatibility/rolling-deployment plan.
// Version 15 permits distinct effect receipts for each workflow loop iteration.
// Version 16 adds the Knowledge retrieval, graph-ontology and change-event
// structures (weighted lexical vectors, relationship backoff, outbox).
// Version 17 adds tool-set scopes and the internal marker to MCP credentials.
// Version 18 adds durable semantic-index work, partitioned context evidence
// payloads and the monthly trace-partition maintenance function.
// Version 19 adds aggregate retention audit and bounded owner/project trace quotas.
// Version 20 regenerates graph status and provenance checks from the ontology.
// Version 22 adds registered public OAuth clients, one-time authorization codes
// and browser consent requests for external MCP hosts.
// Version 24 adds workflow trigger delivery, the agent activity outbox, and
// recording-import activity correlation; observability version 3 owns agent runs.
// Existing databases must run the normal additive migration before verify.
// Version 25 adds persistent login protection, immutable Story/run snapshots,
// suite module membership and durable generation failure/stage contracts.
const REQUIRED_SCHEMA_VERSION = 25;
const MAIN_SCHEMA_CONTRACTS = [
  ['auth_login_protection','email'],['auth_login_protection','failure_count'],['auth_login_protection','locked_until'],['auth_login_protection','last_notice_at'],
  ['execution_case_snapshots','requirement_snapshots'],['test_suites','module_ids'],['test_suites','module_membership'],
  ['feedback','linked_execution_result_id'],['feedback','linked_step_id'],
  ['ai_requirement_generation_jobs','job_kind'],['ai_requirement_generation_jobs','error_code'],['ai_requirement_generation_jobs','failure_payload'],
  ['ai_test_case_generation_jobs','error_code'],['ai_test_case_generation_jobs','failure_payload'],['ai_test_case_generation_jobs','processing_payload']
].map(([table_name,column_name])=>({table_name,column_name}));
async function verifyMainContracts(db){
  const contracts=await db.prepare(`SELECT COUNT(*)::integer AS missing_columns
    FROM jsonb_to_recordset(?::jsonb) expected(table_name text,column_name text)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns actual WHERE actual.table_schema='public'
      AND actual.table_name=expected.table_name AND actual.column_name=expected.column_name)`).get(MAIN_SCHEMA_CONTRACTS);
  if(Number(contracts?.missing_columns)!==0)throw missing('main');
}
const requiredVersion = component => component === "main" ? REQUIRED_SCHEMA_VERSION : 3;
const missing = component => Object.assign(new Error(`The ${component} database needs migration. Run npm --prefix services/platform/backend run migrate before starting API profiles.`), { code: "SCHEMA_MIGRATION_REQUIRED", statusCode: 503 });
async function verifySchema(db, component) {
  const present = await db.prepare("SELECT to_regclass('public.runtime_schema_receipts') AS name").get();
  if (!present?.name) throw missing(component);
  const receipt = await db.prepare("SELECT version FROM runtime_schema_receipts WHERE component = ?").get(component);
  if (!Number.isInteger(Number(receipt?.version)) || Number(receipt?.version) < requiredVersion(component)) throw missing(component);
  if(component === 'main')await verifyMainContracts(db);
}
async function recordSchema(db, component) {
  if(component === 'main')await verifyMainContracts(db);
  await db.query(`CREATE TABLE IF NOT EXISTS runtime_schema_receipts (
    component TEXT PRIMARY KEY, version INTEGER NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.prepare(`INSERT INTO runtime_schema_receipts(component, version) VALUES (?, ?)
    ON CONFLICT(component) DO UPDATE SET version = GREATEST(runtime_schema_receipts.version, EXCLUDED.version), applied_at = CURRENT_TIMESTAMP`).run(component, requiredVersion(component));
}
const schemaMode = () => {
  const mode = process.env.HELLOTEST_SCHEMA_MODE || "migrate";
  if (!["migrate", "verify"].includes(mode)) throw new Error("HELLOTEST_SCHEMA_MODE must be migrate or verify");
  return mode;
};
module.exports = { verifySchema, recordSchema, schemaMode, REQUIRED_SCHEMA_VERSION, MAIN_SCHEMA_CONTRACTS };
