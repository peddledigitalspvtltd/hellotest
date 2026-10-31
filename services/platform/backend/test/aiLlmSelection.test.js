const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

function fixture(initial = {}) {
  let preferences = initial;
  const writes = [];
  const reads = {admin:0,personal:0};
  const integrations = new Map([
    ["edited-recently", { id: "edited-recently", type: "llm", is_active: true }],
    ["worked", { id: "worked", type: "llm", is_active: true }],
    ["inactive", { id: "inactive", type: "llm", is_active: false }],
    ["other-project", { id: "other-project", type: "llm", is_active: true, config: { project_id: "other" } }]
  ]);
  const exports = {};
  vm.runInNewContext(readFileSync(require.resolve("../../../integration/backend/services/aiLlmSelection.service"), "utf8"), {
    exports,
    require(id) {
      if (id === "./integration.service") return {
        async getIntegration(id) { if (!integrations.has(id)) throw new Error("Integration not found"); return { ...integrations.get(id) }; },
        async getActiveIntegrationByType() { return { ...integrations.get("edited-recently") }; },
        async getActiveIntegrationByTypeForProject() { return { ...integrations.get("edited-recently") }; }
      };
      if (id === "@hellotest/platform/backend/services/settings.service") return {
        async getWorkspacePreferences() { reads.admin++; return preferences; },
        async getPersonalWorkspacePreferences() { reads.personal++; return preferences; },
        async updateWorkspacePreferences(userId, next) { writes.push({ userId, next }); preferences = { ...preferences, ...next }; }
      };
      if (id === "@hellotest/platform/backend/src/utils/llmTraceContext") return require("../src/utils/llmTraceContext");
      if (id === "@hellotest/platform/backend/src/utils/aiExecutionConfiguration") return require("../src/utils/aiExecutionConfiguration");
      if (id === "@hellotest/platform/backend/services/aiConfiguration.service") return require("../services/aiConfiguration.service");
      throw new Error(`Unexpected dependency ${id}`);
    }
  });
  return { service: exports, writes, reads, getPreferences: () => preferences };
}
const scope = { userId: "reviewer", usageKey: "ai.requirement.grooming", projectId: "project" };
const success = (integration_id, extra = {}) => ({ integration_id, project_id: "project", usage_key: scope.usageKey, succeeded_at: "2026-09-22T12:00:00Z", ...extra });

test("provider attempts are remembered only after a confirmed working response", async () => {
  const { service, writes } = fixture();
  const attempted = await service.resolveLlmIntegrationForUsage({ ...scope, integrationId: "worked" });
  assert.equal(writes.length, 0);
  assert.equal((await service.resolveLlmIntegrationForUsage(scope)).id, "edited-recently");
  await service.recordSuccessfulLlmIntegration(attempted);
  assert.equal(writes.length, 1);
  assert.equal((await service.resolveLlmIntegrationForUsage(scope)).id, "worked");
  assert.equal((await service.resolveLlmIntegrationForUsage({ ...scope, integrationId: "edited-recently" })).id, "edited-recently");
  assert.equal((await service.resolveLlmIntegrationForUsage(scope)).id, "worked", "an unsuccessful later selection does not replace a working default");
  assert.equal((await service.resolveLlmIntegrationForUsage({ ...scope, projectId: "other" })).id, "edited-recently");
});

test("inactive/deleted implicit defaults are skipped while explicit selections retain validation", async () => {
  const { service } = fixture({
    ai_prompt_registry_llm_overrides: { [scope.usageKey]: "deleted" },
    ai_last_successful_llm: [success("inactive"), success("other-project"), success("worked")]
  });
  assert.equal((await service.resolveLlmIntegrationForUsage(scope)).id, "worked");
  await assert.rejects(service.resolveLlmIntegrationForUsage({ ...scope, integrationId: "inactive" }), /inactive/);
  await assert.rejects(service.resolveLlmIntegrationForUsage({ ...scope, integrationId: "deleted" }), /not found/);
});

test("configured feature overrides win and success history is scoped and bounded", async () => {
  const { service, getPreferences } = fixture({
    ai_prompt_registry_llm_overrides: { [scope.usageKey]: "edited-recently" },
    ai_last_successful_llm: [success("worked"), ...Array.from({ length: 110 }, (_, index) => success("worked", { usage_key: `feature-${index}` }))]
  });
  const configured = await service.resolveLlmIntegrationForUsage(scope);
  assert.equal(configured.id, "edited-recently");
  await service.recordSuccessfulLlmIntegration(configured);
  await service.recordSuccessfulLlmIntegration(configured);
  assert.equal(getPreferences().ai_last_successful_llm.length, 100);
  assert.equal(getPreferences().ai_last_successful_llm.filter((entry) => entry.usage_key === scope.usageKey).length, 1);
});

test("objects without request provenance cannot change another user's default", async () => {
  const { service, writes } = fixture();
  await service.recordSuccessfulLlmIntegration({ id: "worked", type: "llm", is_active: true });
  const anonymous = await service.resolveLlmIntegrationForUsage({ projectId: "project" });
  await service.recordSuccessfulLlmIntegration(anonymous);
  assert.equal(writes.length, 0);
});

test('node and agent model selection ignores admin mappings while retaining project validation',async()=>{
  const execution=require('../src/utils/aiExecutionConfiguration');
  const {service,reads}=fixture({ai_prompt_registry_llm_overrides:{'ai.test_case.design':'worked','ai.agentic.test-improvement':'worked'}});
  const node={source:'workflow_node',id:'node',feature_id:'ai.test_case.design',config:{}};
  assert.equal((await execution.run(node,()=>service.resolveLlmIntegrationForUsage({...scope,usageKey:'ai.test_case.design'}))).id,'edited-recently');
  assert.equal((await service.resolveLlmIntegrationForUsage({...scope,usageKey:'ai.agentic.test-improvement'})).id,'edited-recently');
  assert.equal(reads.admin,0);
  assert.equal(reads.personal,2);
  assert.equal((await execution.run({...node,config:{integration_id:'worked'}},()=>service.resolveLlmIntegrationForUsage({...scope,usageKey:'ai.test_case.design'}))).id,'worked');
  assert.equal((await service.resolveLlmIntegrationForUsage({...scope,usageKey:'ai.test_case.design'})).id,'worked','Application features retain admin selection.');
  await assert.rejects(execution.run({...node,config:{integration_id:'other-project'}},()=>service.resolveLlmIntegrationForUsage({...scope,usageKey:'ai.test_case.design',integrationId:'other-project'})),{code:'LLM_PROJECT_SCOPE_DENIED'});
});
