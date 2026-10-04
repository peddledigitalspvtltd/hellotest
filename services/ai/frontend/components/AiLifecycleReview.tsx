import { AutomationRepairReview } from "@hellotest/ai/frontend/components/AutomationRepairReview";
import { useEffect, useRef, useState } from "react";
import { IconSparkles, IconPlayerPlay } from "@tabler/icons-react";
import { agenticApi } from "@hellotest/agentic/frontend/api.client";
import type { AgenticAssistantSessionResponse } from "@hellotest/platform/frontend/src/types";
import { QualityEvidencePanel } from "./QualityEvidencePanel";
import { AiLlmSelect } from "./AiLlmSelect";
import "./AiLifecycleReview.css";

const capabilities = [
  { id: "release-readiness", name: "Release readiness", task: "Assess the selected release scope using the code-computed gates. Explain blockers, unknown evidence and the next checks without approving deployment." },
  { id: "impact-analysis", name: "Impact analysis", task: "Trace the selected change through recorded relationships. Explain the affected records, uncertain paths and conservative regression scope." },
  { id: "coverage-assurance", name: "Test coverage", task: "Review acceptance obligations and linked assertions. Separate designed, executable and observed coverage and make unknown coverage explicit." },
  { id: "risk-prediction", name: "Risk indicators", task: "Explain the rule-based risk indicators and missing data. Do not invent probabilities or waive release gates." },
  { id: "flaky-test-intelligence", name: "Flaky test intelligence", task: "Review comparable test attempts. Preserve observed failures, explain sample limitations and propose checks to distinguish nondeterminism from product defects." },
  { id: "release-risk-simulation", name: "Release scenarios", task: "Explain the code-computed hypothetical gate scenarios and required evidence. Do not change actual readiness or approvals." },
  { id: "quality-graph", name: "AI Quality Graph", task: "Explain recorded Story, Test Case, attempt and Defect relationships. Identify missing traceability without treating missing links as proof of no impact." },
  { id: "automation-repair", name: "Automation repair", task: "Review failed automation and propose the smallest safe locator, synchronization or fixture repair. Preserve every assertion. Include reproduction and neighbor checks; unexecuted patches remain proposals." }
];

