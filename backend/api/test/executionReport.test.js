const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");
const { buildExecutionReportModel } = require("../src/services/executionReportModel");
const { renderDetailedExecutionHtml, REPORT_CSP, redact } = require("../src/services/executionReportHtml");
const NOW = Date.parse("2026-09-10T10:30:00Z");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function fixture() {
  const execution = {
    id: "run", name: "Customer portal · Release 2026.09", project_id: "project", status: "running", execution_mode: "manual",
    started_at: "2026-09-10T10:00:00Z", parameter_values: { "r.region": "EU", "r.api_key": "RUN_SECRET" },
    test_environment: { name: "Staging", snapshot: { name: "Staging", base_url: "https://staging.example.test", variables: [{ key: "authorization", value: "ENV_SECRET" }] } },
    test_configuration: { name: "Chrome desktop", snapshot: { name: "Chrome desktop", browser: "Chrome", viewport: "1440 × 900" } },
    case_snapshots: [
      { test_case_id: "case1", test_case_title: "Checkout accepts customer payment", test_case_description: "Validate payment for each supported customer persona.", suite_id: "suite1", suite_name: "Checkout smoke", module_id: "module1", module_name: "Payments", parameter_values: { "t.card_type": "Visa", password: "CASE_SECRET" }, suite_parameter_values: { "s.currency": "EUR" }, test_data_set_id: "data1", test_data_set_name: "Customer personas", test_data_set_snapshot: { name: "Customer personas", mode: "table", rows: [{ customer: "Alex", segment: "standard", token: "ROW_SECRET" }, { customer: "Priya", segment: "premium" }, { customer: "Sam", segment: "business" }] } },
      { test_case_id: "case2", test_case_title: "Keyboard navigation reaches payment action", suite_id: "suite1", suite_name: "Checkout smoke", module_id: "module2", module_name: "Accessibility" },
      { test_case_id: "case3", test_case_title: "Customer can review order history", suite_id: null }
    ],
    step_snapshots: [
      { test_case_id: "case1", snapshot_step_id: "step1", step_order: 1, step_type: "web", action: "When the customer submits a payment", expected_result: "Then the confirmation page shows the order number" },
      { test_case_id: "case1", snapshot_step_id: "step2", step_order: 2, step_type: "api", action: "Read the order status", expected_result: "HTTP 200 and the payment state is accepted" },
      { test_case_id: "case2", snapshot_step_id: "step3", step_order: 1, step_type: "web", action: "Tab to the payment action", expected_result: "The keyboard focus indicator is visible" }
    ]
  };
  const results = [
    { id: "row0-retry", execution_id: "run", test_case_id: "case1", data_set_iteration_index: 0, data_set_iteration_key: "data1:1", data_set_row_snapshot: { customer: "Alex", segment: "standard", token: "ROW_SECRET" }, status: "passed", duration_ms: 2000, created_at: "2026-09-10T10:08:00Z", started_at: "2026-09-10T10:07:58Z", ended_at: "2026-09-10T10:08:00Z", executed_by_name: "QA Lead", logs: JSON.stringify({ stepStatuses: { step1: "passed", step2: "passed" }, stepNotes: { step1: "Confirmation visible after retry" }, stepApiDetails: { step2: { status: 200, headers: { authorization: "API_SECRET" }, response: { state: "accepted" } } } }) },
    { id: "row0-first", execution_id: "run", test_case_id: "case1", data_set_iteration_index: 0, status: "failed", duration_ms: 1000, created_at: "2026-09-10T10:02:00Z", error: "Initial request timed out", logs: JSON.stringify({ stepStatuses: { step1: "failed" }, stepNotes: { step1: "The payment gateway did not respond" }, stepEvidence: { step1: { fileName: "first-attempt.png", dataUrl: PNG } } }) },
    { id: "row1", execution_id: "run", test_case_id: "case1", data_set_iteration_index: 1, status: "failed", duration_ms: 3000, created_at: "2026-09-10T10:10:00Z", error: "Expected confirmation, received payment declined", logs: JSON.stringify({ stepStatuses: { step1: "failed" }, stepNotes: { step1: "The premium discount was applied twice" }, stepEvidence: { step1: { attachmentId: "evidence1", fileName: "payment-error.png" } }, stepWebDetails: { step1: { console: [{ level: "error", text: "Payment rejected" }], network: [{ url: "https://api.example.test/pay?token=QUERY_SECRET", status: 422 }], url: "https://staging.example.test/checkout" } } }) },
    { id: "accessibility", execution_id: "run", test_case_id: "case2", status: "blocked", duration_ms: 0, created_at: "2026-09-10T10:12:00Z", error: "Staging keyboard focus styles need review" }
  ];
  return { execution, results };
}
function loadService(name, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services", name), "utf8"), {
    module, exports: module.exports, Buffer, Date, setTimeout, clearTimeout, process,
    require: key => Object.hasOwn(dependencies, key) ? dependencies[key] : require(key)
  }, { filename: name });
  return module.exports;
}

