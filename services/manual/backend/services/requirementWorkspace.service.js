const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { requireAiAssessment } = require("@hellotest/platform/backend/src/utils/requireAiAssessment");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { createHash, randomUUID: uuid } = require("crypto");
const db = require("@hellotest/platform/backend/src/db");
const requirementService = require("./requirement.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { storyAiSnapshot, object } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");

const normalizeList = (value) => Array.isArray(value) ? value : [];
const excerpt = (value, length = 500) => String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, length);
const hash = (input) => createHash("sha256").update(JSON.stringify(input || {})).digest("hex").slice(0, 20);
const REQUIREMENT_EXPORT_LIMIT = 500;
const GROOMING_USAGE_KEY = "ai.requirement.grooming";
const GROOMING_LIST_LIMIT = 8;
const CHECK_STATUSES = new Set(["met", "partial", "missing"]);
const CHECK_STATUS_RANK = { missing: 0, partial: 1, met: 2 };
const READINESS_ACTIONS = {
  intent: "Describe the intended behavior and observable user or system outcome.",
  "actor-flow": "Name the primary actor, trigger, main flow, and recipient of the outcome.",
  "business-outcome": "Add the business outcome and a measurable success signal.",
  acceptance: "Add concrete acceptance criteria covering the success and failure paths.",
  "scope-boundary": "Define what is in and out of scope, then split or size the Story with the delivery team.",
  "solution-design": "Document the observable solution behavior, rules, and system boundaries needed for technical review.",
  "implementation-approach": "Identify the evidenced components, data, integrations, and quality expectations that shape delivery.",
  "delivery-boundaries": "Record applicable dependencies and constraints, or explicitly mark them not applicable.",
  "test-coverage": "Link existing test coverage or draft the minimum scenarios needed for traceability."
};

const normalizeText = (value, limit = 2000) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
};
const normalizeTextList = (value, limit = GROOMING_LIST_LIMIT, itemLimit = 600) => {
  const seen = new Set();
  return normalizeList(value)
    .map((item) => normalizeText(item, itemLimit))
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
};

const meaningfulPlanningText = (value) => {
  const text = normalizeText(value, 1200);
  const withoutTrailingPunctuation = text.replace(/[\s:;,.\-_–—]+$/g, "").trim();
  if (!withoutTrailingPunctuation) return "";
  if (/^(?:as an?\s*:?\s*)?(?:i want(?: to)?\s*:?\s*)?(?:so that\s*:?\s*)?$/i.test(text)) return "";
  if (/^(?:as an?|i want(?: to)?|so that|description|summary|purpose|intent|tbd|tbc|todo|to be (?:defined|determined|confirmed|completed)|not yet (?:defined|determined|confirmed|provided)|n\/?a|none|null|not provided|placeholder)$/i.test(withoutTrailingPunctuation)) return "";
  if (/^(?:\[[^\]]*\]|\{[^}]*\}|\.{2,})$/.test(withoutTrailingPunctuation)) return "";
  if (/^as\s+an?\b/i.test(text) && /\[[^\]]+\]|\{[^}]+\}/.test(text)) return "";
  return text;
};
const explicitNotApplicable = (value) => /^(?:n\/?a|none|not applicable|no (?:known )?(?:dependencies|constraints))$/i
  .test(normalizeText(value, 180).replace(/[\s:;,.\-_–—]+$/g, "").trim());

const htmlToLines = (value) => String(value || "")
  .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
  .replace(/<h[1-6][^>]*>/gi, "\n@@heading@@ ")
  .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
  .replace(/<li[^>]*>/gi, "@@item@@ ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&#(?:8203|8204|8205|65279);/gi, "")
  .replace(/&#x(?:200b|200c|200d|feff);/gi, "")
  .split(/\n+/)
  .map((line) => {
    const trimmed = line.replace(/\s+/g, " ").trim();
    const markdownHeading = /^#{1,6}\s+/.test(trimmed);
    const listItem = trimmed.startsWith("@@item@@ ") || /^\s*(?:[-*•]|\d+[.)])\s+/.test(trimmed);
    const content = trimmed.replace(/^@@item@@\s+/, "").replace(/^#{1,6}\s+/, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    return `${markdownHeading ? "@@heading@@ " : listItem ? "@@item@@ " : ""}${content}`.trim();
  })
  .filter(Boolean);

const boundedDescriptionSnapshot = (value, limit = 4000) => htmlToLines(value)
  .map((line) => line
    .replace(/^@@heading@@ /, "## ")
    .replace(/^@@item@@ /, "- "))
  .join("\n")
  .slice(0, limit)
  .trim();

const SECTION_HEADINGS = [
  ["feature_purpose", /^(?:feature purpose|purpose|intent|feature overview|story description|description)$/i],
  ["business_context", /^(?:business context|problem|problem statement|why it matters|why needed)$/i],
  ["business_impact", /^(?:business impact|business value|commercial impact|operational impact|impact)$/i],
  ["actors", /^(?:actors?|personas?|roles?)$/i],
  ["intended_behaviors", /^(?:intended behavio(?:u)?r|requested behavio(?:u)?r|user intent)$/i],
  ["roles_and_flow", /^(?:roles?(?: and| &) flow|user flow|workflow)$/i],
  ["stakeholders", /^(?:stakeholders?)$/i],
  ["use_cases", /^(?:use cases?|scenarios?|user journeys?)$/i],
  ["outcomes", /^(?:business )?(?:outcomes?|goals?|expected outcomes?|value outcomes?)$/i],
  ["success_measures", /^(?:success measures?|success metrics?|metrics?|kpis?)$/i],
  ["trigger", /^(?:trigger|entry point|starting point)$/i],
  ["journey_steps", /^(?:journey steps?|process steps?|workflow steps?|walkthrough|step-by-step)$/i],
  ["alternate_paths", /^(?:alternate paths?|alternative paths?|exception paths?|recovery paths?)$/i],
  ["solution_design", /^(?:solution design|technical design|architecture|design overview|solution overview)$/i],
  ["implementation_approach", /^(?:implementation approach|implementation plan|delivery approach|build approach)$/i],
  ["components", /^(?:components?|services?|modules?)$/i],
  ["implementation_data", /^(?:data|data model|data flow|storage)$/i],
  ["implementation_integrations", /^(?:integrations?|external systems?|interfaces?)$/i],
  ["functional_requirements", /^(?:functional requirements?|requirements?|required behavio(?:u)?r|behavio(?:u)?r)$/i],
  ["acceptance_criteria", /^(?:acceptance criteria|definition of done|done criteria)$/i],
  ["dependencies", /^(?:dependencies|dependency)$/i],
  ["solution_rules", /^(?:business rules?|data rules?|system rules?|governing rules?)$/i],
  ["constraints", /^(?:constraints?|business rules?|data rules?)$/i],
  ["data_and_integrations", /^(?:data(?: and| &) integrations?|integrations?|external systems?)$/i],
  ["non_functional_requirements", /^(?:non[- ]functional requirements?|quality attributes?|nfrs?)$/i],
  ["edge_cases", /^(?:edge cases?|negative cases?|failure paths?|exceptions?)$/i],
  ["security_and_privacy", /^(?:security(?: and| &) privacy|security|privacy)$/i],
  ["observability", /^(?:observability|monitoring|logging|audit(?:ing)?|telemetry)$/i],
  ["testability_notes", /^(?:testability|test notes?|qa notes?|test approach)$/i],
  ["test_scenarios", /^(?:test scenarios?|validation scenarios?|coverage scenarios?)$/i],
  ["assumptions", /^(?:assumptions?)$/i],
  ["decisions_needed", /^(?:decisions? needed|pending decisions?|decisions?)$/i],
  ["open_questions", /^(?:open questions?|questions?|decisions? needed)$/i],
  ["risks", /^(?:risks?)$/i],
  ["in_scope", /^(?:in scope|scope)$/i],
  ["out_of_scope", /^(?:out of scope|non-goals?)$/i]
];

const parseUserStory = (value) => {
  const text = normalizeText(value, 1200);
  if (!meaningfulPlanningText(text)) return null;
  const withOutcome = text.match(/^as\s+an?\s+(.+?)(?:,\s*|\s+)i\s+want(?:\s+to)?\s+(.+?)(?:,?\s+so\s+that\s+)(.+?)[.!]?$/i);
  const withoutOutcome = withOutcome ? null : text.match(/^as\s+an?\s+(.+?)(?:,\s*|\s+)i\s+want(?:\s+to)?\s+(.+?)[.!]?$/i);
  const match = withOutcome || withoutOutcome;
  if (!match) return null;
  const actor = normalizeText(match[1], 240).replace(/[,.]$/, "");
  const behavior = normalizeText(match[2], 600).replace(/[.]$/, "");
  const outcome = normalizeText(match[3], 600).replace(/[.]$/, "");
  return actor && behavior ? { actor, behavior, outcome } : null;
};

const descriptionSections = (value, { explicitHeadingsOnly = false } = {}) => {
  const sections = Object.fromEntries(SECTION_HEADINGS.map(([key]) => [key, []]));
  const lines = htmlToLines(value);
  let activeSection = null;

  for (const line of lines) {
    const isMarkupHeading = line.startsWith("@@heading@@ ");
    const isListItem = line.startsWith("@@item@@ ");
    const contentLine = isMarkupHeading
      ? line.slice("@@heading@@ ".length)
      : isListItem
        ? line.slice("@@item@@ ".length)
        : line;
    const colonIndex = contentLine.indexOf(":");
    const possibleHeading = (colonIndex >= 0 ? contentLine.slice(0, colonIndex) : contentLine).trim();
    const match = possibleHeading.length <= 80
      ? SECTION_HEADINGS.find(([, pattern]) => pattern.test(possibleHeading))
      : null;

    if (match) {
      activeSection = match[0];
      const inlineValue = colonIndex >= 0 ? normalizeText(contentLine.slice(colonIndex + 1), 600) : "";
      if (inlineValue) sections[activeSection].push(inlineValue);
      continue;
    }

    if (isMarkupHeading || (!isListItem && colonIndex > 0 && possibleHeading.length <= 80)) activeSection = null;
    const userStory = explicitHeadingsOnly ? null : parseUserStory(contentLine);
    const replacesStructuredUserStory = userStory && ["actors", "roles_and_flow", "feature_purpose", "intended_behaviors"].includes(activeSection);
    if (activeSection && !replacesStructuredUserStory) sections[activeSection].push(contentLine);
    if (explicitHeadingsOnly) continue;
    if (userStory) {
      sections.actors.push(userStory.actor);
      sections.intended_behaviors.push(userStory.behavior);
      if (userStory.outcome) sections.outcomes.push(userStory.outcome);
    }
    const outcomeMatch = contentLine.match(/\bso that\s+(.+)$/i);
    if (!userStory && !/^as\s+an?\b/i.test(contentLine) && outcomeMatch?.[1]) sections.outcomes.push(outcomeMatch[1]);
    if (/\b(?:given|when|then)\b/i.test(contentLine)) sections.acceptance_criteria.push(contentLine);
    if (/\?$/.test(contentLine)) sections.open_questions.push(contentLine);
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, items]) => [key, normalizeTextList(items)])
  );
};

