const test = require('node:test');
const assert = require('node:assert/strict');
const {browserCurrentActionPolicy,browserActionOrderFeedback} = require('../../backend/lib/automationBrowserActionOrder');
const {projectBrowserCapabilities} = require('../../backend/lib/automationBrowserCapabilities');
const {runAutomationBrowserAgent} = require('../../backend/lib/automationBrowserAgent');
const execution = (action = 'Verify Username field is present and editable', extras = {}) => ({required:true,step_id:'current',
  source_obligations:[{id:'current',source:'section',action,expected_result:'The Username input field is visible and editable.'}],...extras});
const inspect = (name, active = execution()) => browserActionOrderFeedback({request:{name,arguments:{locator:'#private-target',value:'PRIVATE_INPUT'}},execution:active});
const readonly = ['browser_snapshot','browser_assert','browser_validate_locator','browser_wait_for','browser_screenshot'];

test('the three observed property-only manual actions restrict the actor to read-only checks',()=>{
  for(const action of ['Verify Username field is present and editable','Verify Password field is present and masked','Verify Login button is present and enabled']) {
    const policy=browserCurrentActionPolicy(execution(action));
    assert.equal(policy.kind,'property_verification_only',action);assert.deepEqual(policy.allowed_tools,readonly);
    assert.equal(policy.interactive_actions_allowed,false);assert.equal(policy.source,'original_source_obligations');
    assert.ok(Object.isFrozen(policy)&&Object.isFrozen(policy.allowed_tools));
    assert.doesNotMatch(JSON.stringify(policy),/Username|Password|Login|private/);
  }
});

test('a narrow named-control property grammar accepts opaque labels without interpreting their data',()=>{
  for(const action of ['Please verify that the Username field is visible, editable, and enabled.',
    'Assert the Password input has type password.','Verify Password field is of input type "password".',
    'Verify the "Click and submit" button is enabled.','Verify the `Username` field remains present and is editable.',
    "Assert the 'Password' control is masked.",'Verify the named field is read-only.'])
    assert.equal(browserCurrentActionPolicy(execution(action))?.kind,'property_verification_only',action);
});

test('unknown functionality and conditional prose retain review while explicit compound families stay available',()=>{
  for(const action of ['Verify Username field is present\nand editable',
    'Verify Username field is editable after entering data','Verify Username field is editable if enabled',
    'Verify login functionality','Verify the Login functionality is enabled',
    'Verify Username field is clickable','Verify Username field displays "present and editable"',
    'Vérifier que le champ Username est modifiable','ユーザー名フィールドが編集可能であることを確認する',
    '<p>Verify Username field is editable</p>','', 'x'.repeat(20_001)])
    assert.equal(browserCurrentActionPolicy(execution(action)),undefined,action.slice(0,100));
  for(const action of ['Verify Username field is present and enter the name','Verify Username field is editable then submit',
    'Verify Username field is present; click Login','Check the Remember me checkbox','Verify Remember me checkbox is checked','Confirm Login button is enabled','Verify the field is editable'])
    assert.ok(browserCurrentActionPolicy(execution(action)),action);
});

test('parameter names, quoted instructions and expected prose cannot manufacture a property-only policy',()=>{
  for(const action of ['"Verify Username field is present and editable"','Verify Username field is "present and editable"',
    'Verify @r.[Username field is present and editable]',
    'Verify Username field is @r.[present and editable]','Verify Username field is params["r.editable"]',
    'Verify Username field contains `editable`']) assert.equal(browserCurrentActionPolicy(execution(action)),undefined,action);
  assert.ok(browserCurrentActionPolicy(execution('Verify Username field is editable @r.[click and submit]')));
  const active=execution('Enter @r.[editable field]',{action:'Verify Username field is editable',expected_result:'The field is editable'});
  assert.equal(browserCurrentActionPolicy(active).kind,'entry_only','Only the original entry action determines its family.');
  assert.equal(browserCurrentActionPolicy(execution('Verify the @r.target field is editable')).kind,'presence_verification_only');
  for(const source_obligations of [[],[{action:undefined}],undefined]) assert.equal(browserCurrentActionPolicy({...execution(),source_obligations}),undefined);
  assert.equal(browserCurrentActionPolicy(execution(undefined,{required:false})),undefined);
});

test('every nonempty original obligation must be a property check, and feedback never leaks source or data',()=>{
  const active=execution();active.source_obligations.push({action:'Verify Password field is masked'});active.source_obligations.push({action:''});
  assert.equal(browserCurrentActionPolicy(active)?.kind,'property_verification_only');
  active.source_obligations.push({action:'Enter the Username'});assert.equal(browserCurrentActionPolicy(active).kind,'entry_only');
  for(const tool of ['browser_navigate','browser_fill','browser_click','browser_press_key','browser_select_option','browser_check','browser_uncheck','browser_hover','browser_future_mutation']) {
    const feedback=inspect(tool);assert.equal(feedback.code,'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER',tool);
    assert.equal(feedback.action_outcome,'not_attempted');assert.equal(feedback.retry_safe,true);
    assert.equal(feedback.remaining_contract,'complete_current_authored_property_checks_without_mutating_controls');
    assert.doesNotMatch(JSON.stringify(feedback),/private-target|PRIVATE_INPUT|Username|Password|Login/);
  }
  for(const tool of readonly) assert.equal(inspect(tool),null,tool);
});

