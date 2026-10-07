const execution = require("./knowledgeExecution.service");
const { retryKnowledgeModel } = require("@hellotest/platform/backend/src/utils/knowledgeModelRetry");

const adapters = new Map();
const registerAdapter = (protocol, adapter) => {
  if (!protocol || typeof adapter !== "function") throw new TypeError("A named model adapter is required.");
  adapters.set(protocol, adapter);
};

const recordUsage = ({ integration, operation, usage = {} }) => {
  const context = execution.current();
  if (!context) return;
  const count = (value) => value != null && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : NaN;
  const inputTokens = count(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = count(usage.completion_tokens ?? usage.output_tokens);
  const rates = integration.config?.pricing || {};
  const priced = Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
    && Number.isFinite(Number(rates.input_per_million_usd)) && Number.isFinite(Number(rates.output_per_million_usd));
  const cost = priced ? (inputTokens * Number(rates.input_per_million_usd) + outputTokens * Number(rates.output_per_million_usd)) / 1_000_000 : null;
  context.usage.push({ operation, model: integration.model, input_tokens: Number.isFinite(inputTokens) ? inputTokens : null, output_tokens: Number.isFinite(outputTokens) ? outputTokens : null, cost_usd: cost });
};

const reserveAttempt = (input, maxOutputTokens, context) => {
  const budget = context?.modelBudget;
  if (budget && Number(context.modelStats.calls || 0) >= budget.max_tool_calls) throw Object.assign(new Error("Model call budget reached."), { code: "MODEL_BUDGET_EXCEEDED" });
  if (budget?.max_query_cost_usd != null) {
    const rates = input.integration.config?.pricing || {};
    if (![rates.input_per_million_usd, rates.output_per_million_usd].every((rate) => rate != null && Number.isFinite(Number(rate)) && Number(rate) >= 0)) {
      throw Object.assign(new Error("A cost-limited request requires configured model pricing."), { code: "MODEL_PRICING_REQUIRED" });
    }
    // Retain conservative reservations when providers omit usage or a request
    // fails after dispatch; missing usage cannot reopen the same cost budget.
    const used = Number(context.modelStats.reservedCostUsd || 0);
    // Conservative admission estimate; actual provider usage is recorded below.
    const inputBound = Buffer.byteLength(JSON.stringify(input.messages), "utf8") + 256;
    const estimated = (inputBound * Number(rates.input_per_million_usd) + maxOutputTokens * Number(rates.output_per_million_usd)) / 1_000_000;
    if (used + estimated > budget.max_query_cost_usd) throw Object.assign(new Error("The model cost budget would be exceeded."), { code: "MODEL_COST_BUDGET_EXCEEDED" });
    context.modelStats.reservedCostUsd = used + estimated;
  }
  if (context) context.modelStats.calls += 1;
};

const request = async (input) => {
  execution.assertActive();
  const protocol = input.integration.config?.protocol || "openai_compatible";
  const adapter = adapters.get(protocol) || (protocol === "openai_compatible" ? require("./knowledgeJsonCompletion.service") : null);
  if (!adapter) throw Object.assign(new Error(`Unsupported model protocol: ${protocol}`), { code: "MODEL_PROTOCOL_UNSUPPORTED" });
  const context = execution.current();
  const maxOutputTokens = Math.max(1, Math.min(4096, Number.parseInt(input.maxOutputTokens, 10) || 4096));
  return retryKnowledgeModel(({ signal, timeoutMs, attempt }) => {
    const active = execution.current();
    reserveAttempt(input, maxOutputTokens, active);
    if (attempt > 1) active.modelStats.retries = Number(active.modelStats.retries || 0) + 1;
    return adapter({ ...input, maxOutputTokens, timeoutMs, signal, recordUsage });
  }, {
    timeoutMs: input.timeoutMs ?? 45_000,
    attemptTimeoutMs: input.attemptTimeoutMs,
    signal: input.signal ?? context?.signal,
    stage: (input.operation?.includes("plan-retrieval") || input.operation?.includes("plan-intent")) ? "RETRIEVAL_PLANNING" : "GENERATION",
    canRetry: () => !Number.isFinite(context?.modelBudget?.max_tool_calls) || Number(context.modelStats.calls || 0) < context.modelBudget.max_tool_calls
  });
};

module.exports = { registerAdapter, request, recordUsage };
