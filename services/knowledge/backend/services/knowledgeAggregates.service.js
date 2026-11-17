"use strict";

// Aggregate questions ("how many open defects are there?") are answered from the
// records themselves, not from passages.
//
// Passage retrieval can only quote text that happens to contain a number, and the
// live snapshot only knows what it pre-computes, so a count question used to be
// answered from whatever text mentioned counts. A count is a computed fact: this
// module recognises the simple, exactly-expressible forms, runs a typed,
// permission-checked, parameterised COUNT, and returns it as evidence that names
// the query it ran.
//
// The rule that keeps it honest: a computed fact is produced only when EVERY
// constraint in the question maps to a typed filter that exists in the data. If
// the question also asks for "in the last sprint", "per release" or a status the
// project does not use, this declines and normal retrieval continues, rather than
// returning an unqualified total that could be misread as the answer.

const crypto = require("node:crypto");
const db = require("@hellotest/platform/backend/src/db");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const featureFlagService = require("@hellotest/platform/backend/services/featureFlag.service");
const { fingerprint, sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");

const ENTITIES = Object.freeze({
  bug: { label: "defects", scope: "aggregate-bugs", permission: "feedback.view", noun: /\b(?:defects?|bugs?|issues?)\b/i,
    from: "feedback", where: "feedback.project_id = ?", status: "feedback.status", severity: "feedback.severity" },
  execution: { label: "test runs", scope: "aggregate-runs", permission: "run.view", noun: /\b(?:test )?runs\b|\b(?:test )?run\b|\bexecutions?\b/i,
    from: "executions", where: "executions.project_id = ?", status: "executions.status" },
  requirement: { label: "stories", scope: "aggregate-stories", permission: "requirement.view", noun: /\b(?:stor(?:y|ies)|requirements?)\b/i,
    from: "requirements", where: "requirements.project_id = ?", status: "requirements.status" },
  test_case: { label: "test cases", scope: "aggregate-test-cases", permission: "testcase.view", noun: /\btest cases?\b|\bcases\b/i,
    from: "test_cases JOIN app_types ON app_types.id = test_cases.app_type_id", where: "app_types.project_id = ?", status: "test_cases.status" }
});
// A run noun must win over a case noun in "failed test runs"; a case noun wins in "test cases".
const ENTITY_ORDER = ["bug", "execution", "test_case", "requirement"];

const COUNT_INTENT = /\b(?:how many|number of|count of|total number of|total count of|how much)\b/i;
// Qualifiers this module cannot express as a typed filter. Their presence means the
// question is richer than a total, so it declines.
const UNSUPPORTED_QUALIFIER = new RegExp([
  String.raw`\b(?:last|this|current|previous|past|next)\s+(?:sprint|release|week|month|quarter|year|day|days|build|run)\b`,
  String.raw`\b(?:since|between|before|after|during|until)\b`,
  String.raw`\bper\b`, String.raw`\bby\s+(?:release|sprint|status|severity|assignee|priority|module|suite|app|application)\b`,
  String.raw`\b(?:in|for|on|of|within|under)\s+(?:the\s+|our\s+|this\s+)?(?:[\w-]+\s+){0,3}(?:module|suite|app|application|release|sprint|environment|iteration|folder|collection|project area|team)\b`,
  String.raw`\b(?:assigned to|created by|owned by|reported by)\b`
].join("|"), "i");
const QUALIFIER_WORDS = /\b(failed|failing|passed|passing|blocked|open|opened|closed|resolved|reopened|draft|ready|done|completed|complete|running|queued|pending|cancelled|canceled|critical|blocker|major|minor|trivial|high|medium|low)\b/gi;
const SYNONYMS = { failing: "failed", passing: "passed", opened: "open", complete: "completed", canceled: "cancelled" };

const canonical = (word) => SYNONYMS[String(word).toLowerCase()] || String(word).toLowerCase();

/** @returns {null | {entity: string, qualifiers: string[]}} */
const detect = (question) => {
  const text = String(question || "");
  if (!COUNT_INTENT.test(text) || UNSUPPORTED_QUALIFIER.test(text)) return null;
  const entity = ENTITY_ORDER.find((name) => ENTITIES[name].noun.test(text));
  if (!entity) return null;
  const qualifiers = [...new Set([...text.matchAll(QUALIFIER_WORDS)].map((match) => canonical(match[1])))];
  return { entity, qualifiers };
};

const allowedToView = async (user, permission, projectId) => {
  if (!user) return false;
  try {
    return await permissionService.hasPermission(user, permission, projectId)
      && await featureFlagService.areEnabled(featureFlagService.getFeatureKeysForPermission(permission), { user });
  } catch { return false; }
};

const normalizeValue = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/**
 * Compute the count, or decline (null) when any qualifier has no matching value in
 * the data. Reads the entity's distinct statuses (and severities) first, so a word
 * the project does not use is declined instead of silently counting zero.
 */
const compute = async ({ projectId, spec, store = db }) => {
  const entity = ENTITIES[spec.entity];
  const filters = {};
  const clauses = [entity.where];
  const params = [projectId];
  const distinct = async (column) => (await store.prepare(`SELECT DISTINCT LOWER(COALESCE(${column}, '')) AS value FROM ${entity.from} WHERE ${entity.where} LIMIT 100`).all(projectId))
    .map((row) => normalizeValue(row.value)).filter(Boolean);
  const [statuses, severities] = await Promise.all([distinct(entity.status), entity.severity ? distinct(entity.severity) : Promise.resolve([])]);
  for (const word of spec.qualifiers) {
    if (statuses.includes(word) && !filters.status) { filters.status = word; clauses.push(`LOWER(${entity.status}) = ?`); params.push(word); }
    else if (severities.includes(word) && !filters.severity) { filters.severity = word; clauses.push(`LOWER(${entity.severity}) = ?`); params.push(word); }
    else return null;
  }
  const sql = `SELECT COUNT(*)::INTEGER AS count FROM ${entity.from} WHERE ${clauses.join(" AND ")}`;
  const row = await store.prepare(sql).get(...params);
  const display = sql.replace(/\?/g, (() => { let index = 0; return () => index === 0 ? (index++, ":project_id") : `'${String(params[index++] ?? "")}'`; })());
  return { value: Number(row?.count || 0), filters, query: display };
};

const factHit = ({ projectId, spec, result, asOf }) => {
  const entity = ENTITIES[spec.entity];
  const filterText = Object.entries(result.filters).map(([name, value]) => `${name} ${value}`).join(", ");
  const title = `Computed count of ${entity.label}${filterText ? ` (${filterText})` : ""}`;
  const content = sanitizeAiText(JSON.stringify({
    computed_fact: true, metric: "count", entity: entity.label, value: result.value, filters: result.filters, as_of: asOf,
    query: result.query, scope: "All records of this kind in the project that the caller may view.",
    note: "This number was computed by a typed query, not read from a document."
  })).text;
  const hash = fingerprint(`${projectId}:${spec.entity}:${JSON.stringify(result.filters)}:${result.value}:${asOf}`);
  const chunkId = `live-${entity.scope}-${crypto.createHash("sha256").update(hash).digest("hex").slice(0, 32)}`;
  const sourceId = `live-project-${projectId}-${entity.scope}`;
  return {
    id: chunkId, chunk_id: chunkId, document_id: `live-project-${projectId}`, source_id: sourceId, title, source_kind: "live_project", source_ref_id: projectId,
    content, excerpt: content.slice(0, 700), risk_flags: [], score: 1, relevance: 1, lexical_score: 1, semantic_score: 0, computed_fact: true,
    citation: { id: `K-${chunkId}`, label: title, source_id: sourceId, source_kind: "live_project", source_ref_id: projectId, source_uri: null,
      document_id: `live-project-${projectId}`, chunk_id: chunkId, excerpt: content.slice(0, 700), source_hash: fingerprint(`project:${projectId}`),
      version_hash: hash, chunk_hash: hash, location: { heading: title, chunk_index: 0, char_start: 0, char_end: content.length, page: null } }
  };
};

/**
 * Evidence for an aggregate question: a computed fact, or nothing.
 * Declines (empty) when the question is not a simple count, the caller may not
 * view the records, or any constraint in the question has no typed filter.
 */
const hits = async ({ projectId, user, question, store = db, now = () => new Date() }) => {
  const spec = detect(question);
  if (!spec) return [];
  if (!await allowedToView(user, ENTITIES[spec.entity].permission, projectId)) return [];
  const result = await compute({ projectId, spec, store });
  return result ? [factHit({ projectId, spec, result, asOf: now().toISOString() })] : [];
};

module.exports = { ENTITIES, SCOPE_PERMISSIONS: Object.freeze(Object.fromEntries(Object.values(ENTITIES).map((entity) => [entity.scope, [entity.permission]]))), compute, detect, hits };