test('action-policy intersection removes mutation and navigation schemas even when DOM controls or expansion suggest them',()=>{
  const names=['browser_navigate',...readonly,'browser_click','browser_fill','browser_press_key','browser_check','browser_uncheck','browser_select_option','browser_hover'];
  const catalog=names.map(name=>({name,inputSchema:{type:'object',properties:{locator:{type:'string'}}}}));
  const policy=browserCurrentActionPolicy(execution());
  const restricted=catalog.filter(tool=>policy.allowed_tools.includes(tool.name));
  for(const current of [{},{current_snapshot:{targets:[{tag:'input',role:'textbox'},{tag:'input',role:'checkbox'},{tag:'select'},{role:'menuitem'}]}}]) {
    const projected=projectBrowserCapabilities({tools:restricted,current,action:'Fill and check the field',expectedResult:'Click and submit',expandedNames:names});
    assert.deepEqual(projected.tools,restricted);assert.deepEqual(projected.deferred_tool_names,[]);
    assert.ok(projected.tools.every(tool=>catalog.includes(tool)),'No schema or authority was invented.');
  }
});

test('the actual actor rejects mixed mutation batches before any dispatch and saves only each original property check',async()=>{
  const receipt=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/login',...value})}]});
  const elements=[{tag:'input',accessible_name:'Username',role:'textbox',attributes:{type:'text'},locator_candidates:['#username']},
    {tag:'input',accessible_name:'Password',role:'textbox',attributes:{type:'password'},locator_candidates:['#password']},
    {tag:'button',accessible_name:'Login',role:'button',attributes:{type:'button'},locator_candidates:['#login']},
    {tag:'input',accessible_name:'Remember me',role:'checkbox',attributes:{type:'checkbox'},locator_candidates:['#remember']}]
    .map(row=>({...row,displayed:true,disabled:false,locators_validated:true}));
  for(const [action,expected_result,locator,condition,value] of [
    ['Verify Username field is present and editable','The Username input field is visible and editable.','#username','editable'],
    ['Verify Password field is present and masked','The Password input field is visible and has type password.','#password','input_type','password'],
    ['Verify Login button is present and enabled','The Login button is visible and enabled.','#login','enabled']]) {
    const calls=[],saves=[],observations=[];let actors=0,reviews=0;
    const obligations=[{id:'current',source:'section',action,expected_result}];
    const result=await runAutomationBrowserAgent({actorMode:true,prompt:'The complete journey later fills credentials, checks Remember me and submits the login form.',
      startUrl:'https://app.test/login',parse:JSON.parse,maxTurns:4,maxCalls:10,
      execution:execution(action,{action,expected_result,obligations,source_obligations:obligations,semantic_review_required:true}),
      browser:{tools:['browser_navigate',...readonly,'browser_fill','browser_click','browser_check'].map(name=>({name,inputSchema:{type:'object'}})),
        call:async(name,args)=>{calls.push({name,args});return name==='browser_snapshot'?receipt({observation_id:'login-page',elements}):receipt(name==='browser_assert'?{assertion_outcome:'satisfied'}:{action_outcome:'completed'});}},
      onObservation:row=>observations.push(row),onPartialBuild:async payload=>{saves.push(payload);return{generation_complete:true};},
      complete:async(prompt,_timeout,trace)=>{
        if(trace?.generationScope==='section_semantic_review'){reviews++;return JSON.stringify({decision:'accept',obligations:[{id:'current',action_operations:[],assertion_operations:[2,3]}],issues:[]});}
        actors++;const catalog=JSON.parse(prompt.match(/^Tool catalog: (.+)$/m)[1]);
        assert.ok(catalog.every(tool=>readonly.includes(tool.name)),JSON.stringify(catalog));
        if(actors===1)return JSON.stringify({stage:'act',step_id:'current',section_complete:false,tool_calls:[
          {name:'browser_assert',arguments:{assertion:'visible',locator}},
          {name:'browser_fill',arguments:{locator:'#username',value:'PRIVATE_INPUT'}}]});
        assert.equal(calls.filter(row=>row.name==='browser_assert').length,0,'Even the earlier read in a rejected mixed batch was not dispatched.');
        assert.match(prompt,/complete_current_authored_property_checks_without_mutating_controls/);
        return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[
          {name:'browser_assert',arguments:{assertion:'visible',locator}},
          {name:'browser_assert',arguments:{assertion:condition,locator,...(value?{value}:{})}}]});
      }});
    assert.equal(actors,2);assert.equal(reviews,1);assert.equal(saves.length,1);
    assert.equal(calls.filter(row=>row.name==='browser_navigate').length,1,'Host start-URL bootstrap remains available before the read-only section policy.');
    assert.equal(calls.filter(row=>['browser_fill','browser_click','browser_check'].includes(row.name)).length,0);
    assert.equal(calls.filter(row=>row.name==='browser_assert').length,2);assert.doesNotMatch(result.steps[0].automation_code,/\.fill\(|\.click\(|\.check\(|PRIVATE_INPUT/);
    assert.ok(observations.some(row=>row.tool==='automation_action_order_feedback'&&row.mcp_call===false));
  }
});
