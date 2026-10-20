const test=require('node:test'),assert=require('node:assert/strict');
const {reduceActivityProgress}=require('../../backend/lib/automationActivityProgress');
const {stepBuildError,providerFailureMessages}=require('../../backend/lib/automationStepBuildErrors');
const {buildFailureProgress}=require('../../backend/lib/automationBuildFailureProgress');

test('a repeated unobserved target gets safe per-step discovery guidance without claiming previous actions did not run',()=>{
 const error=stepBuildError({phase:'automation.agent.browser.failed',message:'private page payload',details:{error_code:'AUTOMATION_BROWSER_TARGET_PROPOSAL_STALLED',locator:'#private-field',provider:'private provider data'}},'now');
 assert.equal(error.code,'AUTOMATION_BROWSER_TARGET_PROPOSAL_STALLED');assert.match(error.message,/No browser action ran for that proposal/);assert.match(error.message,/current observed target reference or scoped discovery/);
 assert.doesNotMatch(JSON.stringify(error),/private page|private-field|private provider/);
});

test('step diagnostics retain typed facts without copying raw provider or browser data',()=>{
 const error=stepBuildError({phase:'automation.agent.action.failed',message:'private raw exception',details:{error_code:'BROWSER_ASSERTION_NOT_SATISFIED',tool:'browser_assert',assertion:'value',value:'private input',message:'private page text',attempt:2}},'now');
 assert.equal(error.code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.equal(error.attempt,2);assert.equal(error.assertion,'value');
 assert.doesNotMatch(JSON.stringify(error),/private/);
 assert.equal(stepBuildError({phase:'automation.agent.reasoning'},'now'),null);
});

test('known provider step errors share the exact safe actionable top-level message',()=>{
 const cases=[
  ['LLM_REQUEST_TOO_LARGE',413,/Reduce the request size/],
  ['LLM_RATE_LIMIT_REQUEST_TOO_LARGE',429,/provider token capacity/],
  ['LLM_RATE_LIMITED',429,/Wait for the provider limit to reset/],
  ['LLM_QUOTA_EXCEEDED',429,/usage and billing settings/],
  ['LLM_AUTHENTICATION_FAILED',401,/credentials, model access and base URL/]
 ];
 assert.equal(Object.isFrozen(providerFailureMessages),true);
 for(const [code,status,expected] of cases){
  const event=buildFailureProgress(Object.assign(new Error('private provider body and credentials'),{code,upstreamStatus:status,active_step_id:'active',saved_sections:2}));
  const issue=stepBuildError({...event,message:'private raw provider exception',details:{...event.details,message:'private organization data',body:'private response body'}},'now');
  assert.equal(issue.code,code);assert.equal(issue.phase,'automation.llm.failed');
  assert.equal(issue.message,event.message);assert.equal(issue.message,providerFailureMessages[code]);
  assert.match(issue.message,expected);assert.match(issue.message,/Previously saved Plan sections remain available/);
  assert.doesNotMatch(JSON.stringify(issue),/private|browser evidence/);
 }
});

test('unknown provider codes keep a safe generic step fallback without copying provider text',()=>{
 const issue=stepBuildError({phase:'automation.llm.failed',message:'private provider text',details:{error_code:'LLM_UNRECOGNIZED_PROVIDER_FAILURE',message:'private credentials',body:'private provider body'}},'now');
 assert.equal(issue.code,'LLM_UNRECOGNIZED_PROVIDER_FAILURE');
 assert.equal(issue.message,'This section could not finish building. Review its browser evidence and model request and response.');
 assert.doesNotMatch(JSON.stringify(issue),/private|credentials/);
});

test('public diagnostics preserve a real action identity and reject arbitrary action-id text',()=>{
 const actionId='1f1e6a29-8d5b-46b8-a621-bf561c3bd914';
 const error=stepBuildError({phase:'automation.agent.action.failed',details:{action_id:actionId,error_code:'BROWSER_ASSERTION_NOT_SATISFIED',tool:'browser_assert',assertion:'value'}},'now');
 assert.equal(error.action_id,actionId);assert.match(error.id,new RegExp(actionId));
 const unsafe=stepBuildError({phase:'automation.agent.action.failed',details:{action_id:'private text in a log id',error_code:'BROWSER_ASSERTION_NOT_SATISFIED'}},'now');
 assert.equal(unsafe.action_id,undefined);assert.doesNotMatch(JSON.stringify(unsafe),/private text/);
});

test('unsupported field assertions explain the control and association prerequisite without copying page data',()=>{
 const details={tool:'browser_assert',error_code:'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED',assertion:'field_valid',message:'private browser text',value:'private password',locator:'#private-target'};
 const field=stepBuildError({phase:'automation.agent.action.failed',details},'now');
 assert.match(field.message,/accessible hints and errors/);
 assert.match(field.message,/missing or duplicate/);
 assert.doesNotMatch(JSON.stringify(field),/private/);
 const other=stepBuildError({phase:'automation.agent.action.failed',details:{...details,assertion:'valid'}},'now');
 assert.match(other.message,/control type/);assert.doesNotMatch(other.message,/duplicate associations/);
 const unmet=stepBuildError({phase:'automation.agent.action.failed',details:{...details,error_code:'BROWSER_ASSERTION_NOT_SATISFIED'}},'now');
 assert.match(unmet.message,/expected-result check did not pass/);assert.doesNotMatch(unmet.message,/duplicate associations/);
});

const state=()=>({step_progress:[{test_case_id:'case',step_id:'saved',status:'completed',instruction_status:'saved'},
 {test_case_id:'case',step_id:'active',status:'in_progress',instruction_status:'requested'},
 {test_case_id:'case',step_id:'future',status:'queued',instruction_status:'pending'},
 {test_case_id:'other',step_id:'active',status:'in_progress',instruction_status:'requested'}],manual_step_progress:[
 {test_case_id:'case',manual_step_id:'m-current',section_step_id:'active',status:'in_progress'},
 {test_case_id:'case',manual_step_id:'m-future',status:'queued'}]});

test('provider diagnostics reach only the unfinished step and retain the safe provider reason',()=>{
 const event=buildFailureProgress(Object.assign(new Error('private provider response'),{code:'LLM_REQUEST_TOO_LARGE',active_step_id:'active',active_manual_step_ids:['m-current'],saved_sections:1}));
 const progress=reduceActivityProgress(state(),{...event,details:{...event.details,test_case_id:'case'}});
 assert.equal(progress.step_progress[1].build_errors[0].message,event.message);
 assert.equal(progress.manual_step_progress[0].build_errors[0].message,event.message);
 assert.equal(progress.step_progress[0].status,'completed');assert.equal(progress.step_progress[0].build_errors,undefined);
 assert.equal(progress.step_progress[2].status,'queued');assert.equal(progress.step_progress[2].build_errors,undefined);
 assert.equal(progress.step_progress[3].build_errors,undefined);assert.doesNotMatch(JSON.stringify(progress),/private/);
});

test('terminal errors are attributed only to current work and leave future work queued',()=>{
 const event=buildFailureProgress(Object.assign(new Error('private raw browser error'),{code:'AUTOMATION_BROWSER_EXECUTION_INCOMPLETE',active_step_id:'active',active_manual_step_ids:['m-current']}),{modelStarted:true});
 const progress=reduceActivityProgress(state(),{...event,details:{...event.details,test_case_id:'case'}});
 assert.equal(progress.step_progress[1].build_errors.length,1);assert.equal(progress.step_progress[1].status,'needs_attention');
 assert.equal(progress.step_progress[0].build_errors,undefined);assert.equal(progress.step_progress[2].status,'queued');assert.equal(progress.step_progress[2].build_errors,undefined);
 assert.equal(progress.step_progress[3].build_errors,undefined);assert.equal(progress.manual_step_progress[0].build_errors.length,1);assert.equal(progress.manual_step_progress[1].status,'queued');
 assert.doesNotMatch(JSON.stringify(progress),/private raw/);
});

test('saving resolves retained errors and duplicate events do not duplicate the step record',()=>{
 const event={phase:'automation.agent.output.invalid',details:{test_case_id:'case',active_step_id:'active',error_code:'AUTOMATION_GENERATED_SOURCE_INVALID',updated_at:'2026-10-16T10:00:00Z'}};
 const first=reduceActivityProgress(state(),event),duplicate=reduceActivityProgress(first,event);
 assert.equal(duplicate.step_progress[1].build_errors.length,1);
 const saved=reduceActivityProgress(duplicate,{phase:'automation.agent.section.saved',details:{test_case_id:'case',step_id:'active',development_status:'completed',updated_at:'2026-10-16T10:01:00Z'}});
 assert.equal(saved.step_progress[1].build_errors[0].resolved_at,'2026-10-16T10:01:00Z');assert.equal(first.step_progress[1].build_errors[0].resolved_at,undefined);
 assert.equal(saved.manual_step_progress[0].build_errors[0].resolved_at,'2026-10-16T10:01:00Z');
});

test('semantic review gaps stay on the active step and resolve only after its validated save',()=>{
 const event={phase:'automation.agent.semantic.rejected',message:'private reviewer text',details:{test_case_id:'case',active_step_id:'active',active_manual_step_ids:['m-current'],error_code:'AUTOMATION_SEMANTIC_REVIEW_REJECTED',issues:[{message:'private page content'}],updated_at:'2026-10-17T10:00:00Z'}};
 const rejected=reduceActivityProgress(state(),event);
 assert.equal(rejected.step_progress[1].status,'in_progress');
 assert.equal(rejected.step_progress[1].build_errors[0].code,'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
 assert.equal(rejected.manual_step_progress[0].build_errors[0].code,'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
 assert.equal(rejected.step_progress[0].build_errors,undefined);
 assert.equal(rejected.step_progress[2].build_errors,undefined);
 assert.doesNotMatch(JSON.stringify(rejected),/private/);
 const saved=reduceActivityProgress(rejected,{phase:'automation.agent.section.saved',details:{test_case_id:'case',step_id:'active',updated_at:'2026-10-17T10:01:00Z'}});
 assert.equal(saved.step_progress[1].build_errors[0].resolved_at,'2026-10-17T10:01:00Z');
 assert.equal(saved.manual_step_progress[0].build_errors[0].resolved_at,'2026-10-17T10:01:00Z');
});

test('semantic diagnostics retain only allowlisted issue identities and native coverage facts',()=>{
 const issues=[{code:'expected_result_not_covered',obligation_id:'manual:source:email',message:'private reviewer rationale',value:'private input'},
  {code:'expected_result_not_covered',obligation_id:'manual:source:email'},
  {code:'invented_private_classification',obligation_id:'active'},
  {code:'unrelated_assertion',obligation_id:'private\npage text'}];
 const event={phase:'automation.agent.semantic.rejected',details:{active_step_id:'active',semantic_issues:issues,requirement:'independent_field_validation_predicate'}};
 const error=stepBuildError(event,'now');
 assert.deepEqual(error.semantic_issues,[{code:'expected_result_not_covered',obligation_id:'manual:source:email'}]);
 assert.equal(error.semantic_requirement,'independent_field_validation_predicate');
 assert.doesNotMatch(JSON.stringify(error),/private|rationale|value/);
 const failed=buildFailureProgress(Object.assign(new Error('private stop reason'),{code:'AUTOMATION_SEMANTIC_REVIEW_STALLED',active_step_id:'active',details:event.details}),{modelStarted:true});
 assert.deepEqual(failed.details.semantic_issues,error.semantic_issues);
 assert.equal(failed.details.requirement,'independent_field_validation_predicate');
 assert.doesNotMatch(JSON.stringify(failed),/private|rationale|value/);
 const retained=reduceActivityProgress(state(),{...failed,details:{...failed.details,test_case_id:'case'}});
 assert.deepEqual(retained.step_progress[1].build_errors[0].semantic_issues,error.semantic_issues);
 assert.equal(stepBuildError({phase:'automation.agent.action.failed',details:event.details},'now').semantic_issues,undefined);
});
