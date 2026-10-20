import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { automationActivityBrowserMetadata, automationActivityFailureReasons, automationActivityPollingDelay, automationActivityStepErrors, automationSemanticIssueMessage } from '../../frontend/lib/automationActivityMonitoring.ts';
const require = createRequire(import.meta.url);
const { reduceActivityProgress } = require('../../backend/lib/automationActivityProgress');
const { buildFailureProgress } = require('../../backend/lib/automationBuildFailureProgress');

test('semantic review diagnostics identify authorized unmet requirements without provider rationale and merge the unchanged stop',()=>{
 const issue={code:'expected_result_not_covered',obligation_id:'manual:source:email'};
 const details={test_case_id:'at',active_step_id:'one',semantic_issues:[{...issue,message:'private model rationale'},
  {code:'unrelated_assertion',obligation_id:'manual:other:email'}, {code:'private message as code',obligation_id:'one'}],requirement:'independent_field_validation_predicate',attempt:2};
 const rejected={id:'rejected',level:'warning',phase:'automation.agent.semantic.rejected',message:'Review the unsupported manual result.',details:{...details,error_code:'AUTOMATION_SEMANTIC_REVIEW_REJECTED'}};
 const stopped={id:'stopped',level:'error',phase:'automation.agent.browser.failed',message:'The same rejected evidence was resubmitted.',details:{...details,error_code:'AUTOMATION_SEMANTIC_REVIEW_STALLED'}};
 let metadata={step_progress:[{test_case_id:'at',step_id:'one',status:'in_progress'}],manual_step_progress:[{test_case_id:'at',manual_test_case_id:'source',manual_step_id:'email',section_step_id:'one'}]};
 for(const event of [rejected,stopped])metadata={...metadata,...reduceActivityProgress(metadata,event)};
 const before=structuredClone(metadata),errors=automationActivityStepErrors(metadata,[rejected,stopped]);
 assert.equal(errors.length,1);assert.equal(errors[0].code,'AUTOMATION_SEMANTIC_REVIEW_STALLED');
 assert.deepEqual(errors[0].semantic_issues,[issue]);assert.equal(errors[0].semantic_requirement,'independent_field_validation_predicate');
 assert.match(automationSemanticIssueMessage(issue,errors[0].semantic_requirement),/validation status/);
 assert.match(automationSemanticIssueMessage({code:'unrelated_assertion',obligation_id:'one'}),/different outcome/);
 assert.doesNotMatch(JSON.stringify(errors),/private|model rationale|manual:other/);
 assert.deepEqual(metadata,before,'display projection does not rewrite retained activity');
 const eventsOnly=automationActivityStepErrors({...metadata,step_progress:[{test_case_id:'at',step_id:'one'}]},[rejected]);
 assert.equal(eventsOnly.length,1);assert.deepEqual(eventsOnly[0].semantic_issues,[issue]);
});

