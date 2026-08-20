import type { AiArtifactAssuranceAnalysis, AiArtifactAssuranceDimension, AiArtifactAssuranceInsight } from "../types";

type AssuranceStep = {
  id?: string;
  action?: string | null;
  expected_result?: string | null;
  step_type?: string | null;
  automation_code?: string | null;
  api_request?: unknown;
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const scoreStatus = (score: number): AiArtifactAssuranceDimension["status"] =>
  score >= 82 ? "strong" : score >= 60 ? "developing" : "needs-attention";

const overallVerdict = (score: number) => {
  if (score >= 86) return "Strong foundation · ready for focused review";
  if (score >= 72) return "Sound foundation · targeted improvements remain";
  if (score >= 56) return "Developing · material evidence gaps remain";
  return "Needs redesign · resolve the highest-risk gaps first";
};

const dimension = (
  id: string,
  label: string,
  score: number,
  explanation: string,
  evidence: string[],
  recommendation: string,
  frameworks: string[] = []
): AiArtifactAssuranceDimension => ({
  id,
  label,
  score: clampScore(score),
  status: scoreStatus(score),
  explanation,
  evidence: evidence.slice(0, 4),
  recommendation,
  frameworks
});

const insight = (
  id: string,
  priority: AiArtifactAssuranceInsight["priority"],
  title: string,
  explanation: string,
  evidence: string[],
  recommendation: string
): AiArtifactAssuranceInsight => ({ id, priority, title, explanation, evidence: evidence.slice(0, 3), recommendation });

const weightedScore = (dimensions: AiArtifactAssuranceDimension[]) =>
  clampScore(dimensions.reduce((total, item) => total + item.score, 0) / Math.max(dimensions.length, 1));

const includesPattern = (value: string, pattern: RegExp) => pattern.test(value.toLowerCase());

export function buildStoryAssuranceAnalysis(input: {
  title: string;
  description: string;
  gherkinScenarios?: string[];
  linkedCaseCount: number;
  externalReferences?: string[];
  labels?: string[];
  hasDeliveryContext: boolean;
}): AiArtifactAssuranceAnalysis {
  const title = input.title.trim();
  const description = input.description.trim();
  const text = `${title} ${description} ${(input.gherkinScenarios || []).join(" ")}`;
  const references = input.externalReferences || [];
  const labels = input.labels || [];
  const hasUser = includesPattern(text, /\b(user|customer|member|admin|operator|buyer|reader|patient|agent)\b/);
  const hasOutcome = includesPattern(text, /\b(so that|in order to|so i can|outcome|benefit|reduce|improve|prevent|recover|complete)\b/);
  const hasAcceptance = (input.gherkinScenarios || []).length > 0 || includesPattern(description, /\b(acceptance criteria|scenario:)\b|\bgiven\b[\s\S]*\bwhen\b[\s\S]*\bthen\b/);
  const hasConstraints = includesPattern(text, /\b(error|invalid|expired|timeout|limit|boundary|failure|fallback|constraint|single-use|unauthori[sz]ed|edge)\b/);
  const hasSecurity = includesPattern(text, /\b(auth\w*|password|secure|security|privacy|token|session|permission|role)\b/);
  const hasAccessibility = includesPattern(text, /\b(accessib\w*|keyboard|screen reader|focus (?:order|state|indicator)|contrast|aria|wcag)\b/);
  const hasFeedback = includesPattern(text, /\b(feedback|message|confirm|status|notification|progress|response)\b/);
  const hasMeasurableQuality = includesPattern(text, /\b(seconds?|minutes?|percent|latency|availability|success rate|time-bound|single-use)\b/);

  const standardsScore = 12
    + (title.length >= 16 ? 12 : 0)
    + (description.length >= 80 ? 14 : 0)
    + (hasUser && hasOutcome ? 14 : 0)
    + (hasAcceptance ? 14 : 0)
    + (hasConstraints ? 12 : 0)
    + (hasMeasurableQuality ? 8 : 0);
  const standardFrameworks = ["INVEST"];
  if (hasConstraints || hasMeasurableQuality) standardFrameworks.push("ISO/IEC 25010");
  if (hasAccessibility) standardFrameworks.push("WCAG 2.2");
  if (hasSecurity) standardFrameworks.push("OWASP ASVS");

  const usefulnessScore = Math.min(hasMeasurableQuality ? 96 : 88, 16
    + (hasUser ? 18 : 0)
    + (hasOutcome ? 18 : 0)
    + (description.length >= 80 ? 12 : 0)
    + (input.linkedCaseCount > 0 ? 10 : 0)
    + (input.hasDeliveryContext ? 8 : 0)
    + (labels.length > 0 ? 4 : 0)
    + (hasMeasurableQuality ? 10 : 0));

  const maturityScore = 12
    + (hasAcceptance ? 18 : 0)
    + (hasConstraints ? 16 : 0)
    + ((hasSecurity || hasAccessibility) ? 10 : 0)
    + (input.linkedCaseCount > 0 ? 14 : 0)
    + (references.length > 0 ? 8 : 0)
    + (input.hasDeliveryContext ? 8 : 0);

  const marketScore = Math.min(78, 15
    + (hasUser && hasOutcome ? 18 : 0)
    + (hasFeedback ? 12 : 0)
    + (hasConstraints ? 14 : 0)
    + ((hasSecurity || hasAccessibility) ? 12 : 0)
    + (hasMeasurableQuality ? 5 : 0));

  const dimensions = [
    dimension(
      "industry-standards",
      "Industry standards alignment",
      standardsScore,
      hasAcceptance && (hasConstraints || hasMeasurableQuality)
        ? "The Story is testable and includes quality constraints beyond the happy path."
        : "Core intent is present, but standards-aligned acceptance evidence is incomplete.",
      [
        hasUser && hasOutcome ? "User and outcome are explicit" : "User or outcome is not explicit",
        hasAcceptance ? "Acceptance behavior is reviewable" : "No explicit acceptance behavior found",
        hasMeasurableQuality ? "A measurable quality rule is present" : "No measurable quality target found"
      ],
      hasAcceptance ? "Add one measurable non-functional criterion for the highest-risk quality attribute." : "Add concise Given/When/Then or equivalent acceptance criteria.",
      standardFrameworks
    ),
    dimension(
      "usefulness",
      "User usefulness",
      usefulnessScore,
      hasUser && hasOutcome
        ? "The Story connects a recognizable user need to a concrete product outcome."
        : "The requested behavior is visible, but its user benefit needs a sharper statement.",
      [
        hasUser ? "A user or actor is named" : "No clear actor is named",
        hasOutcome ? "A desired outcome is stated" : "Business or user benefit is implicit",
        input.linkedCaseCount ? `${input.linkedCaseCount} linked test case${input.linkedCaseCount === 1 ? "" : "s"}` : "No linked validation"
      ],
      hasOutcome && hasMeasurableQuality ? "Validate the stated success measure with the product owner." : hasOutcome ? "Add one observable measure of user or business value." : "State who benefits, what improves, and why it matters."
    ),
    dimension(
      "design-maturity",
      "Design maturity",
      maturityScore,
      hasAcceptance && hasConstraints
        ? "Behavior, constraints, and validation evidence form a credible implementation brief."
        : "The main flow is understandable; edge states and review evidence need more definition.",
      [
        hasConstraints ? "Edge or failure behavior is represented" : "No edge or failure behavior found",
        (hasSecurity || hasAccessibility) ? "Relevant quality attributes are explicit" : "Quality attributes remain implicit",
        references.length ? `${references.length} source reference${references.length === 1 ? "" : "s"}` : "No source reference supplied"
      ],
      hasConstraints ? "Resolve the remaining evidence gap before implementation starts." : "Add the highest-risk error, empty, permission, or recovery state."
    ),
    dimension(
      "market-patterns",
      "Market comparison readiness",
      marketScore,
      hasFeedback && hasConstraints
        ? "The flow reflects common product patterns for feedback, recovery, and safe failure."
        : "The flow covers the primary task but omits one or more common interaction safeguards.",
      [
        hasFeedback ? "User feedback or confirmation is specified" : "Feedback and confirmation are not explicit",
        hasConstraints ? "Safe failure or recovery is described" : "Safe failure or recovery is not described",
        references.length ? "Named comparison unavailable: reference content was not loaded" : "Named comparison unavailable: no benchmark source supplied"
      ],
      "Add approved competitor or research excerpts to enable a named, source-grounded comparison.",
      ["Common interaction patterns"]
    )
  ];

  const insights: AiArtifactAssuranceInsight[] = [];
  if (!hasAcceptance) insights.push(insight("acceptance", "high", "Make the outcome testable", "The Story does not expose a clear acceptance contract.", ["No Given/When/Then or equivalent rule detected"], "Add 2–4 acceptance criteria covering success and failure."));
  if (!hasConstraints) insights.push(insight("edge-states", "high", "Define the riskiest edge state", "A happy path without failure behavior leaves design and test decisions open.", ["No edge, invalid, timeout, or fallback language detected"], "Specify the most damaging failure and expected recovery."));
  if (!input.linkedCaseCount) insights.push(insight("coverage", "high", "Close the traceability gap", "No reusable test evidence is linked to this Story.", ["0 linked test cases"], "Link or create reviewed coverage before release planning."));
  if (!references.length) insights.push(insight("sources", "medium", "Ground design decisions", "The analysis has no product research, specification, or benchmark source.", ["0 external references"], "Attach the governing spec or approved research excerpt."));
  if (insights.length < 3 && !hasMeasurableQuality) insights.push(insight("measure", "opportunity", "Add a measurable success signal", "A measurable target would make review and release decisions less subjective.", ["No measurable quality target detected"], "Add one latency, completion, accuracy, or reliability target."));
  if (insights.length < 3) insights.push(insight("benchmark-evidence", "opportunity", "Ground the market comparison", "Reference pointers do not provide readable competitor or research evidence to this analysis.", [references.length ? `${references.length} pointer${references.length === 1 ? "" : "s"}; content not loaded` : "No benchmark source supplied"], "Attach an approved excerpt with its source and observation date."));

  const overall = weightedScore(dimensions);
  return {
    artifact_type: "story",
    overall_score: overall,
    score_label: "Story design maturity",
    verdict: overallVerdict(overall),
    summary: "Scores reflect the current Story draft, linked coverage, and available evidence—not model certainty.",
    dimensions,
    insights: insights.slice(0, 3),
    limitations: [
      "Standards scores indicate practice alignment, not certification or compliance.",
      "Market comparison uses common product patterns; no live competitor research was performed."
    ],
    evidence_count: dimensions.reduce((total, item) => total + item.evidence.length, 0) + references.length + input.linkedCaseCount,
    benchmark: {
      mode: "market-pattern",
      label: "Market-pattern benchmark",
      disclosure: "Compared with common product interaction patterns. Add approved source excerpts for named competitor analysis."
    }
  };
}

export function buildTestCaseAssuranceAnalysis(input: {
  title: string;
  description: string;
  steps: AssuranceStep[];
  requirementCount: number;
  labels?: string[];
  parameterValues?: Record<string, string>;
  reviewStatus: string;
  finalizedRunCount?: number;
  passRate?: number | null;
  suiteCount?: number;
  externalReferenceCount?: number;
}): AiArtifactAssuranceAnalysis {
  const title = input.title.trim();
  const description = input.description.trim();
  const steps = input.steps.slice(0, 100);
  const completeSteps = steps.filter((step) => String(step.action || "").trim() && String(step.expected_result || "").trim());
  const allText = `${title} ${description} ${steps.map((step) => `${step.action || ""} ${step.expected_result || ""}`).join(" ")}`;
  const normalizedReview = input.reviewStatus.trim().toLowerCase();
  const isReviewed = ["accepted", "approved"].includes(normalizedReview);
  const hasObservableResults = steps.some((step) => includesPattern(String(step.expected_result || ""), /\b(display|show|return|status|message|response|created|updated|blocked|denied|sent|saved|equal|contain)\b/));
  const hasBoundaryCoverage = includesPattern(allText, /\b(invalid|empty|expired|boundary|limit|maximum|minimum|duplicate|unauthori[sz]ed|failure|error|timeout|negative|zero|null)\b/);
  const hasPreconditions = includesPattern(allText, /\b(given|precondition|logged|setup|existing|configured|starts? with|is on)\b/);
  const parameterCount = Object.keys(input.parameterValues || {}).filter((key) => key.trim()).length;
  const automationEvidenceCount = steps.filter((step) => Boolean(String(step.automation_code || "").trim() || step.api_request)).length;
  const labels = input.labels || [];
  const completeRatio = steps.length ? completeSteps.length / steps.length : 0;
  const observableStepCount = steps.filter((step) => includesPattern(String(step.expected_result || ""), /\b(display|show|return|status|message|response|created|updated|blocked|denied|sent|saved|equal|contain)\b/)).length;
  const observableRatio = steps.length ? observableStepCount / steps.length : 0;
  const finalizedRunCount = Number.isFinite(Number(input.finalizedRunCount))
    ? Math.max(0, Math.floor(Number(input.finalizedRunCount)))
    : 0;
  const observedPassRate = input.passRate !== null && input.passRate !== undefined && Number.isFinite(Number(input.passRate))
    ? Math.max(0, Math.min(100, Math.round(Number(input.passRate))))
    : null;
  const parsedExternalReferenceCount = Number(input.externalReferenceCount || 0);
  const externalReferenceCount = Number.isFinite(parsedExternalReferenceCount)
    ? Math.max(0, Math.floor(parsedExternalReferenceCount))
    : 0;

  const scenarioScoreCap = completeRatio < 1 ? 72 : (steps.length >= 2 || hasBoundaryCoverage ? 94 : 78);
  const scenarioScore = Math.min(scenarioScoreCap, 12
    + (title.length >= 12 ? 12 : 0)
    + (description.length >= 40 ? 10 : 0)
    + (steps.length > 0 ? 16 : 0)
    + (completeRatio === 1 ? 18 : Math.round(completeRatio * 18))
    + (input.requirementCount > 0 ? 16 : 0));

  const clarityScoreCap = completeRatio < 1 ? 72 : Math.round(76 + (observableRatio * 24));
  const clarityScore = Math.min(clarityScoreCap, 16
    + (hasPreconditions ? 16 : 0)
    + (steps.length >= 2 ? 16 : 0)
    + (completeRatio === 1 ? 26 : Math.round(completeRatio * 20))
    + Math.round(observableRatio * 18)
    + (isReviewed ? 8 : 0));

  const reliabilityScoreBeforeObservedOutcomes = 24
    + (hasBoundaryCoverage ? 20 : 0)
    + Math.round(observableRatio * 20)
    + (finalizedRunCount > 0 ? 12 : 0)
    + (observedPassRate !== null ? observedPassRate >= 80 ? 12 : observedPassRate >= 50 ? 6 : 0 : 0);
  const reliabilityScore = finalizedRunCount > 0 && observedPassRate !== null
    ? Math.min(
      reliabilityScoreBeforeObservedOutcomes,
      observedPassRate === 0 ? 40 : observedPassRate < 50 ? 52 : observedPassRate < 80 ? 72 : 100
    )
    : reliabilityScoreBeforeObservedOutcomes;

  const maintainabilityScore = 32
    + (input.requirementCount > 0 ? 22 : 0)
    + ((input.suiteCount || 0) > 0 ? 12 : 0)
    + (labels.length > 0 ? 10 : 0)
    + (externalReferenceCount > 0 ? 8 : 0)
    + (isReviewed ? 10 : 0);

  const dimensions = [
    dimension(
      "scenario-coverage",
      "Scenario intent",
      scenarioScore,
      steps.length && input.requirementCount
        ? "The case has an executable scenario and a traceable product intent."
        : "The scenario needs stronger intent or Story traceability before it can prove coverage.",
      [
        `${steps.length} authored step${steps.length === 1 ? "" : "s"}`,
        input.requirementCount ? `${input.requirementCount} linked ${input.requirementCount === 1 ? "Story" : "Stories"}` : "No linked Story",
        completeRatio === 1 ? "Every authored step has an expected result" : "One or more authored steps are incomplete"
      ],
      "Map this focused scenario to the exact acceptance rule it proves.",
      ["ISO/IEC/IEEE 29119-3", "ISTQB test design practices"]
    ),
    dimension(
      "execution-clarity",
      "Execution clarity",
      clarityScore,
      completeRatio === 1 && hasObservableResults
        ? "Actions and expected results provide a clear, independently executable path."
        : "One or more steps lack the setup or observable result needed for consistent execution.",
      [
        `${completeSteps.length}/${steps.length} action/result pairs complete`,
        hasPreconditions ? "Setup or preconditions are visible" : "Setup or preconditions are implicit",
        `${observableStepCount}/${steps.length} steps have observable assertions`
      ],
      completeRatio === 1 ? "Tighten any subjective expected result into an observable outcome." : "Complete every action/expected-result pair."
    ),
    dimension(
      "data-reliability",
      "Data & reliability",
      reliabilityScore,
      hasBoundaryCoverage || finalizedRunCount > 0
        ? "The case includes risk-oriented data or execution evidence that supports a reliable verdict."
        : "Reliability is inferred from the draft; boundary data and run evidence are still missing.",
      [
        parameterCount ? `${parameterCount} reusable parameter${parameterCount === 1 ? "" : "s"}` : "No explicit test-data parameters",
        finalizedRunCount ? `${finalizedRunCount} finalized run result${finalizedRunCount === 1 ? "" : "s"}` : "No finalized run evidence",
        observedPassRate === null ? "Pass-rate evidence unavailable" : `${observedPassRate}% observed pass rate`
      ],
      hasBoundaryCoverage ? "Capture the data source and reset strategy when state affects repeatability." : "Add representative invalid, empty, expired, or limit data where applicable."
    ),
    dimension(
      "trace-maintainability",
      "Traceability & maintainability",
      maintainabilityScore,
      input.requirementCount && ((input.suiteCount || 0) || labels.length)
        ? "Links and classification make the case easier to reuse, locate, and maintain."
        : "The case is executable, but reuse and change-impact signals are limited.",
      [
        input.requirementCount ? "Story trace is available" : "Story trace is missing",
        (input.suiteCount || 0) ? `${input.suiteCount} linked suite${input.suiteCount === 1 ? "" : "s"}` : "No linked suite",
        automationEvidenceCount ? `${automationEvidenceCount} step${automationEvidenceCount === 1 ? "" : "s"} with automation evidence` : "Manual case; automation is not assumed",
        externalReferenceCount ? `${externalReferenceCount} source reference${externalReferenceCount === 1 ? "" : "s"}` : "No source reference supplied"
      ],
      input.requirementCount ? "Keep the case atomic and review links after Story changes." : "Link the case to the Story or requirement it verifies."
    )
  ];

  const insights: AiArtifactAssuranceInsight[] = [];
  if (finalizedRunCount > 0 && observedPassRate !== null && observedPassRate < 50) insights.push(insight("stability", "high", "Investigate unstable execution evidence", "Recorded outcomes do not yet support reliable reuse of this case.", [`${observedPassRate}% observed pass rate`], "Review failures and environment variance before relying on this case as a quality gate."));
  if (completeRatio < 1) insights.push(insight("incomplete-step", "high", "Complete the execution contract", "A missing action or expected result makes the verdict ambiguous.", [`${completeSteps.length}/${steps.length} complete step pairs`], "Complete the missing pair before review."));
  if (!hasBoundaryCoverage) insights.push(insight("boundary", "medium", "Add adjacent risk coverage", "This focused case has no negative, boundary, or failure signal.", ["Boundary coverage not detected in this case"], "Add or link a separate case for the most costly failure path."));
  if (!input.requirementCount) insights.push(insight("trace", "high", "Restore Story traceability", "The case cannot demonstrate which product rule it covers.", ["0 linked Stories"], "Link the governing Story before adding the case to release scope."));
  if (!finalizedRunCount) insights.push(insight("run-evidence", "medium", "Build execution evidence", "The design score has no observed pass/fail history yet.", ["0 finalized run results"], "Execute in a controlled run and retain the result evidence."));
  if (insights.length < 3 && !isReviewed) insights.push(insight("review", "medium", "Record a human decision", "AI analysis does not approve this test case.", [`Review state: ${normalizedReview.replace(/_/g, " ") || "not requested"}`], "Request review after the design gaps are resolved."));

  const overall = weightedScore(dimensions);
  return {
    artifact_type: "test-case",
    overall_score: overall,
    score_label: "Test design maturity",
    verdict: overallVerdict(overall),
    summary: "Scores reflect the current test draft, trace links, and recorded execution evidence—not model certainty.",
    dimensions,
    insights: insights.slice(0, 3),
    limitations: [
      "Practice alignment is guidance, not standards certification.",
      "Automation and parameterization are supporting evidence, not prerequisites for a strong manual case.",
      "Execution evidence uses the latest case result from at most 25 affected runs; without connected workspace run links, analysis scans the newest 100 runs."
    ],
    evidence_count: dimensions.reduce((total, item) => total + item.evidence.length, 0) + finalizedRunCount,
    benchmark: {
      mode: "market-pattern",
      label: "Test-practice benchmark",
      disclosure: "Compared with common risk-based and evidence-led test design practices."
    }
  };
}