const descriptionLead = (value) => {
  const lead = [];
  for (const line of htmlToLines(value)) {
    const isMarkupHeading = line.startsWith("@@heading@@ ");
    const contentLine = line.replace(/^@@(?:heading|item)@@ /, "");
    const colonIndex = contentLine.indexOf(":");
    const possibleHeading = (colonIndex >= 0 ? contentLine.slice(0, colonIndex) : contentLine).trim();
    const isKnownSection = possibleHeading.length <= 80 && SECTION_HEADINGS.some(([, pattern]) => pattern.test(possibleHeading));
    if (isKnownSection || isMarkupHeading) break;
    const meaningfulLine = meaningfulPlanningText(contentLine);
    if (meaningfulLine) lead.push(meaningfulLine);
    if (lead.length === 2) break;
  }
  return normalizeText(lead.join(" "), 600);
};

const buildEvidenceSections = ({ description, storyRef, comments = [] }) => {
  const sectionEntries = Object.fromEntries(SECTION_HEADINGS.map(([key]) => [key, []]));
  const seenBySection = Object.fromEntries(SECTION_HEADINGS.map(([key]) => [key, new Set()]));
  const explicitNotApplicableRefs = { dependencies: [], constraints: [] };
  const addSections = (parsed, ref) => {
    for (const [key, values] of Object.entries(parsed)) {
      for (const value of values) {
        if (Object.hasOwn(explicitNotApplicableRefs, key) && explicitNotApplicable(value)) {
          if (!explicitNotApplicableRefs[key].includes(ref)) explicitNotApplicableRefs[key].push(ref);
          continue;
        }
        const normalized = normalizeText(meaningfulPlanningText(value), 600);
        const dedupeKey = normalized.toLowerCase();
        if (!normalized || seenBySection[key].has(dedupeKey) || sectionEntries[key].length >= GROOMING_LIST_LIMIT) continue;
        seenBySection[key].add(dedupeKey);
        sectionEntries[key].push({ value: normalized, ref });
      }
    }
  };

  addSections(descriptionSections(description), storyRef);
  for (const comment of comments.slice(0, 20)) {
    const commentRef = `comment:${comment.id}`;
    const boundedBody = String(comment.body || "").slice(0, 500);
    addSections(descriptionSections(boundedBody, { explicitHeadingsOnly: true }), commentRef);
  }

  return {
    sections: Object.fromEntries(Object.entries(sectionEntries).map(([key, items]) => [key, items.map((item) => item.value)])),
    section_refs: Object.fromEntries(Object.entries(sectionEntries).map(([key, items]) => [key, [...new Set(items.map((item) => item.ref))]])),
    explicit_not_applicable_refs: explicitNotApplicableRefs
  };
};

const evidenceRefsFor = (sectionRefs, keys, extraRefs = []) => normalizeTextList([
  ...keys.flatMap((key) => sectionRefs[key] || []),
  ...extraRefs
], 16, 255);

const validEvidenceRefs = (value, allowedRefs, limit = 16) => normalizeTextList(value, limit, 255)
  .filter((ref) => allowedRefs.has(ref));
const isFactualEvidenceSource = (item) => item.type !== "attachment" && item.type !== "external-reference";

const check = ({ id, label, status, detail, evidenceRefs = [] }) => ({
  id,
  label,
  status,
  detail,
  evidence_refs: evidenceRefs
});

const readinessFromChecks = (checks) => {
  const missingCore = checks.slice(0, 4).filter((item) => item.status === "missing").length;
  const hasUnresolved = checks.some((item) => item.status !== "met");
  const status = checks[0]?.status === "missing" || missingCore >= 3
    ? "not-ready"
    : hasUnresolved
      ? "needs-clarification"
      : "ready-for-planning";
  const summary = status === "ready-for-planning"
    ? "Intent, actor, business outcome, acceptance, scope, solution boundaries, implementation evidence, and linked coverage are documented for planning review."
    : status === "not-ready"
      ? "The Story is missing core evidence needed for a reliable planning conversation."
      : "The Story has a usable starting point, but specific decisions still need confirmation before planning.";
  const unresolved = checks.filter((item) => item.status !== "met");
  return {
    status,
    summary,
    checks,
    gaps: unresolved.map((item) => item.detail),
    next_actions: unresolved.map((item) => READINESS_ACTIONS[item.id]).filter(Boolean)
  };
};

