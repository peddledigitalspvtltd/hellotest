const test = require('node:test');
const assert = require('node:assert/strict');
const {stampObservation,reconcileAction,exactLinearCoverage}=require('../../backend/lib/automationActionReconciliation');

const execution={required:true,step_id:'section'};
const click={name:'browser_click',arguments:{locator:'#continue'}};
const payload=code=>({steps:[{step_id:'section',automation_code:code}]});
function observed(request=click,overrides={}){
  const observation={tool:request.name,execution_step_id:'section',action_id:'action-one',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',action_outcome:'completed'})}]},...overrides};
  return stampObservation(observation,request);
}
const reconcile=(code,observations=[observed()],request=click,scope=execution)=>reconcileAction({payload:payload(code),execution:scope,request,observations});

test('saved source retains an observed prerequisite navigation even when later input actions already match',()=>{
 const navigation=observed(click,{action_id:'navigation'});
 require('../../backend/lib/automationActionReconciliation').markPageTransition(navigation);
 const fill={name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},filled=observed(fill,{action_id:'fill'});
 const source="await page.locator('#email').fill('@t.email'); await expect(page.locator('#email')).toHaveValue('@t.email');";
 const missing=exactLinearCoverage({payload:payload(source),execution,observations:[navigation,filled]});
 assert.equal(missing.missing_action_count,0);assert.deepEqual(missing.missing_source_actions,{browser_click:1});
 assert.equal(exactLinearCoverage({payload:payload("await page.locator('#continue').click();"+source),execution,observations:[navigation,filled,navigation]}).missing_source_action_count,undefined,'duplicate history is not another navigation');
 assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[{...navigation},filled]}).missing_source_action_count,undefined,'JSON copies cannot manufacture host-only prerequisite facts');
});

test('host startup navigation is exempt while a later explicit navigation replaces earlier exploratory navigation',()=>{
 const bootstrap=stampObservation({tool:'browser_navigate',execution_step_id:'section',action_id:'startup',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',action_outcome:'completed'})}]}},{name:'browser_navigate',arguments:{url:'https://app.test'}},{bootstrap:true});
 const source="await page.locator('#continue').click();";
 assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[bootstrap,observed()]}).missing_source_action_count,undefined);
 const later=observed({name:'browser_navigate',arguments:{url:'https://app.test/signup'}},{action_id:'later-nav'});
 const complete="await page.goto('https://app.test/signup');";
 assert.equal(exactLinearCoverage({payload:payload(complete),execution,observations:[bootstrap,observed(),later]}).missing_source_action_count,undefined);
});

test('a revised linear draft reuses an exact current-section click receipt without exposing original request data',()=>{
  const observation=observed();
  const result=reconcile(`await page.locator("#continue").click(); await expect(page.locator('#review-email')).toHaveText('@t.email');`,[observation]);
  assert.deepEqual(result,{action_id:'action-one',matching_count:1,candidate_count:1});
  assert.equal(JSON.stringify(observation).includes('automation.executedRequest'),false);
  assert.equal(reconcile('await page.click("#continue");',[observation]).action_id,'action-one');
  assert.equal(reconcile('const next = page.locator(`#continue`); await next.click();',[observation]).action_id,'action-one');
  assert.equal(reconcile('await page.locator("#continue").click();',[{...observation}]),null,'A model/history copy cannot supply host-only execution proof.');
});

test('two identical source clicks require two distinct executions and duplicate history cannot inflate proof',()=>{
  const code='await page.locator("#continue").click(); await page.locator("#continue").click();';
  const first=observed(),second=observed(click,{action_id:'action-two'});
  assert.equal(reconcile(code,[first]),null);
  assert.equal(reconcile(code,[first,first]),null);
  assert.deepEqual(reconcile(code,[first,second]),{action_id:'action-two',matching_count:2,candidate_count:2});
});

test('semantic targets canonicalize quote/property order while retaining exact matching semantics',()=>{
  const request={name:'browser_click',arguments:{locator:`getByRole('button', {name:'Continue', exact:true})`}};
  const proof=observed(request);
  assert.ok(reconcile('await page.getByRole("button", {exact:true,name:"Continue"}).click();',[proof],request));
  assert.equal(reconcile('await page.getByRole("button", {name:"Continue"}).click();',[proof],request),null);
  assert.equal(reconcile('await page.getByRole("button", {name:"Continue",exact:false}).click();',[proof],request),null);
  assert.equal(reconcile('await page.getByRole("button", {name:"Back",exact:true}).click();',[proof],request),null);
  const roleRequest={name:'browser_click',arguments:{locator:'role=button[name="Continue"]'}};
  assert.ok(reconcile('await page.getByRole("button", {name:"Continue",exact:true}).click();',[observed(roleRequest)],roleRequest));
});

