const connections = require("./connections");
const mcp = require("./mcpClient");
const permissions = require("@hellotest/platform/backend/services/permission.service");
const flags = require("@hellotest/platform/backend/services/featureFlag.service");
const {
  sanitizeAiText,
} = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const KINDS = new Set([
  "customAI",
  "apiTool",
  "apiAgent",
  "webAgent",
  "mcpTool",
  "knowledgeTool",
  "repositoryTool",
  "testOpsTool",
  "condition",
  "loop",
  "transform",
  "errorHandler",
  "log",
]);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
function parseObject(value, label) {
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw connections.fail(`${label} must be valid JSON.`);
  }
  if (!object(parsed))
    throw connections.fail(`${label} must be a JSON object.`);
  if (Buffer.byteLength(JSON.stringify(parsed)) > 16384)
    throw connections.fail(`${label} must be at most 16 KB.`);
  return parsed;
}
function readPath(root, path) {
  const parts = String(path || "")
    .replace(/^\$/, "")
    .split(".")
    .filter(Boolean);
  if (
    parts.some((key) =>
      ["__proto__", "constructor", "prototype"].includes(key),
    ) ||
    parts.length > 12
  )
    throw connections.fail("Use a simple data path without prototype keys.");
  return parts.reduce(
    (value, key) =>
      value != null && Object.hasOwn(value, key) ? value[key] : undefined,
    root,
  );
}
function mapValues(template, context, depth = 0) {
  if (depth > 12) throw connections.fail("Field mapping is too deeply nested.");
  if (
    typeof template === "string" &&
    /^\$(input|request|item)(\.|$)/.test(template)
  )
    return readPath(context, template) ?? null;
  if (Array.isArray(template))
    return template.map((value) => mapValues(value, context, depth + 1));
  if (object(template))
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => {
        if (["__proto__", "constructor", "prototype"].includes(key))
          throw connections.fail("Field mapping contains a reserved key.");
        return [key, mapValues(value, context, depth + 1)];
      }),
    );
  return template;
}
const contextFor = (run, sources) => ({
  request: run.input_payload,
  input:
    sources.length === 1
      ? (sources[0].output?.data ??
        sources[0].output?.request ??
        sources[0].output)
      : sources.map((source) => source.output),
  item: null,
});
function condition(data, context) {
  const actual = readPath(context, data.conditionPath || "input.status");
  let expected;
  try {
    expected = JSON.parse(data.conditionValue || "true");
  } catch {
    throw connections.fail(
      "Comparison value must be JSON (quote text values).",
    );
  }
  switch (data.conditionOperator || "equals") {
    case "exists":
      return actual !== undefined && actual !== null;
    case "equals":
      return JSON.stringify(actual) === JSON.stringify(expected);
    case "notEquals":
      return JSON.stringify(actual) !== JSON.stringify(expected);
    case "contains":
      return typeof actual === "string" && typeof expected === "string"
        ? actual.includes(expected)
        : Array.isArray(actual) &&
            actual.some(
              (value) => JSON.stringify(value) === JSON.stringify(expected),
            );
    case "greater":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual > expected
      );
    case "less":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual < expected
      );
    default:
      throw connections.fail("Choose a supported comparison.");
  }
}
function validate(node) {
  const { data = {} } = node;
  const kind = data.kind || node.type;
  const errors = [];
  const check = (task) => {
    try {
      task();
    } catch (error) {
      errors.push(error.publicMessage || error.message);
    }
  };
  if (["transform", "loop"].includes(kind))
    check(() => parseObject(data.transformMapping || "{}", "Field mapping"));
  if (kind === "condition") check(() => condition(data, {}));
  if (kind === "mcpTool") {
    if (!data.connectionId || !data.mcpTool)
      errors.push("Choose an MCP server and tool.");
    check(() => parseObject(data.mcpArguments || "{}", "Tool arguments"));
  }
  if (["apiTool", "apiAgent", "webAgent"].includes(kind)) {
    if (!data.apiUrl && !data.connectionId)
      errors.push("Enter an endpoint or select a connection.");
    if (data.apiAuth || data.credentialId)
      errors.push(
        "Replace inline authentication with a server-managed connection.",
      );
    if (
      Number(data.retryCount) > 0 &&
      !["GET", "HEAD"].includes(data.apiMethod || "GET")
    )
      errors.push(
        "Set retries to zero for HTTP requests that may change data.",
      );
  }
  if (kind === "mcpTool" && Number(data.retryCount) > 0)
    errors.push(
      "MCP calls cannot be automatically retried. Set retries to zero.",
    );
  if (kind === "loop") {
    if (!["transform", "customAI"].includes(data.loopAction || "transform"))
      errors.push("Choose field mapping or AI review for each item.");
    if (
      !Number.isInteger(Number(data.loopMaxIterations)) ||
      Number(data.loopMaxIterations) < 1 ||
      Number(data.loopMaxIterations) > 10
    )
      errors.push("For each supports 1–10 items per execution.");
    if (data.loopAction === "customAI" && !String(data.prompt || "").trim())
      errors.push("Describe the AI task for each item.");
  }
  if (
    kind === "testOpsTool" &&
    data.testOpsAction &&
    data.testOpsAction !== "read-runs"
  )
    errors.push("Run evidence is read-only. Select Read runs.");
  return errors;
}
async function execute({
  run,
  node,
  sources,
  user,
  signal,
  onProgress,
  review,
}) {
  const data = node.data || {},
    kind = data.kind || node.type;
  const context = contextFor(run, sources);
  if (kind === "customAI")
    return review(run, {
      ...node,
      data: { ...data, kind: "agent", agentId: "quality-evaluator" },
    });
  if (["apiTool", "apiAgent", "webAgent"].includes(kind))
    return connections.callHttp({
      projectId: run.project_id,
      data: {
        ...data,
        apiMethod: kind === "webAgent" ? "GET" : data.apiMethod,
      },
      signal,
    });
  if (kind === "mcpTool")
    return mcp.call(
      {
        projectId: run.project_id,
        connectionId: data.connectionId,
        signal,
        timeoutMs: Number(data.timeoutMs) || 30000,
      },
      data.mcpTool,
      mapValues(
        parseObject(data.mcpArguments || "{}", "Tool arguments"),
        context,
      ),
    );
  if (kind === "transform")
    return {
      data: mapValues(
        parseObject(data.transformMapping || "{}", "Field mapping"),
        context,
      ),
    };
  if (kind === "condition")
    return { matched: condition(data, context), data: context.input };
  if (kind === "log")
    return {
      data: context.input,
      message: sanitizeAiText(
        String(data.logMessage || "Received connected data."),
      ).text,
    };
  if (kind === "errorHandler")
    return {
      data: sources.map((source) => ({
        node_id: source.node_id,
        status: source.status,
        error: source.error || null,
      })),
      recovered: true,
    };
  if (kind === "loop") {
    const items = readPath(context, data.loopSourceKey || "input.items");
    if (!Array.isArray(items))
      throw connections.fail(
        "For each input must resolve to an array. Check the Items path against the Input panel.",
      );
    const max = Number(data.loopMaxIterations);
    if (items.length > max)
      throw connections.fail(
        `For each received ${items.length} items; its limit is ${max}. Split the input or increase the limit (maximum 10).`,
      );
    const results = [];
    for (let index = 0; index < items.length; index++) {
      if (signal.aborted) throw connections.fail("Iteration cancelled.", 499);
      await onProgress({
        percent: Math.round((index / items.length) * 100),
        current_item: index + 1,
        total_items: items.length,
        stages: results.map((_, i) => ({
          id: String(i),
          label: `Item ${i + 1}`,
          status: "completed",
        })),
      });
      const value =
        data.loopAction === "customAI"
          ? await review(
              {
                ...run,
                input_payload: {
                  ...run.input_payload,
                  item: items[index],
                  item_index: index,
                },
              },
              {
                ...node,
                data: { ...data, kind: "agent", agentId: "quality-evaluator" },
              },
            )
          : {
              data: mapValues(
                parseObject(data.transformMapping || "{}", "Field mapping"),
                { ...context, item: items[index] },
              ),
            };
      results.push({ index, ...value });
    }
    await onProgress({
      percent: 100,
      current_item: items.length,
      total_items: items.length,
      stages: results.map((_, i) => ({
        id: String(i),
        label: `Item ${i + 1}`,
        status: "completed",
      })),
    });
    return {
      data: results,
      processed: results.length,
      ...(results.some(
        (result) =>
          result.readiness && result.readiness.status !== "ready_for_review",
      )
        ? { readiness: { status: "limited" } }
        : {}),
    };
  }
  if (["knowledgeTool", "repositoryTool", "testOpsTool"].includes(kind)) {
    if (
      !(await permissions.hasPermission(
        user,
        "knowledge.view",
        run.project_id,
      )) ||
      !(await flags.areEnabled(
        flags.getFeatureKeysForPermission("knowledge.view"),
        { user },
      ))
    )
      throw connections.fail(
        "Knowledge Repo access is required for this evidence node.",
        403,
      );
    const filters =
      kind === "testOpsTool"
        ? { source_kinds: ["execution"] }
        : kind === "repositoryTool"
          ? { source_kinds: ["knowledge_item", "file", "text"] }
          : {};
    const packet =
      await require("@hellotest/knowledge/backend/services/knowledgeRetrieval.service").retrieve(
        {
          projectId: run.project_id,
          appTypeId: run.app_type_id,
          query: String(
            data.knowledgeQuery ||
              (kind === "testOpsTool"
                ? "Recent test runs and results"
                : kind === "repositoryTool"
                  ? "Repository code and object metadata"
                  : "Project quality evidence"),
          ),
          filters,
          user,
          signal,
          budgets: {
            deadline_ms: Math.min(15000, Number(data.timeoutMs) || 15000),
            max_evidence_items: 10,
            max_query_cost_usd: 0,
          },
        },
      );
    return {
      data: packet.evidence,
      context_packet_id: packet.context_packet_id,
      limitations: packet.limitations,
    };
  }
  throw connections.fail("This node does not have an execution adapter.");
}
module.exports = {
  KINDS,
  validate,
  execute,
  _internals: { parseObject, readPath, mapValues, condition, contextFor },
};
