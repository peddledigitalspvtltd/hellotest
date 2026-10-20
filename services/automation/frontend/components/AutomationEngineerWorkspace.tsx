import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertCircle, IconArrowRight, IconBraces, IconCheck, IconCode, IconFileText, IconPhoto, IconWorld } from "@tabler/icons-react";
import type { StepApiRequest, TestStep } from "@hellotest/platform/frontend/src/types";
import type { AutomationRepositoryReference } from "../lib/automationKeywordInputs";
import { testingApi } from "@hellotest/testing/frontend/api.client";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { AutomationInstructionPreview } from "./AutomationInstructionPreview";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
import { formatAutomationSourceLines } from "../lib/automationInstructions";
import { engineerProgressFrontier, engineerStepFinished } from "../lib/automationEngineerProgress";
import { automationSemanticIssueMessage, type AutomationSemanticIssue, type AutomationStepBuildError } from "../lib/automationActivityMonitoring";
import { projectEngineerStepData, type EngineerParameterResolution } from "../lib/automationEngineerData";
import { generationApplicabilityNotice } from "../lib/automationGenerationApplicability";
import "./AutomationEngineerWorkspace.css";

export type AutomationAgentInitialStep = Pick<TestStep, "id" | "step_order" | "action" | "expected_result" | "step_type"> & { test_case_id?: string };
export type AutomationAgentInitialManualStep = {
  manual_test_case_id: string; manual_step_id: string; manual_step_order: number; action: string; expected_result?: string | null;
  test_case_id?: string; section_step_id?: string | null;
};
const EngineerModelPayload = capabilityView<{ projectId: string; sessionId: string; caseId: string; stepId?: string; attempt?: number; kind: "request" | "response"; live?: boolean; modelCallIds?: string[] }>("trace", "EngineerModelPayload", () => import("@hellotest/trace/frontend/components/ModelCallDetails"), "Model request / response");
export type AutomationAgentWorkspaceStep = {
  test_case_id: string; step_id?: string; manual_step_id?: string; manual_test_case_id?: string; section_step_id?: string;
  step_order?: number; step_type?: string | null; action?: string; expected_result?: string; status?: string; instruction_status?: string;
  preview_artifact_id?: string; preview_created_at?: string; validated_at?: string; updated_at?: string; attempt?: number;
  browser_actions?: Array<{ action_id: string; tool: string; status: string; action_outcome?: string; assertion_outcome?: string; active_manual_step_ids?: string[] }>;
  development_status?: string;
  parameter_resolution?: EngineerParameterResolution;
};
type CaseSummary = { test_case_id: string; title?: string };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const plain = (value: unknown) => richTextToPlainText(text(value));
const stepKey = (step: AutomationAgentWorkspaceStep, index: number) => `${step.test_case_id}:${step.manual_test_case_id || ""}:${step.manual_step_id || step.step_id || index}`;
const codeFormats = [
  {id:"instructions",label:"Instructions",icon:IconBraces}, {id:"source",label:"Source",icon:IconCode},
  {id:"errors",label:"Build Error",icon:IconAlertCircle}, {id:"activity",label:"Browser activity",icon:IconWorld},
  {id:"verification",label:"Verification",icon:IconCheck}, {id:"request",label:"Model request"}, {id:"response",label:"Model response"}
] as const;
type CodeFormat = typeof codeFormats[number]["id"];
const buildErrorTitle = (error: AutomationStepBuildError) => error.code?.startsWith("AUTOMATION_SEMANTIC_REVIEW_") ? "Expected result needs review" : error.code?.startsWith("AUTOMATION_PREREQUISITE_") ? "Missing step needs review" : ["AUTOMATION_BROWSER_SECTION_BLOCKED", "AUTOMATION_BROWSER_CHECK_STALLED"].includes(error.code || "") ? "Step needs review" : error.phase?.includes("dependencies") || error.code === "AUTOMATION_DEPENDENCY_MISSING" ? "Context required" : error.phase?.includes("save") ? "Instructions could not be saved" : error.phase?.includes("output.invalid") || error.phase?.includes("incomplete") ? "Instructions need correction" : error.phase?.includes("browser") || error.phase?.includes("action") ? "Browser action could not finish" : "Generation could not finish";
function statusFor(step: AutomationAgentWorkspaceStep, initial: boolean) {
  if (initial) return { value: "retained", label: "Existing section" };
  if (step.instruction_status === "saved") return { value: "saved", label: "Saved · Not run" };
  if (step.instruction_status?.startsWith("validated")) return { value: "validated", label: "Validated draft" };
  if (step.status === "in_progress") return { value: "working", label: "Developing" };
  if (step.status === "needs_attention") return { value: "attention", label: "Needs attention" };
  if (step.instruction_status === "requested") return { value: "queued", label: "Requested from model" };
  return { value: "queued", label: "Queued" };
}
const draftReady = (step?: AutomationAgentWorkspaceStep) => Boolean(step && (step.instruction_status === "saved" || step.instruction_status?.startsWith("validated")));
const observedUrl = (value: unknown) => {
  try { const url = new URL(text(value));return ["http:", "https:"].includes(url.protocol) ? `${url.origin}${url.pathname}` : ""; }
  catch { return ""; }
};
const observedTime = (value: unknown) => { const time = new Date(text(value));return Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString(); };

