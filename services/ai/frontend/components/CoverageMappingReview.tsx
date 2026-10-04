import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@hellotest/platform/frontend/src/auth/AuthContext';
import { hasPermission } from '@hellotest/platform/frontend/src/platform/lib/permissions';
import { request, toQueryString, HelloTestApiError } from '@hellotest/platform/frontend/src/lib/httpClient';

type Inventory = { story_id:string;story_revision:string;obligations:Array<{id:string;text:string}>;tests:Array<{id:string;title:string;revision:string;assertions:Array<{id:string;action:string;expected_result:string;hash:string}>}>;reviews:Array<{id:string;obligation_id:string;test_case_id:string;step_id:string;decision:string;rationale:string}>;limitations:string[] };
export function CoverageMappingReview({projectId,storyId}:{projectId:string;storyId:string}) {
  const {session}=useAuth(), client=useQueryClient();
  const [criterion,setCriterion]=useState(''),[testId,setTestId]=useState(''),[stepId,setStepId]=useState(''),[rationale,setRationale]=useState(''),[decision,setDecision]=useState('approved');
  const [message,setMessage]=useState('');
  const canReview=hasPermission(session,'testcase.update',projectId);
  const query=useQuery({queryKey:['quality-coverage-mappings',projectId,storyId],queryFn:({signal})=>request<Inventory>(`/ai/coverage-mappings${toQueryString({project_id:projectId,story_id:storyId})}`,{signal}),retry:false});
  const inventory=query.data, selectedTest=inventory?.tests.find(test=>test.id===testId), selectedStep=selectedTest?.assertions.find(step=>step.id===stepId);
  const save=useMutation({mutationFn:()=>request('/ai/coverage-mappings',{method:'POST',body:JSON.stringify({project_id:projectId,story_id:storyId,story_revision:inventory?.story_revision,obligation_id:criterion,test_case_id:testId,test_revision:selectedTest?.revision,step_id:stepId,rationale,decision,request_id:crypto.randomUUID()})}),
    onSuccess:()=>{setMessage('Review saved. Run the AI review again to calculate coverage from this revision.');setRationale('');void client.invalidateQueries({queryKey:['quality-coverage-mappings',projectId,storyId]});},onError:error=>{
      setMessage(error instanceof Error?error.message:'Unable to save the assertion review.');
      if(error instanceof HelloTestApiError && error.status === 409) { setCriterion('');setStepId('');void client.invalidateQueries({queryKey:['quality-coverage-mappings',projectId,storyId]}); }
    }});
  return <section className="coverage-mapping-review" aria-label="Review assertion coverage">
    <p>Match an acceptance criterion to a specific expected result. Approval records your review of relevance and the expected behavior; execution coverage still requires a recorded attempt.</p>
    {query.isLoading&&<p role="status">Loading criteria and assertions…</p>}{query.isError&&<p role="alert">Unable to load the mapping inventory. <button className="ghost-button" type="button" onClick={()=>void query.refetch()}>Reload mappings</button></p>}
    {inventory&&<>
      {inventory.limitations.map(item=><p key={item}>{item}</p>)}
      <div className="ai-lifecycle-controls"><label>Acceptance criterion<select value={criterion} disabled={save.isPending} onChange={event=>{setCriterion(event.target.value);setMessage('');}}><option value="">Choose a criterion</option>{inventory.obligations.map(item=><option key={item.id} value={item.id}>{item.text.slice(0,160)}</option>)}</select></label>
      <label>Linked Test Case<select value={testId} disabled={save.isPending} onChange={event=>{setTestId(event.target.value);setStepId('');}}><option value="">Choose a Test Case</option>{inventory.tests.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
      <label>Assertion / expected result<select value={stepId} disabled={!selectedTest||save.isPending} onChange={event=>setStepId(event.target.value)}><option value="">Choose an assertion</option>{selectedTest?.assertions.map((item,index)=><option key={item.id} value={item.id}>{index+1}. {item.expected_result.slice(0,180)}</option>)}</select></label>
      {selectedStep&&<blockquote><strong>{selectedStep.action}</strong><p>{selectedStep.expected_result}</p></blockquote>}
      {!inventory.tests.length&&<p>No linked Test Cases are available. Link a Test Case to this Story first.</p>}
      {selectedTest&&!selectedTest.assertions.length&&<p>This Test Case has no observable expected results. Add an assertion before reviewing coverage.</p>}
      {canReview?<><div className="ai-lifecycle-controls"><label>Review decision<select value={decision} disabled={save.isPending} onChange={event=>setDecision(event.target.value)}><option value="approved">Adequately verifies this criterion</option><option value="rejected">Does not verify this criterion</option><option value="revoked">Withdraw previous approval</option></select></label></div><label>Evidence and rationale<textarea rows={3} maxLength={2000} value={rationale} disabled={save.isPending} onChange={event=>setRationale(event.target.value)} placeholder="Explain the observable signal, expected behavior, and any boundary or negative-case evidence you reviewed." /></label><button className="primary-button" type="button" disabled={!criterion||!selectedStep||rationale.trim().length<12||save.isPending} onClick={()=>save.mutate()}>{save.isPending?'Saving review…':'Save assertion review'}</button></>:<p>Test Case editing permission is required to approve or withdraw a mapping.</p>}
      {!!inventory.reviews.length&&<ul>{inventory.reviews.filter(item=>!criterion||item.obligation_id===criterion).map(item=><li key={item.id}><strong>{item.decision}</strong> · {inventory.tests.find(test=>test.id===item.test_case_id)?.title||item.test_case_id}<p>{item.rationale}</p></li>)}</ul>}
    </>}{message&&<p role={save.isError?'alert':'status'}>{message}</p>}
  </section>;
}
