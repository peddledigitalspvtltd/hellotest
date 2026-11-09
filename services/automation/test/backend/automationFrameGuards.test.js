const test=require('node:test'),assert=require('node:assert/strict');
const {stampObservation,reconcileAction,exactLinearCoverage}=require('../../backend/lib/automationActionReconciliation');
const {browserRecoveryState,recordBrowserCheck,repeatedUnsuccessfulCheck,confirmedLocatorValidation}=require('../../backend/lib/automationBrowserRecovery');
const {createAutomationSnapshotReadGuard}=require('../../backend/lib/automationSnapshotReadGuard');
const execution={required:true,step_id:'section'};
const receipt=(fields={},isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/shell',title:'Outer',...fields})}]});
const scope=(frame,document='document-one')=>({frame_path:frame,frame_url:'https://app.test/embedded',frame_document_id:document});
const page=(frame,document='document-one',changes={})=>({...scope(frame,document),scope:'body',accessibility:'- button "Continue"',partial:false,elements:[{tag:'button',text:'Continue',attributes:{id:'continue'},locators_validated:true,locator_candidates:['#continue'],displayed:true}],...changes});
const snapshot=(frame,document='document-one',changes={})=>({tool:'browser_snapshot',arguments:{frame},execution_step_id:'section',result:receipt(page(frame,document,changes))});
const action=frame=>({name:'browser_click',arguments:{frame,locator:'#continue'}});
const observed=(request,id='action-one',fields={})=>stampObservation({tool:request.name,arguments:request.arguments,execution_step_id:'section',action_id:id,result:receipt({...scope(request.arguments.frame),action_outcome:'completed',...fields})},request);
const payload=code=>({steps:[{step_id:'section',automation_code:code}]});
const reconcile=(source,request,observations)=>reconcileAction({payload:payload(source),execution,request,observations});
const source=frame=>'await page.'+frame.map(selector=>`frameLocator(${JSON.stringify(selector)})`).join('.')+'.locator("#continue").click();';

test('framed action receipts reconcile only the exact observed frame path and never alias sibling or main controls',()=>{
  const left=action(['#left']),right=action(['#right']),proof=observed(left);
  assert.deepEqual(reconcile(source(left.arguments.frame),left,[proof]),{action_id:'action-one',matching_count:1,candidate_count:1});
  assert.equal(reconcile(source(right.arguments.frame),right,[proof]),null);
  assert.equal(reconcile('await page.locator("#continue").click();',{name:'browser_click',arguments:{locator:'#continue'}},[proof]),null);
  assert.equal(exactLinearCoverage({payload:payload(source(right.arguments.frame)),execution,observations:[proof]}).missing_action_count,1);
  assert.equal(reconcile(source(left.arguments.frame),left,[{...proof}]),null,'serialized history cannot retain host proof');
  assert.equal(reconcile(source(left.arguments.frame),left,[observed(left,'wrong',{...scope(['#right'])})]),null,'native receipt scope must match the actual dispatched frame');
  const stale=stampObservation({tool:left.name,execution_step_id:'section',result:receipt({action_outcome:'not_attempted',retry_safe:true},true)},left);
  assert.ok(reconcile(source(left.arguments.frame),left,[proof,stale]),'a native pre-dispatch frame rejection cannot erase completed work or require its replay');
  for(const frame of [[],['#a','#b','#c','#d'],[''],['#left\n']])assert.equal(reconcile(source(['#left']),action(frame),[proof]),null);
});

test('nested frame action counts remain ordered and distinct executions are required before an action can be reused',()=>{
  const nested=action(['#outer','#inner']),first=observed(nested),second=observed(nested,'action-two');
  const repeated=source(nested.arguments.frame).repeat(2);
  assert.equal(reconcile(repeated,nested,[first,first]),null);
  assert.equal(reconcile(repeated,nested,[first,observed(action(['#sibling','#inner']),'other')]),null);
  assert.equal(reconcile(repeated,nested,[first,second]).matching_count,2);
  assert.equal(exactLinearCoverage({payload:payload(repeated),execution,observations:[first,second]}).missing_action_count,0);
  assert.equal(reconcile('const f=page.frameLocator(variable); await f.locator("#continue").click();',nested,[first]),null,'unsupported frame fallback fails closed');
});

test('failed-check retry families and native state distinguish siblings and document epochs without being reopened by sibling changes',()=>{
  const left=['#left'],right=['#right'];
  const request=frame=>({name:'browser_assert',arguments:{frame,assertion:'text',locator:'#continue',value:'Expected'}});
  const observations=[snapshot(left),snapshot(right)];
  for(let index=0;index<2;index++){
    const current=request(left),failure={tool:current.name,arguments:current.arguments,execution_step_id:'section',result:receipt({...scope(left),assertion_outcome:'not_satisfied'},true)};
    recordBrowserCheck(failure,current,browserRecoveryState(observations,current));observations.push(failure);
  }
  assert.equal(repeatedUnsuccessfulCheck({request:request(left),observations,stepId:'section'}).failed_check_count,2);
  assert.equal(repeatedUnsuccessfulCheck({request:request(right),observations,stepId:'section'}),null);
  observations.push(observed(action(right),'sibling-action'),snapshot(right,'different-sibling-document',{accessibility:'Changed sibling'}));
  assert.equal(repeatedUnsuccessfulCheck({request:request(left),observations,stepId:'section'}).failed_check_count,2,'a sibling action/snapshot is not new evidence on the failed target');
  observations.push(snapshot(left,'same-url-new-document'));
  assert.equal(repeatedUnsuccessfulCheck({request:request(left),observations,stepId:'section'}),null,'same URL and controls cannot hide a new native document');
});

test('successful locator validation cannot be reused across frames or after same-URL document replacement',()=>{
  const left=['#left'],right=['#right'],request=frame=>({name:'browser_validate_locator',arguments:{frame,locator:'#continue'}});
  const observations=[snapshot(left)],current=request(left);
  const success={tool:current.name,arguments:current.arguments,execution_step_id:'section',result:receipt({...scope(left),match_count:1,unique:true})};
  recordBrowserCheck(success,current,browserRecoveryState(observations,current));observations.push(success,snapshot(right));
  assert.equal(confirmedLocatorValidation({request:current,observations,stepId:'section'}).match_count,1);
  assert.equal(confirmedLocatorValidation({request:request(right),observations,stepId:'section'}),null);
  observations.push(snapshot(left,'replacement'));
  assert.equal(confirmedLocatorValidation({request:current,observations,stepId:'section'}),null);
});

test('fallback recovery state retains scope even when the selected target is incomplete or invalidated by a fresh inventory',()=>{
  const frame=['#left'],request={name:'browser_assert',arguments:{frame,assertion:'visible',locator:'#continue'}};
  const first=[snapshot(frame,'one',{partial:true})],next=[snapshot(frame,'two',{partial:true})];
  assert.notEqual(browserRecoveryState(first,request),browserRecoveryState(next,request));
  const before=browserRecoveryState(first,request);
  first.push({tool:'browser_snapshot',arguments:{},result:receipt({scope:'body',accessibility:'',elements:[],frames:[{path:frame,url:'https://app.test/embedded',title:'Inner',frame_document_id:'two'}]})});
  assert.notEqual(browserRecoveryState(first,request),before,'top inventory cannot leave an old child document usable for cached proof');
});

test('frame-only snapshots have a bounded allowance and alternating sibling/main documents cannot reset it',()=>{
  const guard=createAutomationSnapshotReadGuard(),left=['#left'],right=['#right'];
  const request=frame=>({name:'browser_snapshot',arguments:{frame}}),inspect=(observations,frame)=>guard.inspect({request:request(frame),observations,stepId:'section'});
  const observations=[snapshot(left),snapshot(right),snapshot(left),snapshot(right)];
  assert.equal(inspect(observations,left).stop,false);
  observations.push(snapshot(right));
  assert.equal(inspect(observations,left).stop,true,'reading another frame cannot reopen the first frame budget');
  assert.equal(inspect(observations,right).stop,false,'sibling allowance is tracked independently');
  assert.equal(inspect(observations,right).stop,true);
  observations.push(snapshot(left,'document-one',{frames:[{path:right,url:'https://app.test/embedded',title:'Changed sibling',frame_document_id:'sibling-reload'}]}));
  assert.equal(inspect(observations,left).stop,true,'an unrelated inventory row is not new evidence within this frame');
  observations.push(snapshot(left,'replacement'));
  assert.equal(inspect(observations,left),null,'new document epoch is actual new evidence');
  const scoped={name:'browser_snapshot',arguments:{frame:left,locator:'#continue'}};
  assert.equal(guard.inspect({request:scoped,observations,stepId:'section'}),null,'a unique DOM region retains scoped-read behavior');
});