test("separates data-row instances, retries, frozen pending rows and direct cases", () => {
  const { execution, results } = fixture();
  const report = buildExecutionReportModel(execution, results, NOW);
  assert.equal(report.summary.total, 5);
  assert.equal(report.summary.distinct_cases, 3);
  assert.equal(report.summary.attempts, 4);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.summary.pending, 2);
  assert.equal(report.summary.conclusive_pass_rate, 50);
  assert.equal(report.summary.duration_ms, 6000);
  const row0 = report.cases.find(item => item.id === "case1" && item.data_set_iteration_index === 0);
  assert.equal(row0.status, "passed");
  assert.equal(row0.duration_ms, 3000);
  assert.equal(row0.attempts.length, 2);
  assert.equal(row0.attempts[1].steps[0].status, "failed");
  assert.equal(row0.attempts[1].steps[0].has_evidence, true);
  assert.equal(report.cases.find(item => item.data_set_iteration_index === 2).status, "pending");
  assert.deepEqual(report.cases.find(item => item.data_set_iteration_index === 2).data_set_row, { customer: "Sam", segment: "business" });
  assert.equal(report.suites.find(item => item.id === "suite1").total, 4);
});

test("same-timestamp retries use deterministic newest ID without dropping other row outcomes", () => {
  const { execution } = fixture();
  const results = [
    { id: "b", test_case_id: "case1", data_set_iteration_index: 0, status: "failed", created_at: "2026-09-10T00:00:00Z" },
    { id: "a", test_case_id: "case1", data_set_iteration_index: 0, status: "passed", created_at: "2026-09-10T00:00:00Z" }
  ];
  for (const input of [results, results.slice().reverse()]) assert.equal(buildExecutionReportModel(execution, input, NOW).cases[0].status, "failed");
});

test("empty runs have no conclusive percentage and do not infer success from empty steps", () => {
  const report = buildExecutionReportModel({ id: "empty", case_snapshots: [{ test_case_id: "never-started", test_case_title: "Unexecuted" }] }, [], NOW);
  assert.equal(report.summary.passed, 0);
  assert.equal(report.summary.conclusive_pass_rate, null);
  assert.match(renderDetailedExecutionHtml(report), /0 passed \/ 0 passed or failed/);
  assert.match(renderDetailedExecutionHtml(buildExecutionReportModel({ id: "empty" }, [], NOW)), /No case snapshots or execution results/);
});

test("legacy result-only runs remain visible and never read mutable authored steps", () => {
  const report = buildExecutionReportModel({ id: "old" }, [{ id: "legacy", execution_id: "old", test_case_id: "deleted", test_case_title: "Recorded title", status: "failed", error: "Historic failure" }, { id: "foreign", execution_id: "different", test_case_id: "secret", status: "passed" }], NOW);
  assert.equal(report.cases.length, 1);
  assert.equal(report.cases[0].legacy, true);
  assert.equal(report.cases[0].title, "Recorded title");
  assert.equal(report.cases[0].steps.length, 0);
});

test("key-value datasets represent one instance and preserve empty cells", () => {
  const report = buildExecutionReportModel({ id: "run", case_snapshots: [{ test_case_id: "c", test_data_set_snapshot: { mode: "key_value", rows: [{ key: "region", value: "" }, { key: "segment", value: "premium" }] } }] }, [], NOW);
  assert.equal(report.cases.length, 1);
  assert.deepEqual(report.cases[0].data_set_row, { region: "", segment: "premium" });
});