test('historical case-failed headers join the actual terminal cause while retaining its separate failed browser check',()=>{
  const metadata={step_progress:[{test_case_id:'case',step_id:'step',status:'needs_attention',build_errors:[
    {id:'automation.agent.action.failed:11111111-1111-4111-8111-111111111111:time',phase:'automation.agent.action.failed',code:'BROWSER_ASSERTION_NOT_SATISFIED',message:'The expected-result check did not pass.'},
    {id:'terminal',phase:'automation.llm.failed',code:'AUTOMATION_BUILD_INCOMPLETE',message:'This section could not finish building.'}
  ]}],case_outcomes:[{test_case_id:'case',active_step_id:'step',error:'Automation agent exceeded the browser-tool budget.'}]};
  const details={test_case_id:'case',active_step_id:'step'};
  const errors=automationActivityStepErrors(metadata,[
    {phase:'automation.llm.failed',level:'error',message:'Automation generation could not continue. Previously saved Plan sections remain available.',details},
    {phase:'automation.case.failed',level:'error',message:'Automation build failed for case case.',details}
  ]);
  assert.equal(errors.length,2);assert.equal(errors.filter(error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED').length,1);
  assert.ok(errors.some(error=>error.message==='Automation agent exceeded the browser-tool budget.'));
  assert.ok(!errors.some(error=>error.message.startsWith('Automation build failed for case')));
});

test('monitoring bridges initial missing receipts, discovers latest builds briefly and bounds automatic polling', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.equal(automationActivityPollingDelay(null, true, now, now), 3000);
  assert.equal(automationActivityPollingDelay(null, true, now, now + 30_000), false);
  assert.equal(automationActivityPollingDelay({ status: 'failed', metadata: {} }, false, now, now), 15_000);
  assert.equal(automationActivityPollingDelay({ status: 'failed', metadata: {} }, true, now, now), false);
  assert.equal(automationActivityPollingDelay({ status: 'running', metadata: {} }, false, now, now), 3000);
  assert.equal(automationActivityPollingDelay({ status: 'running', metadata: {} }, false, now, now + 15 * 60_000), false);
  assert.equal(automationActivityPollingDelay({ status: 'queued', metadata: { scheduled_at: '2026-10-18T12:00:00Z' } }, true, now, now), 60_000);
});

test('failure reasons explain the selected case and keep dependency details in their existing disclosure', () => {
  const metadata = { case_outcomes: [{ test_case_id: 'one', message: 'Model response omitted the active section.', code: 'AI_INVALID_RESPONSE' }, { test_case_id: 'two', message: 'A mailbox is required.', code: 'AUTOMATION_DEPENDENCY_MISSING' }] };
  assert.deepEqual(automationActivityFailureReasons(metadata, 'one'), ['Model response omitted the active section.']);
  assert.deepEqual(automationActivityFailureReasons({ ...metadata, error: 'A mailbox is required.' }, 'two'), []);
  assert.deepEqual(automationActivityFailureReasons({ error: 'The provider connection could not be established.' }, 'one'), ['The provider connection could not be established.']);
});

test('legacy browser launch logs become a concise setup explanation without exposing command arguments', () => {
  const raw = 'browserType.launch: Target page, context or browser has been closed. Browser logs: --user-data-dir=/tmp/private-profile --argument=private-value';
  const reasons = automationActivityFailureReasons({ case_outcomes: [{ test_case_id: 'one', message: raw }] }, 'one');
  assert.deepEqual(reasons, ['Browser could not start before generation. Check Test Engine and retry.']);
  assert.doesNotMatch(JSON.stringify(reasons), /browserType|private-profile|private-value/);
  assert.deepEqual(automationActivityFailureReasons({ error: 'A required source is unavailable.' }, 'one'), ['A required source is unavailable.']);
});

test('durable step failures merge with scoped events and leave the case banner empty without dropping resolved history', () => {
  const message = 'The email input was not available on the observed page.';
  const metadata = { error:message,step_progress:[{test_case_id:'at',step_id:'one',status:'needs_attention',build_errors:[{id:'failure-one',code:'BROWSER_TARGET_NOT_FOUND',message,phase:'automation.agent.action.failed',attempt:2,resolved_at:'2026-10-17T12:01:00Z'}]}],case_outcomes:[{test_case_id:'at',active_step_id:'one',code:'BROWSER_TARGET_NOT_FOUND',message}] };
  const events=[{level:'error',phase:'automation.agent.action.failed',message,details:{test_case_id:'at',active_step_id:'one',error_code:'BROWSER_TARGET_NOT_FOUND'}}];
  const errors=automationActivityStepErrors(metadata,events);
  assert.equal(errors.length,1);assert.equal(errors[0].id,'failure-one');assert.equal(errors[0].resolved_at,'2026-10-17T12:01:00Z');
  assert.deepEqual(automationActivityFailureReasons(metadata,'at',errors),[]);
});

test('manual-source views recognize the mapped AT outcome even when historical source_test_case_id is absent', () => {
  const metadata={error:'The active browser action failed.',manual_step_progress:[{test_case_id:'at',manual_test_case_id:'manual',manual_step_id:'m1',section_step_id:'one'}],step_progress:[{test_case_id:'at',step_id:'one',build_errors:[{message:'The active browser action failed.',code:'BROWSER_FAILED'}]}],case_outcomes:[{test_case_id:'at',active_step_id:'one',message:'The active browser action failed.',code:'BROWSER_FAILED'}]};
  const errors=automationActivityStepErrors(metadata);
  assert.deepEqual(automationActivityFailureReasons(metadata,'manual',errors),[]);
  assert.deepEqual(automationActivityFailureReasons({...metadata,case_outcomes:[{test_case_id:'at',message:'A case-wide setup issue.'}]},'manual'),['A case-wide setup issue.']);
});

test('generic historical case failures are never attributed to every pending or needs-attention step', () => {
  const message='Browser inspection could not continue.';
  const metadata={step_progress:[{test_case_id:'at',step_id:'one',status:'needs_attention'},{test_case_id:'at',step_id:'two',status:'queued'}],case_outcomes:[{test_case_id:'at',message,code:'AUTOMATION_BROWSER_INSPECTION_FAILED'}]};
  assert.deepEqual(automationActivityStepErrors(metadata),[]);
  assert.deepEqual(automationActivityFailureReasons(metadata,'at'),[message]);
  metadata.step_progress[0].status='in_progress';
  const errors=automationActivityStepErrors(metadata);assert.equal(errors.length,1);assert.equal(errors[0].step_id,'one');
  assert.deepEqual(automationActivityFailureReasons(metadata,'at',errors),[]);
});

test('scoped dependency failures preserve required references and ignore unknown step attribution', () => {
  const metadata={step_progress:[{test_case_id:'at',step_id:'one'}],case_outcomes:[{test_case_id:'at',code:'AUTOMATION_DEPENDENCY_MISSING',blocked_steps:[{step_id:'one',reason:'A mailbox is needed.',required_context:['Test mailbox'],required_parameters:['@t.email']},{step_id:'unknown',reason:'Global account setup is needed.'}]}]};
  const errors=automationActivityStepErrors(metadata);assert.equal(errors.length,1);
  assert.equal(errors[0].step_id,'one');assert.deepEqual(errors[0].required_parameters,['@t.email']);assert.deepEqual(errors[0].required_context,['Test mailbox']);
});

test('fallback browser action failures reveal no tool arguments, private payload or guessed URL', () => {
  const metadata={step_progress:[{test_case_id:'at',step_id:'one',browser_actions:[{action_id:'failed-fill',tool:'browser_fill',status:'failed',arguments:{password:'private-value'},response:{source:'private-source'}}]}]};
  const errors=automationActivityStepErrors(metadata);
  assert.equal(errors.length,1);assert.equal(errors[0].tool,'browser_fill');assert.match(errors[0].message,/browser action failed/);
  assert.doesNotMatch(JSON.stringify(errors),/private-value|private-source|arguments|password/);
  const raw='browserType.launch: failed --user-data-dir=/tmp/private-profile';
  const legacy=automationActivityStepErrors({step_progress:[{test_case_id:'at',step_id:'one'}]},[{level:'error',phase:'automation.agent.browser.failed',message:raw,details:{test_case_id:'at',active_step_id:'one',raw_provider_response:'private-model'}}]);
  assert.equal(legacy[0].message,'Browser could not start before generation. Check Test Engine and retry.');
  assert.doesNotMatch(JSON.stringify(legacy),/private-profile|private-model/);
});

const firstAction='1f1e6a29-8d5b-46b8-a621-bf561c3bd914';
const secondAction='7927d780-c104-4bdf-af71-d6f65114b698';
const assertionMessage='The expected-result check did not pass. Review the current browser evidence and model response.';
const genericTerminal='This section could not finish building. Review its browser evidence and model request and response.';
const errorEvent=(phase,message,details)=>({id:`event-${phase}-${details.action_id||details.error_code||'terminal'}`,level:'error',phase,message,created_at:'2026-10-17T12:00:00Z',details:{test_case_id:'at',active_step_id:'one',...details}});

test('one browser failure appears once across a durable record and a differently worded event, including historical encoded action ids',()=>{
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',build_errors:[{id:`automation.agent.action.failed:${firstAction}:2026-10-17T12:00:00Z`,code:'BROWSER_ASSERTION_NOT_SATISFIED',message:assertionMessage,phase:'automation.agent.action.failed',tool:'browser_assert',assertion:'value'}]}]};
 const events=[errorEvent('automation.agent.action.failed','Browser assert: failed.',{action_id:firstAction,tool:'browser_assert',assertion:'value',error_code:'BROWSER_ASSERTION_NOT_SATISFIED'})];
 const errors=automationActivityStepErrors(metadata,events);
 assert.equal(errors.length,1);assert.equal(errors[0].action_id,firstAction);assert.equal(errors[0].assertion,'value');assert.equal(errors[0].message,assertionMessage);
});

test('distinct failed actions remain separate while terminal wrappers and the outcome retain one actual terminal cause',()=>{
 const code='AUTOMATION_BROWSER_TOOL_BUDGET',cause='The browser interaction budget was exhausted while this section was unfinished.';
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',build_errors:[
  ...[firstAction,secondAction].map((action_id,index)=>({id:`durable-${index}`,action_id,code:'BROWSER_ASSERTION_NOT_SATISFIED',message:assertionMessage,phase:'automation.agent.action.failed',tool:'browser_assert',assertion:index?'visible':'value'})),
  {id:'durable-terminal',code,message:genericTerminal,phase:'automation.agent.browser.failed'}
 ]}],case_outcomes:[{test_case_id:'at',active_step_id:'one',code,message:cause}]};
 const events=[... [firstAction,secondAction].map(action_id=>errorEvent('automation.agent.action.failed','Browser assert: failed.',{action_id,tool:'browser_assert',error_code:'BROWSER_ASSERTION_NOT_SATISFIED'})),
  errorEvent('automation.agent.browser.failed','Browser inspection could not continue. Previously saved Plan sections were retained; review the browser failure before retrying.',{error_code:code}),
  errorEvent('automation.failed',cause,{error_code:code})];
 const errors=automationActivityStepErrors(metadata,events);
 assert.equal(errors.length,3);assert.equal(errors.filter(error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED').length,2);
 assert.equal(errors.find(error=>error.code===code).message,cause);
});