const buildReadiness = ({ hasIntent, intentEvidenceRefs, sections, sectionRefs, explicitNotApplicableRefs = {}, linkedCases }) => {
  const hasActor = sections.actors.length > 0 || sections.roles_and_flow.length > 0;
  const hasIntendedBehavior = sections.intended_behaviors.length > 0;
  const hasExplicitFlow = sections.roles_and_flow.length > 0
    || sections.journey_steps.length > 0
    || sections.use_cases.length > 0;
  const hasPartialFlowEvidence = hasActor || hasIntendedBehavior || hasExplicitFlow || sections.trigger.length > 0;
  const actorFlowStatus = hasActor && hasExplicitFlow ? "met" : hasPartialFlowEvidence ? "partial" : "missing";
  const hasOutcome = sections.outcomes.length > 0 || sections.success_measures.length > 0;
  const hasAcceptance = sections.acceptance_criteria.length > 0;
  const hasInScope = sections.in_scope.length > 0;
  const hasOutOfScope = sections.out_of_scope.length > 0;
  const scopeStatus = hasInScope && hasOutOfScope ? "met" : hasInScope || hasOutOfScope || hasAcceptance ? "partial" : "missing";
  const hasSolutionDesign = sections.solution_design.length > 0
    || sections.functional_requirements.length > 0
    || sections.solution_rules.length > 0
    || sections.constraints.length > 0;
  const hasImplementationEvidence = sections.implementation_approach.length > 0
    || sections.components.length > 0
    || sections.implementation_data.length > 0
    || sections.implementation_integrations.length > 0
    || sections.data_and_integrations.length > 0
    || sections.non_functional_requirements.length > 0
    || sections.security_and_privacy.length > 0
    || sections.observability.length > 0;
  const hasRecordedDeliveryBoundary = sections.dependencies.length > 0
    || sections.constraints.length > 0
    || sections.solution_rules.length > 0
    || sections.non_functional_requirements.length > 0;
  const hasExplicitNotApplicableBoundary = normalizeList(explicitNotApplicableRefs.dependencies).length > 0
    || normalizeList(explicitNotApplicableRefs.constraints).length > 0;
  const hasDeliveryBoundary = hasRecordedDeliveryBoundary || hasExplicitNotApplicableBoundary;
  const actorFlowEvidenceRefs = evidenceRefsFor(sectionRefs, ["actors", "roles_and_flow", "intended_behaviors", "trigger", "journey_steps", "use_cases"]);
  const businessOutcomeEvidenceRefs = evidenceRefsFor(sectionRefs, ["business_impact", "outcomes", "success_measures"]);
  const acceptanceEvidenceRefs = evidenceRefsFor(sectionRefs, ["acceptance_criteria"]);
  const scopeEvidenceRefs = evidenceRefsFor(sectionRefs, ["in_scope", "out_of_scope", "acceptance_criteria"]);
  const solutionEvidenceRefs = evidenceRefsFor(sectionRefs, ["solution_design", "functional_requirements", "solution_rules", "constraints"]);
  const implementationEvidenceRefs = evidenceRefsFor(sectionRefs, ["implementation_approach", "components", "implementation_data", "implementation_integrations", "data_and_integrations", "non_functional_requirements", "security_and_privacy", "observability"]);
  const deliveryEvidenceRefs = evidenceRefsFor(sectionRefs, ["dependencies", "constraints", "solution_rules", "non_functional_requirements"], [
    ...normalizeList(explicitNotApplicableRefs.dependencies),
    ...normalizeList(explicitNotApplicableRefs.constraints)
  ]);
  const checks = [
    check({ id: "intent", label: "Intent is documented", status: hasIntent ? "met" : "missing", detail: hasIntent ? "The bounded evidence contains a meaningful purpose or intended behavior to review." : "Only the title, empty rich text, or template headings are available; the intended behavior is not documented.", evidenceRefs: hasIntent ? intentEvidenceRefs : [] }),
    check({ id: "actor-flow", label: "Actor and flow are clear", status: actorFlowStatus, detail: actorFlowStatus === "met" ? "The bounded evidence identifies an actor and explicit flow." : actorFlowStatus === "partial" ? "Only part of the actor, trigger, and flow is explicit." : "The initiator, trigger, and recipient of the outcome are not explicit.", evidenceRefs: actorFlowStatus === "missing" ? [] : actorFlowEvidenceRefs }),
    check({ id: "business-outcome", label: "Business outcome is observable", status: hasOutcome ? "met" : "missing", detail: hasOutcome ? "An outcome or success measure is documented." : "No explicit business outcome or success measure is documented.", evidenceRefs: hasOutcome ? businessOutcomeEvidenceRefs : [] }),
    check({ id: "acceptance", label: "Acceptance is testable", status: hasAcceptance ? "met" : "missing", detail: hasAcceptance ? "Acceptance criteria are present in the bounded evidence." : "No explicit acceptance criteria or definition of done is documented.", evidenceRefs: hasAcceptance ? acceptanceEvidenceRefs : [] }),
    check({ id: "scope-boundary", label: "Scope is bounded and estimable", status: scopeStatus, detail: scopeStatus === "met" ? "Both in-scope and out-of-scope boundaries are documented." : scopeStatus === "partial" ? "Some boundary evidence exists, but the Story still needs an explicit in/out-of-scope review before sizing." : "No explicit scope boundary is documented; size and splitting cannot be assessed from the available evidence.", evidenceRefs: scopeStatus === "missing" ? [] : scopeEvidenceRefs }),
    check({ id: "solution-design", label: "Solution behavior and boundaries are reviewable", status: hasSolutionDesign ? "met" : "missing", detail: hasSolutionDesign ? "The bounded evidence records solution behavior, functional requirements, or governing rules for technical review." : "No explicit solution behavior, functional requirements, or governing rules are documented.", evidenceRefs: hasSolutionDesign ? solutionEvidenceRefs : [] }),
    check({ id: "implementation-approach", label: "Implementation evidence is identifiable", status: hasImplementationEvidence ? "met" : "missing", detail: hasImplementationEvidence ? "The bounded evidence records an implementation approach, component, data, integration, or quality expectation." : "No evidenced implementation approach, component, data, integration, or quality expectation is documented.", evidenceRefs: hasImplementationEvidence ? implementationEvidenceRefs : [] }),
    check({ id: "delivery-boundaries", label: "Dependencies and constraints are addressed", status: hasDeliveryBoundary ? "met" : "partial", detail: hasRecordedDeliveryBoundary ? "At least one dependency, constraint, rule, or quality attribute is recorded." : hasExplicitNotApplicableBoundary ? "The bounded evidence explicitly marks a dependency or constraint boundary as not applicable." : "No dependency, constraint, or quality boundary is recorded; confirm whether each is not applicable.", evidenceRefs: hasDeliveryBoundary ? deliveryEvidenceRefs : [] }),
    check({ id: "test-coverage", label: "Test coverage is traceable", status: linkedCases.length ? "met" : "missing", detail: linkedCases.length ? `${linkedCases.length} linked test case${linkedCases.length === 1 ? " is" : "s are"} available for review.` : "No linked test case is recorded.", evidenceRefs: linkedCases.map((item) => `test-case:${item.id}`).slice(0, 8) })
  ];
  return readinessFromChecks(checks);
};

