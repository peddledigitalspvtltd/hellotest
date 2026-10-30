import { useState } from "react";
import type { AgenticWorkflowRun, AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";
import { ArtifactAssuranceWorkspace } from "@hellotest/ai/frontend/components/ArtifactAssuranceWorkspace";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { agenticApi } from "../api.client";
import { collectSprintDrafts } from "./sprintDraftResults";
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
  const [saved, setSaved] = useState<Record<string, string>>({});
  const drafts = collectSprintDrafts(run);
  const publicationReceipts = run.node_results.filter(item => item.node_type === "artifactTask").flatMap(item => {
    const publication = (item.output as { library_publication?: { mode?: string; receipts?: PublicationReceipt[] } })?.library_publication;
    return publication?.mode === "automatic" ? publication.receipts || [] : [];
  }).filter(receipt => receipt.saved === true && typeof receipt.id === "string" && receipt.id.trim());
  if (!drafts.length) return null;
  const accept = async (storyIndex: number, caseIndex: number, kind: "manual" | "automation") => {
    const key = `${storyIndex}:${caseIndex}:${kind}`;
    setBusy(key); setError("");
    const target = kind === "automation" ? drafts[storyIndex].automationTarget : drafts[storyIndex].manualTarget;
    if (!target) { setError("The assessed draft is not available for acceptance yet."); setBusy(""); return; }
    try { const receipt = await agenticApi.agenticWorkflows.acceptWorkflowDraft(run.id, { node_id: target.nodeId, story_index: target.storyIndex, case_index: caseIndex, kind }); setSaved(current => ({ ...current, [key]: receipt.id })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The draft could not be saved. Review its permissions and evidence."); }
    finally { setBusy(""); }
  };
  return <section className="studio-sprint-drafts" aria-label="Sprint Test Case drafts">
    <h3>{publicationReceipts.length ? "Sprint results and Library cases" : "Sprint drafts ready for review"}</h3>
    <p>{publicationReceipts.length ? "Generated Test Cases are saved in the Library as AI generated and pending review. " : ""}Story and Test Case metrics use the same measurements as their native workspaces. Generated automation requires a Test Engine run before its behavior can be verified.</p>
    {error && <p role="alert">{error}</p>}
    {drafts.map(({packet, manualTarget, automationTarget}, storyIndex) => <details key={`${packet.story_id}:${packet.story_revision || "legacy"}`}>
      <summary>{packet.story?.title || packet.story_id} · {packet.cases.length} {packet.cases.length === 1 ? "Test Case" : "Test Cases"}</summary>
      {packet.story_assurance?.analysis && <details><summary>Story quality metrics and evidence</summary><ArtifactAssuranceWorkspace analysis={packet.story_assurance.analysis} title="AI Story Assurance" reviewState="review-required" analysisSource="ai" criteriaKey="metric.assurance.story" /></details>}
      {packet.cases.map((draft, caseIndex) => <article key={`${packet.story_id}:${caseIndex}`}>
        <h4>{draft.title}</h4><p>{draft.description}</p>
        {draft.gherkin_document ? <pre>{draft.gherkin_document}</pre> : <ol>{draft.steps?.map((step, index) => <li key={index}><strong>{String(step.action || "")}</strong><p>Expected: {String(step.expected_result || "")}</p></li>)}</ol>}
        <AutomationReadiness readiness={packet.case_assurance?.[caseIndex]?.assurance_review?.automation_readiness} built={packet.automation?.[caseIndex]?.validation?.status === "passed"} />
        {packet.case_assurance?.[caseIndex]?.analysis && <details><summary>Test Case quality metrics and evidence</summary><ArtifactAssuranceWorkspace analysis={packet.case_assurance[caseIndex].analysis} title="AI Test Case Quality Assurance" reviewState="review-required" analysisSource="ai" criteriaKey="metric.assurance.test_case" /></details>}
        {packet.automation_input_required?.filter(item => item.case_index === caseIndex).map((item, index) => <div role="status" key={index} className="studio-notice"><strong>Automation needs input</strong><p>{item.message}</p>{!item.blocked_steps?.length && [...(item.required_context || []), ...(item.required_parameters || [])].length ? <p>Required: {[...(item.required_context || []), ...(item.required_parameters || [])].join("; ")}</p> : null}{item.blocked_steps?.map((step, stepIndex) => <p key={stepIndex}>{step.reason}{[...(step.required_context || []), ...(step.required_parameters || [])].length ? ` Required: ${[...(step.required_context || []), ...(step.required_parameters || [])].join("; ")}` : ""}</p>)}</div>)}
        {packet.automation?.[caseIndex] && <details><summary>Generated automation · Draft · {packet.automation[caseIndex]?.verification_status || "unverified"}</summary>
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
          if (kind === "manual" && (!packet.case_assurance?.[caseIndex] || !manualTarget)) return null;
          if (kind === "automation" && !automationTarget) return null;
          return saved[key] ? <p role="status" key={key}>Saved AI generated {kind === "manual" ? "Test Case · Pending review" : "automation · Draft · Unverified"} · <a href={kind === "automation" ? `/automation?case=${encodeURIComponent(saved[key])}` : `/test-cases?case=${encodeURIComponent(saved[key])}`}>Open Library</a></p> : <button type="button" className="ghost-button" key={key} disabled={Boolean(busy) || !can("testcase.create") || !["completed", "needs_review"].includes(run.status)} onClick={() => void accept(storyIndex, caseIndex, kind)}>{busy === key ? "Saving…" : `Accept ${kind === "manual" ? "Test Case" : "automation"} into Library`}</button>;
        })}
      </article>)}
    </details>)}
  </section>;
}