test('fills, key presses and selects require the same exact original values, including parameter references',()=>{
  for(const [name,method,field] of [['browser_fill','fill','value'],['browser_press_key','press','key'],['browser_select_option','selectOption','value']]){
    const request={name,arguments:{locator:'#field',[field]:'@t.email'}},proof=observed(request);
    assert.ok(reconcile(`await page.locator('#field').${method}('@t.email');`,[proof],request));
    assert.equal(reconcile(`await page.locator('#field').${method}('@t.other');`,[proof],request),null);
    assert.equal(reconcile(`await page.locator('#field').${method}('resolved-value');`,[proof],request),null);
    assert.equal(reconcile(`await page.locator('#other').${method}('@t.email');`,[proof],request),null);
    assert.equal(reconcile(`await page.locator('#field').${method}('@t.email');`,[proof],{name,arguments:{...request.arguments,[field]:'@t.other'}}),null);
  }
});

test('whole scoped reference aliases reuse exact host action proof without replaying or rewriting the request',()=>{
 for(const [name,method,field]of [['browser_fill','fill','value'],['browser_press_key','press','key'],['browser_select_option','selectOption','value']]){
  const request={name,arguments:{locator:'#field',[field]:'@S.[Access code]'}},before=JSON.stringify(request),proof=observed(request);
  for(const value of ["'@s.[access code]'","'@S.[ACCESS CODE]'","params['s.access code']","params['s.[Access code]']"]){
   const source=`await page.locator('#field').${method}(${value});`;
   const canonicalRequest={name,arguments:{locator:'#field',[field]:'@s.[access code]'}};
   assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[proof]}).missing_action_count,0);
   assert.equal(reconcile(source,[proof],canonicalRequest)?.action_id,'action-one');
   assert.equal(reconcile(source,[proof],request)?.action_id,'action-one');
   assert.equal(reconcile(source,[{...proof}],canonicalRequest),null,'a serialized or spread observation still has no execution authority');
  }
  assert.equal(JSON.stringify(request),before,'canonical comparison preserves the original reviewed bytes');
 }
 const request={name:'browser_fill',arguments:{locator:'#field',value:'@T.Name'}},proof=observed(request);
 assert.ok(reconcile("await page.locator('#field').fill('@t.[name]');",[proof],{...request,arguments:{...request.arguments,value:'@t.name'}}));
});

test('reference identity retains different scopes and names while literal input case and embedded tokens remain exact',()=>{
 for(const [name,method,field]of [['browser_fill','fill','value'],['browser_press_key','press','key'],['browser_select_option','selectOption','value']]){
  const request={name,arguments:{locator:'#field',[field]:'@s.[Access code]'}},proof=observed(request);
  for(const changed of ['@t.[access code]','@r.[access code]','@s.[other code]','@s.access_code','Access code','@access_code']){
   const source=`await page.locator('#field').${method}(${JSON.stringify(changed)});`;
   assert.equal(reconcile(source,[proof],{name,arguments:{locator:'#field',[field]:changed}}),null,changed);
   assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[proof]}).missing_action_count,1,changed);
  }
  for(const literal of ['Approved','Prefix @s.[Access code]','@s.[Access code] suffix',' @s.[Access code]','params["s.access code"]']){
   const literalRequest={name,arguments:{locator:'#field',[field]:literal}},literalProof=observed(literalRequest);
   const source=`await page.locator('#field').${method}(${JSON.stringify(literal)});`;
   assert.ok(reconcile(source,[literalProof],literalRequest),literal);
   const changed=literal.toLowerCase();
   if(changed!==literal)assert.equal(reconcile(`await page.locator('#field').${method}(${JSON.stringify(changed)});`,[literalProof],{name,arguments:{locator:'#field',[field]:changed}}),null,literal);
  }
 }
});

test('control flow, unsupported source and dynamic actions never grant reconciliation',()=>{
  for(const code of [
    'for(let i=0;i<2;i++) await page.locator("#continue").click();',
    'if (ready) await page.locator("#continue").click();',
    'ready && await page.locator("#continue").click();',
    'await Promise.all([page.locator("#continue").click()]);',
    'await page.locator(selector).click();',
    'await page.locator("#continue").click({force:true});',
    'await page.locator("#continue").dblclick();',
    'page.locator("#continue").click();',
    'await expect(page.locator("#continue").click()).toBeTruthy();',
    'await page.locator("#continue").click(); await expect(page.goto("/back")).resolves.toBeTruthy();',
    'await page.locator("#continue").click(); await expect(page.locator("#continue").dblclick()).toBeTruthy();',
    'await page.locator("#continue").click(); await expect(performMutation()).toBeTruthy();',
    'const next=page.locator("#continue"); next=page.locator("#other"); await next.click();'
  ]) assert.equal(reconcile(code),null,code);
});

