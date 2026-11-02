#!/usr/bin/env node
// Opt-in: spends real model tokens and adds review-only Runs in a local project.
// Native repository extraction and Chromium execution are never model fixtures.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { fixtureTestIdCheck } = require('./agent-source-semantics.cjs');
const root = path.resolve(__dirname, '../..');
if (process.env.LIVE_AI_AGENT_VERIFICATION !== '1') {
  console.error('Set LIVE_AI_AGENT_VERIFICATION=1 to authorize real local model calls and new review-only Runs.');
  process.exit(2);
}
const envFile = path.resolve(root, process.env.AGENT_VERIFY_ENV_FILE || '.hellotest/local.env');
const local = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
}));
for (const [key, value] of Object.entries(local)) if (!Object.hasOwn(process.env, key)) process.env[key] = value;
for (const key of ['DATABASE_URL', 'OBS_DATABASE_URL', 'REDIS_URL', 'QDRANT_URL']) if (process.env[key]) {
  const url = new URL(process.env[key]); if (['postgres', 'redis', 'qdrant'].includes(url.hostname)) url.hostname = '127.0.0.1'; process.env[key] = url.href;
}
Object.assign(process.env, { APP_MODE: 'local', STORAGE_PROVIDER: 'minio', MINIO_ENDPOINT: '127.0.0.1', HELLOTEST_SCHEMA_MODE: 'verify',
  HELLOTEST_MCP_INTERNAL_URL: '', HELLOTEST_MCP_PUBLIC_URL: '', ENABLE_OBSERVABILITY: 'false', OPS_MONITORING_ENABLED: 'false', LOG_LEVEL: 'error', KNOWLEDGE_VECTOR_STORE: 'postgresql',
  TESTENGINE_SHARED_SECRET: randomUUID() + randomUUID(), REPOSITORY_MODEL_REVIEW_BATCHES: '1' });
process.env.HELLOTEST_MCP_DATABASE_URL = process.env.DATABASE_URL;
const req = name => require(path.join(root, name));
const projectId = process.env.AGENT_VERIFY_PROJECT_ID || 'sample-project';
const modelId = process.env.AGENT_VERIFY_MODEL_ID || 'sample-v2-integration-llm';
const user = { id: process.env.AGENT_VERIFY_USER_ID || 'u1', role: 'admin' };
const suffix = randomUUID().slice(0, 8);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = path.join(root, '.hellotest/reports', `agent-intents-${stamp}`);
const reportPath = process.env.AGENT_VERIFY_REPORT_PATH || path.join(reportDir, 'repository-browser.json');
const selected = process.env.AGENT_VERIFY_KINDS ? new Set(process.env.AGENT_VERIFY_KINDS.split(',')) : null;
const report = { verified_at: new Date().toISOString(), provider_calls: 'actual configured provider', project_id: projectId,
  model_integration_id: modelId, source_runtime: 'checkout', no_artifacts_applied: true, repository: [], browser: [], cleanup: {}, limitations: [] };
