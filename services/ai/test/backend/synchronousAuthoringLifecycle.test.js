const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const lifecycle = require("../../backend/services/generationLifecycle");
const trace = require("../../../platform/backend/src/utils/llmTraceContext");
const { serviceError, SERVICE_ERROR_CODES } = require("../../../platform/backend/src/utils/serviceErrors");

const appType = { id: "web", project_id: "project", name: "Billing", type: "web" };
const story = { id: "story", project_id: "project", title: "Approve a submitted invoice",
  description: "A reviewer approves a submitted invoice and sees the approved status.", acceptance_criteria: ["Approval records the reviewer and the approved status."] };
const candidate = () => ({ title: "Approve an invoice", description: "A reviewer approves a submitted invoice and checks its recorded status.",
  priority: 2, test_case_type: "functional", parameter_values: {}, requirement_refs: ["R1"],
  steps: [{ action: "Open a submitted invoice and approve it as the assigned reviewer", expected_result: "The invoice is approved and the reviewer is recorded", step_type: "web" }] });

function load(file, overrides) {
  const native = createRequire(file), module = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(file, "utf8"))(name => Object.hasOwn(overrides, name) ? overrides[name] : native(name), module, module.exports);
  return module.exports;
}

function fixture({ family = "case-authoring", providerError, output = candidate(), configurationError } = {}) {
  const phases = [], calls = [];
  const overrides = {
    "@hellotest/platform/backend/services/dropdownCatalog.service": { getField: async () => ({ options: [{ value: "functional", active: true }] }) },
    "@hellotest/integration/backend/services/aiLlmSelection.service": { resolveLlmIntegrationForUsage: async () => {
      if (configurationError) throw configurationError;
      return { id: "model", name: "Configured model", type: "llm", is_active: true, model: "fixture", base_url: "https://provider.invalid/v1" };
    } },
    "@hellotest/knowledge/backend/services/aiKnowledge.service": { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) },
    "@hellotest/platform/backend/src/utils/llmHttpClient": { fetchLlmWithRetry: async (_url, _init, options) => {
      calls.push(options.featureKey);
      assert.equal(trace.current().authoring_profile, family);
      const validation = options.featureKey === "ai.authoring.request_validation";
      assert.equal(trace.current().authoring_stage, validation ? "guardrails" : "specialist");
      if (!validation && providerError) throw providerError;
      const content = validation ? { decision: "accept", explanation: "The requested behavior is supported by the supplied evidence.", suggestions: [] }
        : family === "case-design" ? { testCases: [output] } : output;
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
    } }
  };
  const service = load(require.resolve(family === "case-design" ? "../../../manual/backend/services/requirementDesign.service" : "../../backend/services/aiCaseAuthoring.service"), overrides);
  const preview = family === "case-design" ? service.previewRequirementsTestCases : service.previewCaseAuthoring;
  const input = { appType, requirement: story, requirements: [story], test_case: candidate(), max_cases: 1,
    onProgress: phase => phases.push(phase) };
  return { service, phases, calls, preview: changes => preview({ ...input, ...changes }) };
}