test('legacy terminal wrappers merge with an untyped outcome without swallowing independent provider or network failures',()=>{
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',build_errors:[{id:'terminal',code:'AUTOMATION_BUILD_INCOMPLETE',message:genericTerminal,phase:'automation.llm.failed'}]}],case_outcomes:[{test_case_id:'at',active_step_id:'one',message:'Automation agent exceeded the browser-tool budget.'}]};
 const events=[errorEvent('automation.llm.failed','Automation generation could not continue. Previously saved Plan sections remain available; review the reported issue before retrying.',{}),errorEvent('automation.failed','Automation agent exceeded the browser-tool budget.',{})];
 const merged=automationActivityStepErrors(metadata,events);assert.equal(merged.length,1);assert.equal(merged[0].message,'Automation agent exceeded the browser-tool budget.');
 const independent=automationActivityStepErrors({...metadata,case_outcomes:[{test_case_id:'at',active_step_id:'one',message:'A separate provider connection failed.'}]},events);
 assert.equal(independent.length,2);assert.ok(independent.some(error=>error.message==='A separate provider connection failed.'));
 const typed=automationActivityStepErrors({step_progress:[{test_case_id:'at',step_id:'one'}]},[
  errorEvent('automation.llm.failed','The provider rejected the completion.',{error_code:'LLM_PROVIDER_REJECTED'}),
  errorEvent('automation.agent.browser.failed','The browser connection was lost.',{error_code:'BROWSER_CONNECTION_LOST'})]);
 assert.equal(typed.length,2);
});

