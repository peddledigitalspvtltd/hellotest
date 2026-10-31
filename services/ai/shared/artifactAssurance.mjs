// Shared native Story/Test Case measurements. Keep model narrative separate from measured scores.
const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));
const scoreStatus = (score) => score >= 82 ? "strong" : score >= 60 ? "developing" : "needs-attention";
const overallVerdict = (score) => {
    if (score >= 86)
        return "Strong foundation · ready for focused review";
    if (score >= 72)
        return "Sound foundation · targeted improvements remain";
    if (score >= 56)
        return "Developing · material evidence gaps remain";
    return "Needs redesign · resolve the highest-risk gaps first";
};
const dimension = (id, label, score, explanation, evidence, recommendation, frameworks = []) => ({
    id,
    label,
    score: clampScore(score),
    status: scoreStatus(score),
    explanation,
    evidence: evidence.slice(0, 4),
    recommendation,
    frameworks
});
const insight = (id, priority, title, explanation, evidence, recommendation) => ({ id, priority, title, explanation, evidence: evidence.slice(0, 3), recommendation });
const weightedScore = (dimensions) => clampScore(dimensions.reduce((total, item) => total + item.score, 0) / Math.max(dimensions.length, 1));
const includesPattern = (value, pattern) => pattern.test(value.toLowerCase());
const meaningfulText = value => Boolean(String(value || '').trim())
    && !/^(?:todo|tbd|n\/?a|placeholder|title|description|test|step|expected result|\[[^\]]+\])\s*[.!?]*$/i.test(String(value).trim());
