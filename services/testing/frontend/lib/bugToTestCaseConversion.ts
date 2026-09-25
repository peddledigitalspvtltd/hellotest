import type { Issue } from "@hellotest/platform/frontend/src/types";

export const BUG_TO_TEST_CASE_STORAGE_KEY = "hellotest.convertBugToCase.v2";

export function countConvertedBugs(issues: ReadonlyArray<Pick<Issue, "id" | "has_converted_test_cases">>): number {
  return new Set(issues.filter((issue) => issue.has_converted_test_cases === true).map((issue) => issue.id)).size;
}

export type BugToTestCaseDraft = {
  bugId: string;
  bugDisplayId: string;
  bugRevision?: number;
  existingTestCaseIds: string[];
  title: string;
  description: string;
  preconditions: string[];
  reproductionSteps: string[];
  expectedResults: string[];
  externalReferences: string[];
  labels: string[];
  priority: number;
  requirementIds: string[];
  moduleIds: string[];
  suiteIds: string[];
  release: string;
  sprint: string;
};

export function parseStoredBugToTestCaseDraft(value: string | null): BugToTestCaseDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BugToTestCaseDraft>;
    if (!parsed || typeof parsed !== "object" || !String(parsed.bugId || "").trim()) return null;
    return {
      bugId: String(parsed.bugId).trim(),
      bugDisplayId: String(parsed.bugDisplayId || parsed.bugId).trim(),
      bugRevision: typeof parsed.bugRevision === "number" ? parsed.bugRevision : undefined,
      existingTestCaseIds: uniqueCleanValues(parsed.existingTestCaseIds || []),
      title: String(parsed.title || "").trim(),
      description: String(parsed.description || "").trim(),
      preconditions: uniqueCleanValues(parsed.preconditions || []),
      reproductionSteps: uniqueCleanValues(parsed.reproductionSteps || []),
      expectedResults: uniqueCleanValues(parsed.expectedResults || []),
      externalReferences: uniqueCleanValues(parsed.externalReferences || []),
      labels: uniqueCleanValues(parsed.labels || []),
      priority: Number.isInteger(parsed.priority) && Number(parsed.priority) >= 1 && Number(parsed.priority) <= 5
        ? Number(parsed.priority)
        : 3,
      requirementIds: uniqueCleanValues(parsed.requirementIds || []),
      moduleIds: uniqueCleanValues(parsed.moduleIds || []),
      suiteIds: uniqueCleanValues(parsed.suiteIds || []),
      release: String(parsed.release || "").trim(),
      sprint: String(parsed.sprint || "").trim()
    };
  } catch {
    return null;
  }
}

const uniqueCleanValues = (values: Array<string | null | undefined>) => Array.from(new Set(
  values.map((value) => String(value || "").trim()).filter(Boolean)
));

const decodeBasicHtmlEntities = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'");

/** Turn plain text, numbered lists, bullets, or simple rich text into editable Test Case rows. */
export function parseBugStepLines(value?: string | null): string[] {
  const text = decodeBasicHtmlEntities(String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "\n")
    .replace(/<\/(?:li|p|div|ol|ul)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
  );

  return text
    .replace(/\s+(?=(?:step\s*)?\d+[.)\-:]\s+)/gi, "\n")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*(?:(?:step\s*)?\d+[.)\-:]|[-*•])\s*/i, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}

export function mapBugPriorityToTestCase(priority?: string | null, severity?: string | null): number {
  const value = `${priority || ""} ${severity || ""}`.trim().toLowerCase();
  if (/\b(?:critical|highest|blocker)\b/.test(value)) return 1;
  if (/\bhigh\b/.test(value)) return 2;
  if (/\b(?:lowest|trivial)\b/.test(value)) return 5;
  if (/\blow\b/.test(value)) return 4;
  return 3;
}

export function buildBugToTestCaseDraft(issue: Issue): BugToTestCaseDraft {
  const version = String(issue.fix_version || "").trim();
  const release = String(issue.release || issue.fix_version || "").trim();
  const preconditions = uniqueCleanValues([
    issue.environment ? `Environment: ${issue.environment}` : "",
    version ? `Version: ${version}` : "",
    release && release.toLowerCase() !== version.toLowerCase() ? `Release: ${release}` : "",
    issue.sprint ? `Sprint: ${issue.sprint}` : "",
    issue.build ? `Build: ${issue.build}` : ""
  ]);

  return {
    bugId: issue.id,
    bugDisplayId: String(issue.display_id || issue.jira_bug_key || issue.id).trim(),
    bugRevision: issue.revision,
    existingTestCaseIds: uniqueCleanValues(issue.linked_test_case_ids || []),
    title: String(issue.title || "").trim(),
    description: String(issue.message || "").trim(),
    preconditions,
    reproductionSteps: parseBugStepLines(issue.steps_to_reproduce),
    expectedResults: parseBugStepLines(issue.expected_result),
    externalReferences: uniqueCleanValues([issue.jira_url]),
    labels: uniqueCleanValues(issue.labels || []),
    priority: mapBugPriorityToTestCase(issue.priority, issue.severity),
    requirementIds: uniqueCleanValues(issue.linked_requirement_ids || []),
    moduleIds: uniqueCleanValues(issue.linked_module_ids || []),
    suiteIds: uniqueCleanValues(issue.linked_test_suite_ids || []),
    release,
    sprint: String(issue.sprint || "").trim()
  };
}

export type ConvertedBugStep = {
  action: string;
  expectedResult: string;
  isPrecondition: boolean;
};

export function buildConvertedBugSteps(draft: BugToTestCaseDraft): ConvertedBugStep[] {
  const preconditions = draft.preconditions.map((action) => ({
    action,
    expectedResult: "",
    isPrecondition: true
  }));
  const actions = draft.reproductionSteps.length
    ? draft.reproductionSteps
    : ["Reproduce the behavior reported by the source Defect"];
  const expectedResults = draft.expectedResults;

  return [
    ...preconditions,
    ...actions.map((action, index) => ({
      action,
      expectedResult: expectedResults.length === actions.length
        ? expectedResults[index]
        : index === actions.length - 1
          ? expectedResults.join("\n") || "The reported Defect no longer occurs"
          : "",
      isPrecondition: false
    }))
  ];
}