test('resolved durable failures and historical event-only failures remain resolved when the section is saved',()=>{
 const resolvedAt='2026-10-17T12:01:00Z';
 const durable={id:'durable',action_id:firstAction,code:'BROWSER_ASSERTION_NOT_SATISFIED',message:assertionMessage,phase:'automation.agent.action.failed',resolved_at:resolvedAt};
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',instruction_status:'saved',saved_at:resolvedAt,build_errors:[durable]}]};
 const events=[errorEvent('automation.agent.action.failed','Browser assert: failed.',{action_id:firstAction,error_code:'BROWSER_ASSERTION_NOT_SATISFIED'})];
 const errors=automationActivityStepErrors(metadata,events);assert.equal(errors.length,1);assert.equal(errors[0].resolved_at,resolvedAt);
 const historical=automationActivityStepErrors({step_progress:[{test_case_id:'at',step_id:'one',instruction_status:'saved',updated_at:resolvedAt}]},events);
 assert.equal(historical.length,1);assert.equal(historical[0].resolved_at,resolvedAt);assert.equal(durable.resolved_at,resolvedAt);
});

test('separate terminal attempts and failed browser action fallbacks are retained alongside a terminal summary',()=>{
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',browser_actions:[{action_id:firstAction,tool:'browser_assert',status:'failed'}]}]};
 const events=[errorEvent('automation.llm.failed','The provider connection timed out.',{attempt:1,error_code:'LLM_TIMEOUT'}),errorEvent('automation.llm.failed','The provider connection timed out.',{attempt:2,error_code:'LLM_TIMEOUT'})];
 const errors=automationActivityStepErrors(metadata,events);
 assert.equal(errors.length,3);assert.deepEqual(errors.filter(error=>error.code==='LLM_TIMEOUT').map(error=>error.attempt),[1,2]);
 assert.equal(errors.find(error=>error.action_id===firstAction).tool,'browser_assert');
});