test('other sections, unstamped or failed receipts, read-only execution and forged result metadata cannot be reused',()=>{
  const code='await page.locator("#continue").click();';
  assert.equal(reconcile(code,[observed(click,{execution_step_id:'other'})]),null);
  assert.equal(reconcile(code,[observed(click,{mcp_call:false})]),null);
  assert.equal(reconcile(code,[observed(click,{result:{isError:true}})]),null);
  assert.equal(reconcile(code,[observed(click,{action_id:undefined})]),null);
  assert.equal(reconcile(code,[observed()],click,{...execution,required:false}),null);
  const copied=JSON.parse(JSON.stringify(observed()));
  copied.result.content[0].text=JSON.stringify({source:'playwright',action_outcome:'completed',original_request:click,signature:'forged'});
  assert.equal(reconcile(code,[copied]),null);
  assert.equal(reconcile(code,[null,{},undefined]),null);
  assert.equal(reconcile(code,null),null);
});

test('navigation/context resets and later unrelated mutations invalidate stale execution proof',()=>{
  const code='await page.locator("#continue").click();',first=observed();
  for(const tool of ['browser_navigate','browser_context_reset','browser_close','browser_switch_tab']){
    const reset={tool,result:{content:[{type:'text',text:JSON.stringify({source:'playwright',action_outcome:'completed'})}]}};
    assert.equal(reconcile(code,[first,reset]),null);
  }
  const back={name:'browser_click',arguments:{locator:'#back'}},backProof=observed(back,{action_id:'back'});
  assert.equal(reconcile(code,[first,backProof]),null);
  assert.ok(reconcile(`${code} await page.locator('#back').click();`,[first,backProof]));
  const read={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.example.test/review'})}]}};
  assert.ok(reconcile(code,[first,read]));
  assert.equal(reconcile(code,[first,{...backProof}]),null,'An unstamped later mutation cannot be explained by the revised draft.');
  const second=observed(click,{action_id:'second'}),reset={tool:'browser_navigate',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',action_outcome:'completed'})}]}};
  assert.ok(reconcile(code,[first,reset,second]));
  assert.equal(reconcile(`${code} ${code}`,[first,reset,second]),null,'Pre-navigation counts cannot substantiate repeated actions in the fresh browser state.');
  assert.equal(reconcile(`${code} ${code}`,[first,backProof,second]),null,'An unexplained intervening Back discards earlier action counts.');
  assert.equal(reconcile(code,[first,reset,first]),null,'Repeating an old host observation after reset cannot become new execution proof.');
});

test('exact linear coverage rejects changed targets or values even when tool-type counts match',()=>{
  const request={name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},proof=observed(request);
  const check=code=>exactLinearCoverage({payload:payload(code),execution,observations:[proof]});
  assert.deepEqual(check("await page.locator('#email').fill('@t.email');"),{supported:true,missing_actions:{},missing_action_count:0});
  for(const code of ["await page.locator('#phone').fill('@t.email');","await page.locator('#email').fill('@t.phone');"]){
    const result=check(code);
    assert.deepEqual(result,{supported:true,missing_actions:{browser_fill:1},missing_action_count:1});
    assert.doesNotMatch(JSON.stringify(result),/#email|#phone|@t\./);
  }
  assert.deepEqual(exactLinearCoverage({payload:payload("await page.locator('#email').fill('@t.email');"),execution,observations:[{...proof}]}),
    {supported:true,missing_actions:{browser_fill:1},missing_action_count:1});
});

test('an uncertain failed mutation invalidates old successes while a host-proven pre-dispatch rejection does not',()=>{
  const source="await page.locator('#continue').click();", first=observed();
  const failure=overrides=>observed(click,{action_id:'failed-second-action',result:{isError:true,content:[{type:'text',text:JSON.stringify({source:'playwright',code:'BROWSER_ACTION_OUTCOME_UNKNOWN',action_outcome:'unknown',retry_safe:false,...overrides})}]}});
  for(const failed of [failure(),failure({action_outcome:'completed'}),failure({action_outcome:undefined,retry_safe:undefined}),{...failure({action_outcome:'not_attempted',retry_safe:true})}]){
    assert.equal(reconcile(source,[first,failed]),null);
    assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[first,failed]}).missing_action_count,1);
  }
  const rejected=failure({code:'BROWSER_TOOL_INVALID_ARGUMENTS',action_outcome:'not_attempted',retry_safe:true});
  assert.ok(reconcile(source,[first,rejected]));
  const feedback={...failure(),mcp_call:false};
  assert.ok(reconcile(source,[first,feedback]),'Host-only feedback did not dispatch a browser mutation.');
});

