const connections=require("../../connections");
const {isDeepStrictEqual}=require("node:util");
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const httpMethod = (kind, data = {}) => {
  if (kind === 'webAgent') return 'GET';
  if (data.apiMethod !== undefined && (typeof data.apiMethod !== 'string' || !data.apiMethod.trim())) throw connections.fail('Supply the HTTP method as a nonempty supported method name.');
  return (data.apiMethod ?? 'GET').trim().toUpperCase();
};
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
    // A connected case loop returns a full Story snapshot for each iteration.
    // Case-scoped assurance writes one slot at a time, so reconcile those
    // indexed snapshots while still rejecting two different reviews for the
    // same case. Failure records are keyed by their case_index because their
    // compact arrays grow independently as failures occur.
    if (path.at(-1) === 'case_assurance' && Array.isArray(left) && Array.isArray(right)) {
      const merged = [];
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const a = left[index], b = right[index];
        merged[index] = a == null ? b : b == null ? a : combine(a, b, [...path, String(index)]);
      }
      return merged;
    }
    if (path.at(-1) === 'case_assurance_failures' && Array.isArray(left) && Array.isArray(right)
      && [...left, ...right].every(item => object(item) && Number.isInteger(item.case_index))) {
      const merged = new Map();
      for (const item of [...left, ...right]) {
        const key = String(item.case_index);
        merged.set(key, merged.has(key) ? combine(merged.get(key), item, [...path, key]) : item);
      }
      return [...merged.values()].sort((a, b) => a.case_index - b.case_index);
    }
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
    item: Object.hasOwn(run, 'loop_item') ? run.loop_item : Object.hasOwn(run, "iteration_input") ? run.iteration_input : run.input_payload?.item ?? null,
    ...(Object.hasOwn(run, "iteration_index") ? { iteration: { index: run.iteration_index, number: run.iteration_index + 1, total: run.iteration_total ?? null, ...(run.loop_batch_size ? { batch_size: run.loop_batch_size } : {}) } } : {}),
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
    if (data.conditionValue != null && typeof data.conditionValue !== 'string') throw new Error('Use JSON text.');
    if (Object.hasOwn(data, 'conditionValue') && data.conditionValue === null) throw new Error('Use JSON text.');
    expected = JSON.parse(data.conditionValue || "true");
  } catch {
    throw connections.fail(
      "Comparison value must be JSON text (for example false, 0, null or quoted text).",
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

module.exports={object,httpMethod,parseObject,parseRequestBody,readPath,mapValues,inputValue,appendInputs,mergeInputs,mergeExecutionContext,contextFor,interpolate,condition};
