import { useState } from "react";
import type { AgenticWorkflowRun, AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";
import { ArtifactAssuranceWorkspace } from "@hellotest/ai/frontend/components/ArtifactAssuranceWorkspace";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { agenticApi } from "../api.client";
import { collectSprintDrafts, savedSprintCaseIds, sprintTaskRecords } from "./sprintDraftResults";
import { WorkflowLibraryReviewActions } from "./WorkflowLibraryReviewActions";
import { WorkflowDataView } from "./WorkflowDataView";
import { WorkflowCodeView } from "./WorkflowCodeView";

type PublicationReceipt = { id: string; story_id: string; case_index: number; kind: "manual" | "automation"; saved: boolean; requires_review: boolean };
function AutomationReadiness({ readiness, built }: { readiness?: AiArtifactAssuranceReview["automation_readiness"]; built?: boolean }) {
  if (!readiness) return null;
  const labels = { ready: "Ready for generation", needs_input: "Needs input", unknown: "Not established", not_applicable: "Requires another verification method" };
  const assessment = <>
    <strong>Automation readiness · {labels[readiness.status]}</strong>
    <p>{readiness.summary}</p>
    {readiness.missing_context.length > 0 && <ul>{readiness.missing_context.map((gap, index) => <li key={index}>{gap.reason}{gap.step_refs.length ? ` (${gap.step_refs.join(", ")})` : ""}</li>)}</ul>}
    {readiness.status === "ready" && <p>This assessment permits generation. A Test Engine run is required to verify behavior.</p>}
  </>;
  return built && readiness.status !== "ready"
    ? <details className="studio-notice"><summary>Automation draft generated · Earlier assessment</summary><p>The builder generated a draft that passed native validation. Review the earlier assessment below; execution remains unverified.</p>{assessment}</details>
    : <div className="studio-notice">{assessment}</div>;
}
export function WorkflowSprintDrafts({ run }: { run: AgenticWorkflowRun }) {
  const { can } = useCapabilityAccess(run.project_id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<{runId: string; cases: Record<string, string>}>({runId: run.id, cases: {}});
  const saved = accepted.runId === run.id ? accepted.cases : {};
  const drafts = collectSprintDrafts(run);
  const publicationReceipts = sprintTaskRecords(run).flatMap(item => {
    const publication = (item.output as { library_publication?: { mode?: string; receipts?: PublicationReceipt[] } })?.library_publication;
    return publication?.mode === "automatic" ? publication.receipts || [] : [];
  }).filter(receipt => receipt.saved === true && typeof receipt.id === "string" && receipt.id.trim());
  const reviewIds = savedSprintCaseIds(run, saved);
  if (!drafts.length && !reviewIds.length) return null;
  const accept = async (storyIndex: number, caseIndex: number, kind: "manual" | "automation") => {
    const key = `${storyIndex}:${caseIndex}:${kind}`;
    setBusy(key); setError("");
    const target = kind === "automation" ? drafts[storyIndex].automationTargets[caseIndex] : drafts[storyIndex].manualTargets[caseIndex];
    if (!target) { setError("The assessed draft is not available for acceptance yet."); setBusy(""); return; }
    try { const receipt = await agenticApi.agenticWorkflows.acceptWorkflowDraft(run.id, { node_id: target.nodeId, story_index: target.storyIndex, case_index: caseIndex, kind, ...(target.iterationPath ? { iteration_path: target.iterationPath } : {}) }); setAccepted(current => ({runId: run.id, cases: {...(current.runId === run.id ? current.cases : {}), [key]: receipt.id}})); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The draft could not be saved. Review its permissions and evidence."); }
    finally { setBusy(""); }
  };
  return <section className="studio-sprint-drafts" aria-label="Sprint Test Case drafts">
    <h3>{publicationReceipts.length ? "Sprint results and Library cases" : "Sprint drafts ready for review"}</h3>
    <p>{publicationReceipts.length ? "AI generated Test Cases await Library review. " : ""}Automation drafts require a Test Engine run to verify their behavior.</p>
    <WorkflowLibraryReviewActions run={run} accepted={saved} />
    {error && <p role="alert">{error}</p>}
    {drafts.map(({packet, manualTargets, automationTargets}, storyIndex) => <details key={`${packet.story_id}:${packet.story_revision || "legacy"}`}>
      <summary>{packet.story?.title || packet.story_id} · {packet.cases.length} {packet.cases.length === 1 ? "Test Case" : "Test Cases"}</summary>
      {packet.story_assurance?.failure?.message && <div className="studio-notice" role="status"><strong>Story assurance needs review</strong><p>{packet.story_assurance.failure.message}</p></div>}
      {packet.test_case_generation?.failure?.message && <div className="studio-notice" role="status"><strong>Test Case generation needs review</strong><p>{packet.test_case_generation.failure.message}</p></div>}
      {packet.automation_progress && <div className="studio-notice" role="status">
        <strong>Automation · {packet.automation_progress.processed} of {packet.automation_progress.total} processed</strong>
        <p>{packet.automation_progress.completed} draft{packet.automation_progress.completed === 1 ? "" : "s"} · {packet.automation_progress.failed} failed · {packet.automation_progress.needs_input} need input</p>
        <progress aria-label={`Automation progress for ${packet.story?.title || packet.story_id}`} max={Math.max(1, packet.automation_progress.total)} value={packet.automation_progress.processed} />
        {packet.automation_progress.active_message && <p>{packet.automation_progress.active_case_index != null ? `Case ${packet.automation_progress.active_case_index + 1}: ` : ""}{packet.automation_progress.active_message}</p>}
        {packet.automation_progress.total_sections != null && packet.automation_progress.active_step_order != null && <p>Section {packet.automation_progress.active_step_order} of {packet.automation_progress.total_sections}{packet.automation_progress.completed_sections != null ? ` · ${packet.automation_progress.completed_sections} completed` : ""}</p>}
        {packet.automation_progress.completed_sections != null && packet.automation_progress.total_sections != null && <progress aria-label={`Automation section progress for ${packet.story?.title || packet.story_id}`} max={Math.max(1, packet.automation_progress.total_sections)} value={Math.min(packet.automation_progress.completed_sections, packet.automation_progress.total_sections)} />}
      </div>}
      {packet.story_assurance?.analysis && <details><summary>Story quality metrics and evidence</summary><ArtifactAssuranceWorkspace analysis={packet.story_assurance.analysis} title="AI Story Assurance" reviewState="review-required" analysisSource="ai" criteriaKey="metric.assurance.story" /></details>}
      {packet.cases.map((draft, caseIndex) => <article key={`${packet.story_id}:${caseIndex}`}>
        <h4>{draft.title}</h4><p>{draft.description}</p>
        {draft.gherkin_document ? <pre>{draft.gherkin_document}</pre> : <ol>{draft.steps?.map((step, index) => <li key={index}><strong>{String(step.action || "")}</strong><p>Expected: {String(step.expected_result || "")}</p></li>)}</ol>}
        {draft.parameter_values && Object.keys(draft.parameter_values).length > 0 && <details><summary>Test data and parameters</summary><WorkflowDataView value={draft.parameter_values} defaultMode="json" jsonLabel="Test Case parameters JSON" copyJsonLabel="Copy Test Case parameters JSON" /></details>}
        {packet.test_data?.[caseIndex] && <details><summary>Prepared data · {packet.test_data[caseIndex]?.source === "dataset" ? packet.test_data[caseIndex]?.test_data_set_name || "Test Data Set" : "Synthetic"} · {packet.test_data[caseIndex]?.status}</summary>
          {packet.test_data[caseIndex]?.message && <p>{packet.test_data[caseIndex]?.message}</p>}
          {packet.test_data[caseIndex]?.status === "ready" && Number(packet.test_data[caseIndex]?.existing_parameter_count) > 0 && packet.test_data[caseIndex]?.model_calls_attempted === 0 && !Object.keys(packet.test_data[caseIndex]?.parameter_values || {}).length
            && <p>Using {packet.test_data[caseIndex]?.existing_parameter_count} existing case parameters; no additional generation required.</p>}
          {packet.test_data[caseIndex]?.missing_parameters?.length ? <p>Needs input: {packet.test_data[caseIndex]!.missing_parameters!.join(", ")}</p> : null}
          {packet.test_data[caseIndex]?.private_parameter_names?.length ? <p>Protected references: {packet.test_data[caseIndex]!.private_parameter_names!.join(", ")}</p> : null}
          {packet.test_data[caseIndex]?.deterministic_fallbacks?.map((item, index) => <p key={index}>{item.parameter}: {item.reason}</p>)}
          {packet.test_data[caseIndex]?.parameter_values && Object.keys(packet.test_data[caseIndex]!.parameter_values!).length > 0 && <WorkflowDataView value={packet.test_data[caseIndex]!.parameter_values} defaultMode="json" jsonLabel="Prepared case data JSON" copyJsonLabel="Copy prepared data JSON" />}
        </details>}
        {packet.case_assurance_failures?.[caseIndex] && <div role="status" className="studio-notice"><strong>Test Case assurance needs review</strong><p>{packet.case_assurance_failures[caseIndex]?.message}</p></div>}
        <AutomationReadiness readiness={packet.case_assurance?.[caseIndex]?.assurance_review?.automation_readiness} built={packet.automation?.[caseIndex]?.validation?.status === "passed"} />
        {packet.case_assurance?.[caseIndex]?.analysis && <details><summary>Test Case quality metrics and evidence</summary><ArtifactAssuranceWorkspace analysis={packet.case_assurance[caseIndex].analysis} title="AI Test Case Quality Assurance" reviewState="review-required" analysisSource="ai" criteriaKey="metric.assurance.test_case" /></details>}
        {packet.automation_input_required?.filter((item): item is NonNullable<typeof item> => item !== null && item.case_index === caseIndex).map((item, index) => <div role="status" key={index} className="studio-notice"><strong>Automation needs input</strong><p>{item.message}</p>{!item.blocked_steps?.length && [...(item.required_context || []), ...(item.required_parameters || [])].length ? <p>Required: {[...(item.required_context || []), ...(item.required_parameters || [])].join("; ")}</p> : null}{item.blocked_steps?.map((step, stepIndex) => <p key={stepIndex}>{step.reason}{[...(step.required_context || []), ...(step.required_parameters || [])].length ? ` Required: ${[...(step.required_context || []), ...(step.required_parameters || [])].join("; ")}` : ""}</p>)}</div>)}
        {packet.automation_failures?.filter((item): item is NonNullable<typeof item> => item !== null && item.case_index === caseIndex).map((item, index) => <div role="status" key={index} className="studio-notice">
          <strong>Automation generation failed</strong><p>{item.message}</p>
          {item.completed_sections != null && <p>{item.completed_sections}{item.total_sections != null ? ` of ${item.total_sections}` : ""} build sections completed before this failure.</p>}
          {item.validation_feedback != null && <details><summary>Build diagnostics</summary><WorkflowDataView value={{code: item.code, feedback: item.validation_feedback}} defaultMode="json" jsonLabel="Automation failure JSON" copyJsonLabel="Copy automation failure JSON" /></details>}
          <p>{item.reconciliation_required || item.outcome_unknown
            ? "The browser action outcome is unknown. Review and reconcile the current application state before retrying; completed drafts are retained."
            : "Completed drafts are retained. Review this case’s inputs and instructions before retrying."}</p>
        </div>)}
        {packet.automation?.[caseIndex] && <details><summary>{packet.automation[caseIndex]?.live_validation?.status === "blocked" ? "Draft generated · Live validation blocked" : "Generated automation · Draft"} · {packet.automation[caseIndex]?.verification_status || "unverified"}</summary>
          {packet.automation[caseIndex]?.live_validation?.status === "blocked" && <div role="status" className="studio-notice">
            <p>{packet.automation[caseIndex]?.live_validation?.reason || "The live application prevented the authored case from finishing during generation."}</p>
            {packet.automation[caseIndex]?.live_validation?.stopped_at_step_order != null && <p>Live validation stopped at section {packet.automation[caseIndex]?.live_validation?.stopped_at_step_order}.</p>}
            <p>The generated code remains an unverified draft. A Test Engine run is required to establish its result.</p>
          </div>}
          {packet.automation[caseIndex]?.instructions && <ol>{packet.automation[caseIndex].instructions.map(step => <li key={step.step_order}><strong>{step.action}</strong><p>Expected: {step.expected_result}</p></li>)}</ol>}
          {can("automation.code.view") && packet.automation[caseIndex]?.executable?.code && <WorkflowCodeView code={packet.automation[caseIndex].executable.code} filename={packet.automation[caseIndex].executable.filename} />}
          <details><summary>Native automation plan</summary><WorkflowDataView value={packet.automation[caseIndex]?.steps} defaultMode="json" jsonLabel="Automation plan JSON" copyJsonLabel="Copy automation plan JSON" /></details>
        </details>}
        {(["manual", "automation"] as const).map(kind => {
          const key = `${storyIndex}:${caseIndex}:${kind}`;
          if (kind === "automation" && (!can("automation.view") || !can("automation.build") || !can("automation.code.view"))) return null;
          const receipt = publicationReceipts.find(item => item.story_id === packet.story_id && item.case_index === caseIndex && item.kind === kind);
          if (receipt) return <p role="status" key={key}>Saved AI generated {kind === "manual" ? "Test Case · Pending review" : "automation · Draft · Unverified"} · <a href={kind === "automation" ? `/automation?case=${encodeURIComponent(receipt.id)}` : `/test-cases?case=${encodeURIComponent(receipt.id)}`}>Open Library</a></p>;
          if (kind === "automation" && !packet.automation?.[caseIndex]) return null;
          if (kind === "manual" && (!packet.case_assurance?.[caseIndex] || !manualTargets[caseIndex])) return null;
          if (kind === "automation" && !automationTargets[caseIndex]) return null;
          return saved[key] ? <p role="status" key={key}>Saved AI generated {kind === "manual" ? "Test Case · Pending review" : "automation · Draft · Unverified"} · <a href={kind === "automation" ? `/automation?case=${encodeURIComponent(saved[key])}` : `/test-cases?case=${encodeURIComponent(saved[key])}`}>Open Library</a></p> : <button type="button" className="ghost-button" key={key} disabled={Boolean(busy) || !can("testcase.create") || !["completed", "needs_review"].includes(run.status)} onClick={() => void accept(storyIndex, caseIndex, kind)}>{busy === key ? "Saving…" : `Accept ${kind === "manual" ? "Test Case" : "automation"} into Library`}</button>;
        })}
      </article>)}
    </details>)}
  </section>;
}