const signalScore = signals => clampScore(signals.reduce((sum, [value, weight]) => sum + Math.max(0, Math.min(1, Number(value))) * weight, 0));
export function buildStoryAssuranceAnalysis(input) {
    const title = input.title.trim();
    const description = input.description.trim();
    const text = `${title} ${description} ${(input.gherkinScenarios || []).join(" ")} ${(input.acceptanceCriteria || []).join(' ')}`;
    const references = input.externalReferences || [];
    const hasUser = includesPattern(text, /\b(user|customer|member|admin|operator|buyer|reader|patient|agent)\b/);
    const hasOutcome = includesPattern(text, /\b(so that|in order to|so i can|outcome|benefit|reduce|improve|prevent|recover|complete)\b/);
    const hasAcceptance = (input.acceptanceCriteria || []).some(value => value.trim()) || (input.gherkinScenarios || []).length > 0 || includesPattern(description, /\b(acceptance criteria|scenario:)\b|\bgiven\b[\s\S]*\bwhen\b[\s\S]*\bthen\b/);
    const hasConstraints = includesPattern(text, /\b(error|invalid|expired|timeout|limit|boundary|failure|fallback|constraint|single-use|unauthori[sz]ed|edge)\b/);
    const hasMeasurableQuality = includesPattern(text, /\b(seconds?|minutes?|percent|latency|availability|success rate|time-bound|single-use)\b/);
    const hasQualityObjective = includesPattern(text, /\b(performance|latency|availability|reliability|accessibility|scalability|non-functional|nfr|recovery objective)\b/);
    const hasBenchmarkObjective = includesPattern(text, /\b(benchmark|competitor|market comparison|research comparison)\b/);
    const acceptance = [...(input.acceptanceCriteria || []), ...(input.gherkinScenarios || [])].filter(value => String(value || '').trim());
    const acceptanceRatio = acceptance.length ? acceptance.filter(meaningfulText).length / acceptance.length : hasAcceptance ? 1 : 0;
    const hasTitle = meaningfulText(title), hasDescription = meaningfulText(description);
    // Measure the authored contract. Missing unrelated NFR categories, linked
    // tests, delivery metadata or research must not depress a focused Story.
    const standardsScore = signalScore([[hasTitle, 35], [hasDescription, 65]]);
    const standardFrameworks = ["Authored scope and acceptance contract"];
    const usefulnessScore = signalScore([[hasTitle, 20], [hasDescription, 40], [acceptanceRatio, 40]]);
    const maturityScore = signalScore([[hasTitle, 15], [hasDescription, 25], [acceptanceRatio, 60]]);
    const marketScore = signalScore([[acceptanceRatio, 100]]);
    const dimensions = [
        dimension("industry-standards", "Scope clarity", standardsScore, hasTitle && hasDescription
            ? "A named objective and a non-placeholder behavior description are supplied."
            : "The authored scope needs a meaningful title and behavior description.", [
            hasTitle ? "A named Story objective is supplied" : "Story title is missing or a placeholder",
            hasDescription ? "Behavior description is supplied" : "Behavior description is missing or a placeholder",
            "Unrequested quality categories do not affect this score"
        ], !hasAcceptance ? "Add concise Given/When/Then or equivalent observable acceptance criteria."
            : hasQualityObjective && !hasMeasurableQuality ? "Clarify the acceptance measure for the quality objective already in scope; obtain missing targets from an authorized source."
                : "Preserve the stated objective and resolve ambiguous acceptance outcomes without adding unrequested coverage.", standardFrameworks),
        dimension("usefulness", "Intent and outcome", usefulnessScore, hasTitle && hasDescription && acceptanceRatio === 1
            ? "The Story supplies an objective, behavior description and reviewable acceptance text."
            : "The supplied objective, behavior or acceptance text is incomplete.", [
            hasUser ? "A user or actor is named" : "No clear actor is named",
            hasOutcome ? "A desired outcome is stated" : "Business or user benefit is implicit",
            input.linkedCaseCount ? `${input.linkedCaseCount} linked test case${input.linkedCaseCount === 1 ? "" : "s"}` : "No linked validation"
        ], "Review that the supplied acceptance outcome demonstrates the stated objective; a persona template is optional."),
        dimension("design-maturity", "Authored design contract", maturityScore, hasTitle && hasDescription && acceptanceRatio === 1
            ? "The current authored scope and acceptance fields are complete for semantic review."
            : "Complete the missing authored scope or acceptance field before semantic review.", [
            hasAcceptance ? "Acceptance text is supplied" : "Acceptance text is missing",
            "Negative, security and accessibility categories are scored only through the Story acceptance already in scope",
            references.length ? `${references.length} source reference${references.length === 1 ? "" : "s"}` : "No source reference supplied"
        ], hasConstraints ? "Resolve ambiguity in the constraints already supplied." : "Confirm the intended scope with the owner; add edge behavior only when relevant to that scope."),
        dimension("market-patterns", "Acceptance text completeness", marketScore, acceptanceRatio === 1
            ? "Every supplied acceptance item is nonempty and not a placeholder; semantic adequacy still requires review."
            : "Acceptance items are missing or contain placeholders.", [
            `${acceptance.length} explicitly supplied acceptance item${acceptance.length === 1 ? '' : 's'}`,
            "A named market comparison is not part of this design score",
            references.length ? "Named comparison unavailable: reference content was not loaded" : "Named comparison unavailable: no benchmark source supplied"
        ], hasBenchmarkObjective ? "Supply approved source excerpts for the requested comparison." : "No named market comparison was requested; review the supplied product intent directly.", ["Non-placeholder acceptance text"])
    ];
    const insights = [];
    if (acceptanceRatio < 1)
        insights.push(insight("acceptance", "high", "Make the outcome testable", "The Story does not expose a clear acceptance contract.", ["No Given/When/Then or equivalent rule detected"], "Add 2–4 acceptance criteria covering success and failure."));
    if (insights.length < 3 && hasQualityObjective && !hasMeasurableQuality)
        insights.push(insight("measure", "opportunity", "Clarify the stated quality objective", "The Story names a quality objective without a detectable acceptance measure.", ["Quality objective present; acceptance measure not detected"], "Confirm the observable result and obtain any required target from the product owner; do not invent one."));
    if (insights.length < 3 && hasBenchmarkObjective)
        insights.push(insight("benchmark-evidence", "opportunity", "Ground the market comparison", "Reference pointers do not provide readable competitor or research evidence to this analysis.", [references.length ? `${references.length} pointer${references.length === 1 ? "" : "s"}; content not loaded` : "No benchmark source supplied"], "Attach an approved excerpt with its source and observation date."));
    const overall = weightedScore(dimensions);
    return {
        artifact_type: "story",
        overall_score: overall,
        score_label: "Story design completeness",
        verdict: overallVerdict(overall),
        summary: "Scores measure authored scope and acceptance-text completeness for the stated objective. Linked tests, NFR categories, labels, delivery metadata and benchmark sources do not raise or lower this design score. Semantic correctness requires review.",
        dimensions,
        insights: insights.slice(0, 3),
        limitations: [
            "Non-placeholder field presence does not establish semantic adequacy, standards certification or compliance; missing unrelated quality categories are not Story defects.",
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
export function buildTestCaseAssuranceAnalysis(input) {
    const title = input.title.trim();
    const description = input.description.trim();
    const steps = input.steps.slice(0, 100);
    const completeSteps = steps.filter((step) => String(step.action || "").trim() && String(step.expected_result || "").trim());
    const allText = `${title} ${description} ${steps.map((step) => `${step.action || ""} ${step.expected_result || ""}`).join(" ")}`;
    const normalizedReview = input.reviewStatus.trim().toLowerCase();
    const isReviewed = ["accepted", "approved"].includes(normalizedReview);
    const hasPreconditions = includesPattern(allText, /\b(given|precondition|logged|setup|existing|configured|starts? with|is on)\b/);
    const parameterCount = Object.keys(input.parameterValues || {}).filter((key) => key.trim()).length;
    const automationEvidenceCount = steps.filter((step) => Boolean(String(step.automation_code || "").trim() || step.api_request)).length;
    const completeRatio = steps.length ? completeSteps.length / steps.length : 0;
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
    const hasTitle = meaningfulText(title), hasDescription = meaningfulText(description);
    const authoredRatio = steps.length ? steps.filter(step => meaningfulText(step.action) && meaningfulText(step.expected_result)).length / steps.length : 0;
    const vagueOutcome = /^(?:works?(?: correctly| as expected)?|as expected|correct(?:ly)?|ok(?:ay)?|success(?:ful)?|pass(?:ed)?|no issues)[.!?]*$/i;
    const assertionRatio = steps.length ? steps.filter(step => meaningfulText(step.expected_result) && !vagueOutcome.test(String(step.expected_result).trim())).length / steps.length : 0;
    const declaredParameters = new Set(Object.entries(input.parameterValues || {}).filter(([, value]) => typeof value === 'string').map(([name]) => name.replace(/^@?t\./, '')));
    const generators = new Set(['random', 'string', 'randomstring', 'randomnumber', 'yopmail', 'today', 'timestamp']);
    const referencedParameters = [...new Set([...allText.matchAll(/@t\.([A-Za-z_][A-Za-z0-9_.-]*)/g)].map(match => match[1].replace(/\.+$/, '')).filter(name => !generators.has(name)))];
    const missingParameters = referencedParameters.filter(name => !declaredParameters.has(name));
    const dataRatio = referencedParameters.length ? 1 - missingParameters.length / referencedParameters.length : 1;
    // One focused step is valid. Adjacent negative coverage, automation,
    // approvals, metadata and observed run history are separate evidence.
    const scenarioScore = signalScore([[hasTitle, 20], [hasDescription, 30], [steps.length > 0, 20], [authoredRatio, 30]]);
    const clarityScore = signalScore([[authoredRatio, 75], [assertionRatio, 25]]);
    const reliabilityScore = steps.length ? signalScore([[dataRatio, 100]]) : 0;
    const maintainabilityScore = signalScore([[hasTitle, 30], [hasDescription, 30], [authoredRatio, 40]]);
    const dimensions = [
        dimension("scenario-coverage", "Scenario intent", scenarioScore, steps.length && input.requirementCount
            ? "The case has an executable scenario and a traceable product intent."
            : "Review the stated product intent directly; a standalone case may use supplied evidence without a Story link.", [
            `${steps.length} authored step${steps.length === 1 ? "" : "s"}`,
            input.requirementCount ? `${input.requirementCount} linked ${input.requirementCount === 1 ? "Story" : "Stories"}` : "No linked Story",
            completeRatio === 1 ? "Every authored step has an expected result" : "One or more authored steps are incomplete"
        ], "State the exact product rule this focused scenario checks and link its governing source when available.", ["Authored objective and action/result contract"]),
        dimension("execution-clarity", "Execution clarity", clarityScore, authoredRatio === 1 && assertionRatio === 1
            ? "Actions and expected results provide a clear, independently executable path."
            : "One or more steps lack the setup or observable result needed for consistent execution.", [
            `${completeSteps.length}/${steps.length} action/result pairs complete`,
            hasPreconditions ? "Setup or preconditions are visible" : "Setup or preconditions are implicit",
            `${Math.round(assertionRatio * steps.length)}/${steps.length} expected results contain a non-placeholder, non-generic assertion`
        ], completeRatio === 1 ? "Tighten any subjective expected result into an observable outcome." : "Complete every action/expected-result pair."),
        dimension("data-reliability", "Authored data references", reliabilityScore, missingParameters.length
            ? "One or more referenced local inputs have no supplied declaration."
            : "The authored case has no unresolved local data reference. No-input, literal-input and parameterized cases are valid for their stated objective.", [
            parameterCount ? `${parameterCount} supplied local parameter${parameterCount === 1 ? "" : "s"}` : "Local parameters are optional when this case has no local references",
            `${referencedParameters.length} local input reference${referencedParameters.length === 1 ? "" : "s"}; ${missingParameters.length} unresolved`,
            "Observed execution is disclosed separately and never changes the authored-design score"
        ], "Check that inputs and setup support this case's stated objective; document data source or reset steps only when needed for repeatability."),
        dimension("trace-maintainability", "Self-contained design", maintainabilityScore, hasTitle && hasDescription && authoredRatio === 1
            ? "The named objective, description and complete step contract can be reviewed independently."
            : "The self-contained objective, description or step contract is incomplete.", [
            input.requirementCount ? "Story trace is available" : "No Story link supplied; linking is optional",
            (input.suiteCount || 0) ? `${input.suiteCount} linked suite${input.suiteCount === 1 ? "" : "s"}` : "No linked suite",
            automationEvidenceCount ? `${automationEvidenceCount} step${automationEvidenceCount === 1 ? "" : "s"} with automation evidence` : "Manual case; automation is not assumed",
            externalReferenceCount ? `${externalReferenceCount} source reference${externalReferenceCount === 1 ? "" : "s"}` : "No source reference supplied"
        ], input.requirementCount ? "Keep the case atomic and review links after Story changes." : "Describe the governing product behavior and preserve any supplied source identity; Story linking is optional.")
    ];
    const insights = [];
    if (finalizedRunCount > 0 && observedPassRate !== null && observedPassRate < 50)
        insights.push(insight("stability", "high", "Investigate recorded execution failures", "Observed failures need investigation; they do not by themselves establish a defect in the authored case.", [`${observedPassRate}% observed pass rate`], "Review product failures, data and environment evidence before relying on this execution scope as a quality gate."));
    if (authoredRatio < 1)
        insights.push(insight("incomplete-step", "high", "Complete the execution contract", "A missing action or expected result makes the verdict ambiguous.", [`${completeSteps.length}/${steps.length} complete step pairs`], "Complete the missing pair before review."));
    if (missingParameters.length)
        insights.push(insight("local-data", "high", "Resolve the referenced local inputs", "The authored case refers to local data that was not supplied.", missingParameters.map(name => `@t.${name}`), "Declare each required local value or remove an unintended reference; preserve inherited @s/@r scope."));
    if (!input.requirementCount && !hasDescription)
        insights.push(insight("trace", "medium", "Clarify the product objective", "The short draft and absent Story link leave the governing behavior unclear to this local heuristic.", ["No linked Story; limited description"], "Describe the product rule and relevant prerequisites, or link a governing source when available."));
    if (insights.length < 3 && !isReviewed)
        insights.push(insight("review", "medium", "Record a human decision", "AI analysis does not approve this test case.", [`Review state: ${normalizedReview.replace(/_/g, " ") || "not requested"}`], "Request review after the design gaps are resolved."));
    const overall = weightedScore(dimensions);
    return {
        artifact_type: "test-case",
        overall_score: overall,
        score_label: "Test design completeness",
        verdict: overallVerdict(overall),
        summary: "Scores measure the authored objective, action/result contract and local input references. Negative coverage, Story links, automation, run history and approval do not raise or lower this design score. Semantic correctness requires review.",
        dimensions,
        insights: insights.slice(0, 3),
        limitations: [
            "Practice alignment is guidance, not standards certification.",
            "Automation and parameterization are supporting evidence, not prerequisites for a strong manual case.",
            finalizedRunCount ? `Observed execution: ${finalizedRunCount} finalized run result${finalizedRunCount === 1 ? "" : "s"}; ${observedPassRate === null ? "pass-rate measurement unavailable" : `${observedPassRate}% recorded pass rate`}. These outcomes do not alter the authored-design score.` : "Observed execution: unavailable. No finalized run evidence was supplied; this is not a design defect or an inferred pass.",
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
// Model narrative may explain a score; it cannot replace the deterministic measurement.
export function mergeAssuranceReview(baseline, review) {
    if (!review)
        return baseline;
    const narrative = new Map((review.dimensions || []).map(item => [item.id, item]));
    return {
        ...baseline,
        summary: review.summary?.trim() || baseline.summary,
        verdict: baseline.verdict,
        dimensions: baseline.dimensions.map(item => {
            const refinement = narrative.get(item.id);
            return refinement ? {
                ...item,
                explanation: refinement.explanation?.trim() || item.explanation,
                recommendation: refinement.recommendation?.trim() || item.recommendation,
                ...(refinement.evidence?.length ? { review_evidence: [...refinement.evidence] } : {})
            } : item;
        }),
        insights: Array.isArray(review.insights) ? review.insights : baseline.insights,
        limitations: [...new Set([...baseline.limitations, ...(review.limitations || [])])]
    };
}
