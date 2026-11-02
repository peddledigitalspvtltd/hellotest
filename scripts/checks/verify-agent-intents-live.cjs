#!/usr/bin/env node
// Explicitly opt-in integration verification. Uses native specialist execution,
// real configured providers and NEW synthetic records; never accepts proposals.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const root = path.resolve(__dirname, '../..');
const req = name => require(path.join(root, name));
if (process.env.HELLOTEST_LIVE_LLM !== '1') {
  console.error('Set HELLOTEST_LIVE_LLM=1 to authorize actual billable model calls and new retained synthetic verification records.');
  process.exit(2);
}
const envPath = process.env.HELLOTEST_LIVE_ENV || path.join(root, '.hellotest/local.env');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/); if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
}
for (const key of ['DATABASE_URL', 'OBS_DATABASE_URL', 'REDIS_URL', 'QDRANT_URL']) if (process.env[key]) {
  const url = new URL(process.env[key]); if (['postgres', 'redis', 'qdrant'].includes(url.hostname)) url.hostname = '127.0.0.1'; process.env[key] = url.href;
}
Object.assign(process.env, { APP_MODE: 'local', STORAGE_PROVIDER: 'local', HELLOTEST_MCP_INTERNAL_URL: '', HELLOTEST_MCP_PUBLIC_URL: '', HELLOTEST_SCHEMA_MODE: 'verify', ENABLE_OBSERVABILITY: 'false', OPS_MONITORING_ENABLED: 'false', LOG_LEVEL: 'error', KNOWLEDGE_VECTOR_STORE: 'postgresql' });
process.env.HELLOTEST_MCP_DATABASE_URL = process.env.DATABASE_URL;
const user = { id: process.env.HELLOTEST_LIVE_ACTOR || 'u1', role: 'admin' };
const projectId = process.env.HELLOTEST_LIVE_PROJECT || 'sample-project';
const integrationId = process.env.HELLOTEST_LIVE_INTEGRATION || 'sample-v2-integration-llm';
const appTypeId = process.env.HELLOTEST_LIVE_APPLICATION || 'sample-app-web';
const reportPath = path.resolve(process.env.HELLOTEST_LIVE_REPORT || path.join(root, '.hellotest/reports/agent-intents-live-' + new Date().toISOString().slice(0, 10) + '.json'));
const outputDir = reportPath.replace(/\.json$/, '-outcomes');
fs.mkdirSync(outputDir, { recursive: true });
const profiles = req('services/agentic/shared/workflowSpecialists.json');
let report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { schema: 'agent-intents-live/1', verified_at: new Date().toISOString(), project_id: projectId, application_id: appTypeId, agent_count: Object.keys(profiles).length, results: [], limitations: ['Provider calls are real. Product inputs and saved pass/fail histories are explicitly synthetic fixtures, not claims about an actual application execution.', 'Contract and citation validation cannot prove factual entailment or business correctness.', 'Generated proposals are retained for inspection and are never accepted or applied by this runner.'] };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const emit = (phase, data = {}) => console.log(JSON.stringify({ phase, ...data }));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const db = req('services/platform/backend/src/db');
const obs = req('services/platform/backend/src/obsDb');
let app;
function intentValidation(result) {
  const issues = req('services/agentic/backend/services/agentArtifacts').outcomeIssues(result, result.outcome_contract);
  const reported = result.outcome_issues || [];
  const explicitlyUnresolved = result.verification?.status === 'needs_input' && result.readiness?.status === 'insufficient_evidence'
    && issues.every(issue => ['AGENT_OUTCOME_FINDING_UNRESOLVED', 'AGENT_OUTCOME_PROPOSAL_REQUIRED'].includes(issue.code)
      && reported.some(saved => saved.code === issue.code && saved.kind === issue.kind));
  return { complete: !issues.length, issues, completion_state_truthful: !issues.length || explicitlyUnresolved };
}
async function finalizeReport(f) {
  const all = report.results.flatMap(record => [...(record.previous_attempts || []), record]);
  const sessions = [...new Set(all.map(record => record.transaction_id).filter(Boolean))];
  const traces = sessions.length ? await db.prepare(`SELECT id,session_id,status,http_status,capture->>'request_stage' AS request_stage FROM llm_request_traces WHERE project_id=? AND session_id IN (${sessions.map(() => '?').join(',')})`).all(projectId, ...sessions) : [];
  const byId = new Map(traces.map(trace => [trace.id, trace]));
  for (const record of all) for (const trace of record.model_calls || []) if (byId.has(trace.id)) trace.request_stage = byId.get(trace.id).request_stage;
  for (const record of report.results) {
    record.native_validation = { status: record.status, meaning: 'Native shape, citation identity, artifact references, persistence, current access and truthful completion state; not semantic correctness.' };
    const findings = [];
    if (record.outcome_path) {
      const outcome = JSON.parse(fs.readFileSync(record.outcome_path, 'utf8'));
      for (const artifact of outcome.result.artifacts || []) {
        if (artifact.kind === 'story' && (artifact.acceptance_criteria || []).some(clause => /\b\d+(?:\.\d+)?\s*(?:milliseconds?|seconds?|minutes?|ms)\b/i.test(clause))) findings.push({ code: 'UNSUPPORTED_PRODUCT_TIMING', detail: 'A proposed Story criterion introduces a numeric timing threshold absent from this synthetic source contract. The proposal must not be accepted as established policy.' });
        const steps = artifact.steps || [];
        const duplicate = steps.findIndex(step => /\b(?:again|duplicate|repeated)\b/i.test(step.action || '') && /pending|reservation/i.test(step.action || ''));
        const terminal = steps.findIndex(step => /(?:stock|remaining).{0,35}\b2\b/i.test(step.expected_result || '') && /Reserved/i.test(step.expected_result || ''));
        if (duplicate >= 0 && terminal >= 0 && terminal < duplicate) findings.push({ code: 'PENDING_TEMPORAL_ORACLE_ORDER', detail: 'The draft asserts the terminal reservation outcome before issuing the pending duplicate click. This does not exercise the intended pending window.' });
      }
      if ((outcome.result.findings || []).some(item => /(?:lack|missing|absence|no)\b.{0,35}test cases?.{0,50}\breset\b|do not cover.{0,80}\breset\b/i.test([item.detail, item.gap].join(' ')))) findings.push({ code: 'EXISTING_RESET_INTENT_OVERLOOKED', detail: `The fixture already contains Gherkin reset case ${f.gherkin_test_case_id}. Claims that reset Test Cases are absent require correction or narrower wording about reviewed assertion coverage.` });
      if (record.agent_id === 'story-completion' && /accurately represented and tested/i.test(outcome.result.response || '')) findings.push({ code: 'DRAFT_EXECUTION_WORDING', detail: 'The conclusion says the feature is represented and tested. Drafting a Story and reading synthetic histories do not verify actual product execution.' });
      if (record.agent_id === 'test-designer') {
        const candidate = outcome.result.artifacts.find(item => item.kind === 'test_case' && /duplicate|pending/i.test(item.title));
        const steps = candidate?.steps || [], duplicate = steps.findIndex(step => /again|duplicate|repeated/i.test(step.action));
        const terminal = steps.findIndex(step => /(?:stock|remaining).{0,35}\b2\b/i.test(step.expected_result) && /Reserved/i.test(step.expected_result));
        record.fixture_checks = { duplicate_precedes_terminal_oracle: duplicate >= 0 && terminal > duplicate, pending_control_explicitly_unavailable: /pending/i.test(JSON.stringify(candidate?.prerequisites || [])) && /pending/i.test(JSON.stringify(outcome.result.evidence_gaps || [])), product_execution_claimed: false };
      }
      record.semantic_review = { status: findings.length ? 'needs_review' : 'human_review_required', findings, scope: 'Fixture checks detect specific contradictions only; they do not prove factual entailment, complete temporal correctness or business correctness.' };
      outcome.validation = { native: record.native_validation, intent: record.intent_validation, semantic_review: record.semantic_review, fixture_checks: record.fixture_checks };
      fs.writeFileSync(record.outcome_path, JSON.stringify(outcome, null, 2));
    } else record.semantic_review = { status: 'not_assessable', findings: [{ code: 'NO_ACCEPTED_NATIVE_OUTCOME', detail: 'The provider response was rejected by the native contract. Retained attempts are diagnostic data, not a usable outcome.' }] };
  }
  report.completed_at = new Date().toISOString();
  report.summary = { total: report.agent_count, tested: report.results.length, validated: report.results.filter(item => item.status === 'validated').length, needs_evidence: report.results.filter(item => item.status === 'validated_needs_evidence').length, failed: report.results.filter(item => item.status === 'failed').length,
    agents_with_successful_provider_response: report.results.filter(item => item.model_calls?.some(call => call.http_status === 200)).length,
    recorded_provider_dispatches_all_attempts: traces.filter(trace => trace.request_stage === 'provider_dispatch').length,
    successful_provider_responses_all_attempts: traces.filter(trace => trace.http_status === 200).length,
    semantic_needs_review: report.results.filter(item => item.semantic_review.status === 'needs_review').length,
    general_semantic_correctness_verified: false };
  save(); return report.summary;
}
async function captureFailedAttempt(record) {
  const transaction = record.transaction_id ? { id: record.transaction_id } : await db.prepare("SELECT id FROM workspace_transactions WHERE project_id=? AND metadata->>'agent_id'=? AND created_at>=? ORDER BY created_at LIMIT 1").get(projectId, record.agent_id, record.started_at);
  if (!transaction) return;
  record.transaction_id = transaction.id;
  const traces = await db.prepare('SELECT id,operation,status,http_status,error_code,requested_model,usage,response_payload FROM llm_request_traces WHERE session_id=? ORDER BY started_at').all(transaction.id);
  record.model_calls = traces.map(({ response_payload, ...trace }) => trace);
  const attempts = traces.map(({ response_payload, ...trace }) => { let candidate; try { candidate = JSON.parse(response_payload?.choices?.[0]?.message?.content || 'null'); } catch { candidate = { invalid_json: true }; } return { trace, candidate }; });
  if (!record.outcome_path && attempts.length) { record.attempts_path = path.join(outputDir, record.agent_id + '-failed-attempts.json'); fs.writeFileSync(record.attempts_path, JSON.stringify({ input: record.input, error: record.error, attempts }, null, 2)); }
}
async function revalidateStoredReceipts() {
  for (const record of report.results) {
    if (record.status !== 'failed') continue;
    await captureFailedAttempt(record);
    // PostgreSQL JSONB reorders object keys. Compare the complete structured
    // proposal semantically; serialized key order is not missing content.
    if (!record.outcome_path || !record.checks) continue;
    const outcome = JSON.parse(fs.readFileSync(record.outcome_path, 'utf8'));
    record.intent_validation = intentValidation(outcome.result);
    delete record.checks.intent_contract_satisfied_or_explicitly_blocked;
    record.checks.intent_completion_state_reported = record.intent_validation.completion_state_truthful;
    if (Object.entries(record.checks).some(([key, value]) => key !== 'complete_artifacts_persisted' && !value)) continue;
    const persisted = (await db.prepare('SELECT metadata FROM workspace_transactions WHERE id=?').get(record.transaction_id))?.metadata?.result;
    if (isDeepStrictEqual(persisted?.artifacts, outcome.result.artifacts)) {
      record.verifier_correction = 'Native stored outcome and complete artifacts confirmed by deep structured equality. Explicit needs_input outcomes retain unresolved requirements and are distinguished from malformed outputs.';
      record.previous_verifier_error = record.error; delete record.error;
      record.checks.complete_artifacts_persisted = true;
      record.status = record.verification?.status === 'passed' ? 'validated' : 'validated_needs_evidence';
    }
  }
  save();
}
async function fixture() {
  if (report.fixture) return report.fixture;
  const suffix = crypto.randomUUID().slice(0, 8);
  const description = 'SYNTHETIC ARCHITECTURE VERIFICATION FIXTURE, not a production incident. As a warehouse clerk I reserve exactly one item from a fresh isolated stock fixture. The initial quantity is 3. Clicking Reserve once changes the visible remaining stock to 2 and shows Reserved. There is no authentication, payment, network dependency or external data. Reset restores 3. Duplicate clicks while the operation is pending must be ignored; no policy beyond these boundaries is known. The UI contract names #reserve-item, #remaining, #status and #reset-stock. A historical selector #reserve-old is absent. This description is a supplied fixture specification, not an independently observed current DOM.';
  const story = await req('services/manual/backend/services/requirement.service').createRequirement({ project_id: projectId, title: 'Synthetic: reserve one warehouse item ' + suffix, description, acceptance_criteria: ['Given fresh stock 3, when Reserve is clicked once, remaining stock is exactly 2 and status is Reserved.', 'While the first reservation is pending, repeated clicks do not reserve another item.', 'Reset restores stock to exactly 3 without external dependencies.'], created_by: user.id });
  const release = await req('services/manual/backend/services/requirementRelease.service').createRelease({ project_id: projectId, name: 'Synthetic agent intent verification ' + suffix, fix_version: 'synthetic-agent-' + suffix, description: 'Retained synthetic model-intent verification cohort; not a real release.', requirement_ids: [story.id], state: 'planned', created_by: user.id });
  const common = { app_type_id: appTypeId, requirement_ids: [story.id], created_by: user.id, automated: 'no', priority: 'P2', test_case_type: 'functional', status: 'draft', parameter_values: { 't.initialStock': '3' }, labels: ['synthetic-agent-intent-verification'] };
  const structured = await req('services/testing/backend/services/testCase.service').createTestCase({ ...common, title: 'Synthetic: single reservation exact quantity ' + suffix, description: 'Synthetic fixture. Check one successful reservation. Duplicate pending clicks and reset are intentionally not covered by this case.', authoring_mode: 'structured', steps: [{ action: 'Reset the isolated fixture to initial stock @t.initialStock.', expected_result: 'Remaining stock is exactly 3.', step_type: 'web' }, { action: 'Click Reserve once.', expected_result: 'Remaining stock is exactly 2 and status is Reserved.', step_type: 'web' }] });
  const gherkin = await req('services/testing/backend/services/testCase.service').createTestCase({ ...common, title: 'Synthetic: reset after reservation ' + suffix, description: 'Synthetic complete Gherkin reset scenario.', authoring_mode: 'gherkin', steps: [], gherkin_document: 'Feature: Reset warehouse stock\nScenario: Reset after one reservation\n Given isolated stock is 3\n When I reserve exactly one item\n Then remaining stock is 2\n When I reset stock\n Then remaining stock is 3' });
  const automation = await req('services/testing/backend/services/testCase.service').createTestCase({ ...common, title: 'Synthetic: historical reservation selector ' + suffix, description: 'Synthetic authored web program with deliberately stale selector. No real browser execution is claimed.', automated: 'yes', automation_start_url: 'http://127.0.0.1:8080/synthetic-stock-fixture', automation_case_type: 'web', manual_test_case_ids: [structured.id], authoring_mode: 'structured', parameter_values: {}, steps: [{ action: 'Reserve one item in the fresh fixture.', expected_result: '', step_type: 'web', automation_code: 'await web.click("#reserve-old");' }, { action: 'Check remaining stock and confirmation.', expected_result: 'Remaining stock is exactly 2 and status is Reserved.', step_type: 'web', automation_code: 'await web.expectText("#remaining", "2");\nawait web.expectText("#status", "Reserved");' }] });
  const runs = [];
  // Native services create genuine frozen snapshots. Results are explicitly
  // synthetic recorded observations, never a claim of Test Engine execution.
  for (const [index, status] of ['failed', 'passed', 'failed', 'passed'].entries()) {
    const run = await req('services/testing/backend/services/execution.service').createExecution({ project_id: projectId, app_type_id: appTypeId, test_case_ids: [structured.id], test_environment_id: 'sample-v2-env-staging', test_configuration_id: 'sample-v2-config-chrome', build: 'synthetic-stock-build-1', release_id: release.id, created_by: user.id, execution_mode: 'manual', name: `Synthetic recorded ${status} observation ${index + 1} ${suffix}` });
    await req('services/testing/backend/services/execution.service').startExecution(run.id, { initiated_by: user.id, skip_testengine_dispatch: true });
    const steps = await db.prepare('SELECT snapshot_step_id,step_order FROM execution_step_snapshots WHERE execution_id=? AND test_case_id=? ORDER BY step_order').all(run.id, structured.id);
    const notes = Object.fromEntries(steps.map(step => [step.snapshot_step_id, step.step_order === 1 ? 'SYNTHETIC fixture observation: initial stock exactly 3.' : status === 'failed' ? 'SYNTHETIC product-failure observation: clicking once recorded remaining stock 1 instead of expected 2; status Reserved.' : 'SYNTHETIC passing observation: clicking once recorded remaining stock 2; status Reserved.']));
    await req('services/testing/backend/services/executionResult.service').createExecutionResult({ execution_id: run.id, test_case_id: structured.id, app_type_id: appTypeId, status, duration_ms: 1000, error: status === 'failed' ? 'SYNTHETIC recorded mismatch: expected remaining 2; actual 1 after one click. Root cause unknown.' : null, logs: JSON.stringify({ verification_fixture: true, stepStatuses: Object.fromEntries(steps.map(step => [step.snapshot_step_id, step.step_order === 1 ? 'passed' : status])), stepNotes: notes }), executed_by: user.id });
    await req('services/testing/backend/services/execution.service').completeExecution(run.id, status === 'passed' ? 'completed' : 'failed', { completed_by: user.id });
    runs.push({ id: run.id, status });
  }
  const defect = await req('services/testing/backend/services/issues.service').createIssue({ project_id: projectId, user_id: user.id, title: 'Synthetic: one reservation removes two items ' + suffix, message: 'SYNTHETIC MODEL-INTENT FIXTURE. The recorded manual observation shows stock 1 instead of 2 after one click; production behavior has not been tested. Root cause unknown. Later synthetic passes do not erase the recorded failure.', steps_to_reproduce: 'Reset isolated stock to 3. Click Reserve exactly once. Read remaining stock.', expected_result: 'Remaining stock exactly 2 and status Reserved.', actual_result: 'Synthetic failed observation records remaining stock 1 and status Reserved.', severity: 'high', priority: 'P2', build: 'synthetic-stock-build-1', environment: 'Staging', linked_test_run_id: runs[0].id, linked_test_case_ids: [structured.id], linked_requirement_ids: [story.id], labels: ['synthetic-agent-intent-verification'] });
  report.fixture = { suffix, story_id: story.id, release_id: release.id, test_case_id: structured.id, gherkin_test_case_id: gherkin.id, automation_case_id: automation.id, defect_id: defect.id, runs, build: 'synthetic-stock-build-1', environment_id: 'sample-v2-env-staging', description };
  save(); return report.fixture;
}
async function nativeHash(f) {
  const records = [];
  for (const [table, ids] of [['requirements', [f.story_id]], ['test_cases', [f.test_case_id, f.gherkin_test_case_id, f.automation_case_id]], ['feedback', [f.defect_id]]]) for (const id of ids) records.push(await db.prepare(`SELECT row_to_json(record) AS data FROM ${table} record WHERE id=?`).get(id));
  records.push(await db.prepare('SELECT jsonb_agg(record ORDER BY test_case_id,step_order) AS data FROM test_steps record WHERE test_case_id IN (?,?,?)').get(f.test_case_id, f.gherkin_test_case_id, f.automation_case_id));
  return hash(records);
}
async function ensureRepairFixture(f) {
  if (f.automation_run_id) return;
  const run = await req('services/testing/backend/services/execution.service').createExecution({ project_id: projectId, app_type_id: appTypeId, test_case_ids: [f.automation_case_id], test_environment_id: f.environment_id, test_configuration_id: 'sample-v2-config-chrome', build: f.build, release_id: f.release_id, created_by: user.id, execution_mode: 'manual', name: 'Synthetic recorded automation locator failure ' + f.suffix });
  await req('services/testing/backend/services/execution.service').startExecution(run.id, { initiated_by: user.id, skip_testengine_dispatch: true });
  const steps = await db.prepare('SELECT snapshot_step_id,step_order FROM execution_step_snapshots WHERE execution_id=? AND test_case_id=? ORDER BY step_order').all(run.id, f.automation_case_id);
  await req('services/testing/backend/services/executionResult.service').createExecutionResult({ execution_id: run.id, test_case_id: f.automation_case_id, app_type_id: appTypeId, status: 'failed', duration_ms: 1000, error: 'SYNTHETIC recorded selector timeout for #reserve-old. No real Test Engine or browser execution is claimed.', logs: JSON.stringify({ verification_fixture: true, stepStatuses: Object.fromEntries(steps.map(step => [step.snapshot_step_id, step.step_order === 1 ? 'failed' : 'blocked'])), stepNotes: Object.fromEntries(steps.map(step => [step.snapshot_step_id, step.step_order === 1 ? 'SYNTHETIC timeout observation for authored #reserve-old; no current DOM evidence was captured.' : 'SYNTHETIC successor assertion was not reached.'])) }), executed_by: user.id });
  await req('services/testing/backend/services/execution.service').completeExecution(run.id, 'failed', { completed_by: user.id });
  f.automation_run_id = run.id; save();
}
function task(id, f) {
  const common = `Use only the selected synthetic warehouse stock fixture Story ${f.story_id}, release ${f.release_id}, and their linked evidence. Treat supplied specification as fixture contract, synthetic saved execution histories as synthetic observations, and do not imply production execution or root cause certainty. Return your complete intent-specific assessment or typed deliverable, cite supplied IDs, and distinguish unknowns. Keep the complete outcome concise (roughly 1200 words maximum) while retaining all required typed native fields. Do not add authentication, payments or unrelated workflows.`;
  const intents = {
    'quality-orchestrator': 'Produce the prioritized quality decision brief and explicit exit criteria for this exact release; assess the uncovered duplicate-click obligation and synthetic failing reservation observation.',
    'story-architect': 'Produce one reviewable versioned Story proposal refining the existing acceptance boundaries without inventing cancellation or concurrency policy. Preserve exact initial quantity, reservation and reset outcomes.',
    'test-designer': 'Produce reviewable complete Test Case proposals for the untested duplicate-click pending obligation with exact given contract, setup, actions, expected results and traceability. The controllable pending condition is a REQUIRED but currently unavailable fixture prerequisite; do not invent its implementation. The temporal oracle must trigger the first request WITHOUT waiting for completion, issue repeated clicks WHILE it is still pending, and ONLY THEN await completion and assert remaining stock 2 plus Reserved. Do not assert terminal success before the duplicate clicks. Keep this draft blocked on the unavailable pending control rather than claiming it was executable or executed.',
    'automation-engineer': 'Prepare one structured Automation Plan proposal for the selected manual case. Preserve both complete saved sections and assertions. UI selectors in the supplied specification are authored contracts, not a current observed DOM. Identify unavailable Playwright/browser evidence; do not claim generated code or runner success.',
    'run-planner': 'Produce a native Run proposal selecting only exact existing manual case IDs in this release, with ranking, test versions/build/environment and measurable exit criteria. No run has been submitted by this proposal.',
    'failure-analyst': 'Analyze the first saved failed manual Run, compare the synthetic later passes and hypotheses, and produce evidence-bounded next diagnostic checks. The observed mismatch is product symptom evidence within the synthetic fixture; its root cause remains unknown.',
    'bug-reporter': 'Produce one complete native Defect proposal from the first recorded failed manual result: reproducible one-click observation, expected remaining 2, actual 1, build and environment. State it is synthetic fixture evidence and avoid creating a duplicate production incident.',
    'bug-triage': 'Triage the linked synthetic defect: severity, priority, duplication risk and evidence gaps. Compare the first failed manual Run; a later recorded pass does not prove repair. Do not invent an owner.',
    'quality-evaluator': 'Evaluate obligation traceability, exact expected results, synthetic run evidence and the release unknowns. Provide concrete completion requirements and supported proposals if required by your outcome contract.',
    'repository-curator': 'Review repository reuse and locator contracts for the selected authored automation case. Explain which objects and selectors are saved versus currently observed. Do not invent repository entries or claim a browser observation.',
    'story-completion': 'Return one complete reviewable versioned existing Story proposal preserving all three declared acceptance boundaries. Complete the actor, value, scope, exclusions and Given/When/Then wording using the saved fixture contract. Keep unknown timing/control details as explicit open questions rather than inventing policy.',
    'story-grooming': 'Groom this exact Story: readiness, dependencies, testability of pending duplicate clicks, and unresolved fixture timing. Show a complete supported proposal if findings require it, preserving all three acceptance obligations.',
    'story-assurance': 'Assure the exact Story against its saved acceptance criteria and linked test intent; highlight missing timing/control details without inventing limits. Supply complete reviewable proposals for supported actionable Story gaps.',
    'test-improvement': 'Improve the exact selected saved manual Test Case as a complete Test Case proposal, preserving all original clauses, parameter references and existing Story links. Keep assertions of remaining 3 then remaining 2 and Reserved. Add only supported clarity and concrete missing setup; do not pretend duplicate-click coverage belongs to the original one-click intent.',
    'release-readiness': 'Assess readiness of this exact synthetic release using the code-computed quality snapshot, defect and manual pass/fail observations. Preserve missing coverage/assertion-review/gate evidence and never approve release.',
    'impact-analysis': 'Analyze impact of changing the one-item reservation implementation within this release. Map supported Story, Test Case, Run and Defect relationships; separate recorded graph links from hypothesized propagation.',
    'coverage-assurance': 'Compare all three saved Story obligations against exact case assertions and code-computed coverage checks. Distinguish linked candidates from reviewed assertion coverage; propose concrete missing coverage only from supplied obligations.',
    'risk-prediction': 'Rank evidence-supported risks for this exact release and the limited synthetic four-attempt history. Treat risk as assessment, not calibrated probability; state sparse evidence and unknown configuration/data equivalence.',
    'flaky-test-intelligence': 'Assess the alternating failed/passed synthetic manual histories for the selected case. Compare frozen evidence equivalence and identify nondeterminism hypotheses without declaring verified flaky automation or root cause.',
    'release-risk-simulation': 'Simulate explicitly labeled release scenarios from this synthetic cohort and code-computed snapshot. Separate observed baseline from hypothetical added coverage/defect closure and never invent a release probability or approval.',
    'quality-graph': 'Explain the code-computed quality graph for the exact release: Story obligations, tests, attempts and defect; distinguish witnessed links, candidate assertion matches, reviewed coverage and missing evidence.',
    'automation-repair': 'Assess a typed repair for the selected authored automated web case and its exact matching frozen failed Run. This is an explicitly synthetic saved selector-timeout observation. No current DOM or Test Engine receipt was captured; #reserve-item appears only in the supplied authored specification. Return a complete repair-readiness assessment with specific missing observed locator evidence, automation_repair:null and no fabricated patch or verification. Identify the exact browser/runner receipts needed before a supported repair can be proposed.'
  };
  const inputs = { story_id: f.story_id, release_id: f.release_id, build: f.build, environment_id: f.environment_id };
  if (['automation-engineer', 'test-improvement', 'flaky-test-intelligence'].includes(id)) inputs.test_case_id = f.test_case_id;
  if (['repository-curator', 'automation-repair'].includes(id)) inputs.test_case_id = f.automation_case_id;
  if (['failure-analyst', 'bug-reporter', 'bug-triage', 'automation-repair'].includes(id)) inputs.execution_id = f.runs[0].id;
  if (id === 'automation-repair') inputs.execution_id = f.automation_run_id;
  const taskInput = { prompt: `${common}\nTask: ${intents[id]}`, inputs };
  const outcomeContract = req('services/agentic/backend/services/agentArtifacts').outcomeContract(id);
  if (outcomeContract.mode === 'review' && !outcomeContract.findings_require_proposals) taskInput.prompt += '\nThis task requests an assessment. Tag diagnostic findings requires_proposal:false; retain concrete next checks in the assessment instead of initiating new artifact authoring.';
  if (process.env.HELLOTEST_LIVE_FULL_BRIEF_AGENT === id) {
    taskInput.prompt += '\n' + 'Brief scope note: assess the selected reservation fixture only; saved claims require the supplied native citations.\n'.repeat(80) + 'FINAL_BRIEF_OBLIGATION: preserve the exact Reset outcome of remaining stock 3 in the complete deliverable.';
    taskInput.smart_context = { reviewed_context: 'Human-reviewed synthetic fixture brief; it does not establish observed runtime behavior.\n' + 'Review context: pending duplicate clicks are ignored; unknown fixture timing must remain an open question.\n'.repeat(35) + 'FINAL_REVIEWED_OBLIGATION: no generated proposal establishes real browser execution or release approval.' };
  }
  return taskInput;
}
async function verify(id, f) {
  const started = Date.now(), input = task(id, f);
  const record = { agent_id: id, name: profiles[id].name, started_at: new Date().toISOString(), input, expected_contract: req('services/agentic/backend/services/agentArtifacts').outcomeContract(id) };
  emit('agent_start', { agent_id: id });
  const before = await nativeHash(f);
  try {
    const outcome = await req('services/agentic/backend/services/agenticAssistant.service').respond({ user, project_id: projectId, app_type_id: appTypeId, agent_id: id, mode: 'agent', integration_id: integrationId, context_scopes: profiles[id].scopes, ...input });
    record.transaction_id = outcome.transaction.id;
    const result = outcome.result, allowed = new Set(outcome.citations.map(citation => citation.id));
    const citationIds = req('services/agentic/backend/services/agenticAssistant.service')._internals.collectCandidateCitationIds(result);
    const persisted = (await db.prepare('SELECT metadata FROM workspace_transactions WHERE id=?').get(outcome.transaction.id)).metadata?.result;
    const traces = await db.prepare('SELECT id,operation,status,http_status,error_code,requested_model,usage FROM llm_request_traces WHERE session_id=? ORDER BY started_at').all(outcome.transaction.id);
    record.model_calls = traces;
    const issues = req('services/agentic/backend/services/agentArtifacts').outcomeIssues(result, result.outcome_contract);
    record.checks = { actual_successful_provider_call: traces.some(trace => trace.status === 'succeeded' || trace.http_status === 200), provider_mode_llm: result.model_execution?.generation_mode === 'llm', task_response_nonempty: typeof result.response === 'string' && result.response.trim().length > 0, citations_resolve_to_supplied_evidence: citationIds.length > 0 && citationIds.every(citation => allowed.has(citation)), native_presentation_contract: req('services/agentic/backend/services/agentOutcomePresentation').presentationIssues(result, outcome.citations).length === 0, intent_contract_satisfied_or_explicitly_blocked: issues.every(issue => issue.blocked), complete_response_persisted: persisted?.response === result.response, complete_artifacts_persisted: isDeepStrictEqual(persisted?.artifacts, result.artifacts), native_source_records_unchanged: before === await nativeHash(f), human_review_required: outcome.provenance.requires_human_review === true };
    record.intent_validation = intentValidation(result);
    delete record.checks.intent_contract_satisfied_or_explicitly_blocked;
    record.checks.intent_completion_state_reported = record.intent_validation.completion_state_truthful;
    record.semantic_review = { status: 'human_review_required', scope: 'Native schema, exact citation identities and declared artifact intent are verified separately from factual entailment, temporal behavior and business correctness.' };
    if (input.smart_context?.reviewed_context) {
      const requests = await db.prepare('SELECT request_payload FROM llm_request_traces WHERE session_id=? ORDER BY started_at').all(outcome.transaction.id);
      const packets = requests.flatMap(row => { try { return [JSON.parse(row.request_payload?.messages?.at(-1)?.content)]; } catch { return []; } });
      record.full_brief = { task_characters: input.prompt.length, reviewed_characters: input.smart_context.reviewed_context.length };
      record.checks.full_task_brief_reached_actual_provider = packets.some(packet => packet.request === input.prompt);
      record.checks.full_reviewed_brief_reached_actual_provider = packets.some(packet => packet.bounded_workspace_context?.reviewed_context?.some(item => item.content === input.smart_context.reviewed_context));
    }
    record.verification = result.verification; record.readiness = result.readiness; record.outcome_issues = result.outcome_issues; record.artifact_kinds = result.artifacts.map(item => item.kind); record.agent_chain = result.agent_chain;
    record.outcome_path = path.join(outputDir, id + '.json');
    fs.writeFileSync(record.outcome_path, JSON.stringify({ input, result, citations: outcome.citations, provenance: outcome.provenance, model_calls: traces }, null, 2));
    assert.ok(Object.values(record.checks).every(Boolean), JSON.stringify(record.checks));
    record.status = result.verification?.status === 'passed' ? 'validated' : 'validated_needs_evidence';
  } catch (error) {
    record.status = 'failed'; record.error = { code: error.code, message: error.publicMessage || error.message, validation_errors: error.validation_errors };
    await captureFailedAttempt(record);
  }
  record.duration_ms = Date.now() - started;
  const previous = report.results.findIndex(item => item.agent_id === id);
  if (previous >= 0) { record.previous_attempts = [...(report.results[previous].previous_attempts || []), report.results[previous]]; delete record.previous_attempts.at(-1).previous_attempts; report.results[previous] = record; } else report.results.push(record);
  save(); emit('agent_finished', { agent_id: id, status: record.status, duration_ms: record.duration_ms, transaction_id: record.transaction_id, checks: record.checks, error: record.error });
}
(async () => {
  await req('services/platform/backend/src/db/schemaReadiness').verifySchema(db, 'main');
  assert.equal((await db.prepare('SELECT status FROM users WHERE id=?').get(user.id))?.status, 'active');
  const model = await db.prepare('SELECT id,model,is_active FROM integrations WHERE id=?').get(integrationId); assert.equal(model?.is_active, true);
  report.provider = { integration_id: model.id, model: model.model };
  assert.equal((await db.prepare('SELECT project_id FROM app_types WHERE id=?').get(appTypeId))?.project_id, projectId);
  const Fastify = req('services/platform/backend/node_modules/fastify'); app = Fastify({ logger: false });
  app.register(req('services/platform/backend/src/plugins/errorHandler')); app.register(req('services/platform/backend/src/plugins/validator')); app.register(req('services/platform/backend/src/plugins/accessControl')); app.register(req('services/mcp/backend/plugin')); app.register(req('services/platform/backend/src/routes')); await app.ready();
  const f = await fixture();
  await ensureRepairFixture(f);
  await revalidateStoredReceipts();
  // Initialize the native retrieval/transport path once before the two-worker
  // workload. Its failures remain recorded separately from model validation.
  try {
    const warm = await req('services/knowledge/backend/services/knowledgeRetrieval.service').retrieveSearch({ projectId, appTypeId, user, query: `Story ${f.story_id} linked Test Cases`, filters: { app_type_id: appTypeId, agent_id: 'story-architect', requested_scopes: ['stories', 'test-cases'], source_kinds: ['requirement', 'test_case'], evidence_scope: { story_id: f.story_id, release_id: f.release_id } }, budgets: { deadline_ms: 20000, max_context_tokens: 2000, max_evidence_items: 6 } });
    report.retrieval_warmup = { result_count: warm.results.length, error_codes: warm.retrieval?.error_codes || [], status: warm.retrieval?.status };
  } catch (error) { report.retrieval_warmup = { error: error.code || 'RETRIEVAL_UNAVAILABLE' }; }
  const selected = process.env.HELLOTEST_LIVE_REVALIDATE_ONLY === '1' ? [] : process.env.HELLOTEST_LIVE_AGENTS?.split(',').filter(Boolean) || Object.keys(profiles).filter(id => !report.results.some(item => item.agent_id === id && item.status !== 'failed'));
  assert.ok(selected.every(id => profiles[id]), 'Only supported workspace specialists may be selected.');
  delete report.failure;
  emit('starting', { total_agents: Object.keys(profiles).length, selected_agents: selected.length, model: model.model, fixture: { story_id: f.story_id, release_id: f.release_id } });
  let index = 0;
  await Promise.all([0, 1].map(async () => { while (index < selected.length) { const id = selected[index++]; await verify(id, f); } }));
  emit('completed', await finalizeReport(f));
  if (report.summary.failed || report.summary.semantic_needs_review || report.summary.tested !== report.agent_count) process.exitCode = 1;
})().catch(error => { report.failure = { code: error.code, message: error.publicMessage || error.message }; save(); emit('runner_failed', report.failure); process.exitCode = 1; }).finally(async () => { await app?.close(); await Promise.allSettled([db.close(), obs.close()]); });