test("active timers are evaluated once at the export time; paused time does not tick", () => {
  const report = buildExecutionReportModel({ id: "run" }, [
    { id: "a", test_case_id: "a", status: "running", duration_ms: 250, timer_started_at: new Date(NOW - 2000).toISOString() },
    { id: "b", test_case_id: "b", status: "paused", duration_ms: 500, timer_started_at: new Date(NOW - 2000).toISOString() }
  ], NOW);
  assert.equal(report.summary.duration_ms, 2750);
  assert.equal(report.summary.running, 1);
  assert.equal(report.summary.paused, 1);
});

test("HTML includes hierarchy, per-row trace, retry failures, evidence and recorded context", () => {
  const { execution, results } = fixture();
  const html = renderDetailedExecutionHtml(buildExecutionReportModel(execution, results, NOW));
  for (const expected of ["Conclusive pass rate", "Checkout smoke", "Module · Payments", "Module · Accessibility", "Data row 1", "Data row 2", "Data row 3", "Initial request timed out", "Frozen environment", "Browser console and network", "API request, response and assertions", "Recorded execution logs", "Unexecuted", "first-attempt.png"]) assert.ok(html.includes(expected), expected);
  assert.match(html, /<img src="data:image\/png/);
  assert.equal((html.match(/class="case-card"/g) || []).length, 5);
  if (process.env.REPORT_FIXTURE_OUTPUT) fs.writeFileSync(process.env.REPORT_FIXTURE_OUTPUT, html);
});

test("HTML escapes hostile content, redacts credential fields, and has no external dependencies", () => {
  const { execution, results } = fixture();
  execution.name = '<img src=x onerror="alert(1)">';
  execution.case_snapshots[0].test_case_title = '</summary><script>alert("xss")</script>';
  results[2].error = 'Authorization: Bearer BEARER_SECRET password="MESSAGE_SECRET" <svg onload=alert(1)>';
  const html = renderDetailedExecutionHtml(buildExecutionReportModel(execution, results, NOW));
  for (const secret of ["RUN_SECRET", "ENV_SECRET", "CASE_SECRET", "ROW_SECRET", "API_SECRET", "QUERY_SECRET", "BEARER_SECRET", "MESSAGE_SECRET"]) assert.ok(!html.includes(secret), secret);
  assert.ok(!html.includes('<svg onload=alert(1)>'));
  assert.ok(!html.includes('</summary><script>alert'));
  assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)="https?:/i.test(html));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.ok(REPORT_CSP.includes(`'sha256-${createHash("sha256").update(scripts[0][1]).digest("base64")}'`));
  assert.match(REPORT_CSP, /connect-src 'none'/);
});

test("SVG and remote evidence URLs are not loaded; invalid images are listed with a reason", () => {
  const { execution, results } = fixture();
  results[0].logs = JSON.stringify({ stepEvidence: { step1: { fileName: "hostile.svg", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }, step2: { fileName: "remote.png", dataUrl: "https://tracking.example.test/pixel" } } });
  const html = renderDetailedExecutionHtml(buildExecutionReportModel(execution, results, NOW));
  assert.ok(!html.includes("PHN2Zy8+"));
  assert.ok(!html.includes("https://tracking.example.test"));
  assert.ok(html.includes("unsupported format or report size limit"));
});

test("secret variable descriptors and nested header values are redacted without losing safe data", () => {
  assert.deepEqual(redact({ headers: { Authorization: "a", Accept: "application/json" }, variables: [{ key: "ordinary", value: "hidden", is_secret: true }] }), { headers: { Authorization: "[redacted]", Accept: "application/json" }, variables: [{ key: "ordinary", value: "[redacted]", is_secret: true }] });
});

function evidenceFixture({ denied = false, rows, download } = {}) {
  const { execution, results } = fixture();
  const report = buildExecutionReportModel(execution, results, NOW);
  const state = { queries: 0, downloads: 0 };
  const saved = { id: "evidence1", project_id: "project", entity_type: "execution_result", entity_id: "row1", file_name: "payment-error.png", mime_type: "image/png", size_bytes: 68 };
  const service = loadService("executionReportEvidence.js", {
    "../db": { prepare: sql => ({ all: async (...args) => { state.queries++; assert.match(sql, /SELECT id FROM execution_results WHERE execution_id =/); assert.deepEqual(args.slice(0, 3), ["project", "run", "run"]); return rows || [saved]; } }) },
    "./permission.service": { hasPermission: async () => !denied },
    "./attachment.service": { download: async options => { state.downloads++; assert.equal(options.id, "evidence1"); return download ? download() : { row: saved, stream: Readable.from(Buffer.from(PNG.split(",")[1], "base64")) }; } },
    "./executionReportHtml": { raster: require("../src/services/executionReportHtml").raster }
  });
  return { report, state, saved, service };
}

