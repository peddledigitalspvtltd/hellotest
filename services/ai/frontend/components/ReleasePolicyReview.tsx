import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@hellotest/platform/frontend/src/auth/AuthContext';
import { hasPermission } from '@hellotest/platform/frontend/src/platform/lib/permissions';
import { request, toQueryString } from '@hellotest/platform/frontend/src/lib/httpClient';
import type { QualityEvidenceReport } from '@hellotest/platform/frontend/src/types';

type Policy = {name:string;minimum_completed_attempts:number;max_evidence_age_hours:number;waivable_gates:string[]};
type Record = {version:number;policy:Policy;rationale:string;approved_at:string};
export function ReleasePolicyReview({report}:{report:QualityEvidenceReport}) {
  const projectId=report.scope.project_id!,{session}=useAuth(),client=useQueryClient();
  const [draft,setDraft]=useState<Policy|null>(null),[reason,setReason]=useState(''),[gateId,setGateId]=useState(''),[reference,setReference]=useState(''),[expiry,setExpiry]=useState(''),[exceptionReason,setExceptionReason]=useState('');
  const [message,setMessage]=useState('');
  const canView=hasPermission(session,'quality_gate.view',projectId),canApprove=hasPermission(session,'quality_gate.update',projectId);
  const query=useQuery({queryKey:['release-policy',projectId],queryFn:({signal})=>request<{policy:Record|null}>(`/ai/release-policy${toQueryString({project_id:projectId})}`,{signal}),enabled:canView,retry:false});
  const current=query.data?.policy,policy=draft||current?.policy||{name:'Project release policy',minimum_completed_attempts:1,max_evidence_age_hours:24,waivable_gates:[]};
  const edit=(patch:Partial<Policy>)=>{setDraft({...policy,...patch});setMessage('');};
  const save=useMutation({mutationFn:()=>request('/ai/release-policy',{method:'POST',body:JSON.stringify({project_id:projectId,expected_version:current?.version||0,policy,rationale:reason})}),onSuccess:()=>{setDraft(null);setReason('');setMessage('Policy version approved. Run a fresh review to evaluate it.');void client.invalidateQueries({queryKey:['release-policy',projectId]});},onError:error=>setMessage(error.message)});
  const gate=report.data.gates?.find(item=>item.id===gateId);
  const waiver=useMutation({mutationFn:(decision:string)=>request('/ai/release-waivers',{method:'POST',body:JSON.stringify({...report.scope,policy_version:report.data.policy_version,gate_id:gateId,evidence_hash:gate?.evidence_hash,reference,rationale:exceptionReason,expires_at:new Date(expiry).toISOString(),decision})}),onSuccess:()=>{setExceptionReason('');setMessage('Exception decision recorded. Run a fresh review; failures remain in the evidence history.');},onError:error=>setMessage(error.message)});
  const scoped=Boolean(report.scope.release_id&&report.scope.build&&report.scope.environment_id&&!report.scope.story_id&&!report.scope.test_case_id&&!report.scope.app_type_id&&!report.scope.execution_id);
  const eligible=report.data.gates?.filter(item=>['fail','waived'].includes(item.status)&&current?.policy.waivable_gates.includes(item.id))||[];
  const busy=save.isPending||waiver.isPending;
  return <section className="coverage-mapping-review" aria-label="Release policy and exceptions">
    <p>Approved policies set project release requirements. Exceptions apply to a recorded failure, exact release, build, environment and evidence revision. Unknown evidence cannot be waived.</p>
    {!canView?<p>Quality Gate viewing permission is required.</p>:query.isPending?<p role="status">Loading release policy…</p>:query.isError?<p role="alert">Unable to load the policy. <button type="button" className="ghost-button" onClick={()=>void query.refetch()}>Retry</button></p>:<>
      <p>{current?`Approved version ${current.version} · ${new Date(current.approved_at).toLocaleString()}`:'No project release policy has been approved.'}</p>
      {canApprove?<><fieldset disabled={busy} className="release-policy-fields"><legend>Release requirements</legend>
        <label>Policy name<input value={policy.name} maxLength={120} onChange={event=>edit({name:event.target.value})}/></label>
        <div className="ai-lifecycle-controls"><label>Minimum completed attempts<input type="number" min={1} max={100000} value={policy.minimum_completed_attempts} onChange={event=>edit({minimum_completed_attempts:Number(event.target.value)})}/></label><label>Maximum evidence age (hours)<input type="number" min={1} max={720} value={policy.max_evidence_age_hours} onChange={event=>edit({max_evidence_age_hours:Number(event.target.value)})}/></label></div>
        <p>Gates eligible for an explicit human exception</p>{[['blocking-defects','Recorded critical Defects'],['execution-outcomes','Recorded execution failures']].map(([id,title])=><label key={id} className="release-policy-check"><input type="checkbox" checked={policy.waivable_gates.includes(id)} onChange={event=>edit({waivable_gates:event.target.checked?[...policy.waivable_gates,id]:policy.waivable_gates.filter(key=>key!==id)})}/>{title}</label>)}
        <label>Approval rationale<textarea rows={2} value={reason} minLength={20} maxLength={2000} onChange={event=>setReason(event.target.value)} placeholder="Explain the release requirements and the authority for approving this policy."/></label>
        <button type="button" className="primary-button" disabled={reason.trim().length<20||!policy.name.trim()} onClick={()=>save.mutate()}>{save.isPending?'Approving…':'Approve new policy version'}</button>
      </fieldset></>:current?<p>{current.policy.name} · At least {current.policy.minimum_completed_attempts} completed attempts · Evidence age up to {current.policy.max_evidence_age_hours} hours</p>:null}
      {canApprove&&current&&<fieldset disabled={busy} className="release-policy-fields"><legend>Scoped exception</legend>
        {!scoped?<p>Run a release-wide assessment with an exact build and environment before approving an exception.</p>:current.version!==report.data.policy_version?<p>The policy changed. Run a fresh release review before approving an exception.</p>:!eligible.length?<p>No recorded failures in this assessment are eligible for an exception.</p>:<>
          <label>Recorded gate<select value={gateId} onChange={event=>setGateId(event.target.value)}><option value="">Choose a recorded failure</option>{eligible.map(item=><option key={item.id} value={item.id}>{item.label} · {item.status}</option>)}</select></label>
          <div className="ai-lifecycle-controls"><label>Approval / issue reference<input value={reference} maxLength={255} onChange={event=>setReference(event.target.value)}/></label><label>Exception expiry<input type="datetime-local" value={expiry} onChange={event=>setExpiry(event.target.value)}/></label></div>
          <label>Exception rationale<textarea rows={2} value={exceptionReason} maxLength={2000} onChange={event=>setExceptionReason(event.target.value)} placeholder="Explain the known failure, accepted exposure, and follow-up owner."/></label>
          <button type="button" className="primary-button" disabled={!gate?.evidence_hash||!reference.trim()||!expiry||exceptionReason.trim().length<20} onClick={()=>waiver.mutate(gate?.status==='waived'?'revoked':'approved')}>{waiver.isPending?'Recording…':gate?.status==='waived'?'Withdraw exception':'Approve scoped exception'}</button>
        </>}
      </fieldset>}
    </>}{message&&<p role={save.isError||waiver.isError?'alert':'status'}>{message}</p>}
  </section>;
}
