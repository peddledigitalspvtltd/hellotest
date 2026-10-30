import type { TestDataSet, TestStep } from "@hellotest/platform/frontend/src/types";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { structuredCaseToGherkin } from "@hellotest/testing/frontend/lib/gherkin";
import { annotateGherkinStepGroups } from "@hellotest/testing/frontend/lib/gherkinBehavior";
import { extractStepParameterMatches, normalizeStepParameterName } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { isAutomationPrecondition } from "./automationPlan";
import { buildReadableAutomationInstructions, readableApiInstructions, readableAutomationInstructionText, type AutomationReadableContext } from "./automationReadableInstructions";

/** A behavior-only projection. Source and Full source retain the executable program. */
export function buildAutomationGherkin(title: string, steps: TestStep[], dataSet?: TestDataSet, context: AutomationReadableContext = {}) {
  const columns = dataSet?.mode === "table" ? dataSet.columns : [];
  const columnNames = new Map(columns.map(column => [normalizeStepParameterName(column), column]));
  const text = (value: string) => {
    let result = richTextToPlainText(value).replace(/\s+/g, " ").trim();
    // Use the same reference grammar as authoring and the runner. Periods
    // after a reference are prose; dotted/space column names use brackets.
    for (const match of extractStepParameterMatches(result).reverse()) {
      const column = columnNames.get(match.name);
      if (column) result = result.slice(0, match.index) + `<${column}>` + result.slice(match.index + match.token.length);
    }
    return result;
  };
  const origins = new Map<string, TestStep>();
  const normalized = steps.flatMap(step => {
    const instructions = step.step_type === "api" && step.api_request ? readableApiInstructions(step.api_request) : buildReadableAutomationInstructions(step.automation_code || "", { ...context, platform: step.step_type || "web" });
    const rows = instructions.length ? instructions.map((instruction,index) => ({ ...step, id: `${step.id}:instruction:${index}`, action: instruction.kind === "assertion" && !isAutomationPrecondition(step) ? "" : text(readableAutomationInstructionText(instruction)), expected_result: instruction.kind === "assertion" && !isAutomationPrecondition(step) ? text(readableAutomationInstructionText(instruction)) : "" })) : [{ ...step, action: text(step.action || ""), expected_result: "" }];
    if (step.expected_result) {
      if (!isAutomationPrecondition(step)) rows.push({ ...step, id: `${step.id}:outcome`, action: "", expected_result: text(step.expected_result) });
      else if (!instructions.length && !rows[0].action) rows[0].action = text(step.expected_result);
      else rows.push({ ...step, id: `${step.id}:outcome`, action: `Verify ${text(step.expected_result)}`, expected_result: "" });
    }
    rows.forEach(row => origins.set(row.id,step));return rows;
  });
  const preconditions = normalized.filter(isAutomationPrecondition), main = normalized.filter(step => !isAutomationPrecondition(step));
  let document = structuredCaseToGherkin({ title: text(title), preconditions, steps: main, columns, rows: dataSet?.mode === "table" ? dataSet.rows : [] });
  const groups: Array<{id:string;name:string;steps:TestStep[]}> = [];
  for (const step of main) { if (!step.group_id) continue;const last=groups[groups.length-1];if(last?.id===step.group_id)last.steps.push(step);else groups.push({id:step.group_id,name:step.group_name || "Section Group",steps:[step]}); }
  document = annotateGherkinStepGroups(document,groups.map(group=>({id:group.id,name:group.name,lines:structuredCaseToGherkin({title,steps:group.steps}).split("\n").slice(3)})));
  const behavior = [...preconditions.filter(step=>step.action || step.expected_result),...main.flatMap(step=>[...(step.action?[step]:[]),...(step.expected_result?[step]:[])])];
  const shown = new Set<string>();let index=0;
  return document.split("\n").flatMap(line=>{
    if(!/^\s*(?:Given|And|When|Then)\s/.test(line))return [line];
    const original=origins.get(behavior[index++]?.id);if(!original || shown.has(original.id))return [line];shown.add(original.id);
    return [`    # Section ${original.step_order}: ${text(original.action || "Untitled section")}`,line];
  }).join("\n");
}
