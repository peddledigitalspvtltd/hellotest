import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@hellotest/platform/frontend/src/auth/AuthContext';
import {hasPermission} from '@hellotest/platform/frontend/src/platform/lib/permissions';
import {request,toQueryString} from '@hellotest/platform/frontend/src/lib/httpClient';
import type {AutomationRepairSummary} from '@hellotest/platform/frontend/src/types';
import './QualityEvidencePanel.css';
type Check={phase:string;status:string;detail:string};
type Detail={status:string;source_current:boolean;build:string;verification:{status:string;checks:Check[]};validation:Record<string,{id:string}>|null;neighbors:Array<{id:string;title:string}>;data_sets:Array<{id:string;name:string}>;assertions:Array<{id:string;label:string}>;inventory_truncated:boolean;verification_scope?:{focused_step_order:number;total_sections:number;successor_sections:number}};
export function AutomationRepairReview({summary}:{summary:AutomationRepairSummary}) {
  const [open,setOpen]=useState(false);
  return <section className="quality-evidence-panel" aria-label="Automation repair verification"><header><div><span className="quality-evidence-eyebrow">Typed repair · Assertions preserved</span><h3>Automation repair</h3></div><span className="quality-evidence-status">{summary.status.replace(/_/g,' ')}</span></header><p>{summary.detail}</p>
    {summary.patch&&<><p>{summary.patch.rationale}</p><div className="repair-code-grid"><div><strong>Current section</strong><pre>{summary.patch.before}</pre></div><div><strong>Proposed section</strong><pre>{summary.patch.after}</pre></div></div><p className="repair-revision">Patch {summary.patch.hash}</p></>}
    {summary.id&&summary.project_id&&<details className="quality-evidence-details" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Validate and apply repair</summary>{open&&<RepairValidation id={summary.id} projectId={summary.project_id}/>}</details>}
  </section>;
}
function RepairValidation({id,projectId}:{id:string;projectId:string}) {
  const {session}=useAuth(),client=useQueryClient(),key=['automation-repair',projectId,id];
  const [neighbors,setNeighbors]=useState<string[]>([]),[negative,setNegative]=useState(''),[oracle,setOracle]=useState(''),[contract,setContract]=useState(''),[message,setMessage]=useState('');
  const can=(permission:string)=>hasPermission(session,permission,projectId);
  const allowed=['automation.view','testcase.view','run.view','result.view','data.view'].every(can);
  const query=useQuery({queryKey:key,queryFn:({signal})=>request<Detail>(`/ai/automation-repairs/${encodeURIComponent(id)}${toQueryString({project_id:projectId})}`,{signal}),enabled:allowed,retry:false,refetchInterval:15000,refetchIntervalInBackground:false});
  const action=useMutation({mutationFn:({path,body={}}:{path:string;body?:object})=>request(`/ai/automation-repairs/${encodeURIComponent(id)}/${path}`,{method:'POST',body:JSON.stringify({project_id:projectId,...body})}),onSuccess:(_,variables)=>{setMessage(variables.path==='apply'?'Repair applied. Refresh the Test Case to view its updated action.':variables.path==='validation'?'Validation Runs prepared. Check the fixture setup before starting each phase.':'Validation sent to the Test Engine. Inspect the Run for progress and runner errors.');void client.invalidateQueries({queryKey:key});},onError:error=>setMessage(error.message)});
  const detail=query.data,busy=action.isPending;
  if(!allowed)return <p>Automation, Test Case, Run, result and test data viewing permissions are required.</p>;
  return <div className="coverage-mapping-review">
    {query.isPending&&<p role="status">Loading validation evidence…</p>}{query.isError&&<p role="alert">Unable to load repair evidence. <button type="button" className="ghost-button" onClick={()=>void query.refetch()}>Retry</button></p>}
    {detail&&<>
      <p>Build {detail.build} · {detail.status.replace(/_/g,' ')}. Checks use separate Run snapshots and fresh browser sessions with healing disabled. Prepare/reset isolated application fixtures before each phase.</p>
      {detail.verification_scope&&<p>Repair focuses on step {detail.verification_scope.focused_step_order}. Verification reruns all {detail.verification_scope.total_sections} sections, including {detail.verification_scope.successor_sections} following sections and the linked before/after cases.</p>}
      {!detail.source_current&&detail.status!=='applied'&&<p role="alert">The authored Test Case changed. Generate a new proposal before validating or applying.</p>}
      {!detail.validation&&detail.source_current&&<fieldset className="release-policy-fields" disabled={busy||!can('run.create')}><legend>Verification scope</legend>
        <label>Neighboring Test Cases (optional, up to 5)<select multiple size={Math.min(5,Math.max(2,detail.neighbors.length))} value={neighbors} onChange={event=>setNeighbors(Array.from(event.target.selectedOptions,option=>option.value))}>{detail.neighbors.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Known-negative fixture<select value={negative} onChange={event=>setNegative(event.target.value)}><option value="">Choose a key/value test data set</option>{detail.data_sets.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Protected assertion<select value={oracle} onChange={event=>setOracle(event.target.value)}><option value="">Choose the assertion that must detect the invalid fixture</option>{detail.assertions.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Fixture isolation and expected negative outcome<textarea rows={3} maxLength={2000} value={contract} onChange={event=>setContract(event.target.value)} placeholder="Describe the dedicated fixture, reset procedure, known-invalid data and the assertion that should fail. Include a reference to the fixture definition."/></label>
        {detail.inventory_truncated&&<p>Showing the first 200 Test Cases and data sets.</p>}
        <button type="button" className="primary-button" disabled={!negative||!oracle||neighbors.length>5||contract.trim().length<30} onClick={()=>action.mutate({path:'validation',body:{neighbor_ids:neighbors,negative_data_set_id:negative,oracle_step_id:oracle,fixture_contract:contract}})}>Prepare validation Runs</button>
      </fieldset>}
      {detail.validation&&<><ol className="repair-validation-checks">{detail.verification.checks.map((check,index)=><li key={check.phase}><strong>{({original:'Reproduce original failure',patched:'Verify repaired case and every following step',negative:'Preserve the negative-case assertion'} as Record<string,string>)[check.phase]}</strong><span className="quality-evidence-status">{check.status}</span><p>{check.detail}</p><div className="ai-lifecycle-actions"><a href={`/executions?execution=${encodeURIComponent(detail.validation?.[check.phase]?.id||'')}`} className="ghost-button compact">Open Run</a>{detail.status!=='applied'&&can('run.execute')&&<button type="button" className="ghost-button compact" disabled={busy||!detail.source_current||check.status==='passed'||detail.verification.checks.slice(0,index).some(item=>item.status!=='passed')} onClick={()=>action.mutate({path:'start',body:{phase:check.phase}})}>Start check</button>}</div></li>)}</ol>
        {can('step.manage')&&can('testcase.update')&&detail.status!=='applied'&&<button type="button" className="primary-button" disabled={busy||!detail.source_current||detail.verification.status!=='verified'} onClick={()=>action.mutate({path:'apply'})}>Apply verified repair</button>}
      </>}
    </>}{message&&<p role={action.isError?'alert':'status'}>{message}</p>}
  </div>;
}