test('an outcome repeating a typed browser cause joins the last matching action without collapsing earlier checks',()=>{
 const cause='The final expected browser condition was not satisfied.';
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',build_errors:[firstAction,secondAction].map(action_id=>({id:action_id,action_id,code:'BROWSER_ASSERTION_NOT_SATISFIED',message:assertionMessage,phase:'automation.agent.action.failed',tool:'browser_assert'}))}],case_outcomes:[{test_case_id:'at',active_step_id:'one',code:'BROWSER_ASSERTION_NOT_SATISFIED',message:cause}]};
 const errors=automationActivityStepErrors(metadata);
 assert.equal(errors.length,2);assert.equal(errors[0].message,assertionMessage);
 assert.equal(errors[1].action_id,secondAction);assert.equal(errors[1].message,cause);
});

test('the browser budget progress wrapper merges with its detailed terminal outcome while the original assertion stays visible',()=>{
 const code='AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED',cause='The browser tool budget was reached before this section completed. Latest observed issue: The observed locator matches 0 elements. Choose a different locator from the current page evidence.';
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',build_errors:[
  {id:`automation.agent.action.failed:${firstAction}:now`,code:'BROWSER_ASSERTION_NOT_SATISFIED',message:assertionMessage,phase:'automation.agent.action.failed'},
  {id:'terminal-budget',code,message:genericTerminal,phase:'automation.agent.browser.failed'}
 ]}],case_outcomes:[{test_case_id:'at',active_step_id:'one',code,message:cause}]};
 const events=[errorEvent('automation.agent.action.failed','Browser assert: failed.',{action_id:firstAction,error_code:'BROWSER_ASSERTION_NOT_SATISFIED'}),
  errorEvent('automation.agent.browser.failed','The browser tool budget was reached before this section completed. Review the last unsuccessful browser check; completed Plan sections remain saved.',{error_code:code}),
  errorEvent('automation.case.failed','Automation build failed for case at.',{error_code:code})];
 const errors=automationActivityStepErrors(metadata,events);
 assert.equal(errors.length,2);assert.equal(errors.find(error=>error.code===code).message,cause);
});

