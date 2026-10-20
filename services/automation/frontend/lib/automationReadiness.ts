import type { TestCase, TestStep } from "@hellotest/platform/frontend/src/types";
import { parseApiRequestSource } from "./apiRequestSource";
import { isAutomationStepMapped } from "./automationStepPersistence";

export type AutomationReadinessIssue = { stepId?: string; order?: number; message: string; severity: "blocker" | "warning" };
export type AutomationReadiness = {
  id: string; title: string; revision: number; updatedAt: string | null;
  stepCount: number; runnableCount: number; skippedCount: number; runtimes: string[];
  issues: AutomationReadinessIssue[]; ready: boolean; planSignature: string;
};

/** Checks durable plans, not catalog summary badges or unsaved editor source. */
export function assessAutomationReadiness(testCase: TestCase, steps: TestStep[], intent: "build" | "run" = "run", unsavedStepIds: string[] = [], verifySource = true, buildInstructions = ""): AutomationReadiness {
  const issues: AutomationReadinessIssue[] = [];
  if (testCase.automated !== "yes") issues.push({ severity: "blocker", message: "This case is no longer an automation case." });
  if (String(testCase.status).toLowerCase() === "retired") issues.push({ severity: "blocker", message: "This case is retired. Restore it before continuing." });
  if (!steps.length) {
    const canPlan = intent === "build" && Boolean(buildInstructions.trim() || String(testCase.description || "").replace(/<[^>]*>/g, "").trim());
    issues.push(canPlan ? { severity: "warning", message: "The agent will create the behavior plan from your instructions and case description." } : { severity: "blocker", message: "Add a behavior plan or describe the requested flow before continuing." });
  }
  if (intent === "run" && !verifySource) {
    if (testCase.automation_status !== "ready") issues.push({ severity: "blocker", message: "The saved automation is incomplete. Ask an author to review its instructions." });
    issues.push({ severity: "warning", message: "Executable source is hidden by your role. The engine validates it before dispatch." });
  }
  let skippedCount = 0;
  let runnableCount = 0;
  for (const step of steps) {
    const runtime = step.step_type || (step.api_request ? "api" : "web");
    const flags = String(step.automation_code || step.action || "").match(/^\s*\/\/\s*@hellotest-options\s+([^\n]+)/i)?.[1].split(/\s+/) || [];
    const skipped = flags.includes("skip");
    const issue = (message: string, severity: AutomationReadinessIssue["severity"] = "blocker") => issues.push({ stepId: step.id, order: step.step_order, message, severity });
    if (unsavedStepIds.includes(step.id)) issue("Save or discard this section’s changes before continuing.");
    if (!["web", "api", "android", "ios"].includes(runtime)) issue("Choose a supported step runtime.");
    if (skipped) { skippedCount += 1; continue; }
    if (!String(step.action || "").replace(/<[^>]*>/g, "").trim()) issue("Describe the action this step performs.");
    if (!String(step.expected_result || "").replace(/<[^>]*>/g, "").trim()) issue("No expected result is recorded for this step.", "warning");
    if (intent === "run" && verifySource) {
      if (!isAutomationStepMapped({ ...step, step_type: runtime })) issue(runtime === "api" ? "Add an executable API request." : "Generate or author executable instructions.");
      else if (runtime === "api") {
        try { parseApiRequestSource(JSON.stringify(step.api_request)); runnableCount += 1; }
        catch (error) { issue(error instanceof Error ? error.message : "Repair the API request."); }
      } else runnableCount += 1;
    }
  }
  if (intent === "run" && steps.length && skippedCount === steps.length) issues.push({ severity: "blocker", message: "All steps are skipped. Enable a step before running." });
  const planSignature = JSON.stringify(steps.map(step => [step.id, step.step_order, step.step_type, step.action, step.expected_result, step.automation_code, step.api_request, step.group_id, step.reusable_group_id]));
  return { id: testCase.id, title: testCase.title, revision: testCase.revision || 0, updatedAt: testCase.updated_at || null, stepCount: steps.length, runnableCount, skippedCount, runtimes: [...new Set(steps.map(step => step.step_type || (step.api_request ? "api" : "web")))], issues, ready: !issues.some(issue => issue.severity === "blocker"), planSignature };
}

type Reader = { getCase: (id: string, signal?: AbortSignal) => Promise<TestCase>; getSteps: (id: string, signal?: AbortSignal) => Promise<TestStep[]> };
export async function inspectAutomationTargets(ids: string[], appTypeId: string, reader: Reader, intent: "build" | "run" = "run", unsavedStepIds: string[] = [], signal?: AbortSignal, verifySource = true, buildInstructions = ""): Promise<AutomationReadiness[]> {
  const targets = [...new Set(ids)];
  if (!targets.length) throw new Error("Select at least one automation case.");
  const results: AutomationReadiness[] = new Array(targets.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const index = cursor++, id = targets[index];
      if (signal?.aborted) throw new DOMException("Readiness check cancelled", "AbortError");
      const [testCase, steps] = await Promise.all([reader.getCase(id, signal), reader.getSteps(id, signal)]);
      if (testCase.id !== id || testCase.app_type_id !== appTypeId || steps.some(step => step.test_case_id !== id)) throw new Error("The selected case is outside this application. Refresh your selection.");
      results[index] = assessAutomationReadiness(testCase, steps, intent, unsavedStepIds, verifySource, buildInstructions);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
  return results;
}

export function requireReadyAutomation(results: AutomationReadiness[]) {
  const blocked = results.filter(result => !result.ready);
  if (blocked.length) throw new Error(`${blocked.length} case${blocked.length === 1 ? " needs" : "s need"} attention. ${blocked[0].title}: ${blocked[0].issues.find(issue => issue.severity === "blocker")?.message}`);
}
