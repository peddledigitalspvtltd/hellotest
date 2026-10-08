const crypto = require("crypto");
const db = require("@hellotest/platform/backend/src/db");
const obsDb = require("@hellotest/platform/backend/src/obsDb");
const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");

const CONTEXT_SCOPES = Object.freeze(["stories", "test-cases", "automation", "runs", "bugs", "knowledge"]);

const AGENT_CONTEXT_POLICIES = Object.freeze({
  "quality-orchestrator": {
    priority_scopes: ["stories", "test-cases", "runs", "bugs", "automation", "knowledge"],
    retrieval_focus: "release readiness, traceability gaps, failed or blocked evidence, open defects, and accountable specialist handoffs",
    outcome_sections: ["quality decision", "highest risks", "coverage gaps", "specialist handoffs", "review gate"],
    decision_question: "Can the current delivery scope proceed, and which evidence-backed risks or handoffs block that decision?",
    deliverable_contract: "A go/watch/no-go quality brief with ranked risks, owners or specialist handoffs, evidence gaps, and explicit exit criteria."
  },
  "story-architect": {
    priority_scopes: ["stories", "test-cases", "knowledge"],
    retrieval_focus: "Story intent, acceptance boundaries, delivery scope, linked coverage, domain rules, examples, and ambiguity",
    outcome_sections: ["Story assessment", "missing acceptance", "boundary examples", "testability risks", "proposed wording"],
    decision_question: "Is the Story testable without guessing, and what exact acceptance wording is missing?",
    deliverable_contract: "A Story review containing ambiguity findings, rewritten acceptance criteria, concrete boundary examples, and traceability impact."
  },
  "test-designer": {
    priority_scopes: ["stories", "test-cases", "runs", "bugs", "knowledge"],
    retrieval_focus: "Story risks, existing coverage, reusable steps, data boundaries, historical failures, and defect regressions",
    outcome_sections: ["coverage objective", "proposed scenarios", "data and preconditions", "reuse opportunities", "traceability"],
    decision_question: "Which risk-based Test Cases adequately cover the requested obligations, and why are those techniques and boundaries appropriate?",
    deliverable_contract: "An evidence-based test design rationale, prioritized obligation/coverage matrix, and complete Test Case drafts with concrete preconditions, data, actions, expected results, cleanup, reuse candidates and Story links."
  },
  "automation-engineer": {
    priority_scopes: ["automation", "test-cases", "runs", "bugs", "knowledge"],
    retrieval_focus: "automation readiness, reusable behavior, execution instability, test data, platform constraints, and repository bindings",
    outcome_sections: ["automation readiness", "candidate coverage", "reuse plan", "stability risks", "implementation sequence"],
    decision_question: "Which coverage is safe and valuable to automate now, and what makes the implementation maintainable?",
    deliverable_contract: "An automation readiness plan with candidate cases, shared-step/data reuse, repository bindings, stability risks, and implementation order."
  },
  "run-planner": {
    priority_scopes: ["runs", "test-cases", "stories", "bugs", "knowledge"],
    retrieval_focus: "changed delivery scope, linked Test Cases, priority, recent failures, blocked evidence, defects, and execution cost",
    outcome_sections: ["run objective", "ranked selection", "selection rationale", "excluded coverage", "exit criteria"],
    decision_question: "Which Test Cases best cover the current change and risk within the available execution budget?",
    deliverable_contract: "A ranked Smart Run selection with a reason per Test Case, exclusions, delivery scope, environment needs, and pass/fail exit criteria."
  },
  "failure-analyst": {
    priority_scopes: ["runs", "bugs", "test-cases", "knowledge"],
    retrieval_focus: "failed and blocked outcomes, repeated symptoms, environment and build boundaries, linked defects, and prior evidence",
    outcome_sections: ["observed facts", "failure clusters", "hypotheses to verify", "affected coverage", "next investigation"],
    decision_question: "What is directly evidenced about the failures, and which hypotheses should be tested next?",
    deliverable_contract: "A failure-cluster report separating observations from hypotheses, identifying affected coverage and the next diagnostic action."
  },
  "bug-reporter": {
    priority_scopes: ["runs", "test-cases", "stories", "bugs", "knowledge"],
    retrieval_focus: "strong reproducible failure evidence, expected versus actual behavior, environment, build, delivery scope, and duplicate Defects",
    outcome_sections: ["Defect title", "impact", "reproduction", "expected and actual", "traceability and evidence"],
    decision_question: "Is there enough reproducible evidence to draft a useful Defect without inventing missing behavior?",
    deliverable_contract: "A Defect draft with concise title, impact, reproducible steps, expected/actual behavior, environment/build, and linked evidence."
  },
  "bug-triage": {
    priority_scopes: ["bugs", "runs", "test-cases", "stories", "knowledge"],
    retrieval_focus: "open Defects, severity, priority, reproducibility, failing evidence, release impact, duplication, and ownership gaps",
    outcome_sections: ["triage decision", "priority rationale", "release impact", "duplicates or dependencies", "recommended owner action"],
    decision_question: "What priority and next action are justified by current impact, reproducibility, and release evidence?",
    deliverable_contract: "A triage decision with severity/priority rationale, release impact, duplicate/dependency signals, ownership gap, and next action."
  },
  "quality-evaluator": {
    priority_scopes: ["stories", "test-cases", "runs", "bugs", "automation", "knowledge"],
    retrieval_focus: "claim grounding, evidence currency, completeness, traceability, risk controls, contradictions, and review readiness",
    outcome_sections: ["evaluation verdict", "supported strengths", "evidence gaps", "risk controls", "readiness decision"],
    decision_question: "Which claims are supported, incomplete, contradictory, or unsafe to accept?",
    deliverable_contract: "An evaluation scorecard with claim-level grounding, completeness and traceability gaps, risk controls, and an accept/revise decision."
  },
  "repository-curator": {
    priority_scopes: ["automation", "test-cases", "runs", "knowledge"],
    retrieval_focus: "locator intent, duplicate repository concepts, stability evidence, failed bindings, platform scope, and reusable components",
    outcome_sections: ["repository finding", "reuse candidate", "stability risk", "proposed locator policy", "approval boundary"],
    decision_question: "Which repository objects should be reused, consolidated, or reviewed because their bindings are unstable?",
    deliverable_contract: "A repository curation plan listing duplicates, reuse candidates, low-confidence bindings, locator policy, and approval-required changes."
  }
});

const DEFAULT_AGENT_POLICY = AGENT_CONTEXT_POLICIES["quality-orchestrator"];
const MAX_LIVE_EVIDENCE_CHARS = 9_000;
const normalizeText = (value, max = 12_000) => String(value || "").trim().slice(0, max);
const unique = (items) => [...new Set(items.filter(Boolean))];
const fingerprint = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);
const asArray = (value) => Array.isArray(value) ? value : [];