type Props = {
  projectId: string; appTypeId?: string; inputs?: Record<string, string | undefined>;
  features?: string[]; title?: string; environments?: Array<{ id: string; name: string }>;
  integrations?: Array<{ id: string; name: string; model?: string | null; is_active?: boolean; type?: string }>;
};
export function AiLifecycleReview({ projectId, appTypeId, inputs = {}, features, title = "AI quality review", integrations = [], environments }: Props) {
  const choices = capabilities.filter(item => !features || features.includes(item.id));
  const [agentId, setAgentId] = useState(choices[0]?.id || "quality-graph");
  const [integrationId, setIntegrationId] = useState("");
  const [failedRun, setFailedRun] = useState("");
  const [build, setBuild] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [guidance, setGuidance] = useState("");
  const [response, setResponse] = useState<AgenticAssistantSessionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const scopeKey = JSON.stringify([projectId, appTypeId, inputs]);
  useEffect(() => { generation.current++; controller.current?.abort(); setResponse(null); setError(""); setBusy(false); setBuild(""); setFailedRun(""); setEnvironmentId(""); setGuidance(""); setIntegrationId(""); return () => { generation.current++; controller.current?.abort(); }; }, [scopeKey]);
  const selected = choices.find(item => item.id === agentId) || choices[0];
  const run = async () => {
    if (!selected || !projectId || busy) return;
    controller.current?.abort();
    controller.current = new AbortController();
    const version = ++generation.current;
    setBusy(true); setError(""); setResponse(null);
    try {
      const result = await agenticApi.agenticWorkflows.ask({ project_id: projectId, app_type_id: appTypeId, agent_id: selected.id, mode: "agent", integration_id: integrationId || undefined,
        inputs: { ...inputs, execution_id:inputs.execution_id||failedRun||undefined, build: inputs.build || build, environment_id: inputs.environment_id || environmentId },
        context_scopes: selected.id === "automation-repair" ? ["automation", "stories", "test-cases", "runs", "bugs", "knowledge"] : ["stories", "test-cases", "runs", "bugs", "knowledge"],
        prompt: `${selected.task}${guidance.trim() ? `\nReview focus: ${guidance.trim()}` : ""}` }, { signal: controller.current.signal });
      if (version === generation.current) setResponse(result);
    } catch (failure) { if (version === generation.current && !controller.current.signal.aborted) setError(failure instanceof Error ? failure.message : "The AI review could not finish."); }
    finally { if (version === generation.current) setBusy(false); }
  };
  const cancel = () => { generation.current++; controller.current?.abort(); setBusy(false); setError("Review cancelled. Start a new review when ready."); };
  return <details className="ai-lifecycle-shell"><summary><IconSparkles size={18} aria-hidden="true" /><strong>{title}</strong><span>Evidence, checks and next steps</span></summary><section className="ai-lifecycle-review" aria-label={title}>
    <header><div><span><IconSparkles size={16} aria-hidden="true" />Evidence to decision</span><h3>{title}</h3><p>Review the scope, inspect the evidence and decide the next step.</p></div><span className="ai-lifecycle-model-note">LLM required · Human review</span></header>
    <div className="ai-lifecycle-controls"><label>Review focus<select value={selected?.id} disabled={busy} onChange={event => { setAgentId(event.target.value); setResponse(null); setError(""); }}>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><AiLlmSelect integrations={integrations} value={integrationId} onChange={id => { setIntegrationId(id); setResponse(null); }} disabled={busy} scopeKey={projectId} autoLabel="Project default LLM" /></div>
    {selected && ["release-readiness", "release-risk-simulation", "flaky-test-intelligence"].includes(selected.id) ? <div className="ai-lifecycle-scope">{!inputs.build ? <label>Exact build<input value={build} maxLength={255} disabled={busy} onChange={event => { setBuild(event.target.value); setResponse(null); }} placeholder="Build identifier" /></label> : null}{!inputs.environment_id ? <label>{environments ? "Environment" : "Environment ID"}{environments ? <select aria-label="Environment" value={environmentId} disabled={busy} onChange={event => { setEnvironmentId(event.target.value); setResponse(null); }}><option value="">Choose an environment</option>{environments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <input value={environmentId} maxLength={255} disabled={busy} onChange={event => { setEnvironmentId(event.target.value); setResponse(null); }} placeholder="Environment identifier" />}</label> : null}<p>Missing scope remains unknown. A successful review does not approve a release.</p></div> : null}
    {selected?.id === "automation-repair" && !inputs.execution_id ? <label className="ai-lifecycle-guidance">Failed Run ID <span>Optional · Uses the latest recorded failure for this Test Case</span><input value={failedRun} maxLength={255} disabled={busy} onChange={event=>{setFailedRun(event.target.value);setResponse(null);}} placeholder="Run identifier" /></label>:null}
    <label className="ai-lifecycle-guidance">Additional focus <span>Optional</span><textarea rows={2} maxLength={2000} value={guidance} disabled={busy} onChange={event => { setGuidance(event.target.value); setResponse(null); }} placeholder="A change, concern, or question to investigate…" /></label>
    <div className="ai-lifecycle-actions"><button className="primary-button" type="button" disabled={busy || !selected || !projectId} onClick={() => void run()}><IconPlayerPlay size={16} />{busy ? "Reviewing evidence…" : "Run AI review"}</button>{busy ? <button className="ghost-button" type="button" onClick={cancel}>Cancel</button> : null}<span role="status">{busy ? "Collecting scoped evidence, consulting the model and checking its response." : response ? "Review saved in Agentic Studio." : "Changes are proposed for your review."}</span></div>
    {error ? <p className="ai-lifecycle-error" role="alert">{error}</p> : null}
    {response ? <div className="ai-lifecycle-result"><h4>{response.result.headline || "Review findings"}</h4><p>{response.result.response}</p>{response.result.automation_repair&&<AutomationRepairReview summary={response.result.automation_repair}/>}{response.result.quality_assessment ? <QualityEvidencePanel key={response.result.quality_assessment.snapshot_hash} report={response.result.quality_assessment} /> : null}{response.result.findings?.length ? <ul>{response.result.findings.map((finding, index) => <li key={index}><strong>{finding.title}</strong><p>{finding.detail}</p></li>)}</ul> : null}{response.result.recommendations.length ? <><h4>Recommended next steps</h4><ol>{response.result.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ol></> : null}{response.transaction?.id ? <a className="ghost-button compact" href={`/ops-telemetry?monitoring=ai&session_id=${encodeURIComponent(response.transaction.id)}`}>View model calls</a> : null}<details><summary>Sources and completion checks</summary><ul>{response.citations.map(item => <li key={item.id}>{item.label}</li>)}</ul>{response.result.verification?.checks.map(check => <p key={check.id}>{check.passed ? "Passed" : "Unmet"}: {check.label}</p>)}<p>Model: {response.result.model_execution?.effective_model || response.provenance.model} · {response.result.model_execution?.model_calls || 1} calls</p></details></div> : null}
  </section></details>;
}
