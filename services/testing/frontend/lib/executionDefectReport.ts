import type { Execution, ExecutionResult, TestStep } from "@hellotest/platform/frontend/src/types";
import { parseExecutionLogs } from "./executionLogs";
import { selectLatestExecutionResultInstances } from "./executionResultMetrics";

export type ExecutionDefectAttachment = {
  id: string;
  name: string;
  kind: "execution";
  detail?: string;
  file?: File;
};

export type ExecutionDefectReport = {
  projectId: string;
  runId: string;
  caseId: string;
  includeRunAttachments: boolean;
  resultId?: string;
  stepId?: string;
  attachmentResultId?: string;
  title: string;
  message: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  aiIntent: string;
  aiEvidence: string;
  attachmentCopies: ExecutionDefectAttachment[];
  inlineAttachments: ExecutionDefectAttachment[];
};

const failurePriority = (status?: string | null) => status === "failed" ? 2 : status === "blocked" ? 1 : 0;
const timestamp = (result: ExecutionResult) => Date.parse(result.created_at || result.updated_at || "") || 0;

export function selectExecutionDefectResult(results: ExecutionResult[]) {
  return selectLatestExecutionResultInstances(results)
    .filter(result => failurePriority(result.status))
    .sort((left, right) => failurePriority(right.status) - failurePriority(left.status)
      || timestamp(right) - timestamp(left) || right.id.localeCompare(left.id))[0] || null;
}

const field = (label: string, value?: string | null) => value?.trim() ? `${label}: ${value.trim()}` : "";

export function buildExecutionDefectFallback({ scope, execution, runStatus, caseId, caseTitle, suiteName, moduleName, totals, result }: {
  scope: "case" | "suite" | "module" | "run";
  execution: Execution;
  runStatus: string;
  caseId?: string;
  caseTitle?: string;
  suiteName?: string;
  moduleName?: string;
  totals: { all: number; failed: number; blocked: number };
  result?: ExecutionResult | null;
}) {
  const name = { case: caseTitle || caseId, suite: suiteName, module: moduleName, run: execution.name || execution.id }[scope];
  const title = `${scope.charAt(0).toUpperCase()}${scope.slice(1)} defect${name ? `: ${name}` : ""}`;
  const message = [
    `Reported from a ${scope === "run" ? "test run" : `${scope} within a test run`}.`,
    `Run ID: ${execution.id}`, field("Run name", execution.name), field("Run status", runStatus),
    field("Run trigger", execution.trigger || "manual"), field("Test case ID", caseId), field("Test case title", caseTitle),
    field("Suite", suiteName), field("Module", moduleName), field("Environment", execution.test_environment?.name),
    field("Configuration", execution.test_configuration?.name), field("Build", execution.build),
    `Run totals: ${totals.all} case instances, ${totals.failed} failed, ${totals.blocked} blocked`,
    field("Selected case result", result?.status), "Defect details:"
  ].filter(Boolean).join("\n");
  return { title, message };
}

function environmentUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}${url.pathname}` : "";
  } catch {
    return "";
  }
}

export function buildExecutionDefectReport({ execution, runStatus, result, caseTitle, suiteName, moduleName, steps, includeRunAttachments, toPlainText }: {
  execution: Execution;
  runStatus: string;
  result: ExecutionResult;
  caseTitle: string;
  suiteName?: string;
  moduleName?: string;
  steps: TestStep[];
  includeRunAttachments: boolean;
  toPlainText: (value?: string | null) => string;
}): ExecutionDefectReport | null {
  const logs = parseExecutionLogs(result.logs);
  const orderedSteps = (result.derived ? [] : steps.filter(step => step.test_case_id === result.test_case_id))
    .sort((left, right) => left.step_order - right.step_order);
  const statusFor = (id: string) => logs.stepStatuses?.[id] || logs.stepAutomationDetails?.[id]?.status;
  const failedSteps = orderedSteps.filter(step => failurePriority(statusFor(step.id)));
  const failedStep = failedSteps.find(step => statusFor(step.id) === "failed") || failedSteps[0];
  if (!failedStep && !failurePriority(result.status)) return null;

  const environment = execution.test_environment;
  const configuration = execution.test_configuration;
  const targetDetails = configuration?.snapshot?.targets?.map(target =>
    [target.os, target.browser, target.mobile_os, target.version].filter(Boolean).join(" · ")
  ).filter(Boolean).join("; ");
  const observedError = result.error?.trim() || "";
  const stepComment = (stepId: string) => logs.stepNotes?.[stepId]?.trim()
    || logs.stepAutomationDetails?.[stepId]?.error_message?.trim() || "";
  const failureComments = failedSteps.flatMap(step => {
    const comment = stepComment(step.id);
    return comment ? [`Step ${step.step_order} (${statusFor(step.id)}): ${comment}`] : [];
  });
  const failedAction = toPlainText(failedStep?.action).trim();
  const resolvedCaseTitle = toPlainText(caseTitle || result.test_case_title).trim() || result.test_case_id;
  const runDetails = [
    field("Run", execution.name), field("Run ID", execution.display_id || execution.id), field("Status", runStatus),
    field("Trigger", execution.trigger), field("Mode", execution.run_mode), field("Build", execution.build),
    field("Release", execution.release), field("Sprint", execution.sprint), field("Suite", suiteName), field("Module", moduleName),
    field("Test case", resolvedCaseTitle), field("Case outcome", result.status),
    result.derived ? field("Linked automation case", result.source_display_id) : "",
    field("Data set", result.test_data_set_name),
    result.data_set_iteration_index != null ? `Data row: ${result.data_set_iteration_index + 1}` : ""
  ];
  const environmentDetails = [field("Name", environment?.name), field("Browser", environment?.snapshot?.browser),
    field("Base URL", environmentUrl(environment?.snapshot?.base_url))];
  const configurationDetails = [field("Name", configuration?.name), field("Browser", configuration?.snapshot?.browser),
    field("Mobile OS", configuration?.snapshot?.mobile_os), field("Platform version", configuration?.snapshot?.platform_version),
    field("Targets", targetDetails)];
  const sections = [
    ["Run details", ...runDetails.filter(Boolean)],
    ["Environment", ...environmentDetails.filter(Boolean)],
    ["Configuration", ...configurationDetails.filter(Boolean)]
  ];
  const context = sections.filter(section => section.length > 1).map(([heading, ...lines]) =>
    `**${heading}**\n\n${lines.map(line => `- ${line}`).join("\n")}`
  ).join("\n\n");
  const failingStepLine = failedStep ? `Step ${failedStep.step_order}: ${failedAction || "Recorded failure"}` : "";
  const actualResult = [...new Set([failedStep && stepComment(failedStep.id), observedError].filter(Boolean))].join("\n\n");
  const reproduction = orderedSteps
    .slice(0, failedStep ? orderedSteps.indexOf(failedStep) + 1 : orderedSteps.length)
    .map(step => toPlainText(step.action).trim()).filter(Boolean)
    .map((action, index) => `${index + 1}. ${action}`).join("\n");
  const evidenceLines = [failingStepLine, ...failureComments, observedError && !failedSteps.some(step => stepComment(step.id) === observedError)
    ? field("Run result", observedError) : ""].filter(Boolean);
  const attachmentCopies: ExecutionDefectAttachment[] = [];
  const inlineAttachments: ExecutionDefectAttachment[] = [];
  for (const step of orderedSteps) {
    const evidence = logs.stepEvidence?.[step.id];
    if (!evidence) continue;
    const metadata = {
      name: evidence.fileName || `Step ${step.step_order} evidence`, kind: "execution" as const,
      detail: `Step ${step.step_order}${statusFor(step.id) ? ` · ${statusFor(step.id)}` : ""}`
    };
    if (evidence.attachmentId) attachmentCopies.push({ id: evidence.attachmentId, ...metadata });
    else if (evidence.dataUrl) inlineAttachments.push({ id: step.id, ...metadata });
  }
  return {
    projectId: execution.project_id,
    runId: execution.id,
    caseId: result.test_case_id,
    includeRunAttachments,
    resultId: result.derived ? undefined : result.id,
    stepId: result.derived ? undefined : failedStep?.id,
    attachmentResultId: result.derived ? result.source_result_id : result.id,
    title: `Failed: ${failedAction || resolvedCaseTitle}`.slice(0, 240),
    message: [context, evidenceLines.length ? `**Failure evidence**\n\n${evidenceLines.map(line => `- ${line}`).join("\n")}` : ""].filter(Boolean).join("\n\n"),
    stepsToReproduce: reproduction,
    expectedResult: toPlainText(failedStep?.expected_result),
    actualResult,
    aiIntent: [field("Test case", resolvedCaseTitle), failingStepLine, ...failureComments, !failureComments.length ? field("Observed result", observedError) : ""].filter(Boolean).join("\n"),
    aiEvidence: [context, failingStepLine, field("Expected result", toPlainText(failedStep?.expected_result))].filter(Boolean).join("\n\n"),
    attachmentCopies,
    inlineAttachments
  };
}