const INTENT_RULES = [
  { id: "product_help", scopes: ["knowledge"], pattern: /\b(?:how (?:do|can|to)|where (?:do|can|is)|walk ?through|capabilit(?:y|ies)|features?|use hellotest|create|configure|navigate|knowledge repo(?:sitory)?|context studio|ask hellotest|chatbot)\b/i },
  { id: "execution_context", scopes: ["runs", "knowledge"], pattern: /\b(?:environments?|configurations?|browsers?|devices?|platform versions?|mobile os)\b/i },
  { id: "execution_failure", scopes: ["runs", "bugs", "test-cases", "knowledge"], pattern: /\b(?:fail(?:ed|ure|ing)?|blocked|flaky|root cause|error|execution result|run result|why did)\b/i },
  { id: "run_planning", scopes: ["runs", "test-cases", "stories", "bugs", "knowledge"], pattern: /\b(?:smart run|test run|run plan|execute|execution|regression selection|impacted tests?)\b/i },
  { id: "bug_quality", scopes: ["bugs", "runs", "test-cases", "stories", "knowledge"], pattern: /\b(?:bugs?|defects?|triage|severity|reproduc|actual result|expected result)\b/i },
  { id: "automation", scopes: ["automation", "test-cases", "runs", "knowledge"], pattern: /\b(?:automat(?:e|ed|ion)|locator|object repository|selector|recorder|playwright|selenium|binding)\b/i },
  { id: "test_design", scopes: ["test-cases", "stories", "automation", "knowledge"], pattern: /\b(?:test cases?|test design|scenario|gherkin|coverage|shared steps?|test data|precondition)\b/i },
  { id: "story_delivery", scopes: ["stories", "test-cases", "knowledge"], pattern: /\b(?:stor(?:y|ies)|requirements?|acceptance|sprint|release|backlog|module|delivery scope)\b/i },
  { id: "project_overview", scopes: ["stories", "test-cases", "runs", "bugs", "automation", "knowledge"], pattern: /\b(?:project|summary|overview|quality|health|readiness|risk|status|metrics?)\b/i }
];

const EXPLICIT_PRODUCT_HELP = /\b(?:how (?:do|can|to)|where (?:do|can|is)|walk ?through|how to|use hellotest|navigate|explain (?:the )?(?:knowledge repo(?:sitory)?|context studio|ask hellotest|chatbot)|what (?:is|can i do (?:in|with)) (?:the )?(?:knowledge repo(?:sitory)?|context studio|ask hellotest|chatbot)|what (?:features?|capabilit(?:y|ies))|features? (?:of|in)|capabilit(?:y|ies) (?:of|in)|what (?:does|can) (?:hellotest|the chatbot|the assistant))\b/i;
const CURRENT_PROJECT_FACTS = /\b(?:my|our|current|existing|selected|this project|how many|which|list|show|status|open|closed|failed|blocked|linked|unlinked|recent|today)\b/i;
const REFERENTIAL_FOLLOW_UP = /^(?:and|also|then|so|what about|how about|why|which|where|when)|\b(?:it|its|that|those|them|this|these|same|ones?)\b/i;
const ANALYTICAL_QUESTION = /\b(?:analy[sz]e|compare|explain|why|risk|recommend|improve|impact|root cause|readiness|trend|gap|quality)\b/i;
const DETAILED_ANSWER = /\b(?:detail(?:ed)?|elaborate|deep|thorough|step[- ]by[- ]step|walk ?through|explain|why|how)\b/i;
const SOURCE_KINDS_BY_SCOPE = Object.freeze({
  stories: ["requirement"],
  "test-cases": ["test_case"],
  runs: ["execution"],
  bugs: ["bug"],
  automation: ["test_case"],
  knowledge: ["knowledge_item", "file", "text", "chat", "url"]
});
const INFORMATION_NEED_BY_INTENT = Object.freeze({
  product_help: "feature purpose, navigation, prerequisites, workflow, and limitations",
  execution_context: "current environments, configurations, devices, browsers, and execution targets",
  execution_failure: "failed or blocked results, symptoms, affected coverage, build/environment boundaries, and linked defects",
  run_planning: "delivery scope, impacted coverage, risk, recent outcomes, environment needs, and exclusions",
  bug_quality: "open defects, severity and priority, reproducibility, duplication, traceability, and release impact",
  automation: "automation readiness, reusable assets, locator stability, bindings, and recent execution evidence",
  test_design: "requirements, acceptance boundaries, existing scenarios, data, reusable steps, traceability, and gaps",
  story_delivery: "Story intent, acceptance criteria, delivery metadata, dependencies, and linked coverage",
  project_overview: "current project composition, coverage, execution health, open defect risk, and evidence gaps"
});

