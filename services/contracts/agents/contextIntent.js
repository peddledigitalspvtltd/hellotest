const CONTEXT_SCOPES = Object.freeze(["stories", "test-cases", "automation", "runs", "bugs", "knowledge"]);

const BASE_AGENT_CONTEXT_POLICIES = Object.freeze({
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

// Shared specialist intent is the source of truth for every Studio agent, including
// the assurance specialists added after the original context router.
const specialistIntents = require('@hellotest/contracts/agents/contextPolicies.json');
const AGENT_CONTEXT_POLICIES = Object.freeze(Object.fromEntries(Object.entries(specialistIntents).map(([id, profile]) => [id, {
  ...(BASE_AGENT_CONTEXT_POLICIES[id] || {}),
  priority_scopes: profile.scopes,
  retrieval_focus: BASE_AGENT_CONTEXT_POLICIES[id]?.retrieval_focus || profile.description,
  outcome_sections: BASE_AGENT_CONTEXT_POLICIES[id]?.outcome_sections || ['findings', 'evidence', 'risk', 'reviewable next items'],
  decision_question: BASE_AGENT_CONTEXT_POLICIES[id]?.decision_question || profile.description,
  deliverable_contract: profile.outputInstructions,
}])));

const DEFAULT_AGENT_POLICY = AGENT_CONTEXT_POLICIES["quality-orchestrator"];
const normalizeText = (value, max = 12_000) => String(value || "").trim().slice(0, max);
const unique = (items) => [...new Set(items.filter(Boolean))];
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

const EXPLICIT_PRODUCT_HELP = /\b(?:how (?:do|can|to)|where (?:do|can|is)|walk ?through|how to|use hellotest|navigate|explain (?:the )?(?:knowledge repo(?:sitory)?|context studio|ask hellotest|chatbot|sprint automator|foreach|for each|mcp)|what (?:is|can i do (?:in|with)) (?:the )?(?:knowledge repo(?:sitory)?|context studio|ask hellotest|chatbot|sprint automator|foreach|for each|mcp)|what (?:features?|capabilit(?:y|ies))|features? (?:of|in)|capabilit(?:y|ies) (?:of|in)|what (?:does|can) (?:hellotest|the chatbot|the assistant))\b/i;
const PRODUCT_BEHAVIOR_QUESTION = /\bhow (?:does|do) (?:the )?(?:sprint automator|foreach|for each|loop over items|mcp|ask hellotest|chatbot|knowledge repo(?:sitory)?)\b/i;
const PRODUCT_CONCEPT_QUESTION = /^\s*(?:what (?:is|are)|explain|guide me (?:through|on)) (?:the |a |an )?(?:test cases?|test runs?|stories|story|defects?|bugs?|sprints?|releases?|workflows?|shared steps?|object repository|environments?|configurations?|automation|sprint automator|foreach|for each|mcp)(?:\s+in hellotest)?[?.!]*\s*$/i;
const CURRENT_PROJECT_FACTS = /\b(?:my|our|current|existing|selected|this project|how many|which|list|show|status|open|closed|failed|blocked|linked|unlinked|recent|today)\b/i;
// Possessives and UI nouns occur in usage questions too ("configure my run",
// "where can I view failed runs"). Requesting that workflow is different from
// asking the assistant to inspect the current records.
const PRODUCT_USAGE_ACTION = /\b(?:(?:how (?:do|can|to)|where (?:do|can))\s+(?:(?:i|we|you)\s+)?(?:create|add|configure|enable|disable|connect|use|find|view|see|open|access|navigate|set up|select|choose|save|upload|import|export|manage|edit|delete|link|run|start)|show(?: me)? how to|walk(?: me)? through)\b/i;
const EXPLICIT_PROJECT_REQUEST = /\b(?:how many|which\s+(?!button|menu|screen|tab|page|setting|option|permission|role)\w+(?:\s+\w+){0,4}\s+(?:are|were|have|failed|need)|(?:analy[sz]e|summari[sz]e|investigate|diagnose|improve|fix|compare)\b|(?:and|also|then)\s+(?:show|list|check|tell|find)\b|(?:show|list)\s+(?:me\s+)?(?:all|the|our|my|current|recent)\b|(?:TC|RUN|STORY|BUG|REQ)[_-]\d+)\b/i;
const REFERENTIAL_FOLLOW_UP = /^(?:and|also|then|so|what about|how about|why|which|where|when)|\b(?:it|its|that|those|them|this|these|same|ones?)\b/i;
const ANALYTICAL_QUESTION = /\b(?:analy[sz]e|compare|explain|why|risk|recommend|improve|impact|root cause|readiness|trend|gap|quality|insights?|summary|summari[sz]e|overview)\b/i;
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
  const explicitStandaloneGuide = (EXPLICIT_PRODUCT_HELP.test(question) || PRODUCT_BEHAVIOR_QUESTION.test(question) || PRODUCT_CONCEPT_QUESTION.test(question))
    && !/\b(?:it|its|that|those|them|these|same|ones?)\b|\bthis(?!\s+(?:project|application|product)\b)/i.test(question);
  const conversationReferenceUsed = Boolean(previousUserMessage && !explicitStandaloneGuide && wordCount <= 20 && REFERENTIAL_FOLLOW_UP.test(question));
  const resolvedQuestion = conversationReferenceUsed
    ? normalizeText(`Previous project question: ${previousUserMessage.content}\nCurrent follow-up: ${question}`, 5_000)
    : question;
  const matchedIntents = INTENT_RULES.filter((rule) => rule.pattern.test(resolvedQuestion));
  const domainIntents = matchedIntents.filter((rule) => rule.id !== "product_help");
  const explicitProductHelp = EXPLICIT_PRODUCT_HELP.test(resolvedQuestion) || PRODUCT_BEHAVIOR_QUESTION.test(resolvedQuestion) || PRODUCT_CONCEPT_QUESTION.test(resolvedQuestion);
  const hasProductHelpIntent = matchedIntents.some((rule) => rule.id === "product_help") || explicitProductHelp;
  const hasCurrentProjectSignal = CURRENT_PROJECT_FACTS.test(resolvedQuestion);
  const pureProductHelp = !agentId
    && hasProductHelpIntent
    && explicitProductHelp
    && !/\b(?:TC|RUN|STORY|BUG|REQ|SPR|SPRINT)[_-]\d+\b/i.test(resolvedQuestion)
    && (!hasCurrentProjectSignal || PRODUCT_USAGE_ACTION.test(resolvedQuestion) && !EXPLICIT_PROJECT_REQUEST.test(resolvedQuestion));
  const routedIntents = pureProductHelp
    ? [INTENT_RULES[0]]
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
        : ANALYTICAL_QUESTION.test(resolvedQuestion)
          ? "project_analysis"
          : hasCurrentProjectSignal
            ? "project_facts"
            : "project_knowledge";
  const validRequested = unique(asArray(requestedScopes).map((scope) => normalizeText(scope, 80).toLowerCase()).filter((scope) => CONTEXT_SCOPES.includes(scope)));
  const confidence = agentId && AGENT_CONTEXT_POLICIES[agentId] || pureProductHelp ? "high" : matchedIntents.length ? (domainIntents.length > 1 ? "high" : "medium") : "low";
  const widened = confidence === "low" && !validRequested.length;
  const baseScopes = pureProductHelp ? ["knowledge"] : validRequested.length ? validRequested : widened ? CONTEXT_SCOPES : policy.priority_scopes;
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
  const identifiers = unique(resolvedQuestion.match(/\b(?:AT[_-][0-9]+|(?:BUG|TC|TS|STORY|RUN|REQ|REL|SPRINT)-?[A-Z0-9_-]+)\b/gi) || []).slice(0, 12);
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
    route_confidence: confidence,
    route_contract_version: "context-intent/2",
    route_resolution: "deterministic",
    scope_widened: widened,
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
      ? ["product guide", "prerequisites and navigation", "ordered usage steps", "expected result", "limitations or missing documentation"]
      : policy.outcome_sections,
    decision_question: policy.decision_question || "What answer is supported by the available project evidence?",
    deliverable_contract: policy.deliverable_contract || "A direct evidence-backed answer with limitations and a useful next step."
  };
};

module.exports = {CONTEXT_SCOPES, AGENT_CONTEXT_POLICIES, DEFAULT_AGENT_POLICY, planContext};