test('exact linear coverage and reconciliation preserve action order and repeated-action requirements',()=>{
  const fill={name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},fillProof=observed(fill,{action_id:'fill'}),clickProof=observed();
  const code="await page.locator('#email').fill('@t.email'); await page.locator('#continue').click();";
  const cover=observations=>exactLinearCoverage({payload:payload(code),execution,observations});
  assert.equal(cover([fillProof,clickProof]).missing_action_count,0);
  assert.deepEqual(cover([clickProof,fillProof]),{supported:true,missing_actions:{browser_click:1},missing_action_count:1});
  assert.equal(reconcile(code,[clickProof,fillProof]),null,'An earlier click cannot replace the still-required click after filling.');
  assert.ok(reconcile(code,[fillProof,clickProof]));
  const double="await page.locator('#continue').click(); await page.locator('#continue').click();";
  assert.equal(exactLinearCoverage({payload:payload(double),execution,observations:[clickProof,clickProof]}).missing_action_count,1);
  assert.equal(exactLinearCoverage({payload:payload(double),execution,observations:[clickProof,observed(click,{action_id:'click-two'})]}).missing_action_count,0);
});

test('exact coverage is conservative for unsupported code and scopes proof to the current uninterrupted section',()=>{
  const code="await page.locator('#continue').click();",proof=observed();
  for(const source of ['if(ready) await page.locator("#continue").click();',"await page.locator('#continue').click(); await expect(page.goto('/back')).resolves.toBeTruthy();"]){
    assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[proof]}),null);
  }
  const other=observed(click,{action_id:'other',execution_step_id:'other-section'});
  assert.equal(exactLinearCoverage({payload:payload(code),execution,observations:[proof,other]}).missing_action_count,1);
  assert.equal(exactLinearCoverage({payload:payload(code),execution:{...execution,required:false},observations:[proof]}),null);
  const reset={tool:'browser_navigate',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',action_outcome:'completed'})}]}};
  assert.equal(exactLinearCoverage({payload:payload(code),execution,observations:[proof,reset]}).missing_action_count,1);
  assert.equal(exactLinearCoverage({payload:payload(code),execution,observations:[proof,reset,observed(click,{action_id:'fresh'})]}).missing_action_count,0);
});

test('inherited object names are unavailable tool names and action methods',()=>{
  const code="await page.locator('#continue').click();";
  for(const name of ['__proto__','constructor','toString']){
    const request={name,arguments:{locator:'#continue'}};
    const observation={tool:name,execution_step_id:'section'};
    assert.equal(stampObservation(observation,request),observation);
    assert.equal(reconcile(code,[],request),null);
    assert.equal(exactLinearCoverage({payload:payload(`await page.locator('#continue').${name}();`),execution,observations:[]}),null);
  }
});

test('a confirmed native navigation prefix and its actions are reused after a failed read-only assertion',()=>{
 const navigate={name:'browser_navigate',arguments:{url:'https://Selected.example:443'}},fill={name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}};
 const source="await page.goto('https://selected.example/'); await page.waitForLoadState('domcontentloaded'); await page.locator('#email').fill(params['t.email']); await page.locator('#continue').click(); await expect(page.locator('#review')).toHaveText(params['t.email']);";
 const history=[observed(navigate,{action_id:'navigate'}),observed(fill,{action_id:'fill'}),observed(click,{action_id:'click'}),
  {tool:'browser_assert',execution_step_id:'section',result:{isError:true,content:[{type:'text',text:'{"source":"playwright","assertion_outcome":"not_satisfied"}'}]}}];
 const before=JSON.stringify(navigate);
 assert.deepEqual(exactLinearCoverage({payload:payload(source),execution,observations:history}),{supported:true,missing_actions:{},missing_action_count:0});
 assert.equal(reconcile(source,history,{name:'browser_navigate',arguments:{url:'https://selected.example/'}}).action_id,'navigate');
 assert.equal(reconcile(source,history,fill).action_id,'fill');
 assert.equal(reconcile(source,history,click).action_id,'click');
 assert.equal(JSON.stringify(navigate),before,'URL comparison never rewrites the actual reviewed request.');
});