const planContext = ({ prompt, agentId, requestedScopes = [], mode = "chat", history = [] } = {}) => {
  const question = normalizeText(prompt, 8_000);
  const wordCount = question.split(/\s+/).filter(Boolean).length;
  const previousUserMessage = [...asArray(history)].reverse().find((entry) => entry?.role === "user" && normalizeText(entry.content, 2_500));
  const conversationReferenceUsed = Boolean(previousUserMessage && wordCount <= 20 && REFERENTIAL_FOLLOW_UP.test(question));
  const resolvedQuestion = conversationReferenceUsed
    ? normalizeText(`Previous project question: ${previousUserMessage.content}\nCurrent follow-up: ${question}`, 5_000)
    : question;
  const matchedIntents = INTENT_RULES.filter((rule) => rule.pattern.test(resolvedQuestion));
  const domainIntents = matchedIntents.filter((rule) => rule.id !== "product_help");
  const hasProductHelpIntent = matchedIntents.some((rule) => rule.id === "product_help");
  const hasCurrentProjectSignal = CURRENT_PROJECT_FACTS.test(resolvedQuestion);
  const pureProductHelp = !agentId
    && matchedIntents.some((rule) => rule.id === "product_help")
    && EXPLICIT_PRODUCT_HELP.test(resolvedQuestion)
    && !CURRENT_PROJECT_FACTS.test(resolvedQuestion);
  const routedIntents = pureProductHelp
    ? matchedIntents.filter((rule) => rule.id === "product_help")
    : matchedIntents;
  const intentScopes = unique(routedIntents.flatMap((rule) => rule.scopes));
  const chatPriorityScopes = /\b(?:stor(?:y|ies)|requirements?)\b/i.test(resolvedQuestion) && /\b(?:coverage|covered|uncovered|linked|unlinked)\b/i.test(resolvedQuestion)
    ? unique(["stories", "test-cases", ...intentScopes])
    : /\b(?:test cases?)\b/i.test(resolvedQuestion) && /\b(?:steps?|traceability|authoring|quality|missing|without)\b/i.test(resolvedQuestion)
      ? unique(["test-cases", "stories", ...intentScopes])
      : intentScopes;
  const policy = agentId ? (AGENT_CONTEXT_POLICIES[agentId] || DEFAULT_AGENT_POLICY) : {
    priority_scopes: chatPriorityScopes.length ? chatPriorityScopes : ["knowledge"],
    retrieval_focus: "the user's exact question, current project facts, relevant indexed domain context, evidence currency, and explicit limitations",
    outcome_sections: ["direct answer", "supporting evidence", "risk or limitation", "useful next step"]
  };
  const inputType = agentId
    ? (domainIntents[0] ? `${domainIntents[0].id}_task` : "specialist_task")
    : pureProductHelp
      ? "product_help"
      : domainIntents[0]?.id || "project_question";
  const queryCategory = agentId
    ? "specialist_analysis"
    : pureProductHelp
      ? "tool_help"
      : hasProductHelpIntent && (hasCurrentProjectSignal || domainIntents.length)
        ? "mixed"
        : hasCurrentProjectSignal
          ? "project_facts"
          : ANALYTICAL_QUESTION.test(resolvedQuestion)
            ? "project_analysis"
            : "project_knowledge";
  const validRequested = unique(asArray(requestedScopes).map((scope) => normalizeText(scope, 80).toLowerCase()).filter((scope) => CONTEXT_SCOPES.includes(scope)));
  const baseScopes = validRequested.length ? validRequested : policy.priority_scopes;
  // Knowledge is a governed evidence source for every specialist. It is added
  // even when the caller chooses only relational scopes; ACL checks still run.
  const effectiveScopes = unique([...baseScopes, "knowledge"])
    .sort((left, right) => {
      const leftRank = policy.priority_scopes.indexOf(left);
      const rightRank = policy.priority_scopes.indexOf(right);
      return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
    });
  const priorityScopes = policy.priority_scopes.filter((scope) => effectiveScopes.includes(scope));
  const liveScopes = effectiveScopes.filter((scope) => scope !== "knowledge");
  const indexedSourceKinds = pureProductHelp
    ? ["product_help"]
    : unique([
        ...effectiveScopes.flatMap((scope) => SOURCE_KINDS_BY_SCOPE[scope] || []),
        ...(hasProductHelpIntent ? ["product_help"] : [])
      ]);
  const identifiers = unique(resolvedQuestion.match(/\b(?:BUG|TC|TS|STORY|RUN|REQ|REL|SPRINT)-?[A-Z0-9_-]+\b/gi) || []).slice(0, 12);
  const answerDepth = DETAILED_ANSWER.test(resolvedQuestion) || ["tool_help", "project_analysis", "mixed", "specialist_analysis"].includes(queryCategory)
    ? "detailed"
    : /\b(?:count|how many|status|list|which)\b/i.test(resolvedQuestion) ? "concise" : "standard";
  const informationNeeds = unique(routedIntents.map((rule) => INFORMATION_NEED_BY_INTENT[rule.id])).slice(0, 8);
  if (!informationNeeds.length) informationNeeds.push("the exact named concept, current scoped facts when requested, supporting domain context, and explicit evidence gaps");
  return {
    agent_id: agentId || null,
    input_type: inputType,
    query_category: queryCategory,
    answer_depth: answerDepth,
    route_confidence: matchedIntents.length ? (domainIntents.length > 1 ? "high" : "medium") : "low",
    matched_intents: matchedIntents.map((rule) => rule.id),
    mode: mode === "agent" ? "agent" : "chat",
    effective_scopes: effectiveScopes,
    priority_scopes: priorityScopes,
    live_scopes: liveScopes,
    indexed_source_kinds: indexedSourceKinds,
    information_needs: informationNeeds,
    identifiers,
    requires_live_context: liveScopes.length > 0,
    requires_indexed_context: indexedSourceKinds.length > 0,
    retrieval_budget: {
      max_queries: answerDepth === "detailed" ? 5 : 3,
      max_rounds: answerDepth === "detailed" ? 2 : 1,
      max_evidence_items: answerDepth === "detailed" ? 14 : 10
    },
    knowledge_required: true,
    conversation_reference_used: conversationReferenceUsed,
    resolved_query: resolvedQuestion,
    retrieval_query: normalizeText(`${resolvedQuestion}\nSpecialist retrieval focus: ${policy.retrieval_focus}`, 4_800),
    retrieval_focus: policy.retrieval_focus,
    outcome_sections: pureProductHelp
      ? ["direct answer", "how to use it", "important behavior", "limitations or prerequisites"]
      : policy.outcome_sections,
    decision_question: policy.decision_question || "What answer is supported by the available project evidence?",
    deliverable_contract: policy.deliverable_contract || "A direct evidence-backed answer with limitations and a useful next step."
  };
};

const safeRows = async (sql, params = []) => {
  execution.assertActive();
  try {
    const result = await db.prepare(sql).all(...params);
    execution.assertActive();
    return result;
  } catch (error) {
    execution.assertActive();
    // A failed live read is unavailable evidence, not an authoritative zero.
    if (execution.current()) throw error;
    return [];
  }
};

const safeRow = async (sql, params = []) => {
  execution.assertActive();
  try {
    const result = await db.prepare(sql).get(...params);
    execution.assertActive();
    return result;
  } catch (error) {
    execution.assertActive();
    // A failed live read is unavailable evidence, not an authoritative zero.
    if (execution.current()) throw error;
    return null;
  }
};

const safeObsRows = async (sql, params = []) => {
  execution.assertActive();
  try {
    const result = await obsDb.prepare(sql).all(...params);
    execution.assertActive();
    return result;
  } catch (error) {
    execution.assertActive();
    // A failed live read is unavailable evidence, not an authoritative zero.
    if (execution.current()) throw error;
    return [];
  }
};

const safeObsRow = async (sql, params = []) => {
  execution.assertActive();
  try {
    const result = await obsDb.prepare(sql).get(...params);
    execution.assertActive();
    return result;
  } catch (error) {
    execution.assertActive();
    // A failed live read is unavailable evidence, not an authoritative zero.
    if (execution.current()) throw error;
    return null;
  }
};

const matchTokens = (prompt) => unique((normalizeText(prompt, 4_000).toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,48}/g) || [])
  .filter((token) => !new Set(["the", "and", "for", "with", "from", "this", "that", "what", "which", "about", "project", "hellotest"]).has(token)));