const buildDeterministicGrooming = ({ requirement, comments = [], linkedCases = [], defects = [] }) => {
  const storyRef = `requirement:${requirement.id}`;
  const { sections, section_refs: sectionRefs, explicit_not_applicable_refs: explicitNotApplicableRefs } = buildEvidenceSections({ description: requirement.description, storyRef, comments });
  const explicitAcceptance = normalizeTextList(requirement.acceptance_criteria || requirement.additional_fields?.acceptance_criteria, 12, 600);
  if (explicitAcceptance.length) {
    sections.acceptance_criteria = normalizeList([...explicitAcceptance, ...sections.acceptance_criteria]);
    sectionRefs.acceptance_criteria = normalizeList([storyRef, ...(sectionRefs.acceptance_criteria || [])]);
  }
  const purposeSummary = normalizeText(sections.feature_purpose.join(" "), 900)
    || normalizeText(sections.intended_behaviors.join(" "), 900)
    || descriptionLead(requirement.description);
  const purposeSummaryRefs = sections.feature_purpose.length
    ? evidenceRefsFor(sectionRefs, ["feature_purpose"])
    : sections.intended_behaviors.length
      ? evidenceRefsFor(sectionRefs, ["intended_behaviors"])
      : purposeSummary
        ? [storyRef]
        : [];
  const hasIntent = Boolean(purposeSummary);
  const externalReferences = normalizeTextList(requirement.external_references, 10, 2000);
  const openDefects = defects.filter((item) => !["closed", "done", "resolved", "fixed"].includes(String(item.status || "").toLowerCase()));
  const linkedCaseRefs = linkedCases.map((item) => `test-case:${item.id}`);
  const openDefectRefs = openDefects.map((item) => `issue:${item.id}`);
  const explicitQuestions = normalizeTextList([...sections.open_questions, ...sections.decisions_needed]);
  const readiness = buildReadiness({ hasIntent, intentEvidenceRefs: purposeSummaryRefs, sections, sectionRefs, explicitNotApplicableRefs, linkedCases });
  const gapQuestions = readiness.checks.filter((item) => item.status !== "met").map((item) => ({
    "actor-flow": "Who initiates this behavior, what triggers it, and who receives the outcome?",
    "business-outcome": "What observable result demonstrates business value?",
    acceptance: "Which success, validation, permission, and recovery outcomes define acceptance?",
    "scope-boundary": "What is explicitly in scope, what is out of scope, and should the Story be split before sizing?",
    "solution-design": "What observable behavior, business rules, and system boundaries define the intended solution?",
    "implementation-approach": "Which components, data, integrations, and quality expectations shape the implementation?",
    "delivery-boundaries": "Which dependencies, policies, data rules, or quality constraints apply, and which are not applicable?",
    "test-coverage": "Which linked scenarios will prove the Story is ready to release?",
    intent: "What user or system outcome should this Story deliver?"
  }[item.id])).filter(Boolean);
  const dataAndIntegrations = normalizeTextList([
    ...sections.data_and_integrations,
    ...sections.implementation_data,
    ...sections.implementation_integrations,
    ...externalReferences.map((reference) => `External reference pointer (content not read): ${reference}`)
  ]);
  const linkedTestCoverage = normalizeTextList(linkedCases.map((item) => `Linked test ${item.display_id || item.id}: ${item.title} (${item.status || "status not recorded"}).`));
  const documentedRisks = normalizeTextList([
    ...sections.risks,
    ...openDefects.map((item) => `Open linked defect ${item.jira_bug_key || item.id}: ${item.title} (${item.status || "status not recorded"}).`)
  ]);
  const purposeEvidenceRefs = evidenceRefsFor(sectionRefs, ["business_context", "outcomes"], purposeSummaryRefs);
  const journeyEvidenceRefs = evidenceRefsFor(sectionRefs, ["actors", "roles_and_flow", "intended_behaviors", "trigger", "journey_steps", "use_cases", "alternate_paths"]);
  const businessImpactEvidenceRefs = evidenceRefsFor(sectionRefs, ["business_impact", "stakeholders", "outcomes", "success_measures"]);
  const solutionEvidenceRefs = evidenceRefsFor(sectionRefs, ["solution_design", "intended_behaviors", "functional_requirements", "solution_rules", "dependencies", "constraints"]);
  const implementationEvidenceRefs = evidenceRefsFor(sectionRefs, ["implementation_approach", "components", "implementation_data", "implementation_integrations", "data_and_integrations", "non_functional_requirements", "security_and_privacy", "observability"]);
  const validationEvidenceRefs = evidenceRefsFor(sectionRefs, ["testability_notes", "acceptance_criteria", "test_scenarios", "edge_cases"], linkedCaseRefs);
  const reviewSectionRefs = evidenceRefsFor(sectionRefs, ["assumptions", "open_questions", "decisions_needed", "risks"]);
  const unresolvedByPriority = [
    ...readiness.checks.filter((item) => item.status === "missing"),
    ...readiness.checks.filter((item) => item.status === "partial")
  ];
  const categorizedActions = unresolvedByPriority.map((item) => {
    const action = READINESS_ACTIONS[item.id];
    if (!action) return "";
    const group = item.id === "test-coverage" || item.id === "acceptance"
      ? "Validation"
      : item.id === "implementation-approach" || item.id === "delivery-boundaries"
        ? "Delivery"
        : "Definition";
    return `${group} — ${action}`;
  }).filter(Boolean);
  const remainingEvidenceRefs = normalizeTextList([storyRef, ...reviewSectionRefs, ...openDefectRefs], 12, 255);
  const walkthrough = {
    purpose: {
      summary: purposeSummary,
      why_needed: normalizeText(sections.business_context.join(" "), 1200),
      expected_outcomes: sections.outcomes,
      evidence_refs: purposeEvidenceRefs
    },
    user_journey: {
      summary: normalizeText([...sections.intended_behaviors, ...sections.roles_and_flow].join(" "), 1200),
      actors: sections.actors,
      trigger: normalizeText(sections.trigger.join(" "), 900),
      steps: sections.journey_steps,
      use_cases: sections.use_cases,
      alternate_paths: sections.alternate_paths,
      evidence_refs: journeyEvidenceRefs
    },
    business_impact: {
      summary: normalizeText(sections.business_impact.join(" "), 1200),
      stakeholders: sections.stakeholders,
      value_outcomes: sections.outcomes,
      success_measures: sections.success_measures,
      evidence_refs: businessImpactEvidenceRefs
    },
    solution_design: {
      overview: normalizeText(sections.solution_design.join(" "), 1600),
      behaviors: normalizeTextList([...sections.intended_behaviors, ...sections.functional_requirements]),
      rules: sections.solution_rules,
      dependencies: sections.dependencies,
      constraints: sections.constraints,
      evidence_refs: solutionEvidenceRefs
    },
    implementation: {
      overview: normalizeText(sections.implementation_approach.join(" "), 1600),
      components: sections.components,
      data: sections.implementation_data,
      integrations: normalizeTextList([
        ...sections.implementation_integrations,
        ...sections.data_and_integrations
      ]),
      quality_requirements: normalizeTextList([
        ...sections.non_functional_requirements,
        ...sections.security_and_privacy,
        ...sections.observability
      ]),
      evidence_refs: implementationEvidenceRefs
    },
    validation: {
      summary: normalizeText(sections.testability_notes.join(" "), 1200),
      acceptance_criteria: sections.acceptance_criteria,
      test_scenarios: sections.test_scenarios,
      edge_cases: sections.edge_cases,
      linked_test_coverage: linkedTestCoverage,
      evidence_refs: validationEvidenceRefs.slice(0, 12)
    },
    remaining: {
      summary: readiness.status === "ready-for-planning"
        ? "No planning-readiness blocker is identified in the bounded evidence; confirm the review with the delivery team."
        : readiness.status === "not-ready"
          ? "Resolve the missing core intent, flow, value, or acceptance decisions before planning."
          : "Resolve the highest-priority open decisions before planning.",
      gaps: normalizeTextList(unresolvedByPriority.map((item) => item.detail), 4),
      questions: normalizeTextList([...explicitQuestions, ...gapQuestions]),
      decisions: sections.decisions_needed,
      actions: normalizeTextList(categorizedActions, 4),
      risks: documentedRisks,
      evidence_refs: remainingEvidenceRefs
    }
  };

  return {
    walkthrough,
    layman: {
      explanation: purposeSummary || `No plain-language intent is documented beyond the Story title: “${normalizeText(requirement.title, 240)}”.`,
      analogy: "",
      evidence_refs: purposeSummaryRefs.length ? purposeSummaryRefs : [storyRef]
    },
    business: {
      context: normalizeText([...sections.business_context, ...sections.business_impact].join(" "), 1200),
      roles_and_flow: normalizeTextList([...sections.actors, ...sections.roles_and_flow]),
      use_cases: sections.use_cases,
      outcomes: sections.outcomes,
      success_measures: sections.success_measures,
      stakeholders: sections.stakeholders,
      evidence_refs: evidenceRefsFor(sectionRefs, ["business_context", "business_impact", "actors", "roles_and_flow", "use_cases", "outcomes", "success_measures", "stakeholders"])
    },
    technical: {
      overview: normalizeText(sections.solution_design.join(" "), 1600),
      functional_requirements: sections.functional_requirements,
      data_and_integrations: dataAndIntegrations,
      non_functional_requirements: sections.non_functional_requirements,
      testability_notes: [
        ...sections.testability_notes,
        ...linkedTestCoverage
      ].slice(0, GROOMING_LIST_LIMIT),
      acceptance_criteria: sections.acceptance_criteria,
      dependencies: sections.dependencies,
      constraints: normalizeTextList([...sections.constraints, ...sections.solution_rules]),
      edge_cases: sections.edge_cases,
      security_and_privacy: sections.security_and_privacy,
      observability: sections.observability,
      evidence_refs: evidenceRefsFor(sectionRefs, ["solution_design", "functional_requirements", "data_and_integrations", "implementation_data", "implementation_integrations", "non_functional_requirements", "testability_notes", "acceptance_criteria", "dependencies", "constraints", "solution_rules", "edge_cases", "security_and_privacy", "observability"], [...linkedCaseRefs, ...(externalReferences.length ? [storyRef] : [])]).slice(0, 12)
    },
    scope: {
      in_scope: sections.in_scope,
      out_of_scope: sections.out_of_scope,
      evidence_refs: evidenceRefsFor(sectionRefs, ["in_scope", "out_of_scope"])
    },
    assumptions: sections.assumptions,
    open_questions: normalizeTextList([...explicitQuestions, ...gapQuestions], 8),
    risks: documentedRisks,
    review_evidence_refs: normalizeTextList([storyRef, ...reviewSectionRefs, ...openDefectRefs], 12, 255),
    readiness
  };
};

const groomingContractError = (validationErrors) => Object.assign(new Error("AI Grooming returned an incomplete or ungrounded review."), {
  code: "AI_GROOMING_OUTPUT_INVALID", statusCode: 502,
  validation_errors: validationErrors.slice(0, 32)
});
const groomingIssue = (issues, path, issue) => issues.push({ path, issue });
const normalizeGroomingRefs = (value, allowedRefs, path, issues) => {
  if (!Array.isArray(value) || value.some(ref => typeof ref !== "string" || !ref.trim())) {
    groomingIssue(issues, path, "expected_array_of_evidence_refs");
    return [];
  }
  if (value.some(ref => !allowedRefs.has(ref.trim()))) groomingIssue(issues, path, "unknown_or_forbidden_evidence_ref");
  return validEvidenceRefs(value, allowedRefs);
};

const normalizeSection = ({ candidate, textFields = [], listFields = [], allowedRefs, issues, path }) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    groomingIssue(issues, path, "required_object");
    return null;
  }
  for (const field of textFields) if (typeof candidate[field] !== "string") groomingIssue(issues, `${path}.${field}`, "required_string_empty_when_unknown");
  for (const field of listFields) if (!Array.isArray(candidate[field]) || candidate[field].some(item => typeof item !== "string" || !item.trim())) groomingIssue(issues, `${path}.${field}`, "required_text_array_empty_when_unknown");
  const evidenceRefs = normalizeGroomingRefs(candidate.evidence_refs, allowedRefs, `${path}.evidence_refs`, issues);
  const normalized = {
    ...Object.fromEntries(textFields.map(field => [field, normalizeText(candidate[field], ["explanation", "overview", "context"].includes(field) ? 2400 : 900)])),
    ...Object.fromEntries(listFields.map(field => [field, normalizeTextList(candidate[field])])),
    evidence_refs: evidenceRefs
  };
  const hasContent = textFields.some(field => normalized[field]) || listFields.some(field => normalized[field].length);
  if (hasContent && !evidenceRefs.length) groomingIssue(issues, `${path}.evidence_refs`, "populated_section_requires_allowed_evidence");
  // Empty fields are an honest unknown. They must never be replaced with a
  // locally written narrative merely because a source parser found other text.
  return normalized;
};

const normalizeWalkthrough = (candidate, sources, issues) => {
  const raw = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
  if (raw !== candidate) groomingIssue(issues, "walkthrough", "required_object");
  const narrativeRefs = new Set(sources.filter(item => ["story", "comment", "reviewed-context"].includes(item.type)).map(item => item.ref));
  const validationRefs = new Set(sources.filter(item => ["story", "comment", "reviewed-context", "related-project-record"].includes(item.type)).map(item => item.ref));
  const reviewRefs = new Set(sources.filter(isFactualEvidenceSource).map(item => item.ref));
  return {
    purpose: normalizeSection({ candidate: raw.purpose, textFields: ["summary", "why_needed"], listFields: ["expected_outcomes"], allowedRefs: narrativeRefs, issues, path: "walkthrough.purpose" }),
    user_journey: normalizeSection({ candidate: raw.user_journey, textFields: ["summary", "trigger"], listFields: ["actors", "steps", "use_cases", "alternate_paths"], allowedRefs: narrativeRefs, issues, path: "walkthrough.user_journey" }),
    business_impact: normalizeSection({ candidate: raw.business_impact, textFields: ["summary"], listFields: ["stakeholders", "value_outcomes", "success_measures"], allowedRefs: narrativeRefs, issues, path: "walkthrough.business_impact" }),
    solution_design: normalizeSection({ candidate: raw.solution_design, textFields: ["overview"], listFields: ["behaviors", "rules", "dependencies", "constraints"], allowedRefs: narrativeRefs, issues, path: "walkthrough.solution_design" }),
    implementation: normalizeSection({ candidate: raw.implementation, textFields: ["overview"], listFields: ["components", "data", "integrations", "quality_requirements"], allowedRefs: narrativeRefs, issues, path: "walkthrough.implementation" }),
    validation: normalizeSection({ candidate: raw.validation, textFields: ["summary"], listFields: ["acceptance_criteria", "test_scenarios", "edge_cases", "linked_test_coverage"], allowedRefs: validationRefs, issues, path: "walkthrough.validation" }),
    remaining: normalizeSection({ candidate: raw.remaining, textFields: ["summary"], listFields: ["gaps", "questions", "decisions", "actions", "risks"], allowedRefs: reviewRefs, issues, path: "walkthrough.remaining" })
  };
};

