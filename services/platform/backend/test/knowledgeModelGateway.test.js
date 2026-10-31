const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../../../knowledge/backend/services/knowledgeExecution.service");
const gateway = require("../../../knowledge/backend/services/knowledgeModelGateway.service");
const assistant = require("../../../chatbot/backend/services/knowledgeAssistant.service");

test("failed provider attempts consume the model call budget", async () => {
  let attempts = 0;
  gateway.registerAdapter("failure-test", async () => { attempts++; throw new Error("Unavailable"); });
  await execution.run({ modelBudget: { max_tool_calls: 1 } }, async () => {
    const request = { integration: { model: "test", config: { protocol: "failure-test" } }, messages: [] };
    await assert.rejects(gateway.request(request), /Unavailable/);
    await assert.rejects(gateway.request(request), { code: "MODEL_BUDGET_EXCEEDED" });
  });
  assert.equal(attempts, 1);
});

test("explicit cost ceilings refuse unpriced models before dispatch", async () => {
  let attempts = 0;
  gateway.registerAdapter("unpriced-test", async () => { attempts++; return {}; });
  await execution.run({ modelBudget: { max_tool_calls: 2, max_query_cost_usd: 0.01 } }, async () => {
    await assert.rejects(gateway.request({ integration: { model: "test", config: { protocol: "unpriced-test" } }, messages: [] }), { code: "MODEL_PRICING_REQUIRED" });
  });
  assert.equal(attempts, 0);
});

test("provider compatibility keeps an output limit through explicit parameter negotiation", async context => {
  const configuration=require('../services/aiConfiguration.service');
  context.mock.method(configuration,'resolve',async id=>{const item=configuration.catalog.find(item=>item.id===id);return {...item,config:{...item.defaults,max_output_tokens:4096},published_version:0,fingerprint:configuration.hash(item.defaults)};});
  context.mock.method(require('../services/metricGovernance.service'),'resolveForFeature',async()=>({instruction:'',metrics:[]}));
  const original = global.fetch;
  const requests = [];
  global.fetch = async (_, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    if (requests.length === 1) return new Response(JSON.stringify({ error: "Unsupported parameter max_tokens; use max_completion_tokens." }), { status: 400 });
    if (requests.length === 2) return new Response(JSON.stringify({ error: "temperature does not support 0; only the default is supported." }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  };
  try {
    const result = await assistant._internals.requestJsonCompletion({ integration: { base_url: "https://compatibility.invalid/v1", api_key: "test-key", model: "test" }, messages: [{ role: "user", content: "test" }], operation: "knowledge.assistant.verify" });
    assert.equal(result.ok, true);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].max_tokens, 4096);
    assert.equal(requests[1].max_completion_tokens, 4096);
    assert.equal(requests[2].max_completion_tokens, 4096);
    assert.equal(requests[2].temperature, undefined);
  } finally { global.fetch = original; }
});

test("missing provider usage does not reopen a reserved cost budget", async () => {
  let attempts = 0;
  gateway.registerAdapter("missing-usage-test", async () => { attempts++; return {}; });
  await execution.run({ modelBudget: { max_tool_calls: 5, max_query_cost_usd: 5 } }, async () => {
    const input = { integration: { model: "test", config: { protocol: "missing-usage-test", pricing: { input_per_million_usd: 1000, output_per_million_usd: 1000 } } }, messages: [] };
    await gateway.request(input);
    await assert.rejects(gateway.request(input), { code: "MODEL_COST_BUDGET_EXCEEDED" });
  });
  assert.equal(attempts, 1);
});