const emit = (phase, values = {}) => console.log(JSON.stringify({ phase, ...values }));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let db, obs, repository, quality, integrationService, engineApp, runtime, targetServer, workDir, engineIntegrationId;
const tracked = [];
const save = () => { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); };
async function traces(sessionId) {
  const rows = await db.prepare('SELECT operation,status,error_code,http_status,requested_model,request_payload,usage FROM llm_request_traces WHERE session_id=? ORDER BY started_at').all(sessionId);
  return rows.map(row => { const findingBatches=(row.request_payload?.messages||[]).flatMap(message=>{
    try { const task=JSON.parse(message.content);return (task.bounded_workspace_context?.workflow_input||[]).flatMap(item=>JSON.parse(item.content).findings||[]); } catch { return []; }
  });return ({ operation: row.operation, status: row.status, error_code: row.error_code, http_status: row.http_status,
    model: row.requested_model, response_format: row.request_payload?.response_format?.type, usage: row.usage,
    has_task_goal: JSON.stringify(row.request_payload?.messages || []).includes('verification'),
    image_parts: (row.request_payload?.messages || []).flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url').length,
    repository_evidence:{finding_ids:findingBatches.map(item=>item.id),has_locator:findingBatches.some(item=>typeof item.locator==='string'),
      has_doc_content:findingBatches.some(item=>typeof item.content==='string'),has_request_parameters:findingBatches.some(item=>Array.isArray(item.parameters)),
      has_declared_responses:findingBatches.some(item=>Array.isArray(item.declared_responses)&&item.declared_responses.length>0),has_assertions:findingBatches.some(item=>Array.isArray(item.assertions)&&item.assertions.length>0)} });});
}
async function originalSnapshot() {
  const rows = await db.prepare('SELECT to_jsonb(r) AS record FROM requirements r WHERE id=?').all('7c072427-127f-4623-942f-3342e3b4b781');
  const cases = await db.prepare('SELECT to_jsonb(c) AS record FROM test_cases c WHERE id IN (?,?) ORDER BY id').all('f924c263-f363-4746-9589-41aa4a1b9334', 'c00b84d2-d269-428d-ac09-85b097e1ebc4');
  return digest({ rows, cases });
}
async function repositoryFixture() {
  const files = {
    'README.md': '# Verification catalog\n\nRead-only product catalog. GET /api/products/{id} returns product details. The ProductCard component renders a product name, price and a Details link. No checkout, payment or authentication behavior is implemented. Source declarations require runtime verification.\n',
    'src/ProductCard.tsx': 'export function ProductCard() {\n  return <section aria-label="Product card"><h2>Field notebook</h2><p data-testid="product-price">$42</p><a data-testid="product-details" href="/product">Product details</a></section>;\n}\n',
    'openapi.json': JSON.stringify({ openapi: '3.0.3', info: { title: 'Verification catalog', version: '1.0.0' }, servers: [{ url: 'https://catalog.example.test' }], paths: {
      '/api/products/{id}': { get: { operationId: 'getProduct', summary: 'Read a product', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }], responses: {
        200: { description: 'Product found', content: { 'application/json': { schema: { type: 'object', required: ['id', 'name', 'price'], properties: { id: { type: 'integer' }, name: { type: 'string' }, price: { type: 'number' } } } } } }, 404: { description: 'Product not found' } } } }
    } }, null, 2)
  };
  const archive = path.join(workDir, 'verification-source.zip');
  execFileSync('python3', ['-c', 'import json,sys,zipfile\nfiles=json.load(sys.stdin)\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:\n for name,content in files.items(): z.writestr(name,content)\n', archive], { input: JSON.stringify(files) });
  return { file: { filename: `verification-${suffix}.zip`, buffer: await fsp.readFile(archive) }, files };
}
async function runRepository() {
  const fixture = await repositoryFixture();
  const focus = {
    object_repository: 'Source verification: produce the complete object-by-object locator review for ProductCard in a table with source path/line, object name, locator intent, exact observed selector, stability risks and runtime validation steps. Cover the product price and Details selectors; keep the summary concise. Preserve declared selectors; do not infer runtime uniqueness.',
    api_tests: 'Source verification: review GET /api/products/{id} and draft positive 200 and declared 404 cases. Assert exactly the documented id, name and price response fields and minimum id constraint. The 404 body is undocumented; leave body assertions and boundary statuses as missing evidence. Do not invent description/message fields or maximum IDs. Keep all cases unexecuted and source cited.',
    repository_knowledge: 'Source verification: document only this exact source snapshot, never a typical product-card implementation. ProductCard declares the Field notebook heading, $42 price, and /product Details link. The API 200 schema declares required id, name, price fields; no restriction on additional fields and no 404 body schema is declared. Do not invent image, description, stock or availability fields. Cite exact source paths/lines and flag the explicitly unimplemented checkout/authentication behavior. Return complete documentation, with no implementation proposals outside this documentation task.',
    component_tests: 'Source verification: review ProductCard render contracts for the Field notebook title, $42 price and Product details link. Produce concrete source-cited setup/action/assertion drafts. Flag unobserved interaction behavior; no execution or framework claims.'
  };
  const findingKeys = req('services/agentic/backend/agents/catalog').FINDING_KEYS;
  for (const agent of req('services/agentic/backend/agents/catalog').AGENTS) {
    if (selected && !selected.has(agent.id)) continue;
    const entry = { agent_id: agent.id, intent: agent.description, goal: focus[agent.id], input_files: Object.keys(fixture.files), started_at:new Date().toISOString(), checks: {} };
    report.repository.push(entry); save(); emit('repository_start', { agent_id: agent.id });
    try {
      const run = await repository.createRun({ project_id: projectId, app_type_id: 'sample-app-web', agent_type: agent.id, goal: focus[agent.id], llm_integration_id: modelId, context_scopes: [],
        ai_configuration: { temperature: 0, max_output_tokens: 5000, context: { mode: 'none', token_budget: 1200, max_items: 4, required: false, focus: '' }, agent_execution: { max_model_calls: 3, max_revision_rounds: 1, max_followups: 0, timeout_ms: 150000 } } }, user, { file: fixture.file, requestKey: `live-intent:${suffix}:${agent.id}` });
      entry.run_id = run.id; tracked.push({ type: 'repository', id: run.id });
      let done; const deadline = Date.now() + 190000;
      do { done = await repository.getRun(run.id, user); if (!['queued', 'running'].includes(done.status)) break; await repository.processQueuedRuns(); await pause(250); } while (Date.now() < deadline);
      entry.status = done.status; entry.error = done.error; entry.summary = done.summary; entry.warnings = done.warnings;
      entry.source_worker_compiler_version=(await db.prepare('SELECT compiler_version FROM repository_agent_runs WHERE id=?').get(run.id)).compiler_version;
      entry.checkout_compiler_version=await req('services/agentic/backend/agents/compiler').compilerVersion();
      entry.source_worker_matches_checkout=entry.source_worker_compiler_version===entry.checkout_compiler_version;
      assert.ok(['completed', 'partial'].includes(done.status), done.error || `Repository run ${done.status}`);
      const findings = done.result.findings[findingKeys[agent.id]];
      entry.findings = findings; entry.model_reviews = done.result.llm_reviews; entry.model_calls = (await Promise.all(done.result.llm_reviews.map(review => traces(review.session_id)))).flat();
      entry.checks = { source_evidence: findings.length > 0 && findings.every(finding => finding.review_required && finding.evidence.every(evidence => Object.hasOwn(fixture.files, evidence.path) && evidence.line > 0)),
        actual_model_call: entry.model_calls.some(call => call.http_status === 200 && call.model === report.model), native_static_analysis: done.summary.analysis_mode === 'deterministic_static',
        runtime_not_claimed: done.summary.runtime_verified === false, every_finding_model_reviewed: done.summary.model_reviewed_findings === findings.length,
        review_only: done.published == null || Object.keys(done.published).length === 0 || Array.isArray(done.published.items) && done.published.items.length === 0 };
      if(agent.id==='api_tests') {
        const response=findings[0].declared_responses||[];
        entry.checks.response_schema_retained=response.some(item=>item.status===200&&item.content.some(media=>media.schema?.required?.join(',')==='id,name,price'));
        entry.checks.undocumented_404_body_retained=response.some(item=>item.status===404&&item.body_schema_declared===false);
        const drafts=entry.model_reviews.flatMap(review=>review.artifacts||[]).filter(artifact=>artifact.kind==='test_case');
        const positive=drafts.find(artifact=>artifact.steps?.some(step=>/200/.test(step.expected_result)));
        const expected=positive?.steps?.map(step=>step.expected_result).join('\n')||'';
        entry.checks.native_draft_response_oracle=Boolean(positive)&&/id/i.test(expected)&&/integer/i.test(expected)&&/name/i.test(expected)&&/string/i.test(expected)&&/price/i.test(expected)&&/number|numeric/i.test(expected);
        const caseInput=JSON.stringify({parameters:positive?.parameter_values,prerequisites:positive?.prerequisites,test_data:positive?.test_data,steps:positive?.steps});
        entry.checks.native_draft_input_constraint=Boolean(positive)&&(/minimum.*1|at least 1|>=\s*1|greater.*0/i.test(caseInput)||Object.values(positive.parameter_values||{}).some(value=>value==='1'));
        const unresolved=entry.model_reviews.flatMap(review=>review.findings||[]).filter(finding=>/missing|undocumented|absen/i.test(finding.title+' '+finding.detail)&&/404|response.*body|schema/i.test(finding.title+' '+finding.detail));
        entry.checks.missing_source_contract_not_claimed_resolved=drafts.every(artifact=>(artifact.addressed_finding_ids||[]).every(id=>!unresolved.some(finding=>finding.id===id)));
        entry.checks.provider_received_response_schema=entry.model_calls.some(call=>call.repository_evidence.has_declared_responses);
      }
      if(agent.id==='object_repository') {
        const tables=entry.model_reviews.flatMap(review=>review.tables||[]);
        const cells=[...tables.flatMap(table=>table.rows).flat(),...entry.model_reviews.map(review=>review.response)].join('\n');
        entry.checks.locator_outcome_covers_source=cells.includes('product-price')&&cells.includes('product-details')&&cells.includes('src/ProductCard.tsx');
        entry.checks.provider_received_exact_locators=entry.model_calls.some(call=>call.repository_evidence.has_locator);
      }
      if(agent.id==='repository_knowledge') {
        const text=entry.model_reviews.map(review=>review.response).join('\n');
        entry.checks.documented_exact_component=/Field notebook/.test(text)&&text.includes('$42')&&text.includes('/product');
        entry.checks.documents_source_boundaries=/checkout/i.test(text)&&/authentication/i.test(text)&&/unimplemented|not implemented|not present/i.test(text);
        entry.checks.source_references=text.includes('src/ProductCard.tsx')&&text.includes('openapi.json');
        entry.checks.provider_received_document_content=entry.model_calls.some(call=>call.repository_evidence.has_doc_content);
        entry.semantic_review={status:'requires_human_review',criteria:'Known fixture facts and source references checked; source attribution does not prove every prose claim.'};
      }
      if(agent.id==='component_tests') {
        const text=entry.model_reviews.map(review=>review.response).join('\n');
        entry.checks.component_test_outcome=/Field notebook/.test(text)&&text.includes('$42')&&text.includes('product-details')&&/assert|expect|verif/i.test(text);
        entry.checks.provider_received_component_assertions=entry.model_calls.some(call=>call.repository_evidence.has_assertions);
        entry.selector_evidence=fixtureTestIdCheck(fixture.files,entry.model_reviews);
        entry.checks.model_selectors_source_backed=entry.selector_evidence.valid;
        if(!entry.selector_evidence.valid) {
          entry.semantic_issues=[...(entry.semantic_issues||[]),{code:'UNDECLARED_FIXTURE_TEST_ID',message:entry.selector_evidence.message}];
          assert.equal(entry.selector_evidence.valid,true,entry.selector_evidence.message);
        }
      }
      for (const [check, passed] of Object.entries(entry.checks)) assert.equal(passed, true, `${agent.id}: ${check}`);
      entry.validation = 'passed';
    } catch (error) {
      entry.validation = 'failed'; entry.failure = { code: error.code, message: error.publicMessage || error.message };
      const failed=await db.prepare('SELECT DISTINCT session_id FROM llm_request_traces WHERE started_at>=? AND operation=?').all(entry.started_at,'agentic-assistant.respond');
      entry.failed_model_calls=[];
      for(const row of failed){const calls=await traces(row.session_id);entry.failed_model_calls.push(...calls.filter(call=>call.repository_evidence.finding_ids.length));}
    }
    save(); emit('repository_done', { agent_id: agent.id, run_id: entry.run_id, status: entry.status, validation: entry.validation, checks: entry.checks, failure: entry.failure });
  }
}
async function startBrowserEngine() {
  const { QualityAgentRuntime } = await import(pathToFileURL(path.join(root, 'testengine/backend/dist/lib/qualityAgents/runtime.js')));
  const { registerQualityAgentRoutes } = await import(pathToFileURL(path.join(root, 'testengine/backend/dist/lib/qualityAgents/routes.js')));
  const security = await import(pathToFileURL(path.join(root, 'testengine/backend/dist/lib/testEngineSecurity.js')));
  runtime = await new QualityAgentRuntime({ directory: path.join(reportDir, 'browser-engine'), executablePath: process.env.CHROME_EXECUTABLE,
    environment: { ...process.env, QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS: '127.0.0.1' } }).initialize();
  assert.equal(runtime.capabilities().available, true, 'Install the repository Chromium runtime before live verification.');
  engineApp = req('testengine/backend/node_modules/fastify')({ logger: false });
  await registerQualityAgentRoutes(engineApp, security.createPrivilegedRunGuard(security.resolveTestEngineSharedSecret(process.env)), runtime);
  await engineApp.listen({ port: 0, host: '127.0.0.1' });
  const created = await integrationService.createIntegration({ type: 'testengine', name: `Live intent verification ${suffix}`, base_url: `http://127.0.0.1:${engineApp.server.address().port}`, is_active: true, config: { project_id: projectId, headless: true } });
  engineIntegrationId = created.id;
  targetServer = http.createServer((request, response) => {
    const product = request.url.startsWith('/product');
    const html = `<!doctype html><html lang="en"><head><title>Verification catalog</title><style>body{font:18px Arial;background:white;color:#111;margin:24px}button{min-width:30px;min-height:24px}</style></head><body><main><h1>${product ? 'Field notebook' : 'Verification catalog'}</h1>${product ? '<p data-testid="product-price">Price: $42</p><p>Product ID: 1</p>' : '<a href="/product">Product details</a>'}<img src="data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\"%3E%3Crect width=\"20\" height=\"20\" fill=\"blue\"/%3E%3C/svg%3E"><button id="unlabelled"></button></main></body></html>`;
    response.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(html), 'x-content-type-options': 'nosniff' }); response.end(html);
  });
  await new Promise(resolve => targetServer.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${targetServer.address().port}/`;
}
async function runBrowser() {
  const agents=req('services/agentic/backend/services/qualityAgentContracts').AGENTS.filter(agent=>!selected||selected.has(agent.id)||selected.has(`browser-${agent.id}`));
  if(!agents.length)return;
  const target = await startBrowserEngine();
  const goals = {
    web: 'Live verification: open Product details and report the Field notebook product name, exact visible price and product ID in a structured outcome with observed quotes. Stay on this origin; complete once those facts are observed.',
    security: 'Live verification: passively assess security headers and transport policy for this current catalog page only. The target page is ready for the security scanner; complete the navigation mission now without clicking. Report measured scanner findings and recommendations separately; no penetration-test claims.',
    performance: 'Live verification: measure the current catalog page against navigation_ms 5000 and resource_count 20 budgets. The page is ready for measurement; complete the navigation mission now without clicking. Report single-navigation metrics and limitations; do not claim load-test results.',
    accessibility: 'Live verification: run automated accessibility checks on the current catalog page and report exact observed rule violations and selectors. The page is ready for axe-core; complete the navigation mission now without clicking. Do not certify WCAG conformance.',
    visual: 'Live verification: capture this current catalog page at the reviewed viewport for a first visual review. Complete the navigation mission now without clicking. No baseline has been approved: report needs-review, never a visual-regression pass.'
  };
  for (const agent of agents) {
    const entry = { agent_id: `browser-${agent.id}`, intent: agent.description, goal: goals[agent.id], target_url: target, checks: {} };
    report.browser.push(entry); save(); emit('browser_start', { agent_id: entry.agent_id });
    try {
      const started = await quality.createRun({ project_id: projectId, app_type_id: 'sample-app-web', integration_id: engineIntegrationId, llm_integration_id: modelId,
        execution_mode: 'agent', kind: agent.id, target_url: target, goal: goals[agent.id], context_scopes: [],
        ai_configuration: { temperature: 0, max_output_tokens: 4096, context: { mode: 'none', token_budget: 1200, max_items: 4, required: false, focus: '' }, agent_execution: { max_model_calls: 6, max_revision_rounds: 1, max_followups: 0, timeout_ms: 150000 } },
        options: { timeout_ms: 120000, max_pages: 2, viewport: { width: 640, height: 480 }, mission: { max_actions: 4, allow_form_submission: false }, ...(agent.id === 'performance' ? { budgets: { navigation_ms: 5000, resource_count: 20 } } : {}) }
      }, user, { requestKey: `live-intent:${suffix}:${agent.id}` });
      entry.run_id = started.id; entry.transaction_id = started.transaction_id; tracked.push({ type: 'browser', id: started.id });
      let done; const deadline = Date.now() + 165000;
      do { await quality.processQueuedRuns(); done = await quality.getRun(started.id, user); if (['completed', 'failed', 'cancelled'].includes(done.status)) break; await pause(1000); } while (Date.now() < deadline);
      entry.status = done.status; entry.error = done.error; entry.outcome = done.outcome; entry.task_brief = done.task_brief; entry.mission_outcome = done.mission_outcome;
      entry.mission_report = done.mission_report; entry.metrics = done.metrics; entry.findings = done.findings; entry.limitations = done.limitations;
      entry.assessment = done.agent_assessment; entry.model_usage = done.model_usage; entry.artifacts = done.artifacts;
      entry.model_calls = await traces(started.transaction_id);
      assert.equal(done.status, 'completed', JSON.stringify(done.error));
      const calls = entry.model_calls.filter(call => call.http_status === 200 && call.model === report.model);
      entry.checks = { actual_model_decision_and_assessment: calls.length >= 2, exact_goal_retained: done.task_brief.goal === entry.goal,
        structured_outcome: Boolean(done.mission_outcome?.title && done.mission_outcome?.summary), observed_browser_receipts: done.mission_report?.actions?.length > 0,
        native_assessment_contract: done.agent_assessment?.generation_mode === 'llm' && done.agent_assessment.review_required === true,
        evidence_ids_validated: done.agent_assessment?.observations.every(observation => done.findings.some(finding => finding.id === observation.finding_id)),
        artifact_integrity: true };
      for (const artifact of done.artifacts) {
        const result = await quality.getArtifact(done.id, artifact.id, user);
        assert.equal(createHash('sha256').update(result.bytes).digest('hex'), artifact.sha256);
      }
      if (agent.id === 'web') entry.checks.product_facts = /42/.test(JSON.stringify(done.mission_outcome)) && /Field notebook/i.test(JSON.stringify(done.mission_outcome));
      if (agent.id === 'security') entry.checks.passive_findings = done.findings.some(finding => finding.category==='security_posture'&&/^security-/.test(finding.id));
      if (agent.id === 'performance') entry.checks.actual_navigation_metrics = typeof done.metrics.navigation_wall_ms === 'number' && typeof done.metrics.transfer_bytes === 'number';
      if (agent.id === 'accessibility') entry.checks.actual_axe_findings = done.metrics.check_engine === 'axe_core' && done.findings.some(finding => /alt|name|label/i.test(finding.title));
      if (agent.id === 'visual') {
        entry.checks.first_capture_needs_review = done.outcome === 'needs_review' && done.agent_assessment.conclusion === 'needs_review';
        entry.checks.actual_screenshot_model_input = done.agent_assessment.visual_evidence?.image_input_prepared === true && calls.some(call => call.image_parts > 0);
      }
      for (const [check, passed] of Object.entries(entry.checks)) assert.equal(passed, true, `${agent.id}: ${check}`);
      entry.validation = 'passed';
    } catch (error) { entry.validation = 'failed'; entry.failure = { code: error.code, message: error.publicMessage || error.message }; }
    save(); emit('browser_done', { agent_id: entry.agent_id, run_id: entry.run_id, status: entry.status, validation: entry.validation, model_calls: entry.model_calls?.length, checks: entry.checks, failure: entry.failure });
  }
}
(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qaira-live-intents-')); fs.mkdirSync(reportDir, { recursive: true });
  db = req('services/platform/backend/src/db'); obs = req('services/platform/backend/src/obsDb');
  await req('services/platform/backend/src/db/schemaReadiness').verifySchema(db, 'main');
  assert.equal((await db.prepare('SELECT status FROM users WHERE id=?').get(user.id))?.status, 'active');
  const configured = await db.prepare('SELECT model,is_active FROM integrations WHERE id=?').get(modelId); assert.equal(configured?.is_active, true); report.model = configured.model;
  report.original_records_before = await originalSnapshot();
  repository = req('services/agentic/backend/agents/repositoryAgents.service'); quality = req('services/agentic/backend/services/qualityAgents.service'); integrationService = req('services/integration/backend/services/integration.service');
  await runRepository(); await runBrowser();
  report.original_records_after = await originalSnapshot(); assert.equal(report.original_records_after, report.original_records_before);
  report.original_records_unchanged = true;
  const all = [...report.repository, ...report.browser]; report.tested_agents = all.length; report.passed_agents = all.filter(entry => entry.validation === 'passed').length;
  report.model_calls = all.reduce((total, entry) => total + (entry.model_calls?.length || 0), 0); report.status = all.every(entry => entry.validation === 'passed') ? 'passed' : 'failed';
  if (report.status !== 'passed') process.exitCode = 1;
})().catch(error => { report.status = 'failed'; report.failure = { code: error.code, message: error.publicMessage || error.message }; process.exitCode = 1; emit('failure', report.failure); }).finally(async () => {
  for (const run of tracked) try {
    const service = run.type === 'repository' ? repository : quality; const current = await service.getRun(run.id, user);
    if (['queued', 'running'].includes(current.status)) await service.cancelRun(run.id, user);
  } catch { /* Preserve diagnostics if the actor lost access. */ }
  await repository?.shutdown(); await quality?.shutdown();
  try { if (engineIntegrationId) { await integrationService.deleteIntegration(engineIntegrationId); report.cleanup.temporary_engine_connection_deleted = true; } } catch (error) { report.cleanup.engine_connection_error = error.message; }
  await engineApp?.close(); await runtime?.close();
  if (targetServer) { targetServer.closeAllConnections(); await new Promise(resolve => targetServer.close(resolve)); }
  if (workDir) await fsp.rm(workDir, { recursive: true, force: true });
  report.cleanup.native_runs_and_review_outputs_retained = true; report.cleanup.no_baseline_approved = true; save();
  await Promise.allSettled([db?.close(), obs?.close()]); emit('report', { path: reportPath, status: report.status, tested_agents: report.tested_agents, passed_agents: report.passed_agents, model_calls: report.model_calls });
});