test('stalled recovery retains two real failed checks and one typed terminal cause across all public projections',()=>{
 let metadata={step_progress:[{test_case_id:'at',step_id:'one',status:'in_progress',instruction_status:'requested'}]};
 const events=[];
 const emit=(event,time)=>{
  const row={...event,id:`record-${events.length}`,created_at:time,details:{...event.details,test_case_id:'at',active_step_id:'one',updated_at:time}};
  events.push(row);metadata={...metadata,...reduceActivityProgress(metadata,row)};
 };
 for(const [index,action_id]of [firstAction,secondAction].entries())emit({phase:'automation.agent.action.failed',message:'Browser assert: failed.',
  details:{action_id,tool:'browser_assert',assertion:'text',error_code:'BROWSER_ASSERTION_NOT_SATISFIED',attempt:2}},`2026-10-17T11:03:${index?35:23}Z`);
 const cause=Object.assign(new Error('The expected-result check remains unsatisfied on the same unchanged target. The step stopped after recovery without repeating another browser operation.'),
  {code:'AUTOMATION_BROWSER_CHECK_STALLED',active_step_id:'one'});
 emit(buildFailureProgress(cause,{modelStarted:true}),'2026-10-17T11:03:40Z');
 events.push(errorEvent('automation.case.failed','Automation build failed for case at.',{error_code:cause.code}));
 metadata.case_outcomes=[{test_case_id:'at',active_step_id:'one',code:cause.code,message:cause.message}];
 const errors=automationActivityStepErrors(metadata,events);
 assert.equal(errors.length,3);
 assert.deepEqual(errors.filter(error=>error.action_id).map(error=>error.action_id),[firstAction,secondAction]);
 const terminal=errors.filter(error=>error.code===cause.code);
 assert.equal(terminal.length,1);assert.equal(terminal[0].message,cause.message);
 assert.deepEqual(automationActivityFailureReasons(metadata,'at',errors),[]);
});

test('typed terminal wrappers join only the latest matching occurrence and preserve independent primary causes and attempts',()=>{
 const code='LLM_TIMEOUT';
 const events=[
  errorEvent('automation.llm.failed','The first provider connection timed out.',{attempt:1,error_code:code}),
  errorEvent('automation.llm.failed','The second provider connection timed out.',{attempt:2,error_code:code}),
  errorEvent('automation.llm.failed','An independent evidence connection timed out.',{attempt:2,error_code:'EVIDENCE_TIMEOUT'}),
  errorEvent('automation.case.failed','Automation build failed for case at.',{error_code:code})
 ];
 const metadata={step_progress:[{test_case_id:'at',step_id:'one'}],case_outcomes:[{test_case_id:'at',active_step_id:'one',code,
  message:'The second provider request exceeded its deadline.'}]};
 const errors=automationActivityStepErrors(metadata,events);
 assert.equal(errors.length,3);
 assert.deepEqual(errors.filter(error=>error.code===code).map(error=>[error.attempt,error.message]),[
  [1,'The first provider connection timed out.'],[2,'The second provider request exceeded its deadline.']]);
 assert.equal(errors.find(error=>error.code==='EVIDENCE_TIMEOUT').message,'An independent evidence connection timed out.');
 const sameAttempt=automationActivityStepErrors({step_progress:[{test_case_id:'at',step_id:'one'}]},[
  errorEvent('automation.llm.failed','The first independent provider failed.',{attempt:1,error_code:code}),
  errorEvent('automation.llm.failed','The second independent provider failed.',{attempt:1,error_code:code})
 ]);
 assert.equal(sameAttempt.length,2,'matching codes do not merge two primary causes');
 const exactEarlier=automationActivityStepErrors({step_progress:[{test_case_id:'at',step_id:'one'}],case_outcomes:[{
  test_case_id:'at',active_step_id:'one',code,message:'The first independent provider failed.',attempt:1}]},[
  errorEvent('automation.llm.failed','The first independent provider failed.',{attempt:1,error_code:code}),
  errorEvent('automation.llm.failed','The second independent provider failed.',{attempt:1,error_code:code})
 ]);
 assert.deepEqual(exactEarlier.map(error=>error.message),['The first independent provider failed.','The second independent provider failed.']);
});

test('typed terminal deduplication does not cross step or case boundaries',()=>{
 const code='AUTOMATION_BROWSER_CHECK_STALLED';
 const metadata={step_progress:[{test_case_id:'at',step_id:'one'},{test_case_id:'at',step_id:'two'},{test_case_id:'other',step_id:'one'}],case_outcomes:[
  {test_case_id:'at',active_step_id:'one',code,message:'The first step stopped its unsuccessful check.'},
  {test_case_id:'at',active_step_id:'two',code,message:'The second step stopped its unsuccessful check.'},
  {test_case_id:'other',active_step_id:'one',code,message:'The other case stopped its unsuccessful check.'}
 ]};
 const events=[
  errorEvent('automation.agent.browser.failed','This section could not finish building.',{error_code:code}),
  {...errorEvent('automation.agent.browser.failed','This section could not finish building.',{error_code:code}),details:{test_case_id:'at',active_step_id:'two',error_code:code}},
  {...errorEvent('automation.agent.browser.failed','This section could not finish building.',{error_code:code}),details:{test_case_id:'other',active_step_id:'one',error_code:code}}
 ];
 const errors=automationActivityStepErrors(metadata,events);
 assert.equal(errors.length,3);
 assert.deepEqual(errors.map(error=>[error.test_case_id,error.step_id]),[['at','one'],['at','two'],['other','one']]);
});