/** Immutable protected previews are evidence of development, never proof of execution. */
export function AutomationEngineerWorkspace({ projectId, appTypeId, activityId, caseId, caseTitle, initialSteps = [], initialManualSteps = [], initialManualLoading = false, initialParameterValues = {}, steps, manualSteps, cases, application, buildDataArtifacts, stepErrors = [], verificationByCase = {}, progressionPolicy, historical = false, working, incomplete }: {
  projectId: string; appTypeId: string; activityId?: string; caseId?: string; caseTitle?: string; initialSteps?: AutomationAgentInitialStep[]; initialManualSteps?: AutomationAgentInitialManualStep[]; initialManualLoading?: boolean;
  initialParameterValues?: Record<string,string>;
  steps: AutomationAgentWorkspaceStep[]; manualSteps: AutomationAgentWorkspaceStep[]; cases: CaseSummary[]; application?: unknown; buildDataArtifacts?: Record<string, string>; stepErrors?: AutomationStepBuildError[]; verificationByCase?: Record<string,unknown>; progressionPolicy?: string; historical?: boolean; working: boolean; incomplete: boolean;
}) {
  const { can } = useCapabilityAccess(projectId);
  const sourceAllowed = ["automation.view", "automation.build", "automation.code.view", "automation.ai"].every(permission => can(permission));
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [chosenCase, setChosenCase] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [follow, setFollow] = useState(true);
  const [codeTab, setCodeTab] = useState<CodeFormat>("instructions");
  const [evidenceTab, setEvidenceTab] = useState<"browser" | "snapshot">("browser");
  const progressIds = [...new Set([...steps.map(item => item.test_case_id), ...manualSteps.map(item => item.test_case_id)])];
  const mappedTarget = manualSteps.find(step => step.manual_test_case_id === caseId)?.test_case_id;
  const preferredCase = caseId && progressIds.includes(caseId) ? caseId : mappedTarget || progressIds[0] || cases[0]?.test_case_id || caseId || "";
  const caseIds = [...new Set([...progressIds, ...cases.map(item => item.test_case_id), ...(progressIds.length || cases.length ? [] : [caseId])].filter((value): value is string => Boolean(value)))];
  const activeCase = caseIds.includes(chosenCase) ? chosenCase : preferredCase;
  const caseName = cases.find(item => item.test_case_id === activeCase)?.title || (activeCase === caseId || activeCase === mappedTarget ? caseTitle : "") || activeCase || "Automation case";
  const dataAllowed = sourceAllowed && can("data.view");
  const buildDataArtifactId = text(buildDataArtifacts?.[activeCase]);
  const buildDataQuery = useQuery({
    queryKey: ["automation-engineer-build-data", projectId, appTypeId, activityId, activeCase, buildDataArtifactId],
    queryFn: async ({ signal }) => {
      const value = record(await testingApi.testCases.automationAgentBuildData(activityId!, buildDataArtifactId, signal));
      if (value.schema_version !== 1 || value.kind !== "automation_build_data" || value.test_case_id !== activeCase) throw new Error("This test data does not belong to the selected case.");
      return value;
    },
    enabled: Boolean(dataAllowed && activityId && buildDataArtifactId), retry: false, staleTime: Infinity
  });
  // Resolved data is fetched under data.view and never stored in general activity metadata.
  const buildData = dataAllowed && buildDataArtifactId ? buildDataQuery.data : undefined;
  const withBuildLabels = (step: AutomationAgentWorkspaceStep, manual: boolean) => {
    const projected = projectEngineerStepData(step,{manual,caseId:activeCase,activityId,dataAllowed,initialParameterValues,buildData,pending:buildDataQuery.isFetching});
    return {...projected.step,parameter_resolution:projected.resolution};
  };
  const currentSteps = steps.filter(step => step.test_case_id === activeCase).map(step => withBuildLabels(step, false));
  const manifest = manualSteps.filter(step => step.test_case_id === activeCase);
  const suppliedManual: AutomationAgentWorkspaceStep[] = initialManualSteps.flatMap(step => {
    const target = step.test_case_id || manualSteps.find(row => row.manual_test_case_id === step.manual_test_case_id && row.manual_step_id === step.manual_step_id)?.test_case_id || preferredCase;
    return target === activeCase ? [{ test_case_id: target, manual_test_case_id: step.manual_test_case_id, manual_step_id: step.manual_step_id, step_order: step.manual_step_order, action: step.action, expected_result: step.expected_result || "", section_step_id: step.section_step_id || undefined }] : [];
  });
  const manualKey = (row: AutomationAgentWorkspaceStep) => `${row.manual_test_case_id || ""}:${row.manual_step_id || row.step_id || row.step_order || ""}`;
  const sourceSteps = [...new Map([...suppliedManual, ...manifest].map(row => [manualKey(row), row])).values()].map(step => withBuildLabels(step, true));
  const initial = !currentSteps.length;
  const planned: AutomationAgentWorkspaceStep[] = currentSteps.length ? currentSteps : initialSteps.filter(step => !step.test_case_id || step.test_case_id === activeCase).map(step => withBuildLabels({ ...step, step_id: step.id, test_case_id: activeCase, action: step.action || "", expected_result: step.expected_result || "" }, false));
  const manual = sourceSteps.length > 0;
  const rows = manual ? sourceSteps : planned;
  const progressFor = (row: AutomationAgentWorkspaceStep) => {
    const generated = manual ? planned.find(section => section.step_id === row.section_step_id) : row;
    return generated ? { ...generated, ...row, status: row.status || generated.status, instruction_status: row.instruction_status || generated.instruction_status } : row;
  };
  const strictProgression = progressionPolicy === "performed_generated_saved";
  const progressRows = rows.map(progressFor);
  const frontierIndex = engineerProgressFrontier(progressRows, strictProgression);
  const automaticIndex = historical ? Math.max(0, progressRows.findIndex(row => row.status === "in_progress")) : frontierIndex;
  const revealed = (index: number) => historical || index <= frontierIndex;
  const selectable = (index: number) => revealed(index) && (index === frontierIndex || engineerStepFinished(progressRows[index], strictProgression) || historical);
  const chosenIndex = rows.findIndex((row, index) => stepKey(row, index) === selectedKey);
  const selectedIndex = follow || chosenIndex < 0 || !selectable(chosenIndex) ? automaticIndex : chosenIndex;
  const selected = rows[selectedIndex];
  const section = manual ? planned.find(row => row.step_id === selected?.section_step_id) : selected;
  const sharedManualSection = manual && sourceSteps.filter(row => row.section_step_id && row.section_step_id === selected?.section_step_id).length > 1;
  const errorsFor = (row?: AutomationAgentWorkspaceStep) => row ? stepErrors.filter(error => error.test_case_id === activeCase && (Boolean(error.step_id && (error.step_id === row.step_id || error.step_id === row.section_step_id)) || Boolean(row.manual_step_id && error.manual_step_ids.includes(row.manual_step_id)))) : [];
  const selectedErrors = errorsFor(selected);
  const semanticRequirementFor = (issue: AutomationSemanticIssue) => {
    const source = issue.obligation_id === section?.step_id ? section : sourceSteps.find(row => {
      try { return issue.obligation_id === `manual:${encodeURIComponent(row.manual_test_case_id || "")}:${encodeURIComponent(row.manual_step_id || "")}`; }
      catch { return false; }
    });
    // Reuse authorized, privacy-projected labels already shown in this view.
    // Public diagnostics never carry provider rationale or expanded test data.
    const action = ["action_not_supported", "source_order_conflict", "unmet_prerequisite"].includes(issue.code);
    return source ? { label: `${source.manual_step_id ? "Manual step" : "Step"}${source.step_order ? ` ${source.step_order}` : ""} · ${action ? "Action" : "Expected result"}`,
      value: action ? source.action : source.expected_result || source.action } : undefined;
  };
  const unresolvedErrors = selectedErrors.filter(error => !error.resolved_at);
  const selectedData = selected?.parameter_resolution;
  const followingKey = rows[automaticIndex] ? stepKey(rows[automaticIndex], automaticIndex) : "";
  useEffect(() => {
    if (!follow || !followingKey) return;
    const list = listRef.current;
    const item = list?.querySelector<HTMLButtonElement>(`button[data-step-index="${automaticIndex}"]`);
    if (!list || !item) return;
    const viewport = list.getBoundingClientRect(), bounds = item.getBoundingClientRect();
    const top = bounds.top < viewport.top ? bounds.top - viewport.top - 8 : bounds.bottom > viewport.bottom ? bounds.bottom - viewport.bottom + 8 : 0;
    if (top) list.scrollBy({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [follow, followingKey, automaticIndex]);
  const artifactId = section?.preview_artifact_id || "";
  const previewQuery = useQuery({
    queryKey: ["automation-engineer-preview", projectId, appTypeId, activityId, activeCase, section?.step_id, artifactId],
    queryFn: async ({ signal }) => {
      const value = record(await testingApi.testCases.automationAgentPreview(activityId!, artifactId, signal));
      if (value.schema_version !== 1 || value.kind !== "section_preview" || value.test_case_id !== activeCase || value.step_id !== section?.step_id) throw new Error("This preview does not belong to the selected section.");
      return value;
    },
    enabled: Boolean(sourceAllowed && activityId && artifactId), retry: false, staleTime: 0, refetchOnMount: "always"
  });
  const preview = sourceAllowed && artifactId ? previewQuery.data : undefined;
  const generationNotice = preview ? generationApplicabilityNotice(preview) : null;
  const references = Array.isArray(preview?.object_references) ? preview.object_references.map(record) : [];
  const repository: AutomationRepositoryReference[] = references.flatMap(item => {
    const reference = text(item.reference), point = reference.indexOf(".");
    return point > 0 && point < reference.length - 1 ? [{ id: text(item.entry_id) || reference, page_key: reference.slice(0, point), locator_intent: reference.slice(point + 1), locator: text(item.locator) || reference, metadata: { screen_name: reference.slice(0, point), object_name: reference.slice(point + 1) } }] : [];
  });
  const code = text(preview?.automation_code);
  const apiRequest = preview?.step_type === "api" && Object.keys(record(preview?.api_request)).length ? preview.api_request as StepApiRequest : null;
  const source = apiRequest ? JSON.stringify(apiRequest, null, 2) : formatAutomationSourceLines(code);
  const [copyNotice, setCopyNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const copyArtifact = useRef(artifactId);copyArtifact.current = artifactId;
  useEffect(() => {setCopyNotice("");setCopying(false);}, [artifactId, sourceAllowed]);
  const copySource = async () => {
    if (!sourceAllowed || !source || copying) return;
    setCopying(true);setCopyNotice("");
    try { await navigator.clipboard.writeText(source);if (copyArtifact.current === artifactId) setCopyNotice("Source copied"); }
    catch { if (copyArtifact.current === artifactId) setCopyNotice("Copy unavailable. Select the source text to copy it."); }
    finally { if (copyArtifact.current === artifactId) setCopying(false); }
  };
  const observation = record(application);
  const sectionEvidence = record(preview?.evidence);
  const sectionObservation = sectionEvidence.association === "generation_phase" && sectionEvidence.test_case_id === activeCase && (sectionEvidence.snapshot_artifact_id || sectionEvidence.screenshot_artifact_id);
  const manualObservationMatches = (value: RecordValue) => !selected?.manual_step_id || (Array.isArray(value.active_manual_step_ids) && value.active_manual_step_ids.length ? value.active_manual_step_ids.includes(selected.manual_step_id) : !sharedManualSection);
  const latestMatchesSelection = observation.test_case_id === activeCase && manualObservationMatches(observation) && (observation.active_step_id === section?.step_id && Boolean(section?.step_id) || selected?.manual_step_id && Array.isArray(observation.active_manual_step_ids) && observation.active_manual_step_ids.includes(selected.manual_step_id));
  const latestTime = Date.parse(text(observation.observed_at)) || 0;
  const previewTime = Date.parse(text(sectionEvidence.observed_at)) || 0;
  const usePreviewObservation = sectionObservation && !(latestMatchesSelection && latestTime >= previewTime);
  const app = !sourceAllowed ? {} : usePreviewObservation ? sectionEvidence : observation.test_case_id === activeCase ? observation : {};
  const observationStep = text(app.active_step_id);
  const observationManualIds = Array.isArray(app.active_manual_step_ids) ? app.active_manual_step_ids : [];
  const selectedObservation = manualObservationMatches(app) && Boolean(observationStep && observationStep === section?.step_id || selected?.manual_step_id && observationManualIds.includes(selected.manual_step_id));
  const evidenceLabel = selectedObservation ? "Selected step observation" : usePreviewObservation ? "Generation phase observation" : observationStep ? "Another step observation" : "Latest case observation";
  const screenshotId = text(app.screenshot_artifact_id);
  const snapshotId = text(app.snapshot_artifact_id);
  const activeEvidenceTab = screenshotId ? evidenceTab : "snapshot";
  const screenshotQuery = useQuery({
    queryKey: ["automation-engineer-screenshot", projectId, appTypeId, activityId, activeCase, screenshotId],
    queryFn: () => testingApi.testCases.automationAgentScreenshot(activityId!, screenshotId),
    enabled: Boolean(sourceAllowed && activityId && screenshotId && activeEvidenceTab === "browser"), retry: false, staleTime: Infinity
  });
  const evidenceQuery = useQuery({
    queryKey: ["automation-engineer-evidence", projectId, appTypeId, activityId, activeCase, snapshotId],
    queryFn: async ({ signal }) => {
      const value = record(await testingApi.testCases.automationAgentEvidence(activityId!, snapshotId, signal));
      if (value.test_case_id !== activeCase) throw new Error("This evidence does not belong to the selected case.");
      return value;
    },
    enabled: Boolean(sourceAllowed && activityId && snapshotId && activeEvidenceTab === "snapshot"), retry: false, staleTime: Infinity
  });
  const screenshot = sourceAllowed && typeof screenshotQuery.data?.data_url === "string" && /^data:image\/(?:png|jpeg|webp);base64,/.test(screenshotQuery.data.data_url) ? screenshotQuery.data.data_url : "";
  const snapshot = sourceAllowed ? text(evidenceQuery.data?.accessibility) || text(evidenceQuery.data?.snapshot) || text(evidenceQuery.data?.text) || text(evidenceQuery.data?.content) : "";
  const elements = sourceAllowed && Array.isArray(evidenceQuery.data?.elements) ? evidenceQuery.data.elements.map(record) : [];
  const attempted = section?.attempt ?? preview?.attempt;
  const modelAttempt = typeof attempted === "number" && Number.isInteger(attempted) && attempted > 0 ? attempted : undefined;
  const modelCallIds = Array.isArray(preview?.model_call_ids) ? preview.model_call_ids.filter((value): value is string => typeof value === "string") : undefined;
  const parameterReferences = sourceAllowed && Array.isArray(preview?.parameter_references) ? preview.parameter_references.filter((value): value is string => typeof value === "string") : [];
  // Selecting the active step resumes following as later steps are developed.
  const choose = (index: number) => { if (!selectable(index)) return; setSelectedKey(stepKey(rows[index], index));setFollow(index === automaticIndex); };
  // A case-level capture may show the latest browser state. Activity details must
  // be associated with the selected step or its immutable preview.
  const verification=record(verificationByCase[activeCase]);
  const verificationFailure=record(verification.failure);
  const activityObservation = usePreviewObservation && manualObservationMatches(sectionEvidence) ? sectionEvidence : latestMatchesSelection ? observation : sectionObservation && manualObservationMatches(sectionEvidence) ? sectionEvidence : {};
  const selectedActions = manual && selected?.manual_step_id ? selected.browser_actions ?? (section?.browser_actions || []).filter(action => action.active_manual_step_ids?.includes(selected.manual_step_id!) || !action.active_manual_step_ids?.length && !sharedManualSection) : selected?.browser_actions || [];
  const actionName = (tool: string) => tool.replace(/^browser_/, "").replace(/_/g, " ");

  return <section className="automation-engineer-workspace" aria-label="Automation engineer workspace" data-progress-paused={incomplete && !working || undefined}>
    <div className="automation-engineer-commands">
      <header><div><h3>{manual ? "Steps to automate" : "Steps"}</h3></div></header>
      {caseIds.length > 1 ? <label className="automation-engineer-case-select">Case<select aria-label="Engineer case" value={activeCase} onChange={event => {setChosenCase(event.target.value);setSelectedKey("");setFollow(true);}}>{caseIds.map(value => <option key={value} value={value}>{cases.find(item => item.test_case_id === value)?.title || (value === caseId ? caseTitle : "") || value}</option>)}</select></label> : <p className="automation-engineer-case-name">{caseName}</p>}
      {initialManualLoading ? <p className="automation-engineer-step-count" role="status">Loading linked manual steps…</p> : null}
      {dataAllowed && buildDataArtifactId ? <div className="automation-engineer-data-state">{buildDataQuery.isError ? <><span role="status">Resolved test data is unavailable. Parameter references remain visible.</span><button type="button" className="ghost-button compact" onClick={() => void buildDataQuery.refetch()}>Retry test data</button></> : <span>{buildData ? "Test data fixed for this build" : "Loading this build’s test data…"}</span>}</div> : null}
      <div id={`${id}-command-panel`}>
      {rows.length ? <ol className="automation-engineer-command-list" ref={listRef} aria-label={manual ? "Manual steps to automate" : "Automation sections"}>{rows.map((row, index) => {
        if (!revealed(index)) return <li key={stepKey(row,index)} data-status="queued" data-agent-queued="true"><button type="button" data-step-index={index} disabled aria-label={`Step ${row.step_order || index + 1} queued; waiting for the previous step to be performed, generated and saved`}><span className="automation-engineer-command-number">{row.step_order || index + 1}</span><span className="automation-engineer-queued-placeholder" aria-hidden="true"><span className="automation-engineer-wave is-title"/><span className="automation-engineer-wave is-detail"/><span className="automation-engineer-wave is-status"/></span><span className="automation-engineer-command-arrow" aria-hidden="true"/></button></li>;
        const mapped = manual ? planned.find(item => item.step_id === row.section_step_id) : row;
        const status = !activityId && manual ? { value: index === 0 ? "idle" : "queued", label: index === 0 ? "Ready to automate" : "Waiting for previous step" } : statusFor(progressFor(row), !manual && initial);
        const busy = working && index === frontierIndex && (status.value === "working" || progressFor(row).instruction_status === "requested" || status.value === "validated");
        const errors = errorsFor(row);
        return <li key={stepKey(row, index)} data-status={status.value} data-agent-current={working && index === frontierIndex || undefined}><button type="button" data-step-index={index} disabled={!selectable(index)} aria-busy={busy || undefined} aria-current={selectedIndex === index ? "step" : undefined} onClick={() => choose(index)} onKeyDown={event => {
          const available = rows.flatMap((_, candidate) => selectable(candidate) ? [candidate] : []);
          const next = event.key === "ArrowDown" ? available.find(candidate => candidate > index) ?? -1 : event.key === "ArrowUp" ? available.filter(candidate => candidate < index).pop() ?? -1 : event.key === "Home" ? available[0] ?? -1 : event.key === "End" ? available[available.length - 1] ?? -1 : -1;
          if (next >= 0 && next < rows.length) {event.preventDefault();choose(next);listRef.current?.querySelectorAll<HTMLButtonElement>(":scope > li > button")[next]?.focus();}
        }}><span className="automation-engineer-command-number">{draftReady(progressFor(row)) ? <IconCheck aria-hidden="true" size={16}/> : row.step_order || index + 1}</span><span className="automation-engineer-command-copy"><strong>{plain(row.action) || "Untitled step"}</strong>{row.expected_result ? <span className="automation-engineer-command-expected"><b>Expected result</b><span>{plain(row.expected_result)}</span></span> : null}<small><span className="automation-engineer-command-state">{busy ? <span className="automation-engineer-step-loader" aria-hidden="true"/> : null}{status.label}</span>{manual && mapped ? <span>{`Section ${mapped.step_order || ""}`}</span> : null}{row.attempt ? <span>Attempt {row.attempt}</span> : null}{errors.length ? <span className="automation-engineer-command-error" data-resolved={errors.every(error => error.resolved_at) || undefined}><IconAlertCircle aria-hidden="true" size={12}/>{errors.length} {errors.every(error => error.resolved_at) ? "earlier issue" : "build issue"}{errors.length === 1 ? "" : "s"}</span> : null}</small></span><IconArrowRight aria-hidden="true" className="automation-engineer-command-arrow" size={15}/></button></li>;
      })}</ol> : working ? <><p className="automation-engineer-planning-label" role="status">Planning the first step</p><ol className="automation-engineer-command-list" aria-label="Planned automation steps">{[1,2,3].map(number => <li key={number} data-status="queued" data-agent-queued="true"><button type="button" disabled aria-label={`Step ${number} awaiting the behavior plan`}><span className="automation-engineer-command-number">{number}</span><span className="automation-engineer-queued-placeholder" aria-hidden="true"><span className="automation-engineer-wave is-title"/><span className="automation-engineer-wave is-detail"/><span className="automation-engineer-wave is-status"/></span><span className="automation-engineer-command-arrow" aria-hidden="true"/></button></li>)}</ol></> : <div className="automation-engineer-placeholder"><IconFileText aria-hidden="true" size={24}/><strong>No sections recorded</strong><p>Start the Engineer to develop the case from its requirements and instructions.</p></div>}
      </div>
    </div>
    <div className="automation-engineer-output">
      <section className="automation-engineer-application" aria-label="Application evidence">
        <header><div><IconWorld aria-hidden="true" size={17}/><h3>Application</h3></div><span>{evidenceLabel}</span></header>
        <div className="automation-engineer-browser-address"><span aria-hidden="true">●</span><code>{observedUrl(app.url) || "Waiting for an application observation"}</code>{observedTime(app.observed_at) ? <time dateTime={text(app.observed_at)}>{observedTime(app.observed_at)}</time> : null}</div>
        <div className="automation-engineer-evidence-tabs" role="tablist" aria-label="Application evidence format"><button id={`${id}-browser-tab`} role="tab" aria-selected={activeEvidenceTab === "browser"} aria-controls={`${id}-application-panel`} disabled={!screenshotId} onClick={() => setEvidenceTab("browser")} type="button"><IconPhoto aria-hidden="true" size={14}/>Browser capture</button><button id={`${id}-snapshot-tab`} role="tab" aria-selected={activeEvidenceTab === "snapshot"} aria-controls={`${id}-application-panel`} disabled={!snapshotId} onClick={() => setEvidenceTab("snapshot")} type="button"><IconFileText aria-hidden="true" size={14}/>Page snapshot</button></div>
        <div id={`${id}-application-panel`} role="tabpanel" aria-labelledby={`${id}-${activeEvidenceTab}-tab`} className="automation-engineer-application-view">
          {!sourceAllowed ? <p>Application evidence is hidden by your role.</p> : activeEvidenceTab === "browser" && screenshotId ? screenshotQuery.isPending ? <p role="status">Loading captured application…</p> : screenshotQuery.isError || !screenshot ? <p role="status">The browser capture is unavailable. Use the page snapshot when available.</p> : <img src={screenshot} alt={`Captured application for ${caseName}. Execution is unverified.`}/> : snapshotId ? evidenceQuery.isPending ? <p role="status">Loading page snapshot…</p> : evidenceQuery.isError ? <p role="status">The page snapshot is unavailable within your access.</p> : snapshot ? <pre>{snapshot}</pre> : elements.length ? <ul className="automation-engineer-evidence-elements">{elements.map((element, index) => <li key={index}><strong>{text(element.role) || text(element.tag) || "Element"}</strong><span>{text(element.name) || text(element.label) || text(element.text) || text(element.placeholder) || "Unnamed element"}</span>{element.locator ? <code>{text(element.locator)}</code> : null}</li>)}</ul> : <p>No page text was retained.</p> : <div className="automation-engineer-placeholder"><IconWorld aria-hidden="true" size={28}/><strong>{working ? "Waiting for browser evidence" : "No application evidence retained"}</strong><p>Real browser captures and page observations appear here when available.</p></div>}
        </div>
        {activeEvidenceTab === "snapshot" && (evidenceQuery.data?.partial || evidenceQuery.data?.truncated) ? <p className="automation-engineer-partial-note">Partial page observation</p> : null}
      </section>
      <section className="automation-engineer-implementation" aria-label="Generated section implementation">
        <header><div><IconCode aria-hidden="true" size={17}/><h3>{section ? `${section.step_order || selectedIndex + 1}. ${plain(section.action) || "Section implementation"}` : "Section implementation"}</h3></div><span>{generationNotice?.historical ? "Historical generation · Not run" : section?.instruction_status === "saved" ? "Saved · Not run" : preview ? "Validated draft · Not saved" : "Awaiting preview"}</span></header>
        {generationNotice ? <div className="automation-engineer-generation-version" role="note" aria-label="Generation applicability"><strong>{generationNotice.title}</strong><span>{generationNotice.message}</span></div> : null}
        {dataAllowed && selectedData && (selectedData.missing.length || selectedData.deferred.length || selectedData.private.length) ? <div className="automation-engineer-parameter-status" aria-label="Selected step test data">
          {selectedData.missing.length ? <p><strong>Test data needed</strong><span>Configure these parameter values under Plan or in the linked data set, then retry this case.</span>{selectedData.missing.map(name=><code key={name}>@{name}</code>)}</p> : null}
          {selectedData.deferred.length ? <p><span>Random values are fixed when the build starts.</span>{selectedData.deferred.map(name=><code key={name}>@{name}</code>)}</p> : null}
          {selectedData.private.length ? <p><span>Protected values remain as references in activity.</span>{selectedData.private.map(name=><code key={name}>@{name}</code>)}</p> : null}
        </div> : null}
        <div className="automation-engineer-code-tools"><div className="automation-engineer-code-tabs" role="tablist" aria-label="Generated implementation format" onKeyDown={event => {
          const current = codeFormats.findIndex(format => format.id === codeTab);
          const next = event.key === "ArrowRight" ? (current + 1) % codeFormats.length : event.key === "ArrowLeft" ? (current + codeFormats.length - 1) % codeFormats.length : event.key === "Home" ? 0 : event.key === "End" ? codeFormats.length - 1 : -1;
          if (next < 0) return;event.preventDefault();setCodeTab(codeFormats[next].id);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{codeFormats.map(format => {const Icon="icon" in format ? format.icon : null;return <button key={format.id} id={`${id}-${format.id}-tab`} role="tab" aria-label={format.id === "errors" && selectedErrors.length ? `Build Error (${unresolvedErrors.length || `${selectedErrors.length} earlier`})` : format.label} aria-selected={codeTab === format.id} tabIndex={codeTab === format.id ? 0 : -1} aria-controls={`${id}-implementation-panel`} onClick={() => setCodeTab(format.id)} type="button">{Icon ? <Icon aria-hidden="true" size={14}/> : null}{format.label}{format.id === "errors" && selectedErrors.length ? <span className="automation-engineer-error-count" data-resolved={!unresolvedErrors.length || undefined} aria-hidden="true">{unresolvedErrors.length || selectedErrors.length}</span> : null}</button>;})}</div>{codeTab === "source" ? <button type="button" className="ghost-button compact" aria-label="Copy generated source" disabled={!sourceAllowed || !source || copying} onClick={() => void copySource()}>{copying ? "Copying…" : "Copy code"}</button> : null}</div>
        {copyNotice ? <p className="automation-engineer-copy-notice" role="status">{copyNotice}</p> : null}
        <div id={`${id}-implementation-panel`} role="tabpanel" aria-labelledby={`${id}-${codeTab}-tab`} className="automation-engineer-code-view">
          {!sourceAllowed ? <p>Generated source and keywords are hidden by your role.</p> : codeTab === "verification" ? <section aria-label="Verification for selected step"><h4>Isolated verification</h4><p>{typeof verification.message==='string'?plain(verification.message):'No isolated verification was requested for this build.'}</p>{verificationFailure.step_id===section?.step_id?<p role="status">Operation {Number(verificationFailure.operation_index)||1}: <code>{text(verificationFailure.code)}</code> · {text(verificationFailure.action_outcome).replace(/_/g,' ')}</p>:null}{verification.source_fingerprint?<small>Saved source {text(verification.source_fingerprint).slice(0,12)} · {Number(verification.attempts)||0} run(s). Changes to Plan require a new run.</small>:null}</section> : codeTab === "errors" ? <section className="automation-engineer-build-errors" aria-label="Build errors for selected step">{selectedErrors.length ? <><header><h4>Build errors for this step</h4><p>{section?.instruction_status === "saved" ? "These issues were recorded during generation. The saved section remains available in Plan." : "Review these issues before retrying the unfinished case. Previously saved sections remain in Plan."}</p></header><ol>{selectedErrors.map(error => <li key={error.id} data-resolved={Boolean(error.resolved_at) || undefined}><div><strong>{buildErrorTitle(error)}</strong>{error.resolved_at ? <span>Resolved during generation</span> : null}{error.attempt ? <span>Attempt {error.attempt}</span> : null}{observedTime(error.created_at) ? <time dateTime={error.created_at}>{observedTime(error.created_at)}</time> : null}</div><p>{plain(error.message)}</p>{error.semantic_issues.length ? <ul className="automation-engineer-semantic-issues" aria-label="Unmet requirements">{error.semantic_issues.map(issue => {const requirement=semanticRequirementFor(issue);return <li key={`${issue.code}:${issue.obligation_id}`}><p>{automationSemanticIssueMessage(issue,error.semantic_requirement)}</p>{requirement?.value ? <div><b>{requirement.label}</b><p>{plain(requirement.value)}</p></div> : null}</li>;})}</ul> : null}{error.required_context.length ? <div className="automation-engineer-error-context"><b>Required context</b><ul>{error.required_context.map((value,index)=><li key={index}>{plain(value)}</li>)}</ul></div> : null}{error.required_parameters.length ? <div className="automation-engineer-error-context"><b>Required parameters</b>{error.required_parameters.map((value,index)=><code key={index}>{plain(value)}</code>)}</div> : null}{error.code || error.tool ? <small>{error.tool ? error.tool.replace(/^browser_/,"").replace(/_/g," ") : null}{error.code ? <code>{error.code}</code> : null}</small> : null}</li>)}</ol></> : <div className="automation-engineer-placeholder"><IconCheck aria-hidden="true" size={24}/><strong>{selected ? "No build errors recorded for this step" : "Select a step to view build errors"}</strong><p>Generation errors appear here when the agent can associate them with this step.</p></div>}</section> : codeTab === "activity" ? <section className="automation-engineer-browser-activity" aria-label="Browser activity for selected step">
            {activityObservation.interaction_mode === "read_only" || activityObservation.interaction_mode === "interactive" ? <p className="automation-engineer-interaction-mode">{activityObservation.interaction_mode === "read_only" ? "Read-only observation · Browser actions were not enabled." : "Interactive browser evidence · Browser actions were enabled."}</p> : null}
            {activityObservation.title ? <p className="automation-engineer-page-title">{plain(activityObservation.title)}</p> : null}
            {selectedActions.length ? <ul className="automation-engineer-browser-actions" aria-label="Browser actions for selected step">{selectedActions.map(action => <li key={action.action_id} data-status={action.status}><span>{actionName(action.tool)}</span><strong>{action.status === "running" ? "In progress" : action.status === "completed" ? action.assertion_outcome === "satisfied" ? "Check satisfied" : "Completed" : action.status === "unknown" ? "Outcome unknown · Stopped" : "Failed"}</strong></li>)}</ul> : <div className="automation-engineer-placeholder"><IconWorld aria-hidden="true" size={24}/><strong>{selected ? "No browser action confirmed for this step" : "Select a step to view browser activity"}</strong></div>}
          </section> : codeTab === "request" || codeTab === "response" ? activityId && activeCase ? <EngineerModelPayload key={`${activityId}:${activeCase}:${section?.step_id || ""}:${modelAttempt || ""}`} projectId={projectId} sessionId={activityId} caseId={activeCase} stepId={section?.step_id} attempt={modelAttempt} kind={codeTab} live={working} modelCallIds={modelCallIds}/> : <p>Start the Engineer to view its model {codeTab}.</p> : previewQuery.isFetching && artifactId ? <p role="status">Loading validated section preview…</p> : previewQuery.isError && artifactId ? <div><p role="alert">This section preview is unavailable within your access or retention period.</p><button type="button" className="ghost-button compact" onClick={() => void previewQuery.refetch()}>Retry preview</button></div> : preview ? codeTab === "source" ? <pre><code>{source || "No executable source retained."}</code></pre> : <AutomationInstructionPreview view="instructions" code={code} apiRequest={apiRequest} sectionName={plain(section?.action) || "Generated section"} context={{repository}}/> : <div className="automation-engineer-placeholder"><IconCode aria-hidden="true" size={26}/><strong>{manual && selected && !section ? "Waiting for a section mapping" : working ? "Implementation is being developed" : "No validated preview retained"}</strong><p>{manual && selected && !section ? "The selected manual action and expected result remain visible while the agent develops its implementation." : "Validated generated instructions appear here. Existing saved instructions remain available under Plan."}</p></div>}
        </div>
        {!!references.length && sourceAllowed ? <div className="automation-engineer-object-references"><span>Objects</span>{references.map((item, index) => <code key={`${text(item.entry_id)}:${index}`}>{text(item.reference)}</code>)}</div> : null}
        {parameterReferences.length ? <div className="automation-engineer-object-references"><span>Parameters</span>{parameterReferences.map((name, index) => <code key={`${name}:${index}`}>{name.startsWith("@") ? name : `@${name}`}</code>)}</div> : null}
      </section>
    </div>
  </section>;
}