const normalizeReadiness = (candidate, measured, sources, providedIssues) => {
  const issues = providedIssues || [];
  const narrativeRefs = new Set(sources.filter(item => ["story", "comment", "reviewed-context"].includes(item.type)).map(item => item.ref));
  const testCoverageRefs = new Set(sources.filter(item => ["story", "comment", "reviewed-context", "related-project-record"].includes(item.type)).map(item => item.ref));
  const linkedTestRefs = new Set(sources.filter(item => item.type === "related-project-record").map(item => item.ref));
  const expectedIds = new Set(measured.checks.map(item => item.id));
  if (candidate?.status != null && !["ready-for-planning", "needs-clarification", "not-ready"].includes(candidate.status)) {
    groomingIssue(issues, "readiness.status", "expected_ready_for_planning_needs_clarification_or_not_ready");
  }
  const rawChecks = new Map();
  if (!candidate || !Array.isArray(candidate.checks)) groomingIssue(issues, "readiness.checks", "required_canonical_check_array");
  for (const [index, item] of normalizeList(candidate?.checks).entries()) {
    if (!item || typeof item !== "object" || !expectedIds.has(item.id)) { groomingIssue(issues, `readiness.checks[${index}].id`, "unknown_canonical_check"); continue; }
    if (rawChecks.has(item.id)) groomingIssue(issues, `readiness.checks.${item.id}`, "duplicate_check");
    rawChecks.set(item.id, item);
  }
  const adjustments = [];
  const modelChecks = [];
  const checks = measured.checks.map(signal => {
    const item = rawChecks.get(signal.id);
    const path = `readiness.checks.${signal.id}`;
    if (!item) { groomingIssue(issues, path, "required_check"); return null; }
    if (!CHECK_STATUSES.has(item.status)) groomingIssue(issues, `${path}.status`, "expected_met_partial_or_missing");
    if (typeof item.detail !== "string" || !item.detail.trim()) groomingIssue(issues, `${path}.detail`, "required_evidence_or_gap_explanation");
    const allowedRefs = signal.id === "test-coverage" ? testCoverageRefs : narrativeRefs;
    const evidenceRefs = normalizeGroomingRefs(item.evidence_refs, allowedRefs, `${path}.evidence_refs`, issues);
    if (item.status !== "missing" && !evidenceRefs.length) groomingIssue(issues, `${path}.evidence_refs`, "met_or_partial_requires_evidence");
    if (signal.id === "test-coverage" && item.status === "met" && !evidenceRefs.some(ref => linkedTestRefs.has(ref))) groomingIssue(issues, `${path}.evidence_refs`, "met_coverage_requires_linked_test_record");
    const modelCheck = { id: signal.id, label: signal.label, status: item.status,
      detail: normalizeText(item.detail, 500), evidence_refs: evidenceRefs };
    modelChecks.push(modelCheck);
    if (CHECK_STATUSES.has(item.status) && CHECK_STATUS_RANK[item.status] > CHECK_STATUS_RANK[signal.status]) {
      // Source completeness is a code-owned measurement, not generated review
      // prose. Keep the original model assessment alongside every adjustment.
      adjustments.push({ check_id: signal.id, label: signal.label, model_status: item.status,
        measured_status: signal.status, applied_status: signal.status, reason: signal.detail,
        evidence_refs: signal.evidence_refs, applicability: signal.status === "missing" ? "unconfirmed" : "documented" });
      return { ...signal, detail: `Source completeness measurement: ${signal.detail}`, assessment_source: "measurement" };
    }
    return { ...modelCheck, assessment_source: "model" };
  }).filter(Boolean);
  if (!providedIssues && issues.length) throw groomingContractError(issues);
  return { ...readinessFromChecks(checks), model_checks: modelChecks,
    measurement_adjustments: adjustments, measured_checks: measured.checks };
};

const normalizeGroomingCandidate = (candidate, measured, sources) => {
  const raw = candidate?.grooming && typeof candidate.grooming === "object" ? candidate.grooming : candidate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw groomingContractError([{ path: "grooming", issue: "required_object" }]);
  const issues = [];
  const allowedRefs = new Set(sources.filter(isFactualEvidenceSource).map(item => item.ref));
  const layman = normalizeSection({ candidate: raw.layman, textFields: ["explanation", "analogy"], allowedRefs, issues, path: "layman" });
  const business = normalizeSection({ candidate: raw.business, textFields: ["context"], listFields: ["roles_and_flow", "use_cases", "outcomes", "success_measures", "stakeholders"], allowedRefs, issues, path: "business" });
  const technical = normalizeSection({ candidate: raw.technical, textFields: ["overview"], listFields: ["functional_requirements", "data_and_integrations", "non_functional_requirements", "testability_notes", "acceptance_criteria", "dependencies", "constraints", "edge_cases", "security_and_privacy", "observability"], allowedRefs, issues, path: "technical" });
  const scope = normalizeSection({ candidate: raw.scope, listFields: ["in_scope", "out_of_scope"], allowedRefs, issues, path: "scope" });
  const reviewEvidenceRefs = normalizeGroomingRefs(raw.review_evidence_refs, allowedRefs, "review_evidence_refs", issues);
  const review = Object.fromEntries(["assumptions", "open_questions", "risks"].map(field => {
    if (!Array.isArray(raw[field]) || raw[field].some(item => typeof item !== "string" || !item.trim())) groomingIssue(issues, field, "required_text_array_empty_when_unknown");
    const values = normalizeTextList(raw[field]);
    if (values.length && !reviewEvidenceRefs.length) groomingIssue(issues, "review_evidence_refs", `required_for_${field}`);
    return [field, values];
  }));
  const grooming = { walkthrough: normalizeWalkthrough(raw.walkthrough, sources, issues), layman, business, technical, scope,
    ...review, review_evidence_refs: reviewEvidenceRefs, readiness: normalizeReadiness(raw.readiness, measured.readiness, sources, issues) };
  if (![layman?.explanation, grooming.walkthrough.purpose?.summary, grooming.walkthrough.remaining?.summary].some(Boolean)) {
    groomingIssue(issues, "grooming", "required_grounded_purpose_or_missing_evidence_review");
  }
  if (issues.length) throw groomingContractError(issues);
  return { grooming, fallback_sections: [] };
};

const groomingStoryMetadata = (requirement) => {
  const { description, acceptance_criteria, external_references, ...metadata } = storyAiSnapshot(requirement, { listLimit: 12, itemLimit: 600 });
  return { ...metadata, display_id: requirement.display_id || requirement.id, external_reference_pointers: external_references };
};

const groomingSourceSnapshot = (sources) => sources.map((item) => ({
  ref: item.ref,
  type: item.type,
  title: item.title,
  excerpt: item.excerpt || null,
  ...(item.type === "story" ? { acceptance_criteria: normalizeTextList(item.acceptance_criteria, 12, 600) } : {}),
  status: item.status || null
}));

const buildGroomingPrompt = ({ requirement, project, sources, promptGuidance = "", unavailableSources = [] }) => [
  aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.buildGroomingPrompt.1"),
  [aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.service.buildGroomingPrompt.segment.1"),String(JSON.stringify({ prompt_guidance: promptGuidance || null })),""].join(''),
  "",
  aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.buildGroomingPrompt.12"),
  "{",
  aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.buildGroomingPrompt.44"),
  "}",
  "",
  aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.buildGroomingPrompt.26"),
  "",
  [aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.service.buildGroomingPrompt.segment.2"),String(JSON.stringify({ id: project.id, key: project.display_id || project.id })),""].join(''),
  [aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.service.buildGroomingPrompt.segment.3"),String(JSON.stringify(unavailableSources)),aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.service.buildGroomingPrompt.segment.4")].join(''),
  [aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.service.buildGroomingPrompt.segment.5"),String(JSON.stringify(groomingStoryMetadata(requirement))),""].join(''),
  [aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.service.buildGroomingPrompt.segment.6"),String(JSON.stringify(sources.filter(isFactualEvidenceSource).map((item) => item.ref))),""].join(''),
  [aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.service.buildGroomingPrompt.segment.7"),String(JSON.stringify(sources.filter((item) => !isFactualEvidenceSource(item)).map((item) => item.ref))),""].join(''),
  aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.buildGroomingPrompt.42"),
  JSON.stringify(groomingSourceSnapshot(sources), null, 2)
].join("\n");

const extractJson = (value) => {
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Grooming response did not contain JSON");
  return JSON.parse(text.slice(start, end + 1));
};

const requestGrooming = async ({ integration, prompt, correction, timeoutMs }) => {
  const baseUrl = String(integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (integration.api_key) headers.Authorization = `Bearer ${integration.api_key}`;
  const response = await fetchLlmWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: integration.model,

      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: aiInstructionBlock("ai.requirement.grooming", "requirementWorkspace.response.43") },
        { role: "user", content: prompt },
        ...(correction ? [{ role: "user", content: aiInstructionBlock(GROOMING_USAGE_KEY, "requirementWorkspace.contractCorrection") + "\n" + JSON.stringify(correction) }] : [])
      ]
    })
  }, { integration, operation: "requirement.grooming", featureKey: GROOMING_USAGE_KEY, contextFallback: false,
    timeoutMs, maxAttempts: 1, compatibility: false });
  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, headers: response.headers, detail: raw });
  }
  const payload = await response.json();
  const content = getCompletionContent(payload);
  if (!content) throw groomingContractError([{ path: "grooming", issue: "missing_model_content" }]);
  return content;
};

