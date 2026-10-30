import { extractStepParameterMatches, normalizeStepParameterName, normalizeStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

export type ReviewableDraft = {
  title: string;
  description?: string | null;
  priority?: number | string;
  test_case_type?: string;
  authoring_mode?: "structured" | "gherkin";
  gherkin_document?: string | null;
  parameter_values?: Record<string, string> | null;
  steps: Array<{ action?: string | null; expected_result?: string | null }>;
};

/** An AI proposal cannot replace protected values it never received. The
 * current editor remains their source; inherited data must stay inherited. */
export function restoreAiPrivateParameterValues(proposed: Record<string, string>, current: Record<string, string>, privateNames: Iterable<string>) {
  const values = normalizeStepParameterValues(proposed, "t");
  const existing = normalizeStepParameterValues(current, "t");
  const preservedNames: string[] = [];
  for (const name of new Set(Array.from(privateNames, key => normalizeStepParameterName(key, "t")))) {
    if (!name.startsWith("t.")) continue;
    const hasCurrent = Object.prototype.hasOwnProperty.call(existing, name);
    if (Object.prototype.hasOwnProperty.call(values, name) && (!hasCurrent || values[name] !== existing[name])) preservedNames.push(name);
    if (hasCurrent) values[name] = existing[name];
    else delete values[name];
  }
  return { values, preservedNames };
}

/** Local completeness checks, never a model confidence or coverage score. */
export function draftReadinessIssues(draft: ReviewableDraft, fallbackMode: "structured" | "gherkin" = "structured"): string[] {
  const issues: string[] = [];
  if (!draft.title.trim()) issues.push("Add a title.");
  if (draft.title.length > 255) issues.push("Keep the title within 255 characters.");
  const priority=typeof draft.priority==='string'&&/^P[1-5]$/.test(draft.priority)?Number(draft.priority.slice(1)):draft.priority;
  if (!String(draft.description||'').trim()) issues.push('Add a description.');
  if (Object.prototype.hasOwnProperty.call(draft,'priority')&&(!Number.isSafeInteger(priority)||Number(priority)<1||Number(priority)>5)) issues.push('Choose a priority from P1 to P5.');
  if (Object.prototype.hasOwnProperty.call(draft,'test_case_type')&&!String(draft.test_case_type||'').trim()) issues.push('Choose a Test Case type.');
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
    const scenarios = structural.split(/^[ \t]*Scenario(?: Outline| Template)?[ \t]*:[^\r\n]*(?:\r?\n|$)/im).slice(1);
    if (!scenarios.length || scenarios.some(scenario => {
      const action = scenario.search(/^[ \t]*When[ \t]+\S/im), outcome = scenario.search(/^[ \t]*Then[ \t]+\S/im);
      return action < 0 || outcome <= action;
    })) issues.push("Add a When action and a Then outcome to every Scenario.");
    const steps = (structural.match(/^\s*(?:Given|When|Then|And|But|\*)[ \t]+\S/gim) || []).length;
    if (steps > 30) issues.push("Use at most 30 scenario steps.");
    if (delimiter) issues.push("Close the scenario doc string.");
  } else {
    if (!draft.steps.length || draft.steps.length > 30) issues.push("Use 1–30 steps.");
    const incomplete = draft.steps.findIndex(step => !String(step.action || "").trim() || !String(step.expected_result || "").trim());
    if (incomplete >= 0) issues.push(`Complete the action and expected result for step ${incomplete + 1}.`);
  }
  const values = draft.parameter_values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    issues.push("Add Test Params and synthetic data, or an empty object when no case input is needed.");
  } else {
    const localValues = new Map<string, string>();
    if (Object.keys(values).length > 100) issues.push("Use at most 100 Test Params per case.");
    for (const [name, value] of Object.entries(values)) {
      // Workspace proposals use scoped t.name keys; manual case drafts use raw
      // names. Both represent local data, never inherited suite/run values.
      const normalized = normalizeStepParameterName(name, "t");
      if (!normalized.startsWith("t.") || ['__proto__', 'constructor', 'prototype'].includes(normalized.slice(2)) || typeof value !== "string") issues.push("Use case-owned Test Param names and text data values.");
      else if (localValues.has(normalized)) issues.push(`Declare Test Param ${normalized} only once.`);
      else localValues.set(normalized, value);
    }
    const generators = new Set(['t.random', 't.string', 't.randomstring', 't.randomnumber', 't.yopmail', 't.today', 't.timestamp']);
    const references = (value: string) => [...new Set(extractStepParameterMatches(value, { knownLegacyNames: [] }).filter(match => match.scope === "t" && !generators.has(match.name)).map(match => match.name))];
    const gherkin = (draft.gherkin_document || "").split("\n").filter(line => !/^\s*[@#]/.test(line)).join("\n");
    const content = [draft.title, draft.description || "", gherkin, ...draft.steps.flatMap(step => [step.action || "", step.expected_result || ""])].join("\n");
    const checked = new Set<string>(), visiting = new Set<string>();
    const check = (name: string) => {
      if (!localValues.has(name)) { issues.push(`Supply Test Param ${name} with synthetic data or a protected data reference.`); return; }
      if (visiting.has(name)) { issues.push(`Remove the circular Test Param reference at ${name}.`); return; }
      if (checked.has(name)) return;
      visiting.add(name);
      references(localValues.get(name) || "").forEach(check);
      visiting.delete(name);
      checked.add(name);
    };
    [...references(content), ...localValues.keys()].forEach(check);
  }
  return [...new Set(issues)];
}