test('a satisfied native assertion produces no fallback BuildError when a later section fails',()=>{
 let metadata={step_progress:[{test_case_id:'at',step_id:'one',status:'in_progress',instruction_status:'requested'},
  {test_case_id:'at',step_id:'two',status:'queued',instruction_status:'pending'}]};
 const apply=(phase,details)=>metadata={...metadata,...reduceActivityProgress(metadata,{phase,details:{test_case_id:'at',...details}})};
 apply('automation.agent.action.started',{active_step_id:'one',action_id:firstAction,tool:'browser_assert'});
 apply('automation.agent.action.completed',{active_step_id:'one',action_id:firstAction,tool:'browser_assert',assertion_outcome:'satisfied'});
 apply('automation.agent.section.saved',{step_id:'one',development_status:'completed'});
 apply('automation.agent.section.started',{step_id:'two',active_step_id:'two'});
 apply('automation.agent.action.failed',{active_step_id:'two',action_id:secondAction,tool:'browser_assert',error_code:'BROWSER_ASSERTION_NOT_SATISFIED'});
 const errors=automationActivityStepErrors(metadata);
 assert.equal(metadata.step_progress[0].browser_actions[0].status,'completed');
 assert.equal(errors.length,1);assert.equal(errors[0].step_id,'two');
 assert.ok(!errors.some(error=>error.action_id===firstAction));
});

test('historical assertion status is repaired only from its matching real completed event without mutating retained metadata',()=>{
 const action={action_id:firstAction,tool:'browser_assert',status:'failed',assertion_outcome:'satisfied',active_manual_step_ids:['m1']};
 const metadata={step_progress:[{test_case_id:'at',step_id:'one',instruction_status:'saved',browser_actions:[action]}],
  manual_step_progress:[{test_case_id:'at',manual_step_id:'m1',section_step_id:'one',browser_actions:[action]}]};
 const completed={...errorEvent('automation.agent.action.completed','Browser assert: completed.',{action_id:firstAction,tool:'browser_assert',assertion_outcome:'satisfied'}),level:'info'};
 const before=structuredClone(metadata);
 const projected=automationActivityBrowserMetadata(metadata,[completed]);
 assert.equal(projected.step_progress[0].browser_actions[0].status,'completed');
 assert.equal(projected.manual_step_progress[0].browser_actions[0].status,'completed');
 assert.deepEqual(metadata,before,'historical activity data stays byte-for-byte unchanged');
 assert.deepEqual(automationActivityStepErrors(metadata,[completed]),[],'a satisfied assertion is not a fallback build failure');
 assert.equal(automationActivityBrowserMetadata(metadata,[]),metadata,'missing original event does not manufacture success');
 for(const change of [{active_step_id:'two'},{test_case_id:'other'},{action_id:secondAction},{assertion_outcome:'not_satisfied'},
  {tool:'browser_click'},{action_outcome:'unknown'},{action_outcome:'failed'}]){
  const foreign={...completed,details:{...completed.details,...change}};
  assert.equal(automationActivityBrowserMetadata(metadata,[foreign]),metadata,JSON.stringify(change));
 }
 const failed={...completed,phase:'automation.agent.action.failed'};
 assert.equal(automationActivityBrowserMetadata(metadata,[failed]),metadata);
 const unknown={step_progress:[{test_case_id:'at',step_id:'one',browser_actions:[{...action,status:'unknown'}]}]};
 assert.equal(automationActivityBrowserMetadata(unknown,[completed]),unknown,'unknown outcomes remain unknown');
});