for (const family of ["case-authoring", "case-design"]) {
  test(`${family} confirms actual stages, native output and provider trace identity`, async () => {
    const f = fixture({ family }), result = await f.preview();
    assert.deepEqual(f.phases, lifecycle.STAGES);
    assert.equal(result.processing.schema_version, 1);
    assert.equal(result.processing.active_stage_id, "review");
    assert.equal(result.processing.output_count, 1);
    assert.equal(result.processing.completed_stage_count, 6);
    assert.equal(result.processing.profile, family);
    assert.equal(f.calls.filter(key => key !== "ai.authoring.request_validation").length, 1);
  });

  test(`${family} input and configuration rejection never claim a provider phase`, async () => {
    const f = fixture({ family });
    await assert.rejects(f.preview({ additional_context: "x".repeat(18001) }), error => {
      assert.equal(error.authoring_failure.stage_id, family === "case-design" ? "intake" : "context");
      assert.equal(error.authoring_failure.code, "AI_INPUT_BUDGET_EXCEEDED"); return true;
    });
    assert.equal(f.calls.length, 0);
    assert.ok(!f.phases.includes("specialist"));
    const denied = fixture({ family, configurationError: Object.assign(new Error("A provider must be configured"), { code: "AI_FEATURE_UNMAPPED", statusCode: 422 }) });
    await assert.rejects(denied.preview(), error => error.authoring_failure.stage_id === "guardrails" && error.authoring_failure.code === "AI_FEATURE_UNMAPPED");
    assert.equal(denied.calls.length, 0);
  });

  for (const [code, stage] of [["LLM_QUOTA_EXCEEDED", "specialist"], ["LLM_AUTHENTICATION_FAILED", "specialist"], ["LLM_MODEL_NOT_FOUND", "specialist"], ["AI_NATIVE_CONTRACT_INVALID", "outcome"]]) {
    test(`${family} preserves ${code}, confirmed stage and retry receipt`, async () => {
      const f = fixture({ family, providerError: Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code, statusCode: code === "LLM_QUOTA_EXCEEDED" ? 429 : 502, publicMessage: "Safe provider diagnostic", retryAfterSeconds: 13 }) });
      await assert.rejects(f.preview(), error => {
        assert.equal(error.authoring_failure.stage_id, stage);
        assert.equal(error.authoring_failure.code, code);
        assert.equal(error.authoring_failure.retry_after_seconds, 13);
        assert.equal(error.authoring_processing.active_stage_id, stage);
        assert.doesNotMatch(JSON.stringify(error.authoring_failure), /PRIVATE_PROVIDER_DETAIL/); return true;
      });
      assert.equal(f.calls.filter(key => key !== "ai.authoring.request_validation").length, 1);
    });
  }

  test(`${family} validates a received native proposal in outcome before review`, async () => {
    const f = fixture({ family, output: { title: "Incomplete output" } });
    await assert.rejects(f.preview(), error => error.authoring_failure.stage_id === "outcome" && error.authoring_failure.code === "AI_NATIVE_CONTRACT_INVALID");
    assert.ok(!f.phases.includes("review"));
  });
}

test("actual authoring route preserves intake validation, provider failures and success processing through HTTP", async () => {
  const f = fixture(), app = require("fastify")({ logger: false });
  try {
    await app.register(require("../../../platform/backend/src/plugins/errorHandler"));
    await app.register(require("../../../platform/backend/src/plugins/validator"));
    const route = load(require.resolve("../../../testing/backend/routes/testCases.routes"), new Proxy({
      "@hellotest/ai/services/generationLifecycle": lifecycle,
      "@hellotest/ai/services/aiCaseAuthoring": { previewCaseAuthoring: input => f.service.previewCaseAuthoring(input) },
      "@hellotest/platform/backend/public/applicationAccess": { getAppType: async () => appType },
      "@hellotest/platform/backend/public/projectAccess": { getProject: async () => ({ id: "project" }) }
    }, { getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }), get: (object, key) => object[key] || {} }));
    await route({ get() {}, put() {}, delete() {},
      post: (path, handler) => { if (path === "/test-cases/ai-authoring-preview") app.post(path, handler); },
      authenticate: async req => { req.user = { id: "author" }; }, validate: app.validate
    });
    const invalid = await app.inject({ method: "POST", url: "/test-cases/ai-authoring-preview", payload: {} });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().failure.stage_id, "intake");
    assert.equal(invalid.json().processing.completed_stage_count, 0);
    assert.equal(f.calls.length, 0);
    const success = await app.inject({ method: "POST", url: "/test-cases/ai-authoring-preview", payload: { app_type_id: "web", test_case: candidate() } });
    assert.equal(success.statusCode, 200);
    assert.equal(success.json().processing.active_stage_id, "review");
    const failed = fixture({ providerError: serviceError(SERVICE_ERROR_CODES.TIMEOUT, { dependency: "llm-provider", statusCode: 504, retryable: true, retryAfterSeconds: 7 }) });
    f.service.previewCaseAuthoring = failed.service.previewCaseAuthoring;
    const timeout = await app.inject({ method: "POST", url: "/test-cases/ai-authoring-preview", payload: { app_type_id: "web", test_case: candidate() } });
    assert.equal(timeout.statusCode, 504);
    assert.equal(timeout.headers["retry-after"], "7");
    assert.equal(timeout.json().failure.stage_id, "specialist");
    assert.equal(timeout.json().failure.code, SERVICE_ERROR_CODES.TIMEOUT);
    assert.equal(timeout.json().processing.active_stage_id, "specialist");
  } finally { await app.close(); }
});

test("typed output failure does not overwrite a later confirmed evaluation boundary", async () => {
  const preview = lifecycle.withLifecycle("case-authoring", async ({ onProgress }) => {
    await onProgress("evaluation", "Checking normalized field relationships.");
    throw Object.assign(new Error("Invalid parameter relationship"), { code: "AI_NATIVE_CONTRACT_INVALID", statusCode: 502 });
  });
  await assert.rejects(preview(), error => error.authoring_failure.stage_id === "evaluation");
});