const rankRecords = (records, prompt, fields) => {
  const tokens = matchTokens(prompt);
  return records.map((record, index) => {
    const haystack = fields.map((field) => normalizeText(record?.[field], 2_000)).join(" ").toLowerCase();
    const tokenMatches = tokens.filter((token) => haystack.includes(token)).length;
    return { record, rank: tokenMatches * 10 - index * 0.001 };
  }).sort((left, right) => right.rank - left.rank).map((entry) => entry.record);
};

const LIVE_EVIDENCE_SCOPE = Object.freeze({
  "project-overview": "project",
  stories: "stories",
  "test-cases": "test-cases",
  runs: "runs",
  "execution-context": "execution-context",
  "object-repository": "automation",
  bugs: "bugs"
});

const liveEvidenceScore = (route, scope, fallback) => {
  if (scope === "execution-context" && route?.input_type === "execution_context") return 0.999;
  const routedScope = LIVE_EVIDENCE_SCOPE[scope] || scope;
  const priorityIndex = asArray(route?.priority_scopes).indexOf(routedScope);
  if (priorityIndex >= 0) return Number(Math.max(0.94, 0.998 - priorityIndex * 0.012).toFixed(3));
  if (scope === "project-overview") {
    return ["project_question", "project_overview"].includes(route?.input_type) ? 0.997 : 0.89;
  }
  return fallback;
};

const serializeBoundedEvidence = (content, maxChars = MAX_LIVE_EVIDENCE_CHARS) => {
  let payload;
  try {
    payload = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return normalizeText(content, maxChars);
  }
  if (!payload || typeof payload !== "object") return normalizeText(content, maxChars);

  const arrays = [];
  const strings = [];
  const visit = (value, path = []) => {
    // Authorization provenance cannot be shortened with display record lists.
    if (path.length === 1 && path[0] === "evidence_permissions") return;
    if (Array.isArray(value)) {
      arrays.push({ path: path.join("."), value, originalLength: value.length });
      value.forEach((entry, index) => visit(entry, [...path, String(index)]));
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === "string") strings.push({ owner: value, key, originalLength: entry.length });
      else visit(entry, [...path, key]);
    });
  };
  visit(payload);

  let serialized = JSON.stringify(payload);
  while (serialized.length > maxChars - 400) {
    const candidate = arrays.filter((entry) => entry.value.length)
      .sort((left, right) => right.value.length - left.value.length)[0];
    if (!candidate) break;
    candidate.value.pop();
    serialized = JSON.stringify(payload);
  }
  if (serialized.length > maxChars - 400) {
    strings.sort((left, right) => right.originalLength - left.originalLength).forEach((entry) => {
      if (serialized.length <= maxChars - 400 || entry.owner[entry.key].length <= 320) return;
      entry.owner[entry.key] = `${entry.owner[entry.key].slice(0, 317)}...`;
      serialized = JSON.stringify(payload);
    });
  }

  const truncatedLists = arrays
    .filter((entry) => entry.value.length < entry.originalLength)
    .map((entry) => ({ field: entry.path || "records", returned: entry.value.length, available_in_snapshot: entry.originalLength }));
  if (truncatedLists.length) {
    payload.context_window = {
      bounded: true,
      note: "Record lists are bounded for AI context. Aggregate totals describe the full authorized project scope.",
      truncated_lists: truncatedLists.slice(0, 12)
    };
    serialized = JSON.stringify(payload);
  }
  return serialized.length <= maxChars ? serialized : JSON.stringify({
    evidence_type: payload.evidence_type || "authoritative_live_project_snapshot",
    ...(Array.isArray(payload.evidence_permissions) ? { evidence_permissions: payload.evidence_permissions } : {}),
    context_window: { bounded: true, note: "Detailed records exceeded the safe AI context window." },
    aggregate_totals: Object.fromEntries(Object.entries(payload).filter(([key, value]) => (
      /(?:total|count|records|covered|failed|blocked|open|screens)/i.test(key) && ["string", "number", "boolean"].includes(typeof value)
    )))
  });
};

const makeLiveHit = ({ projectId, scope, title, content, score = 0.96 }) => {
  const bounded = serializeBoundedEvidence(content);
  const sanitized = sanitizeAiText(bounded);
  const sanitizedText = serializeBoundedEvidence(sanitized.text);
  const contentHash = fingerprint(`${projectId}:${scope}:${sanitizedText}`);
  const chunkId = `live-${scope}-${contentHash}`;
  const citationId = `K-${chunkId}`;
  const sourceId = `live-project-${projectId}-${scope}`;
  return {
    id: chunkId,
    chunk_id: chunkId,
    document_id: `live-project-${projectId}`,
    source_id: sourceId,
    title,
    source_kind: "live_project",
    source_ref_id: projectId,
    content: sanitizedText,
    excerpt: sanitizedText.slice(0, 700),
    risk_flags: sanitized.risk_flags || [],
    score,
    lexical_score: score,
    semantic_score: score,
    citation: {
      id: citationId,
      label: title,
      source_id: sourceId,
      source_kind: "live_project",
      source_ref_id: projectId,
      source_uri: null,
      document_id: `live-project-${projectId}`,
      chunk_id: chunkId,
      excerpt: sanitizedText.slice(0, 700),
      source_hash: fingerprint(`project:${projectId}`),
      version_hash: contentHash,
      chunk_hash: contentHash,
      location: { heading: title, chunk_index: 0, char_start: 0, char_end: sanitizedText.length, page: null }
    }
  };
};

