export type ReviewableDraft = {
  title: string;
  authoring_mode?: "structured" | "gherkin";
  gherkin_document?: string | null;
  steps: Array<{ action?: string | null; expected_result?: string | null }>;
};

/** Local completeness checks, never a model confidence or coverage score. */
export function draftReadinessIssues(draft: ReviewableDraft, fallbackMode: "structured" | "gherkin" = "structured"): string[] {
  const issues: string[] = [];
  if (!draft.title.trim()) issues.push("Add a title.");
  if (draft.title.length > 255) issues.push("Keep the title within 255 characters.");
  if ((draft.authoring_mode || fallbackMode) === "gherkin") {
    const document = draft.gherkin_document || "";
    // Doc strings may contain heading-like examples, which are data.
    let delimiter = "";
    const structural = document.split(/\r?\n/).filter(line => {
      const marker = line.trim().match(/^("""|```)/)?.[1];
      if (marker) { delimiter = delimiter ? delimiter === marker ? "" : delimiter : marker; return false; }
      return !delimiter;
    }).join("\n");
    if (!/^[ \t]*Feature[ \t]*:[ \t]*\S/im.test(structural)) issues.push("Add a named Feature.");
    if (!/^[ \t]*Scenario(?: Outline| Template)?[ \t]*:[ \t]*\S/im.test(structural)) issues.push("Add a named Scenario.");
    if (!/^[ \t]*(?:Given|When)[ \t]+\S/im.test(structural) || !/^[ \t]*Then[ \t]+\S/im.test(structural)) issues.push("Add an action and a Then outcome.");
    const steps = (structural.match(/^\s*(?:Given|When|Then|And|But|\*)[ \t]+\S/gim) || []).length;
    if (steps > 30) issues.push("Use at most 30 scenario steps.");
    if (delimiter) issues.push("Close the scenario doc string.");
  } else {
    if (!draft.steps.length || draft.steps.length > 30) issues.push("Use 1–30 steps.");
    const incomplete = draft.steps.findIndex(step => !String(step.action || "").trim() || !String(step.expected_result || "").trim());
    if (incomplete >= 0) issues.push(`Complete the action and expected result for step ${incomplete + 1}.`);
  }
  return issues;
}