const assisted = ({ capability, input, evidence, confidence, payload, integration = null, fallbackUsed = false, fallbackReason = null, fallbackSections = [], directModelInvocation = false, generationMode: requestedGenerationMode = null }) => {
  const generatedAt = new Date().toISOString();
  const requestId = `${capability}-${Date.now()}`;
  const generationMode = ["llm", "hybrid", "deterministic"].includes(requestedGenerationMode)
    ? requestedGenerationMode
    : integration && !fallbackUsed
      ? "llm"
      : "deterministic";
  const providerBacked = Boolean(integration && (generationMode === "llm" || generationMode === "hybrid"));
  const provider = providerBacked ? integration.name : "HelloTest evidence graph";
  const model = providerBacked ? integration.model : null;
  const normalizedFallbackSections = normalizeTextList(fallbackSections, 24, 120);
  const provenance = { capability, generation_mode: generationMode, provider, model, request_id: requestId, input_fingerprint: hash(input), generated_at: generatedAt, confidence, evidence, fallback_used: fallbackUsed, fallback_reason: fallbackReason, fallback_sections: normalizedFallbackSections, requires_human_review: true };
  return { ...payload, integration: providerBacked ? { id: integration.id, name: integration.name, type: integration.type, model: integration.model, generation_mode: generationMode, direct_model_invocation: true } : { id: "hellotest-evidence-graph", name: "HelloTest evidence graph", type: "deterministic", model: null, generation_mode: generationMode, direct_model_invocation: Boolean(directModelInvocation) }, provenance, generation_mode: generationMode, generated_at: generatedAt, request_id: requestId, input_fingerprint: provenance.input_fingerprint, confidence, fallback_used: fallbackUsed, fallback_reason: fallbackReason, fallback_sections: normalizedFallbackSections, requires_human_review: true, preview_only: true };
};

exports.previewGrooming = async ({ requirement, project, userId, integrationId, user, integration_id, promptGuidance, prompt_guidance, additionalContext, proposedChange } = {}) => {
  // Review the current editor draft without allowing proposed fields to move
  // identity, project scope, permissions, or persisted evidence relationships.
  const draftFields = object(proposedChange);
  const editableFields = ["title", "description", "acceptance_criteria", "gherkin_scenarios", "specification_format", "specification_content", "priority", "status", "external_references", "labels", "sprint", "fix_version", "release", "iteration_id", "dev_completion_target_date", "qa_completion_target_date", "scrum_team"];
  requirement = {
    ...requirement,
    ...Object.fromEntries(editableFields.filter((field) => Object.prototype.hasOwnProperty.call(draftFields, field)).map((field) => [field, draftFields[field]])),
    additional_fields: { ...object(requirement.additional_fields), ...object(draftFields.additional_fields) }
  };
  const rawPromptGuidance = promptGuidance ?? prompt_guidance;
  if (rawPromptGuidance != null && typeof rawPromptGuidance !== "string") {
    throw Object.assign(new Error("AI Grooming prompt guidance must be a string."), { statusCode: 400, code: "INVALID_PROMPT_GUIDANCE" });
  }
  if (typeof rawPromptGuidance === "string" && rawPromptGuidance.length > 4000) {
    throw Object.assign(new Error("AI Grooming prompt guidance is limited to 4000 characters."), { statusCode: 400, code: "PROMPT_GUIDANCE_TOO_LONG" });
  }
  const normalizedPromptGuidance = normalizeText(rawPromptGuidance, 4000);
  if (additionalContext != null && (typeof additionalContext !== "string" || additionalContext.length > 12000)) throw Object.assign(new Error("Reviewed AI context must be a string of at most 12000 characters."), { statusCode: 400 });
  const reviewedContext = normalizeText(additionalContext, 12000);
  const allExternalReferencePointers = [...new Set(normalizeList(requirement.external_references)
    .map((item) => normalizeText(item, 2000))
    .filter(Boolean))];
  const externalReferencePointers = allExternalReferencePointers.slice(0, 10);
  const evidenceAccess = await getOptionalEvidenceAccess(user || (userId ? { id: userId } : null), project.id, ["comment.view", "attachment.view", "testcase.view", "feedback.view"]);
  const restrictedSources = Object.entries({ "comment.view": "comments", "attachment.view": "attachments", "testcase.view": "related_project_records", "feedback.view": "linked_tickets" })
    .filter(([permission]) => !evidenceAccess[permission]).map(([, source]) => source);
  const [comments, attachments, linkedCases, defects, commentCount, attachmentCount, linkedCaseCount, defectCount] = await Promise.all([
    evidenceAccess["comment.view"] ? db.prepare("SELECT id, body, created_at FROM entity_comments WHERE entity_type = 'requirement' AND entity_id = ? ORDER BY created_at DESC LIMIT 20").all(requirement.id) : [],
    evidenceAccess["attachment.view"] ? db.prepare("SELECT id, file_name, mime_type, size_bytes, created_at FROM attachments WHERE entity_type = 'requirement' AND entity_id = ? ORDER BY created_at DESC LIMIT 20").all(requirement.id) : [],
    evidenceAccess["testcase.view"] ? db.prepare("SELECT test_cases.id, test_cases.display_id, test_cases.title, test_cases.status FROM requirement_test_cases JOIN test_cases ON test_cases.id = requirement_test_cases.test_case_id JOIN app_types ON app_types.id = test_cases.app_type_id WHERE requirement_test_cases.requirement_id = ? AND app_types.project_id = ? ORDER BY test_cases.title LIMIT 50").all(requirement.id, project.id) : [],
    evidenceAccess["feedback.view"] ? db.prepare("SELECT feedback.id, feedback.jira_bug_key, feedback.title, feedback.status FROM requirement_defects JOIN feedback ON feedback.id = requirement_defects.issue_id WHERE requirement_defects.requirement_id = ? AND feedback.project_id = ? ORDER BY feedback.created_at DESC LIMIT 50").all(requirement.id, project.id) : [],
    evidenceAccess["comment.view"] ? db.prepare("SELECT COUNT(*) AS count FROM entity_comments WHERE entity_type = 'requirement' AND entity_id = ?").get(requirement.id) : null,
    evidenceAccess["attachment.view"] ? db.prepare("SELECT COUNT(*) AS count FROM attachments WHERE entity_type = 'requirement' AND entity_id = ?").get(requirement.id) : null,
    evidenceAccess["testcase.view"] ? db.prepare("SELECT COUNT(*) AS count FROM requirement_test_cases JOIN test_cases ON test_cases.id = requirement_test_cases.test_case_id JOIN app_types ON app_types.id = test_cases.app_type_id WHERE requirement_test_cases.requirement_id = ? AND app_types.project_id = ?").get(requirement.id, project.id) : null,
    evidenceAccess["feedback.view"] ? db.prepare("SELECT COUNT(*) AS count FROM requirement_defects JOIN feedback ON feedback.id = requirement_defects.issue_id WHERE requirement_id = ? AND feedback.project_id = ?").get(requirement.id, project.id) : null
  ]);
  const totals = {
    comments: Math.max(comments.length, Number.parseInt(String(commentCount?.count || 0), 10) || 0),
    attachments: Math.max(attachments.length, Number.parseInt(String(attachmentCount?.count || 0), 10) || 0),
    related_project_records: Math.max(linkedCases.length, Number.parseInt(String(linkedCaseCount?.count || 0), 10) || 0),
    linked_tickets: Math.max(defects.length, Number.parseInt(String(defectCount?.count || 0), 10) || 0),
    external_references: allExternalReferencePointers.length
  };
  const omitted = {
    comments: Math.max(0, totals.comments - comments.length),
    attachments: Math.max(0, totals.attachments - attachments.length),
    attachment_text: totals.attachments,
    linked_tickets: Math.max(0, totals.linked_tickets - defects.length),
    related_project_records: Math.max(0, totals.related_project_records - linkedCases.length),
    external_references: Math.max(0, totals.external_references - externalReferencePointers.length)
  };
  const partialSources = Object.entries(omitted)
    .filter(([key, count]) => key !== "attachment_text" && count > 0)
    .map(([key]) => key);
  const description = boundedDescriptionSnapshot(requirement.description, 4000);
  const boundedComments = comments.map((item) => ({
    ...item,
    body: boundedDescriptionSnapshot(item.body, 500)
  }));
  const sources = [
    { type: "story", ref: `requirement:${requirement.id}`, id: requirement.display_id || requirement.id, title: normalizeText(requirement.title, 500), excerpt: description, acceptance_criteria: normalizeTextList(requirement.acceptance_criteria || requirement.additional_fields?.acceptance_criteria, 12, 600), status: requirement.status },
    ...(reviewedContext ? [{ type: "reviewed-context", ref: "review:context", id: "reviewed-context", title: "User-reviewed supporting context", excerpt: reviewedContext }] : []),
    ...boundedComments.map((item) => ({ type: "comment", ref: `comment:${item.id}`, id: item.id, title: "Story comment", excerpt: item.body })),
    ...attachments.map((item) => ({ type: "attachment", ref: `attachment:${item.id}`, id: item.id, title: item.file_name, excerpt: `${item.mime_type}; ${item.size_bytes} bytes` })),
    ...externalReferencePointers.map((item, index) => ({ type: "external-reference", ref: `external-reference:${hash(item)}`, id: `REF-${index + 1}`, title: item, excerpt: "Pointer only; content was not fetched." })),
    ...linkedCases.map((item) => ({ type: "related-project-record", ref: `test-case:${item.id}`, id: item.display_id || item.id, title: item.title, status: item.status })),
    ...defects.map((item) => ({ type: "linked-ticket", ref: `issue:${item.id}`, id: item.jira_bug_key || item.id, title: item.title, status: item.status }))
  ];
  const evidenceRefs = sources.map((item) => item.ref);
  const boundedRequirement = { ...requirement, description, external_references: externalReferencePointers };
  const measured = buildDeterministicGrooming({ requirement: boundedRequirement, comments: boundedComments, linkedCases, defects });
  const integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
    integrationId: integrationId || integration_id, userId: userId || user?.id,
    usageKey: GROOMING_USAGE_KEY, projectId: project.id, fallback: "project-then-global", allowMissing: true
  });
  requireAiAssessment({ integration });
  const prompt = buildGroomingPrompt({ requirement: boundedRequirement, project, sources,
    promptGuidance: normalizedPromptGuidance, unavailableSources: restrictedSources });
  const deadline = Date.now() + 60000;
  let grooming, correction, validationErrors = [], modelCalls = 0;
  for (; modelCalls < 2; modelCalls++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    let content;
    try {
      content = await requestGrooming({ integration, prompt, correction, timeoutMs: remaining });
      const normalized = normalizeGroomingCandidate(extractJson(content), measured, sources);
      grooming = normalized.grooming;
      modelCalls++;
      break;
    } catch (error) {
      if (error instanceof SyntaxError || ["AI_GROOMING_OUTPUT_INVALID","AI_INVALID_JSON","AI_OUTPUT_SCHEMA_VIOLATION","AI_MANAGED_SCHEMA_INVALID"].includes(error?.code) || /Grooming response did not contain JSON/.test(error?.message || "")) {
        validationErrors = error.validation_errors || [{ path: "grooming", issue: "invalid_json_object" }];
        correction = { validation_errors: validationErrors,
          previous_response: typeof (content || error.model_candidate) === "string" ? (content || error.model_candidate).slice(0, 24000) : null };
        continue;
      }
      if (typeof error?.publicMessage === "string" && error.publicMessage.trim()) throw error;
      if (["LLM_AUTHENTICATION_FAILED", "LLM_QUOTA_EXCEEDED", "LLM_RATE_LIMITED", "LLM_RATE_LIMIT_REQUEST_TOO_LARGE", "LLM_REQUEST_TOO_LARGE"].includes(error?.code)) throw error;
      requireAiAssessment({ integration, failed: true });
    }
  }
  if (!grooming) {
    const message = `AI Grooming did not return a complete, evidence-backed review ${modelCalls > 1 ? "after one correction" : "within the review time budget"}. No fallback review was generated. Retry with a smaller Story or another configured model.`;
    throw Object.assign(new Error(message), { code: "AI_GROOMING_OUTPUT_INVALID", statusCode: 502,
      publicMessage: message, validation_errors: validationErrors, model_calls: modelCalls });
  }
  const readinessChecks = grooming.readiness.checks;
  const groundedChecks = readinessChecks.filter((item) => item.status === "met").length;
  const partialChecks = readinessChecks.filter((item) => item.status === "partial").length;
  const confidence = readinessChecks.length
    ? Math.round(((groundedChecks + partialChecks * 0.5) / readinessChecks.length) * 100) / 100
    : 0;
  return assisted({
    capability: "story-grooming-preview",
    input: {
      requirement: { ...groomingStoryMetadata(boundedRequirement), description },
      project: { id: project.id, key: project.display_id || project.id },
      evidence: groomingSourceSnapshot(sources),
      evidence_boundary: { totals, omitted, unavailable_sources: restrictedSources },
      prompt_guidance: normalizedPromptGuidance || null
    },
    evidence: evidenceRefs,
    confidence,
    integration,
    fallbackUsed: false, fallbackReason: null, fallbackSections: [],
    directModelInvocation: true, generationMode: "llm",
    payload: {
      model_execution: { model_calls: modelCalls, max_model_calls: 2, contract_repaired: modelCalls > 1 },
      requirement: { id: requirement.id, display_id: requirement.display_id || requirement.id, title: requirement.title, status: requirement.status, priority: requirement.priority },
      grooming,
      context: { scope: { project_id: project.id, project_key: project.display_id || project.id }, bounded: true, limits: { comments: 20, attachments: 20, attachment_text_files: 0, attachment_text_bytes: 0, attachment_text_chars: 0, linked_tickets: 50, related_project_records: 50, external_references: 10, comment_chars: 500, description_chars: 4000, reviewed_context_chars: 12000 }, included: { reviewed_context: reviewedContext ? 1 : 0, comments: comments.length, attachments: attachments.length, attachment_text_files: 0, linked_tickets: defects.length, related_project_records: linkedCases.length, external_references: externalReferencePointers.length }, omitted, partial_sources: partialSources, unavailable_sources: [...restrictedSources, ...(totals.attachments ? ["attachment-text-extraction"] : [])], sources }
    }
  });
};