test("stored evidence is embedded only after project permission and exact run/result binding", async () => {
  const { report, service, state } = evidenceFixture();
  await service.attachReportEvidence(report, { user: { id: "qa" } });
  assert.equal(state.downloads, 1);
  const row = report.cases.find(item => item.result_id === "row1");
  assert.match(row.steps[0].evidence.dataUrl, /^data:image\/png/);
  assert.equal(row.attempts[0].attachments.length, 1);
});

test("attachment denial performs no storage query or download", async () => {
  const { report, service, state } = evidenceFixture({ denied: true });
  await service.attachReportEvidence(report, { user: { id: "qa" } });
  assert.equal(state.queries, 0);
  assert.equal(state.downloads, 0);
  assert.match(report.evidence_notice, /access is required/);
});

test("foreign attachment references are never downloaded", async () => {
  const { report, service, state } = evidenceFixture({ rows: [{ id: "foreign", project_id: "project", entity_type: "execution_result", entity_id: "other-result" }] });
  await service.attachReportEvidence(report, { user: { id: "qa" } });
  assert.equal(state.downloads, 0);
});

test("storage scope changes and oversized streaming bodies produce omissions and cancel the stream", async () => {
  let stream;
  const a = evidenceFixture({ download: () => ({ row: { project_id: "foreign" }, stream: stream = Readable.from("private") }) });
  await a.service.attachReportEvidence(a.report, { user: { id: "qa" } });
  assert.ok(stream.destroyed);
  assert.ok(!renderDetailedExecutionHtml(a.report).includes("private"));
  const b = evidenceFixture({ download: () => ({ row: { project_id: "project", entity_type: "execution_result", entity_id: "row1" }, stream: stream = Readable.from(Buffer.alloc(2 * 1024 * 1024 + 1)) }) });
  await b.service.attachReportEvidence(b.report, { user: { id: "qa" } });
  assert.ok(stream.destroyed);
  assert.match(b.report.evidence_notice, /Some stored files were not embedded/);
});

test("HTML export uses recorded evidence without requesting an LLM", async () => {
  const { execution, results } = fixture();
  let llmCalls = 0;
  const service = loadService("executionReport.service.js", {
    "./execution.service": { getExecution: async () => execution },
    "./executionResult.service": { getExecutionResults: async () => results },
    "./executionStepRuntime.service": {}, "./email.service": {},
    "./aiLlmSelection.service": new Proxy({}, { get: () => { llmCalls++; throw new Error("Should not request AI"); } }),
    "./workspaceTransaction.service": {}, "../utils/upstreamLlmError": {}, "../utils/llmHttpClient": {},
    "../utils/executionCaseLifecycle": require("../src/utils/executionCaseLifecycle"),
    "./executionReportModel": { buildExecutionReportModel }, "./executionReportHtml": { renderDetailedExecutionHtml, REPORT_CSP }
  });
  assert.match(await service.renderReportHtml("run"), /Customer portal/);
  assert.equal(llmCalls, 0);
});

