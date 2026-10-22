import { useState } from "react";
import type { AgenticWorkflowRun, AiArtifactAssuranceAnalysis } from "@hellotest/platform/frontend/src/types";
import { ArtifactAssuranceWorkspace } from "@hellotest/ai/frontend/components/ArtifactAssuranceWorkspace";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { agenticApi } from "../api.client";

type Draft = { title: string; description?: string; authoring_mode?: string; gherkin_document?: string; steps?: Array<Record<string, unknown>> };
type Packet = { story_id: string; story: { title: string }; story_assurance?: { analysis: AiArtifactAssuranceAnalysis }; cases: Draft[]; case_assurance?: Array<{ analysis: AiArtifactAssuranceAnalysis }>; automation?: Array<{ steps?: Array<Record<string, unknown>>; validation?: { status: string }; verification_status?: string }> };
export function WorkflowSprintDrafts({ run }: { run: AgenticWorkflowRun }) {
  const { can } = useCapabilityAccess(run.project_id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Record<string, string>>({});
  const result = [...run.node_results].reverse().find(item => item.status === "completed" && item.node_type === "artifactTask" && (item.output as { data?: Packet[] })?.data?.some(packet => packet.case_assurance?.length));
  const packets = (result?.output as { data?: Packet[] })?.data;
  if (!result || !packets?.length) return null;
  const accept = async (storyIndex: number, caseIndex: number, kind: "manual" | "automation") => {
    const key = `${storyIndex}:${caseIndex}:${kind}`;
    setBusy(key); setError("");
    try { const receipt = await agenticApi.agenticWorkflows.acceptWorkflowDraft(run.id, { node_id: String(result.node_id), story_index: storyIndex, case_index: caseIndex, kind }); setSaved(current => ({ ...current, [key]: receipt.id })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The draft could not be saved. Review its permissions and evidence."); }
    finally { setBusy(""); }
  };
  return <section className="studio-sprint-drafts" aria-label="Sprint Test Case drafts">
    <h3>Sprint drafts ready for review</h3>
    <p>Story and Test Case metrics use the same measurements as their native workspaces. Generated automation requires a Test Engine run before its behavior can be verified.</p>
    {error && <p role="alert">{error}</p>}
    {packets.map((packet, storyIndex) => <details key={packet.story_id}>
      <summary>{packet.story?.title || packet.story_id} · {packet.cases.length} Test Cases</summary>
      {packet.story_assurance?.analysis && <ArtifactAssuranceWorkspace analysis={packet.story_assurance.analysis} title="AI Story Assurance" reviewState="review-required" analysisSource="ai" criteriaKey="metric.assurance.story" />}
      {packet.cases.map((draft, caseIndex) => <article key={`${packet.story_id}:${caseIndex}`}>
        <h4>{draft.title}</h4><p>{draft.description}</p>
        {draft.gherkin_document ? <pre>{draft.gherkin_document}</pre> : <ol>{draft.steps?.map((step, index) => <li key={index}><strong>{String(step.action || "")}</strong><p>Expected: {String(step.expected_result || "")}</p></li>)}</ol>}
        {packet.case_assurance?.[caseIndex]?.analysis && <details><summary>Test Case quality metrics and evidence</summary><ArtifactAssuranceWorkspace analysis={packet.case_assurance[caseIndex].analysis} title="AI Test Case Quality Assurance" reviewState="review-required" analysisSource="ai" criteriaKey="metric.assurance.test_case" /></details>}
        {packet.automation?.[caseIndex] && <details><summary>Generated automation · {packet.automation[caseIndex].verification_status || "unverified"}</summary><pre>{JSON.stringify(packet.automation[caseIndex].steps, null, 2)}</pre></details>}
        {(["manual", "automation"] as const).map(kind => {
          const key = `${storyIndex}:${caseIndex}:${kind}`;
          if (kind === "automation" && (!packet.automation?.[caseIndex] || !can("automation.view") || !can("automation.build") || !can("automation.code.view"))) return null;
          return saved[key] ? <p role="status" key={key}>Saved {kind} Test Case · {saved[key]} · <a href={kind === "automation" ? `/automation?case=${encodeURIComponent(saved[key])}` : "/test-cases"}>Open library</a></p> : <button type="button" className="ghost-button" key={key} disabled={Boolean(busy) || !can("testcase.create") || !["completed", "needs_review"].includes(run.status)} onClick={() => void accept(storyIndex, caseIndex, kind)}>{busy === key ? "Saving…" : `Accept ${kind === "manual" ? "Test Case" : "automation"} into Library`}</button>;
        })}
      </article>)}
    </details>)}
  </section>;
}