const buildLiveProjectEvidence = async ({ projectId, appTypeId, prompt, user, route, requestedScopes, sourceKinds } = {}) => {
  const contextRoute = route || planContext({ prompt, requestedScopes });
  execution.assertActive();
  if (!contextRoute.live_scopes?.length) return { hits: [], route: contextRoute, counts: {} };
  const project = await safeRow("SELECT id, display_id, name, description, visibility, created_at FROM projects WHERE id = ?", [projectId]);
  if (!project) return { hits: [], route: contextRoute, counts: {} };
  const requestedKinds = new Set(asArray(sourceKinds).map((kind) => normalizeText(kind, 80).toLowerCase()));
  const kindAllowed = (kind) => !requestedKinds.size || requestedKinds.has(kind);
  const permissionCache = new Map();
  const canView = async (permissionCode) => {
    execution.assertActive();
    if (!user) return false;
    if (!permissionCache.has(permissionCode)) permissionCache.set(permissionCode, (async () => {
      if (!await permissionService.hasPermission(user, permissionCode, projectId)) return false;
      const flags = require("@hellotest/platform/backend/services/featureFlag.service");
      return flags.areEnabled(flags.getFeatureKeysForPermission(permissionCode), { user });
    })());
    const allowed = Boolean(await permissionCache.get(permissionCode));
    execution.assertActive();
    return allowed;
  };
  const scopeSet = new Set(contextRoute.live_scopes || []);
  const hits = [];
  const counts = {};
  const appTypes = await safeRows("SELECT id, name, type, is_unified FROM app_types WHERE project_id = ? ORDER BY name", [projectId]);
  if (scopeSet.size) {
    execution.emit("READING_PROJECT", "completed", { message: `Read the current project and ${appTypes.length} application record${appTypes.length === 1 ? "" : "s"}.` });
    hits.push(makeLiveHit({
      projectId,
      scope: "project-overview",
      title: `Live project · ${project.name}`,
      content: JSON.stringify({
        evidence_type: "authoritative_live_project_record",
        as_of: new Date().toISOString(),
        project: { id: project.id, key: project.display_id || project.id, name: project.name, description: project.description || null, visibility: project.visibility },
        applications: appTypes.map((item) => ({ id: item.id, name: item.name, type: item.type, unified: Boolean(item.is_unified) })),
        selected_application_id: appTypeId || null
      }, null, 2),
      score: liveEvidenceScore(contextRoute, "project-overview", 0.89)
    }));
  }

  if (scopeSet.has("stories") && kindAllowed("requirement") && await canView("requirement.view")) {
    execution.emit("READING_STORIES", "started", { message: "Reading current Stories, delivery fields, and linked coverage." });
    const canViewCoverage = await canView("testcase.view");
    const appClause = "";
    const stories = await safeRows(`
      SELECT requirements.id, requirements.display_id, requirements.title, requirements.status,
        requirements.description, requirements.additional_fields->'acceptance_criteria' AS acceptance_criteria, requirements.revision,
        requirements.priority, requirements.sprint, requirements.release, requirements.fix_version,
        requirements.created_at${canViewCoverage ? ", COUNT(DISTINCT requirement_test_cases.test_case_id)::INTEGER AS linked_test_case_count" : ""}
      FROM requirements
      ${canViewCoverage ? "LEFT JOIN requirement_test_cases ON requirement_test_cases.requirement_id = requirements.id" : ""}
      WHERE requirements.project_id = ? ${appClause}
      GROUP BY requirements.id
      ORDER BY ${canViewCoverage ? "COUNT(DISTINCT requirement_test_cases.test_case_id) ASC," : ""} requirements.priority ASC NULLS LAST, requirements.created_at DESC NULLS LAST
      LIMIT 120
    `, [projectId]);
    const storyTotals = await safeRow(`
      SELECT COUNT(*)::INTEGER AS total${canViewCoverage ? `,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM requirement_test_cases WHERE requirement_test_cases.requirement_id = requirements.id
        ))::INTEGER AS covered,
        COUNT(*) FILTER (WHERE (
          SELECT COUNT(*) FROM requirement_test_cases WHERE requirement_test_cases.requirement_id = requirements.id
        ) = 1)::INTEGER AS thin_coverage` : ""}
      FROM requirements WHERE project_id = ?
    `, [projectId]);
    counts.stories = Number(storyTotals?.total || stories.length);
    const selected = rankRecords(stories, prompt, ["display_id", "title", "status", "sprint", "release", "fix_version"]).slice(0, 16);
    const coverageGaps = rankRecords(stories.filter((story) => Number(story.linked_test_case_count || 0) === 0), prompt, ["display_id", "title", "status", "sprint", "release", "fix_version"]).slice(0, 24);
    const thinCoverage = rankRecords(stories.filter((story) => Number(story.linked_test_case_count || 0) === 1), prompt, ["display_id", "title", "status", "sprint", "release", "fix_version"]).slice(0, 16);
    hits.push(makeLiveHit({
      projectId,
      scope: "stories",
      title: "Live Stories and requirement coverage",
      content: JSON.stringify({
        evidence_type: "authoritative_live_story_snapshot",
        evidence_permissions: ["requirement.view", ...(canViewCoverage ? ["testcase.view"] : [])],
        returned_records: selected.length,
        total_records: counts.stories,
        coverage_available: canViewCoverage,
        covered_records: canViewCoverage ? Number(storyTotals?.covered || 0) : null,
        uncovered_records: canViewCoverage ? Math.max(0, counts.stories - Number(storyTotals?.covered || 0)) : null,
        thin_coverage_records: canViewCoverage ? Number(storyTotals?.thin_coverage || 0) : null,
        coverage_policy: canViewCoverage ? "Zero linked Test Cases is uncovered. One linked Test Case is flagged as thin coverage, not automatically sufficient. Domain sufficiency still requires acceptance-boundary review." : "Test Case coverage is unavailable with current access; no coverage conclusion can be drawn.",
        coverage_gaps: canViewCoverage ? coverageGaps : [],
        thin_coverage_examples: canViewCoverage ? thinCoverage : [],
        records: selected
      }, null, 2),
      score: liveEvidenceScore(contextRoute, "stories", 0.96)
    }));
    execution.emit("READING_STORIES", "completed", { evidence_count: selected.length,
      message: `Read ${counts.stories} Stor${counts.stories === 1 ? "y" : "ies"} and selected ${selected.length} relevant record${selected.length === 1 ? "" : "s"}.` });
  }

  const canViewCases = (scopeSet.has("test-cases") || scopeSet.has("automation")) && kindAllowed("test_case") && await canView("testcase.view");
  if (canViewCases) {
    execution.emit("READING_TEST_CASES", "started", { message: "Reading Test Cases, steps, traceability, suites, and shared coverage." });
    const canViewStories = await canView("requirement.view");
    const params = appTypeId ? [projectId, appTypeId] : [projectId];
    const appClause = appTypeId ? "AND test_cases.app_type_id = ?" : "";
    const cases = await safeRows(`
      SELECT test_cases.id, test_cases.display_id, test_cases.title, test_cases.status,
        test_cases.priority, test_cases.automated, test_cases.automation_status,
        test_cases.authoring_mode, test_cases.test_case_type, test_cases.created_at,
        ${canViewStories ? "COUNT(DISTINCT requirement_test_cases.requirement_id)::INTEGER AS linked_story_count," : ""}
        COUNT(DISTINCT test_steps.id)::INTEGER AS step_count
      FROM test_cases
      JOIN app_types ON app_types.id = test_cases.app_type_id
      ${canViewStories ? "LEFT JOIN requirement_test_cases ON requirement_test_cases.test_case_id = test_cases.id" : ""}
      LEFT JOIN test_steps ON test_steps.test_case_id = test_cases.id
      WHERE app_types.project_id = ? ${appClause}
      GROUP BY test_cases.id
      ORDER BY COUNT(DISTINCT test_steps.id) ASC, ${canViewStories ? "COUNT(DISTINCT requirement_test_cases.requirement_id) ASC," : ""}
        test_cases.priority ASC NULLS LAST, test_cases.created_at DESC NULLS LAST
      LIMIT 140
    `, params);
    const caseTotals = await safeRow(`
      SELECT COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE test_cases.automated = 'yes' OR test_cases.automation_status = 'ready')::INTEGER AS automated_or_ready,
        ${canViewStories ? `COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM requirement_test_cases WHERE requirement_test_cases.test_case_id = test_cases.id
        ))::INTEGER AS without_story_traceability,` : ""}
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM test_steps WHERE test_steps.test_case_id = test_cases.id
        ))::INTEGER AS without_steps
      FROM test_cases
      JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE app_types.project_id = ? ${appClause}
    `, params);
    counts.test_cases = Number(caseTotals?.total || cases.length);
    const selected = rankRecords(cases, prompt, ["display_id", "title", "status", "automation_status", "test_case_type"]).slice(0, 12);
    const compactCase = (testCase) => ({
      display_id: testCase.display_id || testCase.id,
      title: testCase.title,
      status: testCase.status,
      priority: testCase.priority,
      test_case_type: testCase.test_case_type,
      authoring_mode: testCase.authoring_mode,
      automation_status: testCase.automation_status,
      ...(canViewStories ? { linked_story_count: Number(testCase.linked_story_count || 0) } : {}),
      step_count: Number(testCase.step_count || 0)
    });
    const withoutSteps = rankRecords(cases.filter((testCase) => Number(testCase.step_count || 0) === 0), prompt, ["display_id", "title", "status", "test_case_type"]).slice(0, 10).map(compactCase);
    const withoutTraceability = rankRecords(cases.filter((testCase) => Number(testCase.linked_story_count || 0) === 0), prompt, ["display_id", "title", "status", "test_case_type"]).slice(0, 10).map(compactCase);
    const supportingParams = appTypeId ? [projectId, appTypeId] : [projectId];
    const supportingAppClause = appTypeId ? "AND app_types.id = ?" : "";
    const canViewSuites = await canView("suite.view");
    const suites = canViewSuites ? await safeRow(`
      SELECT COUNT(*)::INTEGER AS total
      FROM test_suites
      JOIN app_types ON app_types.id = test_suites.app_type_id
      WHERE app_types.project_id = ? ${supportingAppClause}
    `, supportingParams) : null;
    const modules = await safeRow(`
      SELECT COUNT(*)::INTEGER AS total
      FROM test_case_modules
      JOIN app_types ON app_types.id = test_case_modules.app_type_id
      WHERE app_types.project_id = ? ${supportingAppClause}
    `, supportingParams);
    const canViewSharedSteps = await canView("shared_step.view");
    const sharedGroups = canViewSharedSteps ? await safeRows(`
      SELECT shared_step_groups.id, shared_step_groups.display_id, shared_step_groups.name,
        shared_step_groups.description, shared_step_groups.authoring_mode,
        JSONB_ARRAY_LENGTH(shared_step_groups.steps)::INTEGER AS step_count,
        COUNT(DISTINCT test_steps.test_case_id)::INTEGER AS linked_test_case_count,
        shared_step_groups.updated_at
      FROM shared_step_groups
      JOIN app_types ON app_types.id = shared_step_groups.app_type_id
      LEFT JOIN test_steps ON test_steps.reusable_group_id = shared_step_groups.id
      WHERE app_types.project_id = ? ${supportingAppClause}
      GROUP BY shared_step_groups.id
      ORDER BY shared_step_groups.updated_at DESC NULLS LAST
      LIMIT 40
    `, supportingParams) : [];
    const sharedGroupTotal = canViewSharedSteps ? await safeRow(`
      SELECT COUNT(*)::INTEGER AS total
      FROM shared_step_groups
      JOIN app_types ON app_types.id = shared_step_groups.app_type_id
      WHERE app_types.project_id = ? ${supportingAppClause}
    `, supportingParams) : null;
    hits.push(makeLiveHit({
      projectId,
      scope: "test-cases",
      title: "Live Test Case coverage",
      content: JSON.stringify({
        evidence_type: "authoritative_live_test_case_snapshot",
        evidence_permissions: ["testcase.view", ...(canViewStories ? ["requirement.view"] : []), ...(canViewSuites ? ["suite.view"] : []), ...(canViewSharedSteps ? ["shared_step.view"] : [])],
        returned_records: selected.length,
        total_records: counts.test_cases,
        automated_or_ready: Number(caseTotals?.automated_or_ready || 0),
        story_traceability_available: canViewStories,
        without_story_traceability: canViewStories ? Number(caseTotals?.without_story_traceability || 0) : null,
        without_steps: Number(caseTotals?.without_steps || 0),
        supporting_assets: {
          suites: canViewSuites ? Number(suites?.total || 0) : null,
          modules: Number(modules?.total || 0),
          shared_step_groups: canViewSharedSteps ? Number(sharedGroupTotal?.total || 0) : null,
          relevant_shared_step_groups: rankRecords(sharedGroups, prompt, ["display_id", "name", "description", "authoring_mode"]).slice(0, 10)
        },
        quality_gaps: {
          without_steps: withoutSteps,
          without_story_traceability: canViewStories ? withoutTraceability : []
        },
        records: selected.map(compactCase)
      }, null, 2),
      score: liveEvidenceScore(contextRoute, "test-cases", 0.96)
    }));
    execution.emit("READING_TEST_CASES", "completed", { evidence_count: selected.length,
      message: `Read ${counts.test_cases} Test Case${counts.test_cases === 1 ? "" : "s"} and selected ${selected.length} relevant record${selected.length === 1 ? "" : "s"}.` });
  }

  if (scopeSet.has("runs") && kindAllowed("execution") && await canView("run.view")) {
    execution.emit("READING_RUNS", "started", { message: "Reading Test Runs and their permitted result outcomes." });
    const canViewResults = await canView("result.view");
    const params = appTypeId ? [projectId, appTypeId] : [projectId];
    const appClause = appTypeId ? "AND executions.app_type_id = ?" : "";
    const runs = await safeRows(`
      SELECT executions.id, executions.name, executions.status, executions.trigger,
        executions.execution_mode, executions.release, executions.sprint, executions.build,
        executions.created_at, executions.started_at, executions.ended_at${canViewResults ? `,
        COUNT(execution_results.id)::INTEGER AS result_count,
        COUNT(execution_results.id) FILTER (WHERE execution_results.status = 'passed')::INTEGER AS passed_count,
        COUNT(execution_results.id) FILTER (WHERE execution_results.status = 'failed')::INTEGER AS failed_count,
        COUNT(execution_results.id) FILTER (WHERE execution_results.status = 'blocked')::INTEGER AS blocked_count` : ""}
      FROM executions
      ${canViewResults ? "LEFT JOIN execution_results ON execution_results.execution_id = executions.id" : ""}
      WHERE executions.project_id = ? ${appClause}
      GROUP BY executions.id
      ORDER BY executions.created_at DESC NULLS LAST
      LIMIT 40
    `, params);
    const runTotals = await safeRow(`
      SELECT COUNT(DISTINCT executions.id)::INTEGER AS total,
        COUNT(DISTINCT executions.id) FILTER (WHERE executions.status = 'failed')::INTEGER AS failed_runs${canViewResults ? `,
        COUNT(execution_results.id) FILTER (WHERE execution_results.status = 'failed')::INTEGER AS failed_results,
        COUNT(execution_results.id) FILTER (WHERE execution_results.status = 'blocked')::INTEGER AS blocked_results` : ""}
      FROM executions
      ${canViewResults ? "LEFT JOIN execution_results ON execution_results.execution_id = executions.id" : ""}
      WHERE executions.project_id = ? ${appClause}
    `, params);
    counts.runs = Number(runTotals?.total || runs.length);
    const compactRun = (run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      execution_mode: run.execution_mode,
      release: run.release,
      sprint: run.sprint,
      build: run.build,
      result_count: canViewResults ? Number(run.result_count || 0) : null,
      passed_count: canViewResults ? Number(run.passed_count || 0) : null,
      failed_count: canViewResults ? Number(run.failed_count || 0) : null,
      blocked_count: canViewResults ? Number(run.blocked_count || 0) : null,
      created_at: run.created_at,
      ended_at: run.ended_at
    });
    const selected = rankRecords(runs, prompt, ["name", "status", "release", "sprint", "build"]).slice(0, 12).map(compactRun);
    const failureEvidence = rankRecords(runs.filter((run) => (canViewResults && (Number(run.failed_count || 0) > 0 || Number(run.blocked_count || 0) > 0)) || ["failed", "blocked"].includes(String(run.status || "").toLowerCase())), prompt, ["name", "status", "release", "sprint", "build"]).slice(0, 12).map(compactRun);
    hits.push(makeLiveHit({
      projectId,
      scope: "runs",
      title: "Live Test Run outcomes",
      content: JSON.stringify({
        evidence_type: "authoritative_live_execution_snapshot",
        evidence_permissions: ["run.view", ...(canViewResults ? ["result.view"] : [])],
        results_available: canViewResults,
        returned_records: selected.length,
        total_records: counts.runs,
        failed_runs: Number(runTotals?.failed_runs || 0),
        blocked_results: canViewResults ? Number(runTotals?.blocked_results || 0) : null,
        failed_results: canViewResults ? Number(runTotals?.failed_results || 0) : null,
        failed_or_blocked_run_evidence: failureEvidence,
        records: selected
      }, null, 2),
      score: liveEvidenceScore(contextRoute, "runs", 0.96)
    }));
    execution.emit("READING_RUNS", "completed", { evidence_count: selected.length,
      message: `Read ${counts.runs} Test Run${counts.runs === 1 ? "" : "s"} and selected ${selected.length} relevant outcome${selected.length === 1 ? "" : "s"}.` });

    const executionContextParams = appTypeId ? [projectId, appTypeId] : [projectId];
    const executionContextAppClause = appTypeId ? "AND app_type_id = ?" : "";
    const canViewEnvironments = await canView("environment.view");
    const canViewConfigurations = await canView("configuration.view");
    const environments = canViewEnvironments ? await safeRows(`
      SELECT id, name, description, base_url, browser, notes, created_at
      FROM test_environments
      WHERE project_id = ? ${executionContextAppClause}
      ORDER BY created_at DESC NULLS LAST
      LIMIT 30
    `, executionContextParams) : [];
    const configurations = canViewConfigurations ? await safeRows(`
      SELECT id, name, description, browser, mobile_os, platform_version, targets, created_at
      FROM test_configurations
      WHERE project_id = ? ${executionContextAppClause}
      ORDER BY created_at DESC NULLS LAST
      LIMIT 30
    `, executionContextParams) : [];
    const environmentTotal = canViewEnvironments ? await safeRow(`
      SELECT COUNT(*)::INTEGER AS total FROM test_environments
      WHERE project_id = ? ${executionContextAppClause}
    `, executionContextParams) : null;
    const configurationTotal = canViewConfigurations ? await safeRow(`
      SELECT COUNT(*)::INTEGER AS total FROM test_configurations
      WHERE project_id = ? ${executionContextAppClause}
    `, executionContextParams) : null;
    if (environments.length || configurations.length) {
      execution.emit("READING_EXECUTION_CONTEXT", "started", { message: "Reading permitted environments and execution configurations." });
      counts.environments = Number(environmentTotal?.total || environments.length);
      counts.configurations = Number(configurationTotal?.total || configurations.length);
      const compactConfiguration = (configuration) => ({
        id: configuration.id,
        name: configuration.name,
        description: configuration.description,
        browser: configuration.browser,
        mobile_os: configuration.mobile_os,
        platform_version: configuration.platform_version,
        target_count: asArray(configuration.targets).length,
        targets: asArray(configuration.targets).slice(0, 6).map((target) => ({
          name: target?.name || null,
          browser: target?.browser || null,
          mobile_os: target?.mobile_os || target?.platform || null,
          platform_version: target?.platform_version || null,
          device: target?.device || target?.device_name || null
        })),
        created_at: configuration.created_at
      });
      hits.push(makeLiveHit({
        projectId,
        scope: "execution-context",
        title: "Live execution environments and configurations",
        content: JSON.stringify({
          evidence_type: "authoritative_live_execution_context",
          evidence_permissions: [...(canViewEnvironments ? ["environment.view"] : []), ...(canViewConfigurations ? ["configuration.view"] : [])],
          total_environments: counts.environments,
          total_configurations: counts.configurations,
          environments: rankRecords(environments, prompt, ["name", "description", "browser", "notes", "base_url"]).slice(0, 12),
          configurations: rankRecords(configurations, prompt, ["name", "description", "browser", "mobile_os", "platform_version"]).slice(0, 12).map(compactConfiguration)
        }, null, 2),
        score: liveEvidenceScore(contextRoute, "execution-context", 0.945)
      }));
      execution.emit("READING_EXECUTION_CONTEXT", "completed", {
        message: `Read ${counts.environments || 0} environment${counts.environments === 1 ? "" : "s"} and ${counts.configurations || 0} configuration${counts.configurations === 1 ? "" : "s"}.`
      });
    }
  }

  if (scopeSet.has("automation") && await canView("automation.view")) {
    execution.emit("READING_AUTOMATION", "started", { message: "Reading automation and object repository evidence." });
    const params = appTypeId ? [projectId, appTypeId] : [projectId];
    const appClause = appTypeId ? "AND app_type_id = ?" : "";
    const repositoryRows = await safeObsRows(`
      SELECT id, test_case_id, page_url, page_key, locator_intent, locator, locator_kind,
        confidence, source, metadata, hit_count, updated_at
      FROM automation_learning_cache
      WHERE project_id = ? ${appClause}
      ORDER BY hit_count DESC, updated_at DESC NULLS LAST
      LIMIT 80
    `, params);
    const lowConfidenceRows = await safeObsRows(`
      SELECT id, test_case_id, page_url, page_key, locator_intent, locator, locator_kind,
        confidence, source, metadata, hit_count, updated_at
      FROM automation_learning_cache
      WHERE project_id = ? ${appClause} AND confidence < 0.6
      ORDER BY confidence ASC, updated_at DESC NULLS LAST
      LIMIT 30
    `, params);
    const repositoryTotals = await safeObsRow(`
      SELECT COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE confidence < 0.6)::INTEGER AS low_confidence,
        COUNT(DISTINCT page_key)::INTEGER AS screens
      FROM automation_learning_cache
      WHERE project_id = ? ${appClause}
    `, params);
    counts.repository_objects = Number(repositoryTotals?.total || repositoryRows.length);
    if (scopeSet.has("automation") || contextRoute.agent_id === "repository-curator") {
      const compactRepositoryRecord = (record) => ({
        id: record.id,
        test_case_id: record.test_case_id,
        page_key: record.page_key,
        page_url: record.page_url,
        locator_intent: record.locator_intent,
        locator: record.locator,
        locator_kind: record.locator_kind,
        confidence: Number(record.confidence || 0),
        source: record.source,
        hit_count: Number(record.hit_count || 0),
        screen_name: record.metadata?.screen_name || null,
        object_name: record.metadata?.object_name || null,
        platform: record.metadata?.platform || null,
        fallback_strategy: record.metadata?.fallback_strategy || null,
        updated_at: record.updated_at
      });
      hits.push(makeLiveHit({
        projectId,
        scope: "object-repository",
        title: "Live automation object repository",
        content: JSON.stringify({
          evidence_type: "authoritative_live_object_repository_snapshot",
          total_records: counts.repository_objects,
          screens: Number(repositoryTotals?.screens || 0),
          low_confidence_records: Number(repositoryTotals?.low_confidence || 0),
          low_confidence_examples: rankRecords(lowConfidenceRows, prompt, ["page_url", "page_key", "locator_intent", "locator", "locator_kind", "source"]).slice(0, 12).map(compactRepositoryRecord),
          relevant_records: rankRecords(repositoryRows, prompt, ["page_url", "page_key", "locator_intent", "locator", "locator_kind", "source"]).slice(0, 14).map(compactRepositoryRecord)
        }, null, 2),
        score: liveEvidenceScore(contextRoute, "object-repository", 0.95)
      }));
      execution.emit("READING_AUTOMATION", "completed", { evidence_count: counts.repository_objects,
        message: `Read ${counts.repository_objects} automation repository record${counts.repository_objects === 1 ? "" : "s"}.` });
    }
  }

  if (scopeSet.has("bugs") && kindAllowed("bug") && await canView("feedback.view")) {
    execution.emit("READING_BUGS", "started", { message: "Reading current Defects, severity, status, and linked evidence." });
    const bugs = await safeRows(`
      SELECT id, display_id, title, status, severity, priority, environment, build,
        release, fix_version, sprint, linked_test_run_id, linked_test_case_ids,
        linked_requirement_ids, labels, created_at, updated_at
      FROM feedback WHERE project_id = ?
      ORDER BY
        CASE WHEN LOWER(COALESCE(status, 'open')) NOT IN ('closed', 'resolved', 'done', 'accepted') THEN 0 ELSE 1 END,
        CASE WHEN LOWER(COALESCE(severity, priority, '')) IN ('critical', 'highest', 'high') THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 100
    `, [projectId]);
    const bugTotals = await safeRow(`
      SELECT COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'open')) NOT IN ('closed', 'resolved', 'done', 'accepted'))::INTEGER AS open_records,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(severity, priority, '')) IN ('critical', 'highest', 'high'))::INTEGER AS critical_or_high
      FROM feedback WHERE project_id = ?
    `, [projectId]);
    counts.bugs = Number(bugTotals?.total || bugs.length);
    const compactBug = (bug) => ({
      display_id: bug.display_id || bug.id,
      title: bug.title,
      status: bug.status,
      severity: bug.severity,
      priority: bug.priority,
      environment: bug.environment,
      build: bug.build,
      release: bug.release,
      sprint: bug.sprint,
      linked_test_run_id: bug.linked_test_run_id,
      linked_test_case_count: asArray(bug.linked_test_case_ids).length,
      linked_story_count: asArray(bug.linked_requirement_ids).length,
      updated_at: bug.updated_at
    });
    const selected = rankRecords(bugs, prompt, ["display_id", "title", "status", "severity", "priority", "environment", "build", "release", "sprint"]).slice(0, 12).map(compactBug);
    const openHighRisk = rankRecords(bugs.filter((bug) => (
      !["closed", "resolved", "done", "accepted"].includes(String(bug.status || "open").toLowerCase())
      && ["critical", "highest", "high"].includes(String(bug.severity || bug.priority || "").toLowerCase())
    )), prompt, ["display_id", "title", "status", "severity", "priority", "environment", "build", "release", "sprint"]).slice(0, 16).map(compactBug);
    hits.push(makeLiveHit({
      projectId,
      scope: "bugs",
      title: "Live Defect and defect evidence",
      content: JSON.stringify({
        evidence_type: "authoritative_live_bug_snapshot",
        returned_records: selected.length,
        total_records: counts.bugs,
        open_records: Number(bugTotals?.open_records || 0),
        critical_or_high: Number(bugTotals?.critical_or_high || 0),
        open_critical_or_high_records: openHighRisk,
        records: selected
      }, null, 2),
      score: liveEvidenceScore(contextRoute, "bugs", 0.96)
    }));
    execution.emit("READING_BUGS", "completed", { evidence_count: selected.length,
      message: `Read ${counts.bugs} Defect${counts.bugs === 1 ? "" : "s"} and selected ${selected.length} relevant record${selected.length === 1 ? "" : "s"}.` });
  }

  return { hits, route: contextRoute, counts };
};

module.exports = {
  AGENT_CONTEXT_POLICIES,
  CONTEXT_SCOPES,
  buildLiveProjectEvidence,
  planContext,
  _internals: { makeLiveHit, rankRecords, serializeBoundedEvidence }
};