test("report route enforces authentication/project/export scope and applies API-key attachment restrictions", async () => {
  let authenticated = true, denied = "", projectAllowed = true, calls = 0, options;
  const routes = new Map(), permissions = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/routes/executions.routes.js"), "utf8"), {
    module, require: key => {
      if (key === "../services/execution.service") return { getExecution: async () => ({ project_id: "project", name: 'Run\r\n"name' }) };
      if (key === "../services/project.service") return { getProject: async () => { if (!projectAllowed) throw Object.assign(new Error("Not found"), { statusCode: 404 }); } };
      if (key === "../services/executionReport.service") return { REPORT_CSP, renderReportHtml: async (_id, args) => { calls++; options = args; return "<html>Report</html>"; } };
      return {};
    }
  });
  const fastify = {
    ...Object.fromEntries(["get", "post", "put", "delete", "patch"].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    authenticate: async () => { if (!authenticated) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); },
    requirePermission: (code, scope) => async () => { permissions.push([code, scope.projectId]); if (denied === code) throw Object.assign(new Error("Forbidden"), { statusCode: 403 }); }
  };
  await module.exports(fastify);
  const route = routes.get("get /executions/:id/report.html");
  const req = { params: { id: "run" }, user: { id: "qa" } }, headers = {};
  const reply = { header: (key, value) => { headers[key] = value; return reply; }, send: value => value };
  authenticated = false; await assert.rejects(route(req, reply), { statusCode: 401 });
  authenticated = true; denied = "run.report.export"; await assert.rejects(route(req, reply), { statusCode: 403 });
  denied = ""; projectAllowed = false; await assert.rejects(route(req, reply), { statusCode: 404 });
  assert.equal(calls, 0);
  projectAllowed = true; denied = "attachment.view"; await route(req, reply);
  assert.equal(options.include_attachments, false);
  denied = ""; await route(req, reply);
  assert.equal(options.include_attachments, true);
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(headers["Content-Security-Policy"], REPORT_CSP);
  assert.match(headers["Content-Disposition"], /^attachment; filename="Run-name.html"$/);
  assert.ok(permissions.every(([, project]) => project === "project"));
});

test("single-case PDF retains every selected data-row instance and excludes unrelated cases", async () => {
  const { execution, results } = fixture();
  const service = loadService("executionReport.service.js", {
    "./execution.service": { getExecution: async () => execution },
    "./executionResult.service": { getExecutionResults: async () => results },
    "./email.service": {}, "./aiLlmSelection.service": {}, "./workspaceTransaction.service": {},
    "../utils/upstreamLlmError": {}, "../utils/llmHttpClient": {},
    "./executionReportModel": { buildExecutionReportModel }, "./executionReportHtml": { renderDetailedExecutionHtml, REPORT_CSP }
  });
  const pdf = await service.renderCaseReportPdf("run", "case1");
  assert.match(pdf.toString("latin1"), /^%PDF-/);
  for (const row of [1, 2, 3]) assert.ok(pdf.toString("latin1").includes(`Data row ${row}`));
  assert.ok(!pdf.toString("latin1").includes("Keyboard navigation"));
  await assert.rejects(service.renderCaseReportPdf("run", "foreign-case"), { statusCode: 404 });
});

test("unindexed legacy data results are identified as ambiguous rather than assigned invented row values", () => {
  const { execution } = fixture();
  const report = buildExecutionReportModel(execution, [{ id: "old", test_case_id: "case1", status: "passed" }], NOW);
  const item = report.cases.find(item => item.id === "case1");
  assert.equal(item.data_set_iteration_index, null);
  assert.equal(item.data_set_row, null);
  assert.equal(item.data_iteration_ambiguous, true);
  assert.match(renderDetailedExecutionHtml(report), /cannot be assigned reliably/);
});

test("suite-supplied data preserves source and canonical parameter names in the portable report", () => {
  const { execution } = fixture();
  execution.case_snapshots[0].data_set_source = "suite";
  execution.case_snapshots[0].suite_parameter_values = { "r.base_url": "https://suite.example.test", "t.customer": "Alex", "s.currency": "EUR" };
  const report = buildExecutionReportModel(execution, [], NOW);
  assert.equal(report.cases[0].data_set_source, "suite");
  const html = renderDetailedExecutionHtml(report);
  assert.match(html, /Data source<\/dt><dd>Suite/);
  for (const key of ["r.base_url", "t.customer", "s.currency"]) assert.ok(html.includes(key));
});

test("slow object streams are cancelled within the per-file deadline and the report remains available", async () => {
  const stream = new Readable({ read() {} });
  const { report, service } = evidenceFixture({ download: () => ({ row: { project_id: "project", entity_type: "execution_result", entity_id: "row1" }, stream }) });
  const started = Date.now();
  await service.attachReportEvidence(report, { user: { id: "qa" } });
  assert.ok(Date.now() - started < 5000);
  assert.ok(stream.destroyed);
  assert.match(renderDetailedExecutionHtml(report), /Preview unavailable/);
});