test('multiple source navigations preserve their confirmed sequence, while an extra reset invalidates stale later actions',()=>{
 const first={name:'browser_navigate',arguments:{url:'https://selected.example/a'}},second={name:'browser_navigate',arguments:{url:'https://selected.example/b'}},
  fill={name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}};
 const source="await page.goto('https://selected.example/a'); await page.locator('#continue').click(); await page.goto('https://selected.example/b'); await page.waitForLoadState('load'); await page.locator('#email').fill('@t.email');";
 const history=[observed(first,{action_id:'nav-a'}),observed(click,{action_id:'click'}),observed(second,{action_id:'nav-b'}),observed(fill,{action_id:'fill'})];
 assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:history}).missing_action_count,0);
 assert.equal(reconcile(source,history,first).action_id,'nav-a');assert.equal(reconcile(source,history,second).action_id,'nav-b');
 const single="await page.goto('https://selected.example/a'); await page.locator('#continue').click();";
 const reset=[history[0],history[1],observed(first,{action_id:'fresh-nav-a'})];
 assert.equal(exactLinearCoverage({payload:payload(single),execution,observations:reset}).missing_action_count,1);
 assert.equal(reconcile(single,reset,click),null);
 assert.equal(reconcile(single,reset,first).action_id,'fresh-nav-a');
 const foreign={name:'browser_navigate',arguments:{url:'https://selected.example/unrelated'}};
 assert.equal(reconcile(single,[history[0],history[1],observed(foreign,{action_id:'outside'})],click),null);
});

test('explicit locator indices and scoped parameter expressions keep native-equivalent exact action proof',()=>{
 const cases=[
  ["await page.locator('input').first().fill(params['t.email']);",{name:'browser_fill',arguments:{locator:'input.first()',value:'@t.email'}}],
  ["await page.locator('input').nth(0).fill(params['t.email']);",{name:'browser_fill',arguments:{locator:'input.first()',value:'@t.email'}}],
  ["await page.getByRole('button',{name:'Continue',exact:true}).nth(1).click();",{name:'browser_click',arguments:{locator:'getByRole("button", {"exact":true,"name":"Continue"}).nth(1)'}}],
  ["await page.locator('button').last().click();",{name:'browser_click',arguments:{locator:'button.last()'}}],
  ["await page.locator('#code').press(params['s.[Access code]']);",{name:'browser_press_key',arguments:{locator:'#code',key:'@s.[Access code]'}}],
  ["await page.locator('#country').selectOption(params['r.country']);",{name:'browser_select_option',arguments:{locator:'#country',value:'@r.country'}}]
 ];
 for(const [source,request]of cases){
  const proof=observed(request);
  assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[proof]}).missing_action_count,0,source);
  assert.ok(reconcile(source,[proof],request),source);
 }
 const request={name:'browser_fill',arguments:{locator:'input.nth(1)',value:'@t.email'}},proof=observed(request);
 assert.equal(reconcile("await page.locator('input').nth(2).fill(params['t.email']);",[proof],request),null);
 assert.equal(reconcile("await page.locator('input').nth(1).fill(params['t.other']);",[proof],request),null);
});

test('navigation and indexed source support does not widen unsafe waits, URLs, chains or controls',()=>{
 const request={name:'browser_navigate',arguments:{url:'https://selected.example/'}},proof=observed(request);
 for(const source of [
  "await page.waitForLoadState('load'); await page.goto('https://selected.example/');",
  "await page.goto('https://selected.example/'); await page.waitForLoadState('networkidle');",
  "await page.goto('https://selected.example/'); await page.locator('#continue').click(); await page.waitForLoadState('load');",
  "await page.goto('https://selected.example/'); if(ready) await page.locator('#continue').click();",
  "await page.goto('https://selected.example/'); await page.locator('button').first().last().click();"
 ])assert.equal(exactLinearCoverage({payload:payload(source),execution,observations:[proof]}),null,source);
 for(const url of ['file:///private','https://user:password@selected.example/','/relative'])assert.equal(reconcile("await page.goto('https://selected.example/');",[proof],{name:'browser_navigate',arguments:{url}}),null);
 const unstamped={...proof};assert.equal(reconcile("await page.goto('https://selected.example/');",[unstamped],request),null);
 assert.equal(reconcile("await page.goto('https://selected.example/');",[observed(request,{execution_step_id:'other'})],request),null);
});
