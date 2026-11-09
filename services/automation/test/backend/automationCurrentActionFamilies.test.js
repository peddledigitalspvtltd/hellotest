const test=require('node:test'),assert=require('node:assert/strict');
const {browserCurrentActionPolicy,browserActionOrderFeedback}=require('../../backend/lib/automationBrowserActionOrder');
const execution=(action,extra={})=>({required:true,step_id:'current',source_obligations:[{id:'current',action},{id:'manual:linked:current',action}],...extra});
const allowed=(action,name)=>browserCurrentActionPolicy(execution(action))?.allowed_tools.includes(name);
const blocked=(action,name)=>browserActionOrderFeedback({execution:execution(action),request:{name,arguments:{locator:'#fixture'}}});

test('the actual parameterized navigation and duplicate current manual obligation cannot authorize a login batch',()=>{
  const action='Navigate to @r.orangehrm_url.';
  assert.equal(browserCurrentActionPolicy(execution(action)).kind,'navigation_only');
  for(const name of ['browser_fill','browser_click','browser_press_key','browser_select_option','browser_check'])assert.equal(blocked(action,name).action_outcome,'not_attempted');
  for(const name of ['browser_navigate','browser_snapshot','browser_assert'])assert.equal(blocked(action,name),null);
});

test('current data entry does not borrow a later Login click or keyboard submission',()=>{
  const action='Enter @r.username in the Username field.';
  for(const future_actions of [undefined,[],[{step_id:'later',action:'Click the Login button'}]]){
    const current=execution(action,{future_actions,action:'Create a login session',expected_result:'Dashboard appears'});
    assert.ok(browserCurrentActionPolicy(current).allowed_tools.includes('browser_fill'));
    for(const name of ['browser_click','browser_press_key','browser_navigate'])assert.equal(browserActionOrderFeedback({execution:current,request:{name,arguments:{locator:'#login',key:'Enter'}}}).code,'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER');
  }
});

test('Employee Management and Log Out visibility never authorizes activating Log Out',()=>{
  for(const action of ['Verify Employee Management navigation and Log Out are visible.',
    'Verify Employee Management and Log Out options.', 'Verify the "Create and submit" link is visible.']){
    assert.equal(browserCurrentActionPolicy(execution(action)).kind,'presence_verification_only');
    for(const name of ['browser_click','browser_fill','browser_press_key','browser_navigate'])assert.ok(blocked(action,name),action);
  }
});

test('UI-open and click-only operands cannot add entry authority from labels, URLs or parameter names',()=>{
  for(const action of ['Click the Login button.','Open the Create Employee form.','Click "Create Login and Fill Password".',
    'Click @r.[fill and submit]','Click the Create Employee link at https://app.test/login/create?fill=username']){
    assert.equal(allowed(action,'browser_click'),true,action);assert.equal(allowed(action,'browser_fill'),false,action);
  }
  for(const action of ['Open @r.[Login and Create]','Navigate https://app.test/create/login?fill=secret','Navigate to /submit/create/login']){
    assert.equal(allowed(action,'browser_navigate'),true,action);assert.equal(allowed(action,'browser_fill'),false,action);assert.equal(allowed(action,'browser_click'),false,action);
  }
});

test('actual checkbox verification plus Next and explicit current credential-entry/login compounds retain exactly their families',()=>{
  const actual='Verify Auto Generate Employee ID is checked, Create Login Details is unchecked and Initiate Preboarding is unchecked, then click Next.';
  for(const action of [actual,'Verify the checkbox is visible;click Next',
    'Verify Send Notification and Add Employment Details checkboxes are visible and click Next']){
    assert.equal(allowed(action,'browser_click'),true,action);assert.equal(allowed(action,'browser_fill'),false,action);assert.equal(allowed(action,'browser_check'),false,action);
  }
  const compound='Enter @r.username in Username and enter @r.password in Password, then click Login.';
  assert.equal(allowed(compound,'browser_fill'),true);assert.equal(allowed(compound,'browser_click'),true);assert.equal(allowed(compound,'browser_select_option'),false);
  assert.equal(allowed('Check the required checkboxes and click Next','browser_check'),true);
});

test('unknown high-level creation, functionality and unparsed compound actions retain semantic review',()=>{
  for(const action of ['Create an employee','Create a user and log in','Verify login functionality',
    'Enter @r.value and invoke the workflow','Enter @r.value;invoke the workflow','Enter the details page'])assert.equal(browserCurrentActionPolicy(execution(action)),undefined,action);
});
