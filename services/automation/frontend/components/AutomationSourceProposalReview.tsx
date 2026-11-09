import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { testingApi, type AutomationSourceProposal } from "@hellotest/testing/frontend/api.client";
import { traceApi } from "@hellotest/trace/frontend/api.client";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { AutomationOverlay } from "./AutomationOverlay";
import { AutomationInstructionPreview } from "./AutomationInstructionPreview";
import { canReviewAutomationSourceProposal, validateAutomationSourceProposal } from "../lib/automationSourceProposal";
import type { AutomationAgentInitialStep } from "./AutomationEngineerWorkspace";

export function AutomationSourceProposalReview({ projectId, testCaseId, transactionId, steps, history, working, initialStepId, integrationId, onReview }: {
  projectId: string; testCaseId: string; transactionId: string; steps: AutomationAgentInitialStep[];
  history: Array<{ id: string; created_at?: string; status: string; cancelled?: boolean }>; working: boolean; initialStepId?: string; integrationId?: string;
  onReview?: (proposal: AutomationSourceProposal) => void;
}) {
  const { session } = useAuth(), { can } = useCapabilityAccess(projectId), titleId = useId();
  const allowed = canReviewAutomationSourceProposal(session?.user.role, can);
  const eligible = steps.filter(step => (!step.test_case_id || step.test_case_id === testCaseId) && (!step.step_type || step.step_type === "web")).slice().sort((a,b) => a.step_order-b.step_order);
  const [open,setOpen] = useState(false), [stepId,setStepId] = useState("");
  const [evidenceId,setEvidenceId] = useState(transactionId), [callId,setCallId] = useState("");
  const [proposal,setProposal] = useState<AutomationSourceProposal | null>(null), [view,setView] = useState<"instructions" | "source">("instructions");
  const [busy,setBusy] = useState(false), [message,setMessage] = useState("");
  const request = useRef<AbortController | null>(null), version = useRef(0);
  const selectedStep = eligible.find(step => step.id === stepId) || eligible.find(step => step.id === initialStepId) || eligible[0];
  const scope = `${projectId}:${testCaseId}:${transactionId}:${integrationId||""}`;
  const clear = () => { version.current++;request.current?.abort();setBusy(false);setProposal(null);setMessage(""); };
  useEffect(() => {clear();setOpen(false);setEvidenceId(transactionId);setCallId("");setStepId("");}, [scope,allowed]);
  useEffect(() => () => {version.current++;request.current?.abort();}, []);
  const calls = useQuery({queryKey:["automation-source-proposal-calls",projectId,testCaseId,evidenceId,selectedStep?.id],
    enabled:Boolean(allowed&&open&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(evidenceId)&&selectedStep),retry:false,
    queryFn:async({signal})=>{
      let cursor: string | undefined; const exact = [], legacy = [];
      for(let page=0;page<3;page++){
        const result=await traceApi.llmTraces.list({project_id:projectId,session_id:evidenceId,test_case_id:testCaseId,cursor,since:new Date(Date.now()-14*86400000).toISOString()},signal);
        for (const call of result.items) {
          if (call.status === "running" || call.capture?.request_truncated) continue;
          if (call.capture?.generation_scope === "upstream_source" && call.capture.generation_section_ids?.includes(selectedStep!.id)) exact.push(call);
          // Older captures omitted upstream scope/section metadata. The service still authenticates the selected source request.
          else if (!call.capture?.generation_scope && !call.capture?.generation_section_ids?.length) legacy.push(call);
        }
        if(!result.next_cursor||exact.length>=20)break;cursor=result.next_cursor;
      }
      return {items:(exact.length?exact:legacy).slice(0,20),legacy:!exact.length&&legacy.length>0};
    }});
  if(!allowed||!transactionId||!eligible.length)return null;
  const selectedCall = callId || calls.data?.items[0]?.id || "";
  const close = () => {clear();setOpen(false);};
  const generate = async () => {
    if(busy||working||!selectedStep||!selectedCall.trim())return;
    clear();const revision=version.current,controller=new AbortController();request.current=controller;setBusy(true);
    const input={test_case_id:testCaseId,step_id:selectedStep.id,source_call_id:selectedCall.trim(),evidence_transaction_id:evidenceId.trim()||transactionId,...(integrationId?{integration_id:integrationId}:{})};
    try{
      const result=validateAutomationSourceProposal(await testingApi.testCases.proposeAutomationSectionSource(transactionId,input,controller.signal),transactionId,input);
      if(version.current===revision&&!controller.signal.aborted){setProposal(result);setView("instructions");}
    }catch(error){if(version.current===revision&&!controller.signal.aborted)setMessage(error instanceof Error?error.message:"The source proposal could not be generated.");}
    finally{if(version.current===revision)setBusy(false);}
  };
  return <><button className="ghost-button compact" type="button" disabled={working} onClick={()=>setOpen(true)}>Regenerate saved instructions from retained evidence</button>
    {open?<AutomationOverlay variant="dialog" title="Review regenerated instructions" subtitle="Generate a source proposal from retained evidence without opening a browser." onClose={close}>
      <div className="stack-list" aria-labelledby={titleId} aria-busy={busy||undefined}>
        <p id={titleId}>Unverified proposal · Not saved · No browser actions. Existing saved source stays unchanged until you review and Save in the Source editor.</p>
        <label className="form-field"><span>Section</span><select aria-label="Source proposal section" disabled={busy} value={selectedStep?.id||""} onChange={event=>{clear();setStepId(event.target.value);setCallId("");}}>{eligible.map(step=><option key={step.id} value={step.id}>Section {step.step_order}</option>)}</select></label>
        <label className="form-field"><span>Retained evidence Build</span><select aria-label="Retained evidence Build" disabled={busy} value={history.some(item=>item.id===evidenceId)||evidenceId===transactionId?evidenceId:"other"} onChange={event=>{clear();setEvidenceId(event.target.value==="other"?"":event.target.value);setCallId("");}}>
          <option value={transactionId}>Current Build · {transactionId}</option>{history.filter(item=>item.id!==transactionId).map(item=><option key={item.id} value={item.id}>{item.created_at?new Date(item.created_at).toLocaleString():item.id} · {item.cancelled?"Stopped":item.status} · {item.id}</option>)}<option value="other">Another retained Build</option>
        </select></label>
        {!history.some(item=>item.id===evidenceId)&&evidenceId!==transactionId?<label className="form-field"><span>Evidence Build ID</span><input aria-label="Evidence Build ID" disabled={busy} value={evidenceId} onChange={event=>{clear();setEvidenceId(event.target.value);setCallId("");}} maxLength={200}/></label>:null}
        {calls.data?.items.length?<label className="form-field"><span>Retained model call</span><select aria-label="Retained source model call" disabled={busy} value={selectedCall} onChange={event=>{clear();setCallId(event.target.value);}}>{calls.data.items.map(call=><option key={call.id} value={call.id}>{call.started_at?new Date(call.started_at).toLocaleTimeString():"Model call"} · {call.status} · {call.id}</option>)}</select></label>:null}
        <label className="form-field"><span>Source model call ID</span><input aria-label="Source model call ID" disabled={busy} value={selectedCall} onChange={event=>{clear();setCallId(event.target.value);}} maxLength={200}/><small>Choose the saved Source request for this section. Actor and instruction-mapping requests are rejected. Only call metadata is listed here.</small></label>
        {calls.isFetching?<p role="status">Loading retained call metadata…</p>:null}
        {calls.data?.legacy?<p role="status">Older case-level calls are listed because section references were not retained. Choose the Source request ID from Model requests and responses.</p>:null}
        <button className="primary-button" type="button" disabled={busy||working||!selectedStep||!selectedCall.trim()||!evidenceId.trim()} onClick={()=>void generate()}>{busy?"Generating proposal…":"Generate source proposal"}</button>
        {message?<p role="alert">{message}</p>:null}
        {proposal?<><p role="status">Validated source proposal · Unverified · Not saved</p><div role="tablist" aria-label="Proposed implementation format"><button role="tab" aria-selected={view==="instructions"} onClick={()=>setView("instructions")} type="button">{proposal.automation_instructions?"Mapped instructions":"Parsed instructions"}</button><button role="tab" aria-selected={view==="source"} onClick={()=>setView("source")} type="button">Source</button></div>
          <AutomationInstructionPreview sectionName={`Section ${proposal.step_order} proposal`} stepId={proposal.step_id} code={proposal.automation_code} instructionMapping={proposal.automation_instructions} view={view}/>
          {proposal.warnings?.map((warning,index)=><p key={index} role="status">{warning}</p>)}
          <div className="automation-plan-actions"><button className="ghost-button" type="button" onClick={()=>void navigator.clipboard.writeText(proposal.automation_code).then(()=>setMessage("Source copied. Review it before saving."),()=>setMessage("Copy is unavailable. Select the source text to copy it."))}>Copy proposed source</button>{onReview?<button className="primary-button" type="button" onClick={()=>{try{onReview(proposal);close();}catch(error){setMessage(error instanceof Error?error.message:"The existing Source editor could not be opened.");}}}>Review in Source editor</button>:null}</div>
        </>:null}
      </div>
    </AutomationOverlay>:null}
  </>;
}
