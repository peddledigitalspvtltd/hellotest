const connections = require("./connections");
const { isDeepStrictEqual } = require("node:util");
const mcp = require("./mcpClient");
const permissions = require("@hellotest/platform/backend/services/permission.service");
const flags = require("@hellotest/platform/backend/services/featureFlag.service");
const {
  sanitizeAiText,
} = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const KINDS = new Set([
  "customAI",
  "artifactTask",
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
function parseRequestBody(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 128 * 1024) throw connections.fail("Request body must be JSON text within 128 KB.");
  try { return JSON.parse(value); }
  catch { throw connections.fail("Request body must be valid JSON."); }
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
    /^\$(input|request|item|nodes|iteration)(\.|$)/.test(template)
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
const inputValue = output => output && Object.hasOwn(output, "data") ? output.data
  : output && Object.hasOwn(output, "request") ? output.request : output;
const sourceValue = (source, internal = false) => inputValue(internal && source.execution_context ? source.execution_context : source.output);
// Preserve connection order, append arrays one level, and retain each source's
// range so a merge never confuses completion order with data provenance.
function appendInputs(sources) {
  const data = [], source_items = [];
  for (const source of sources) {
    const value = inputValue(source.output);
    const items = Array.isArray(value) ? value : [value];
    source_items.push({ node_id: source.node_id, ...(source.output_key ? { output_key: source.output_key } : {}), start_index: data.length, item_count: items.length });
    data.push(...items);
  }
  return { data, source_items };
}
// Object inputs combine recursively. Identical shared fields are kept once;
// arrays append in connection order. A conflicting scalar is an explicit list
// of alternatives, never an implicit last-writer-wins overwrite. Source labels
// remain available through $nodes and every conflict has inspectable provenance.
function mergeInputs(sources, { internal = false } = {}) {
  const conflicts = [];
  const merge = (entries, path = []) => {
    if (entries.every(entry => isDeepStrictEqual(entry.value, entries[0].value))) return entries[0].value;
    if (path.length < 12 && entries.every(entry => object(entry.value))) {
      const keys = [...new Set(entries.flatMap(entry => Object.keys(entry.value)))];
      return Object.fromEntries(keys.map(key => [key, merge(entries.filter(entry => Object.hasOwn(entry.value, key)).map(entry => ({ ...entry, value: entry.value[key] })), [...path, key])]));
    }
    if (entries.every(entry => Array.isArray(entry.value))) return entries.flatMap(entry => entry.value);
    conflicts.push({ path: path.length ? path.join(".") : "$", node_ids: entries.map(entry => entry.node_id) });
    return entries.map(entry => entry.value);
  };
  return { data: sources.length ? merge(sources.map(source => ({ node_id: source.node_id, value: sourceValue(source, internal) }))) : {}, conflicts };
}
function mergeExecutionContext(sources) {
  if (!sources.length || sources.some(source => !Array.isArray(source.execution_context?.data))) return null;
  const packets = new Map();
  const combine = (left, right, path) => {
    if (isDeepStrictEqual(left, right)) return left;
    if (path.length < 12 && object(left) && object(right)) return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map(key => [key,
      !Object.hasOwn(left, key) ? right[key] : !Object.hasOwn(right, key) ? left[key] : combine(left[key], right[key], [...path,key])]));
    throw Object.assign(connections.fail(`Connected native branches contain conflicting Story lineage at ${path.join(".")}. Rejoin matching Story revisions and drafts before continuing.`, 409), { code: "WORKFLOW_LINEAGE_CONFLICT" });
  };
  for (const source of sources) for (const packet of source.execution_context.data) {
    if (!object(packet) || typeof packet.story_id !== "string" || !packet.story_id) throw connections.fail("A native execution checkpoint is missing its Story identity.", 409);
    packets.set(packet.story_id, packets.has(packet.story_id) ? combine(packets.get(packet.story_id), packet, [packet.story_id]) : packet);
  }
  return { data: [...packets.values()] };
}
function contextFor(run, sources, { internal = false } = {}) {
  const nativeContext = internal ? mergeExecutionContext(sources) : null;
  const combined = sources.length > 1 ? mergeInputs(sources, { internal }) : null;
  return {
    request: run.input_payload,
    input: Object.hasOwn(run, "iteration_input") ? run.iteration_input : nativeContext ? nativeContext.data : !sources.length ? run.input_payload : sources.length === 1 ? sourceValue(sources[0], internal) : combined.data,
    nodes: Object.fromEntries(sources.flatMap(source => [[source.node_id, source.output], ...(source.output_key && source.output_key !== source.node_id ? [[source.output_key, source.output]] : [])])),
    item: Object.hasOwn(run, "iteration_input") ? run.iteration_input : run.input_payload?.item ?? null,
    ...(Object.hasOwn(run, "iteration_index") ? { iteration: { index: run.iteration_index, number: run.iteration_index + 1, total: run.iteration_total ?? null } } : {}),
    ...(combined ? { merge: { mode: "combine_fields", conflicts: combined.conflicts } } : {}),
  };
}
function interpolate(value, context, encode = false) {
  return String(value || "").replace(/\{\{\s*(\$(?:input|request|item|nodes|iteration)(?:\.[\w-]+)*)\s*\}\}/g, (_, path) => {
    const resolved = readPath(context, path);
    if (resolved == null || typeof resolved === "object") throw connections.fail(`The value at ${path} must be text, a number or a boolean.`);
    return encode ? encodeURIComponent(String(resolved)) : String(resolved);
  });
}
function condition(data, context) {
  if (data.conditions != null) {
    if (!Array.isArray(data.conditions) || !data.conditions.length || data.conditions.length > 20 || data.conditions.some(item => !object(item) || item.conditions != null)) throw connections.fail("Use 1–20 simple conditions.");
    if (data.conditionCombinator && !["all", "any"].includes(data.conditionCombinator)) throw connections.fail("Combine conditions using all or any.");
    // Validate all comparisons, including comparisons skipped by boolean
    // short-circuiting, before choosing a branch.
    const matches = data.conditions.map(item => condition(item, context));
    return data.conditionCombinator === "any" ? matches.some(Boolean) : matches.every(Boolean);
  }
  const actual = readPath(context, data.conditionPath || "input.status");
  const exists = actual !== undefined && actual !== null;
  const empty = !exists || actual === "" || ((Array.isArray(actual) || object(actual)) && Object.keys(actual).length === 0);
  if (["exists", "notExists", "isEmpty", "notEmpty", "isTrue", "isFalse"].includes(data.conditionOperator)) return ({ exists, notExists: !exists, isEmpty: empty, notEmpty: !empty, isTrue: actual === true, isFalse: actual === false })[data.conditionOperator];
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
      return isDeepStrictEqual(actual, expected);
    case "notEquals":
      return !isDeepStrictEqual(actual, expected);
    case "contains":
      return typeof actual === "string" && typeof expected === "string"
        ? actual.includes(expected)
        : Array.isArray(actual) &&
            actual.some(
              (value) => isDeepStrictEqual(value, expected),
            );
    case "notContains":
      return typeof actual === "string" && typeof expected === "string" ? !actual.includes(expected)
        : Array.isArray(actual) && !actual.some(value => isDeepStrictEqual(value, expected));
    case "startsWith":
      return typeof actual === "string" && typeof expected === "string" && actual.startsWith(expected);
    case "endsWith":
      return typeof actual === "string" && typeof expected === "string" && actual.endsWith(expected);
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
    case "greaterOrEqual":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lessOrEqual":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
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
  if (kind === "transform" || (kind === "loop" && !["customAI", "storyPackets"].includes(data.loopAction)))
    check(() => parseObject(data.transformMapping || "{}", "Field mapping"));
  if (Number(data.retryCount) > 0 && !require("./runtimeEvents").canRetry(kind, data))
    errors.push("Retries are available for AI reviews and HTTP GET/HEAD requests. Set retries to zero for this node.");
  if (kind === "condition") check(() => condition(data, {}));
  if (kind === "mcpTool") {
    if (!data.connectionId || !data.mcpTool)
      errors.push("Choose an MCP server and tool.");
    check(() => parseObject(data.mcpArguments || "{}", "Tool arguments"));
  }
  if (["apiTool", "apiAgent", "webAgent"].includes(kind)) {
    if (data.apiBody && !["GET", "HEAD"].includes(String(data.apiMethod || "GET").toUpperCase())) check(() => parseRequestBody(data.apiBody));
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
    if (data.loopBatchSize != null && data.loopBatchSize !== "" && Number(data.loopBatchSize) !== 1)
      errors.push("For each processes one item at a time. Batch size must be 1; cyclic or parallel batches are not supported.");
    if (!["transform", "customAI", "storyPackets"].includes(data.loopAction || "transform"))
      errors.push("Choose field mapping or AI review for each item.");
    if (
      !Number.isInteger(Number(data.loopMaxIterations)) ||
      Number(data.loopMaxIterations) < 1 ||
      Number(data.loopMaxIterations) > (data.loopAction === "storyPackets" ? 100 : 10)
    )
      errors.push(data.loopAction === "storyPackets" ? "For each Story supports 1–100 Stories per execution." : "For each supports 1–10 items per execution.");
    if (data.loopAction === "customAI" && !String(data.prompt || "").trim())
      errors.push("Describe the AI task for each item.");
  }
  if (kind === "artifactTask" && !require("./artifactTasks").TASKS.has(data.artifactTask)) errors.push("Choose a native artifact task.");
  if (kind === "artifactTask" && data.artifactTask === "automation-engineer" && data.readinessPolicy != null && !["verify-inputs", "require-ready"].includes(data.readinessPolicy)) errors.push("Choose whether Automation Engineer verifies inputs or requires a ready assurance assessment.");
  if (data.apiPagination && !["none", "cursor"].includes(data.apiPagination)) errors.push("Choose supported cursor pagination.");
  if (data.apiResource === "sprintStories" && !data.connectionId) errors.push("Select a managed HelloTest HTTP API connection with an API key.");
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
  const context = contextFor(run, sources, { internal: kind === "artifactTask" });
  if (kind === "artifactTask") return require("./artifactTasks").execute({ run, node, sources, user, signal, onProgress, context });
  if (data.apiResource === "sprintStories") {
    require("./artifactTasks").checkInput(run);
    await require("./artifactTasks").access(user, run.project_id, ["requirement.view"]);
    const { connection, url } = await connections.resolve(data.connectionId, run.project_id, data.apiUrl || undefined);
    if (!connection) throw connections.fail("Select a managed HelloTest HTTP connection with an API key.", 422);
    const endpoint = new URL(url);
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, "").replace(/\/requirements$/, "") + "/requirements";
    endpoint.search = "";
    endpoint.searchParams.set("project_id", run.project_id);
    endpoint.searchParams.set("sprint_id", String(run.input_payload.sprint_id));
    endpoint.searchParams.set("include_page", "true");
    endpoint.searchParams.set("page_size", "20");
    // The whole selected Sprint must fit the native Story pipeline budget.
    // Pagination never returns a successful prefix of a larger Sprint.
    return connections.callHttp({ projectId: run.project_id, data: { ...data, apiUrl: endpoint.toString(), apiMethod: "GET", apiPagination: "cursor", apiMaxItems: 100 }, signal });
  }
  if (kind === "customAI")
    return review(run, {
      ...node,
      data: { ...data, kind: "agent", agentId: "quality-evaluator", customTask: true },
    });
  if (["apiTool", "apiAgent", "webAgent"].includes(kind))
    return connections.callHttp({
      projectId: run.project_id,
      data: {
        ...data,
        apiUrl: interpolate(data.apiUrl, context, true),
        apiBody: data.apiBody && !["GET", "HEAD"].includes(String(data.apiMethod || "GET").toUpperCase()) ? JSON.stringify(mapValues(parseRequestBody(data.apiBody), context)) : "",
        apiMethod: kind === "webAgent" ? "GET" : data.apiMethod,
      },
      signal,
    });
  if (kind === "mcpTool")
    return mcp.call(
      {
        projectId: run.project_id,
        connectionId: data.connectionId,
        user,
        expectedToolHash: data.mcpToolHash,
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
        interpolate(data.logMessage || "Received connected data.", context),
      ).text,
    };
  if (kind === "errorHandler")
    return {
      data: sources.map((source) => ({
        node_id: source.node_id,
        status: source.status,
        error: source.error || null,
        error_details: source.error_details || null,
        input: source.input?.input ?? null,
        attempts: source.attempts || 0,
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
        `For each received ${items.length} items; its limit is ${max}. Split the input or increase the limit (maximum ${data.loopAction === "storyPackets" ? 100 : 10}).`,
      );
    const results = [];
    const mapping = ["customAI", "storyPackets"].includes(data.loopAction) ? null : parseObject(data.transformMapping || "{}", "Field mapping");
    if (data.loopAction === "storyPackets") {
      require("./artifactTasks").checkInput(run);
      const packets = [];
      for (const [index, item] of items.entries()) {
        if (signal?.aborted) throw connections.fail("Iteration cancelled.", 499);
        await onProgress?.({ percent: Math.round(index / Math.max(1, items.length) * 100), current_item: index + 1, total_items: items.length });
        const story = await require("./artifactTasks").loadStory(run, user, item);
        if (packets.some(packet => packet.story_id === story.id)) throw connections.fail("The Stories API returned a duplicate Story. Retry against a stable Sprint scope.", 409);
        packets.push({ story_id: story.id, story_revision: require("./artifactTasks").revision(story) });
      }
      await onProgress?.({ percent: 100, current_item: items.length, total_items: items.length });
      return { data: packets, processed: packets.length, for_each: "story", requires_human_review: true };
    }
    for (let index = 0; index < items.length; index++) {
      if (signal?.aborted) throw connections.fail("Iteration cancelled.", 499);
      await onProgress?.({
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
                iteration_input: items[index],
                iteration_index: index,
                iteration_total: items.length,
              },
              {
                ...node,
                data: { ...data, kind: "agent", agentId: "quality-evaluator", customTask: true },
              },
            )
          : {
              data: mapValues(
                mapping,
                { ...context, input: items[index], item: items[index], iteration: { index, number: index + 1, total: items.length } },
              ),
            };
      results.push({ index, ...value });
    }
    await onProgress?.({
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
      data: results.map(inputValue),
      items: results,
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
          query: interpolate(
            data.knowledgeQuery ||
              (kind === "testOpsTool"
                ? "Recent test runs and results"
                : kind === "repositoryTool"
                  ? "Repository code and object metadata"
                  : "Project quality evidence"),
            context),
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
  _internals: { parseObject, readPath, mapValues, condition, contextFor, inputValue, appendInputs, mergeInputs, mergeExecutionContext, interpolate },
};