exports.previewGherkin = (input) => require("@hellotest/ai/backend/services/storyGherkin.service").preview(input);

exports.exportRequirements = async ({ projectId, requirementIds = [], userId, format = "csv" }) => {
  const ids = [...new Set(requirementIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (ids.length > REQUIREMENT_EXPORT_LIMIT) {
    throw Object.assign(new Error(`A single Story export is limited to ${REQUIREMENT_EXPORT_LIMIT} records.`), { statusCode: 413, code: "EXPORT_LIMIT_EXCEEDED" });
  }

  const selected = await requirementService.getRequirements({
    project_id: projectId,
    ids,
    limit: ids.length || REQUIREMENT_EXPORT_LIMIT + 1
  });
  if (!ids.length && selected.length > REQUIREMENT_EXPORT_LIMIT) {
    throw Object.assign(new Error(`This project has more than ${REQUIREMENT_EXPORT_LIMIT} Stories. Select a smaller export set.`), { statusCode: 413, code: "EXPORT_LIMIT_EXCEEDED" });
  }
  if (selected.length) {
    const memberships = await db.prepare(`SELECT ri.requirement_id, rel.id, rel.name, rel.fix_version
      FROM requirement_release_items ri JOIN requirement_releases rel ON rel.id = ri.release_id
      WHERE rel.project_id = ? AND ri.source = 'manual' AND ri.requirement_id IN (${selected.map(() => '?').join(',')})`)
      .all(projectId, ...selected.map(item => item.id));
    for (const story of selected) {
      const options = memberships.filter(item => item.requirement_id === story.id);
      const matches = options.filter(item => (story.release && item.name === story.release) || (story.fix_version && item.fix_version === story.fix_version));
      story.release_id = (matches.length === 1 ? matches[0] : options.length === 1 ? options[0] : null)?.id || null;
    }
  }
  const skipped = ids.filter((id) => !selected.some((item) => item.id === id)).map((id) => ({ id, code: "NOT_FOUND", message: "Story is missing or outside the selected project." }));
  const completedAt = new Date().toISOString();
  const transaction = await workspaceTransactionService.createTransaction({ project_id: projectId, category: "bulk_export", action: "requirement_export", status: "completed", title: "Story export", description: `Exported ${selected.length} Story record${selected.length === 1 ? "" : "s"}.`, metadata: { export_format: format, total_items: ids.length || selected.length, processed_items: selected.length, exported: selected.length, failed: skipped.length, progress_percent: 100, current_phase: "completed" }, related_kind: "requirement", created_by: userId, started_at: completedAt, completed_at: completedAt });
  return { id: transaction.id, transaction_id: transaction.id, queued: false, status: "completed", count: selected.length, skipped, requirement_records: selected };
};

const STORY_GENERATION_LEASE_SECONDS = Math.max(30, Math.min(15 * 60, Number.parseInt(process.env.STORY_GENERATION_LEASE_SECONDS || "180", 10) || 180));
const STORY_GENERATION_QUEUE_LIMIT = Math.max(1, Math.min(10, Number.parseInt(process.env.STORY_GENERATION_QUEUE_LIMIT || "1", 10) || 1));
const STORY_GENERATION_WORKER_ID = `story-generation-${process.pid}-${uuid()}`;
let storyGenerationQueueRun = null;

const parseGenerationJobPayload = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// Deliberately project a public job shape. Lease owner/expiry/heartbeat are
// worker coordination details and must never be disclosed through polling.
const shapeJob = (row) => {
  const resultPayload = parseGenerationJobPayload(row?.result_payload);
  const publicResultPayload = { ...resultPayload };
  delete publicResultPayload.lease_owner;
  delete publicResultPayload.lease_expires_at;
  delete publicResultPayload.heartbeat_at;
  return {
    ...publicResultPayload,
    id: row.id,
    job_id: row.id,
    project_id: row.project_id,
    status: row.status,
    queued: row.status === "queued",
    input_payload: parseGenerationJobPayload(row.input_payload),
    result_payload: publicResultPayload,
    last_error: row.last_error || null,
    attempts: Number(row.attempts || 0),
    created_by: row.created_by || null,
    created_at: row.created_at,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    updated_at: row.updated_at
  };
};

const storyGenerationJobProcessing = (status, errorMessage = null) => {
  const stageIds = ["intake", "context", "guardrails", "specialist", "outcome", "evaluation", "review"];
  const isQueued = status === "queued";
  const isFailed = status === "failed";
  return {
    active_stage_id: "intake",
    completed_stage_count: 0,
    total_stage_count: stageIds.length,
    status_label: isQueued ? "Queued for backend processing" : isFailed ? "Story generation failed" : "Story generation request in progress",
    stages: stageIds.map((id, index) => ({
      id,
      status: index === 0 ? isQueued ? "queued" : isFailed ? "failed" : "running" : "queued",
      detail: index === 0
        ? isQueued
          ? "The request is persisted and waiting for the backend runner."
          : isFailed
            ? errorMessage || "The backend runner could not complete this request."
            : "The backend runner is processing the persisted Story request."
        : "This stage has not reported completion yet."
    }))
  };
};

const storyGenerationJobPayload = (status, errorMessage = null) => ({
  processing: storyGenerationJobProcessing(status, errorMessage),
  review_status: status === "failed" ? "not_available" : "processing",
  requires_human_review: true,
  preview_only: true
});

const claimGenerationJob = ({ workerId, leaseSeconds }) => db.transaction(async () => {
  const candidate = await db.prepare(`
    SELECT id
    FROM ai_requirement_generation_jobs
    WHERE status = 'queued'
       OR (
         status = 'running'
         AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
       )
    ORDER BY
      CASE WHEN status = 'running' THEN 0 ELSE 1 END,
      created_at ASC,
      id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `).get();
  if (!candidate) return null;

  return db.prepare(`
    UPDATE ai_requirement_generation_jobs
    SET status = 'running',
        result_payload = ?,
        last_error = NULL,
        attempts = attempts + 1,
        lease_owner = ?,
        lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 second'),
        heartbeat_at = CURRENT_TIMESTAMP,
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        status = 'queued'
        OR (
          status = 'running'
          AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
        )
      )
    RETURNING *
  `).get(storyGenerationJobPayload("running"), workerId, leaseSeconds, candidate.id);
})();

const renewGenerationJobLease = (id, workerId, leaseSeconds) => db.prepare(`
  UPDATE ai_requirement_generation_jobs
  SET lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 second'),
      heartbeat_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND status = 'running'
    AND lease_owner = ?
    AND lease_expires_at > CURRENT_TIMESTAMP
`).run(leaseSeconds, id, workerId);

const completeGenerationJob = (id, workerId, result) => db.prepare(`
  UPDATE ai_requirement_generation_jobs
  SET status = 'completed',
      result_payload = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      heartbeat_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND status = 'running'
    AND lease_owner = ?
    AND lease_expires_at > CURRENT_TIMESTAMP
  RETURNING *
`).get(result, id, workerId);

const failGenerationJob = (id, workerId, message) => db.prepare(`
  UPDATE ai_requirement_generation_jobs
  SET status = 'failed',
      result_payload = ?,
      last_error = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      heartbeat_at = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND status = 'running'
    AND lease_owner = ?
    AND lease_expires_at > CURRENT_TIMESTAMP
  RETURNING *
`).get(storyGenerationJobPayload("failed", message), message, id, workerId);

const runClaimedGenerationJob = async ({ job, workerId, leaseSeconds }) => {
  const heartbeatIntervalMs = Math.max(5_000, Math.floor(leaseSeconds * 1000 / 3));
  let heartbeatInFlight = false;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || leaseLost) return;
    heartbeatInFlight = true;
    void renewGenerationJobLease(job.id, workerId, leaseSeconds)
      .then((renewed) => {
        if (!renewed.changes) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    if (!job.created_by) throw new Error("The Story generation job creator is no longer available.");
    const storedInput = parseGenerationJobPayload(job.input_payload);
    const result = await requirementService.previewRequirementCreation({
      ...storedInput,
      project_id: job.project_id,
      user_id: job.created_by
    });
    const completed = await completeGenerationJob(job.id, workerId, result);
    return { id: job.id, status: completed ? "completed" : "ownership_lost" };
  } catch (error) {
    const message = excerpt(error instanceof Error ? error.message : "Story generation failed", 1_000) || "Story generation failed";
    const failed = await failGenerationJob(job.id, workerId, message);
    return { id: job.id, status: failed ? "failed" : "ownership_lost" };
  } finally {
    clearInterval(heartbeat);
  }
};

const drainGenerationQueue = async ({
  limit = STORY_GENERATION_QUEUE_LIMIT,
  workerId = STORY_GENERATION_WORKER_ID,
  leaseSeconds = STORY_GENERATION_LEASE_SECONDS
} = {}) => {
  const normalizedLimit = Math.max(1, Math.min(10, Number.parseInt(String(limit), 10) || STORY_GENERATION_QUEUE_LIMIT));
  const normalizedLeaseSeconds = Math.max(30, Math.min(15 * 60, Number.parseInt(String(leaseSeconds), 10) || STORY_GENERATION_LEASE_SECONDS));
  const outcomes = [];
  for (let index = 0; index < normalizedLimit; index += 1) {
    const job = await claimGenerationJob({ workerId, leaseSeconds: normalizedLeaseSeconds });
    if (!job) break;
    outcomes.push(await runClaimedGenerationJob({ job, workerId, leaseSeconds: normalizedLeaseSeconds }));
  }
  return outcomes;
};

exports.processQueuedGenerationJobs = (options = {}) => {
  if (storyGenerationQueueRun) return storyGenerationQueueRun;
  storyGenerationQueueRun = drainGenerationQueue(options).finally(() => {
    storyGenerationQueueRun = null;
  });
  return storyGenerationQueueRun;
};

const scheduleGenerationJob = (task) => {
  setImmediate(() => {
    void Promise.resolve().then(task).catch(() => undefined);
  });
};

exports.createGenerationJob = async ({ input, userId, schedule = scheduleGenerationJob }) => {
  const id = uuid();
  const queuedPayload = storyGenerationJobPayload("queued");
  const row = await db.prepare(`INSERT INTO ai_requirement_generation_jobs (id, project_id, status, input_payload, result_payload, created_by) VALUES (?, ?, 'queued', ?, ?, ?) RETURNING *`).get(id, input.project_id, input, queuedPayload, userId);
  // This trigger only lowers latency. The recurring worker is the durable path,
  // and always reloads the input and creator from PostgreSQL.
  try {
    schedule(() => exports.processQueuedGenerationJobs({ limit: 1 }));
  } catch {
    // The row is already durable; the recurring background worker will claim it.
  }
  return shapeJob(row);
};

exports.getGenerationJob = async (id, projectId) => {
  const row = await db.prepare(`SELECT * FROM ai_requirement_generation_jobs WHERE id = ? AND project_id = ?`).get(id, projectId);
  if (!row) throw Object.assign(new Error("Story generation job not found"), { statusCode: 404 });
  return shapeJob(row);
};

exports.listGenerationJobs = async (projectId, status, limit = 10) => {
  const parsedLimit = Math.max(1, Math.min(50, Number.parseInt(String(limit), 10) || 10));
  const rows = status
    ? await db.prepare(`SELECT * FROM ai_requirement_generation_jobs WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`).all(projectId, status, parsedLimit)
    : await db.prepare(`SELECT * FROM ai_requirement_generation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`).all(projectId, parsedLimit);
  return rows.map(shapeJob);
};

if (process.env.NODE_ENV === "test") {
  Object.defineProperty(exports, "__groomingInternals", {
    enumerable: false,
    value: { parseUserStory, descriptionSections, buildEvidenceSections, buildDeterministicGrooming, normalizeReadiness, normalizeGroomingCandidate, buildGroomingPrompt, assisted }
  });
  Object.defineProperty(exports, "__storyGenerationJobInternals", {
    enumerable: false,
    value: {
      claimGenerationJob,
      renewGenerationJobLease,
      completeGenerationJob,
      failGenerationJob,
      runClaimedGenerationJob,
      drainGenerationQueue,
      parseGenerationJobPayload,
      shapeJob,
      storyGenerationJobPayload,
      storyGenerationJobProcessing
    }
  });
}
