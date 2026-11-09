const test=require('node:test');
const assert=require('node:assert/strict');
const expressionProgram=source=>'// @hellotest-parameter-bindings expressions-v1\n'+source;
const {buildWithUpstreamPlaywright,preserveNativeActions,resolveSecretReferences}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const {validSavedInstructionMapping}=require('../../backend/lib/automationInstructionMapping');

const startUrl='https://app.test/start';
const step={id:'save',step_order:1,step_type:'web',action:'Save the form',expected_result:'The saved confirmation appears'};
const goto=`await page.goto(${JSON.stringify(startUrl)});`;
const click='await page.getByRole("button", {name:"Save",exact:true}).click();';
const assertion='await expect(page.getByRole("status")).toHaveText("Saved",{timeout:4500});';
const native=(code,other='Observed current page')=>({content:[{type:'text',text:`### Ran Playwright code\n\x60\x60\x60js\n${code}\n\x60\x60\x60\n${other}`}]});
const tools=[
  {name:'browser_navigate',inputSchema:{type:'object',required:['url'],properties:{url:{type:'string'}},additionalProperties:false}},
  {name:'browser_click',inputSchema:{type:'object',required:['ref'],properties:{ref:{type:'string'}},additionalProperties:false}},
  {name:'browser_type',inputSchema:{type:'object',required:['ref','text'],properties:{ref:{type:'string'},text:{type:'string'}},additionalProperties:false}},
  {name:'browser_verify_value',inputSchema:{type:'object',required:['type','element','target','value'],properties:{type:{enum:['textbox','checkbox','radio','combobox','slider']},element:{type:'string'},target:{type:'string'},value:{type:'string'}},additionalProperties:false}},
  {name:'browser_snapshot',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
function instructionResponse(request){
  const payload=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
  return {schema:'hellotest.playwrightInstructionMapping.v1',steps:payload.steps.map(step=>({step_id:step.step_id,source_sha256:step.source_sha256,instructions:step.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:op.kind==='assertion'?'Verify saved status':'Perform native action',args:[]}))}))};
}
function fixture({actor,source,mapping,call,parameterBindings,redact}={}){
  const dispatched=[],requests=[],saved=[],progress=[];let closes=0,checks=0;
  const actorCounts=new Map();
  const browser={tools,call:async(name,args)=>{
    dispatched.push({name,args});
    if(call)return call(name,args,dispatched.length);
    return native(name==='browser_navigate'?goto:name==='browser_click'?click:'');
  },close:async()=>{closes++;}};
  const complete=async request=>{
    requests.push(request);
    if(request.phase==='upstream_browser_actor'){
      const count=(actorCounts.get(request.step.id)||0)+1;actorCounts.set(request.step.id,count);
      return actor?actor(request,count):count===1?{tool:{name:'browser_click',arguments:{ref:'save-button'}}}:{done:true};
    }
    if(request.phase==='upstream_source')return source?source(request,requests.filter(item=>item.phase==='upstream_source').length):{automation_code:[goto,click,assertion].join('\n')};
    if(request.phase==='upstream_instruction_mapping')return mapping?mapping(request,requests.filter(item=>item.phase==='upstream_instruction_mapping').length):instructionResponse(request);
    throw new Error('Unexpected model phase');
  };
  const run=(overrides={})=>buildWithUpstreamPlaywright({steps:[step],startUrl,interactive:true,browser,complete,validate:inspectExecutablePlan,assertAccess:async()=>{checks++;},onProgress:async event=>progress.push(event),onSection:async update=>saved.push(update),parameterBindings,redact,...overrides});
  return {run,dispatched,requests,saved,progress,get closes(){return closes;},get checks(){return checks;}};
}

test('configured model uses native MCP first, then preserves source and maps display instructions in a separate call before saving',async()=>{
  const state=fixture();
  const result=await state.run();
  assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_click']);
  assert.deepEqual(state.requests.map(item=>item.phase),['upstream_browser_actor','upstream_browser_actor','upstream_source','upstream_instruction_mapping']);
  assert.equal(state.saved.length,1);assert.equal(result.updates[0],state.saved[0]);
  assert.equal(result.updates[0].automation_code,expressionProgram([goto,click,assertion].join('\n')));
  assert.ok(validSavedInstructionMapping(result.updates[0].automation_instructions,{source:result.updates[0].automation_code,stepId:step.id}));
  assert.equal(result.browser_evidence.transport,'upstream_playwright_mcp');
  assert.equal(result.browser_evidence.interaction_mode,'interactive');
  assert.equal(result.side_effects.browser_actions,1);assert.equal(state.closes,1);assert.ok(state.checks>4);
});

test('native actor and source guidance retain full authored record identity and final assertions without replay or ambiguity masking',async()=>{
  const state=fixture();
  const result=await state.run();
  const actor=JSON.parse(state.requests.find(row=>row.phase==='upstream_browser_actor').prompt);
  const source=JSON.parse(state.requests.find(row=>row.phase==='upstream_source').prompt);
  for(const guidance of [actor.expected_result_contract,source.expected_result_contract]){
    assert.match(guidance,/full authored composite identity/);assert.match(guidance,/configured first name and last name where authored/);
    assert.match(guidance,/broad template prefix/);assert.match(guidance,/\.first\(\) to hide ambiguous matches/);
    assert.match(guidance,/after the final authored action/);assert.match(guidance,/without replay/);
  }
  assert.equal(result.updates[0].automation_code,expressionProgram([goto,click,assertion].join('\n')));
  assert.deepEqual(state.dispatched.map(row=>row.name),['browser_navigate','browser_click']);
});

test('source correction retries the model without replaying an accepted browser mutation',async()=>{
  const state=fixture({source:(request,count)=>{
    if(count===1)return {automation_code:[goto,click.replace('Save','Delete'),assertion].join('\n')};
    const payload=JSON.parse(request.prompt);assert.match(payload.feedback,/changed the native emitted browser actions/);
    return {automation_code:[goto,click,assertion].join('\n')};
  }});
  const result=await state.run();
  assert.equal(state.dispatched.filter(item=>item.name==='browser_click').length,1);
  assert.equal(state.requests.filter(item=>item.phase==='upstream_source').length,2);
  assert.equal(result.updates[0].automation_code,expressionProgram([goto,click,assertion].join('\n')));
});

test('invalid source JSON receives bounded model correction without replaying completed native actions',async()=>{
  for(const failure of ['malformed_json','typed_json_error']){
    const state=fixture({source:(request,count)=>{
      if(count===1){if(failure==='typed_json_error')throw Object.assign(new Error('Unparseable provider JSON'),{code:'AI_INVALID_JSON'});return '{"automation_code":';}
      const packet=JSON.parse(request.prompt);assert.match(packet.feedback,/Return valid JSON/);assert.match(packet.feedback,/No browser actions were replayed/);
      return {automation_code:[goto,click,assertion].join('\n')};
    }});
    const result=await state.run();
    assert.equal(state.dispatched.filter(item=>item.name==='browser_click').length,1);
    assert.equal(state.requests.filter(item=>item.phase==='upstream_source').length,2);
    assert.equal(result.updates[0].automation_code,expressionProgram([goto,click,assertion].join('\n')));assert.equal(state.saved.length,1);
  }
});

test('source serialization correction stops after three proposals and never retries unrelated provider failures',async()=>{
  const invalid=fixture({source:()=>'{"automation_code":'});
  await assert.rejects(invalid.run(),{code:'AI_INVALID_JSON'});
  assert.equal(invalid.requests.filter(item=>item.phase==='upstream_source').length,3);assert.equal(invalid.saved.length,0);
  assert.equal(invalid.dispatched.filter(item=>item.name==='browser_click').length,1);assert.equal(invalid.closes,1);
  for(const error of [Object.assign(new Error('Model authentication denied'),{statusCode:401}),Object.assign(new Error('Model transport ended'),{code:'MODEL_TRANSPORT_ENDED'})]){
    const stopped=fixture({source:()=>{throw error;}});
    await assert.rejects(stopped.run(),candidate=>candidate===error);
    assert.equal(stopped.requests.filter(item=>item.phase==='upstream_source').length,1);assert.equal(stopped.saved.length,0);
    assert.equal(stopped.dispatched.filter(item=>item.name==='browser_click').length,1);assert.equal(stopped.closes,1);
  }
});

test('a display mapping retry receives exact validation feedback and can repair its contract without changing executable source',async()=>{
  const state=fixture({mapping:(request,count)=>{
    const mapping=instructionResponse(request);
    if(count===1){mapping.steps[0].instructions[0].depth='0';return mapping;}
    const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
    assert.equal(packet.validation_feedback.expected_schema,'hellotest.playwrightInstructionMapping.v1');
    assert.equal(packet.validation_feedback.failed_rule.rule,'instruction_contract');
    assert.equal(packet.validation_feedback.failed_rule.required_depth,0);
    assert.equal(packet.validation_feedback.required_steps[0].step_id,'save');
    return mapping;
  }});
  const result=await state.run();
  assert.equal(state.requests.filter(item=>item.phase==='upstream_instruction_mapping').length,2);assert.equal(state.saved.length,1);
  assert.equal(result.updates[0].automation_code,expressionProgram([goto,click,assertion].join('\n')));
  assert.ok(validSavedInstructionMapping(result.updates[0].automation_instructions,{source:result.updates[0].automation_code,stepId:'save'}));
  assert.deepEqual(result.warnings,[]);assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_click']);
});

test('two invalid display mappings retain validated source once with parser fallback and warning metadata while the next section continues',async()=>{
  const {sectionPreview}=require('../../backend/lib/automationWorkspacePreview');
  const steps=[step,{...step,id:'verify',step_order:2,action:'Verify the saved state'}],previews=[];
  const state=fixture({actor:(request,count)=>request.step.id==='save'&&count===1?{tool:{name:'browser_click',arguments:{ref:'save-button'}}}:{done:true},
    source:request=>({automation_code:request.step.id==='save'?[goto,click,assertion].join('\n'):assertion}),
    mapping:(request,count)=>{
      const mapping=instructionResponse(request);
      if(request.step.id==='verify')return mapping;
      if(count===1){mapping.steps[0].instructions[0].label='PRIVATE_BAD_DISPLAY_LABEL_'.repeat(20);return mapping;}
      const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
      assert.equal(packet.validation_feedback.expected_schema,'hellotest.playwrightInstructionMapping.v1');
      assert.doesNotMatch(request.prompt,/PRIVATE_BAD_DISPLAY_LABEL/);
      return {response:mapping};
    }});
  const result=await state.run({steps,onSection:async(update,evidence)=>{state.saved.push(update);previews.push(sectionPreview({testCaseId:'case',step:update.step,update,evidence,attempt:1}));}});
  assert.equal(state.saved.length,2);assert.deepEqual(result.updates.map(update=>update.step.id),['save','verify']);
  assert.equal(result.updates[0].automation_code,expressionProgram([goto,click,assertion].join('\n')));assert.equal(result.updates[0].automation_instructions,undefined);
  assert.equal(previews[0].automation_instructions,undefined);assert.equal(previews[0].evidence.instruction_mapping.display_mode,'source_parser');
  assert.equal(previews[0].evidence.instruction_mapping.attempts,2);assert.equal(result.updates[0].instruction_mapping_warning.error_code,'AUTOMATION_INSTRUCTION_MAPPING_INVALID');
  assert.ok(result.updates[1].automation_instructions);assert.equal(result.warnings.length,1);
  const warning=state.progress.find(event=>event.phase==='automation.agent.instructions.fallback');
  assert.equal(warning.level,'warning');assert.equal(warning.details.active_step_id,'save');assert.equal(warning.details.display_mode,'source_parser');
  assert.equal(state.requests.filter(item=>item.phase==='upstream_source').length,2);assert.equal(state.requests.filter(item=>item.phase==='upstream_instruction_mapping').length,3);
  assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_click']);assert.equal(state.closes,1);
  assert.doesNotMatch(JSON.stringify({previews,warnings:result.warnings,progress:state.progress}),/PRIVATE_BAD_DISPLAY_LABEL/);
});

test('display fallback cannot hide authentication, cancellation, lease, lifecycle or executable-source failures',async()=>{
  for(const error of [
    Object.assign(new Error('Access revoked'),{code:'AUTOMATION_INSTRUCTION_MAPPING_INVALID',statusCode:403}),
    Object.assign(new Error('Aborted'),{code:'AUTOMATION_INSTRUCTION_MAPPING_INVALID',name:'AbortError'}),
    Object.assign(new Error('Lease lost'),{code:'BATCH_JOB_LEASE_LOST'}),
    Object.assign(new Error('Request closed'),{code:'AUTOMATION_BUILD_REQUEST_CLOSED'}),
    Object.assign(new Error('Source changed'),{code:'AUTOMATION_UPSTREAM_SOURCE_INVALID'}),
    Object.assign(new Error('Evidence invalid'),{code:'AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED'})
  ]){
    const state=fixture({mapping:()=>{throw error;}});
    await assert.rejects(state.run(),actual=>actual===error);
    assert.equal(state.requests.filter(item=>item.phase==='upstream_instruction_mapping').length,1);assert.equal(state.saved.length,0);
    assert.equal(state.progress.some(event=>event.phase==='automation.agent.instructions.fallback'),false);
    assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_click']);
  }
});

test('uncertain mutating tool responses and transport failures terminate without another browser attempt or source generation',async()=>{
  for(const outcome of ['response','transport']){
    const state=fixture({call:async name=>{
      if(name==='browser_navigate')return native(goto);
      if(outcome==='transport')throw Object.assign(new Error('Transport disconnected after dispatch'),{code:'ECONNRESET'});
      return {isError:true,content:[{type:'text',text:'The action outcome is unknown.'}]};
    }});
    await assert.rejects(state.run(),error=>error.nonRetryable===true&&error.saved_sections===0&&error.active_step_id==='save'&&(outcome==='transport'?error.code==='ECONNRESET':error.code==='AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED'));
    assert.equal(state.dispatched.filter(item=>item.name==='browser_click').length,1);
    assert.equal(state.requests.some(item=>item.phase==='upstream_source'),false);assert.equal(state.saved.length,0);assert.equal(state.closes,1);
  }
});

test('invalid tool arguments return validation to the configured model without dispatching a rejected call',async()=>{
  const state=fixture({call:async name=>native(name==='browser_navigate'?goto:click,'### Snapshot\n- button "Save" [ref=e16]'),actor:(request,count)=>{
    if(count===1)return {tool:{name:'browser_click',arguments:{ref:12}}};
    if(count===2){const packet=JSON.parse(request.prompt);assert.equal(packet.host_feedback.code,'AUTOMATION_UPSTREAM_TOOL_INVALID');assert.equal(packet.latest_observation.tool,'browser_navigate');assert.match(packet.latest_observation.result.content[0].text,/\[ref=e16\]/);return {tool:{name:'browser_click',arguments:{ref:'e16'}}};}
    return {done:true};
  }});
  await state.run();assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_click']);assert.equal(state.saved.length,1);
});

test('read-only builds retain upstream inspection but cannot dispatch mutation tools',async()=>{
  const state=fixture({actor:()=>({tool:{name:'browser_click',arguments:{ref:'save-button'}}})});
  await assert.rejects(state.run({interactive:false,maxCallsPerSection:1}));
  assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate']);assert.equal(state.saved.length,0);assert.equal(state.closes,1);
});

test('each completed section is mapped and saved before developing the next section',async()=>{
  const steps=[step,{id:'check',step_order:2,step_type:'web',action:'Verify saved status',expected_result:'Saved is visible'}];
  let state;
  state=fixture({actor:(request,count)=>{
    if(request.step.id==='save')return count===1?{tool:{name:'browser_click',arguments:{ref:'save-button'}}}:{done:true};
    assert.equal(state.saved.length,1);const payload=JSON.parse(request.prompt);assert.equal(payload.completed_sections[0].step_id,'save');return {done:true};
  },source:request=>({automation_code:request.step.id==='save'?[goto,click,assertion].join('\n'):assertion})});
  const result=await state.run({steps});
  assert.deepEqual(state.saved.map(item=>item.step.id),['save','check']);
  assert.equal(result.updates[1].automation_code,expressionProgram(assertion));
  assert.equal(state.dispatched.filter(item=>item.name==='browser_click').length,1);assert.equal(state.requests.filter(item=>item.phase==='upstream_instruction_mapping').length,2);
});

test('native action authority binds public data and exact secret env references without accepting changed locators or parameter scopes',()=>{
  const nativeSource='await page.getByLabel("Email").fill("reader@example.test");await page.getByLabel("Password").fill(process.env["HELLOTEST_PASSWORD"]);';
  const bindings={parameterValues:{'t.email':'reader@example.test'},secretBindings:{HELLOTEST_PASSWORD:'t.password'}};
  const source='await page.getByLabel("Email").fill("@t.email");await page.getByLabel("Password").fill("@t.password");';
  assert.doesNotThrow(()=>preserveNativeActions(source,nativeSource,bindings,true));
  for(const changed of [source.replace('@t.email','@r.email'),source.replace('Email','Other')])assert.throws(()=>preserveNativeActions(changed,nativeSource,bindings,true),error=>error.code==='AUTOMATION_UPSTREAM_SOURCE_CHANGED');
});

test('private native literals stop before any subsequent model prompt, source mapping or browser replay',async()=>{
  const secret='do-not-copy-private-value';
  const state=fixture({call:async name=>name==='browser_navigate'?native(goto):native(`await page.getByLabel("Password").fill(${JSON.stringify(secret)});`),redact:text=>text.replaceAll(secret,'[private parameter value]')});
  await assert.rejects(state.run(),error=>error.code==='AUTOMATION_PRIVATE_VALUE_IN_SOURCE'&&!error.message.includes(secret));
  assert.equal(state.dispatched.filter(item=>item.name==='browser_click').length,1);
  assert.equal(state.requests.length,1);assert.doesNotMatch(JSON.stringify(state.requests),new RegExp(secret));
  assert.equal(state.saved.length,0);assert.equal(state.closes,1);
});

test('native secret typing uses the upstream secret key while saved source and all model prompts keep scoped references',async()=>{
  const secret='synthetic-secret-not-for-the-model',env='HELLOTEST_T_PASSWORD';
  const secretFill=`await page.getByLabel("Password").fill(process.env[${JSON.stringify(env)}]);`;
  const state=fixture({
    parameterBindings:{secrets:{[env]:secret},secretBindings:{[env]:'t.password'},references:{'@t.password':env},parameterValues:{}},
    redact:text=>text.replaceAll(secret,'[private parameter value]'),
    actor:(request,count)=>count===1?{tool:{name:'browser_type',arguments:{ref:'password',text:'@t.password'}}}:{done:true},
    call:async name=>native(name==='browser_navigate'?goto:secretFill),
    source:()=>({automation_code:[goto,secretFill,assertion].join('\n')})
  });
  const result=await state.run();
  assert.equal(state.dispatched[1].args.text,env);
  assert.match(result.updates[0].automation_code,/fill\(params\["t\.password"\]\)/);
  assert.doesNotMatch(result.updates[0].automation_code,/process\.env|synthetic-secret/);
  assert.doesNotMatch(JSON.stringify(state.requests),new RegExp(secret));
});

test('private verification resolves only at native dispatch and redacted native assertion source retains its exact scoped reference',async()=>{
  const secret='private-wire-only-verification-value',env='HELLOTEST_T_PASSWORD';
  const fill=`await page.getByLabel("Password").fill(process.env[${JSON.stringify(env)}]);`;
  const check=`await expect(page.getByLabel("Password")).toHaveValue(${JSON.stringify('<secret>'+env+'</secret>')});`;
  const observations=[];
  const state=fixture({
    parameterBindings:{secrets:{[env]:secret},secretBindings:{[env]:'t.password'},references:{'@t.password':env},parameterValues:{}},
    redact:text=>text.replaceAll(secret,'[private parameter value]'),
    actor:(_request,count)=>count===1?{tool_calls:[{name:'browser_type',arguments:{ref:'password',text:'@t.password'}}]}:count===2?{tool_calls:[{name:'browser_verify_value',arguments:{type:'textbox',element:'Password',target:'password',value:'@t.password'}}]}:{done:true},
    call:async(name,args)=>{
      if(name==='browser_type')assert.equal(args.text,env);
      if(name==='browser_verify_value')assert.equal(args.value,secret,'the unmodified native verification tool receives its real comparison value');
      return native(name==='browser_navigate'?goto:name==='browser_type'?fill:check);
    },
    source:()=>({automation_code:[goto,fill,check].join('\n')})
  });
  const result=await state.run({steps:[{...step,action:'Enter @t.password',expected_result:'Password retains @t.password',parameter_references:['t.password']}],onObservation:async observation=>observations.push(observation)});
  assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_type','browser_verify_value']);
  assert.match(result.updates[0].automation_code,/fill\(params\["t\.password"\]\)/);assert.match(result.updates[0].automation_code,/toHaveValue\(params\["t\.password"\]\)/);
  assert.doesNotMatch(result.updates[0].automation_code,/<secret>|process\.env|private-wire-only/);
  assert.doesNotMatch(JSON.stringify({requests:state.requests,observations,progress:state.progress,result}),new RegExp(secret));
});

test('native secret resolution uses real values only for verification and preserves reviewed empty inputs',()=>{
  const references={'@t.password':'HELLOTEST_PASSWORD','@t.empty':'HELLOTEST_EMPTY','@t.user':'public-user'};
  const secrets={HELLOTEST_PASSWORD:'private-wire-value',HELLOTEST_EMPTY:''};
  for(const value of ['@t.password','HELLOTEST_PASSWORD'])assert.equal(resolveSecretReferences('browser_verify_value',{value},references,secrets).value,'private-wire-value');
  assert.equal(resolveSecretReferences('browser_verify_value',{value:'@t.user'},references,secrets).value,'public-user');
  assert.equal(resolveSecretReferences('browser_type',{text:'@t.password'},references,secrets).text,'HELLOTEST_PASSWORD');
  assert.equal(resolveSecretReferences('browser_type',{text:'@t.empty'},references,secrets).text,'');
  assert.equal(resolveSecretReferences('browser_verify_value',{value:'HELLOTEST_EMPTY'},references,secrets).value,'');
  assert.deepEqual(resolveSecretReferences('browser_fill_form',{fields:[{name:'Password',value:'@t.password'},{name:'Empty',value:'@t.empty'}]},references,secrets).fields,[{name:'Password',value:'HELLOTEST_PASSWORD'},{name:'Empty',value:''}]);
});

test('permission revocation after a browser action prevents later synthesis and saving',async()=>{
  const state=fixture();
  await assert.rejects(state.run({assertAccess:async()=>{
    if(state.dispatched.some(item=>item.name==='browser_click'))throw Object.assign(new Error('Project permission revoked'),{statusCode:403});
  }}),error=>error.statusCode===403&&error.nonRetryable===true);
  assert.equal(state.dispatched.filter(item=>item.name==='browser_click').length,1);
  assert.equal(state.requests.some(item=>item.phase==='upstream_source'),false);assert.equal(state.saved.length,0);assert.equal(state.closes,1);
});

test('native action preservation rejects new loops, conditions, uninvoked callbacks and changed async ownership',()=>{
  const bindings={parameterValues:{},secretBindings:{}};
  for(const changed of [
    `for(let index=0;index<2;index++){${click}}`,
    `if(false){${click}}`,
    `const later=async()=>{${click}};`,
    click.replace('await ',''),
    `await Promise.all([(async()=>{${click}})()]);`,
    `try{${click}}catch{}`
  ])assert.throws(()=>preserveNativeActions(changed,click,bindings,true),error=>error.code==='AUTOMATION_UPSTREAM_SOURCE_CHANGED',changed);
  const nativeLoop=`for(const item of [1,2]){${click}}`;
  assert.doesNotThrow(()=>preserveNativeActions(nativeLoop,nativeLoop,bindings,true),'native emitted control flow retains its original behavior');
});

test('forbidden synthesized evaluation is rejected without dispatching or replaying the browser again',async()=>{
  const state=fixture({source:()=>({automation_code:[goto,click,'await page.evaluate(() => fetch("/delete",{method:"POST"}));',assertion].join('\n')})});
  await assert.rejects(state.run(),error=>error.code==='AUTOMATION_UPSTREAM_SOURCE_CAPABILITY_DENIED');
  assert.equal(state.dispatched.filter(item=>item.name==='browser_click').length,1);
  assert.equal(state.requests.filter(item=>item.phase==='upstream_source').length,3);
  assert.equal(state.saved.length,0);assert.equal(state.closes,1);
});

test('authored per-step references disambiguate equal scoped values and prior source never enters the synthesis payload',async()=>{
  const fill='await page.getByRole("textbox", {name:"Username",exact:true}).fill("admin");';
  const menu='await page.getByRole("menuitem", {name:"Admin",exact:true}).click();';
  const priorSource='await page.getByRole("button", {name:"PRIOR_SOURCE_MUST_NOT_REACH_MODEL"}).click();';
  const authored={...step,action:'Enter @r.user then open Admin',parameter_references:['r.user'],automation_code:priorSource};
  const state=fixture({
    parameterBindings:{parameterValues:{'t.user':'admin','r.user':'admin'}},
    actor:(request,count)=>count===1?{tool:{name:'browser_type',arguments:{ref:'username',text:'admin'}}}:count===2?{tool:{name:'browser_click',arguments:{ref:'admin-menu'}}}:{done:true},
    call:async name=>native(name==='browser_navigate'?goto:name==='browser_type'?fill:menu),
    source:request=>{
      const payload=JSON.parse(request.prompt);
      assert.equal(payload.step.automation_code,undefined);
      assert.doesNotMatch(request.prompt,/PRIOR_SOURCE_MUST_NOT_REACH_MODEL/);
      return {automation_code:[goto,fill,menu,assertion].join('\n')};
    }
  });
  const result=await state.run({steps:[authored]});
  const source=result.updates[0].automation_code;
  assert.match(source,/fill\(params\["r\.user"\]\)/);assert.doesNotMatch(source,/@t\.user/);
  assert.ok(source.includes(menu),'the uppercase Admin menu is preserved as a locator label');
  assert.equal(state.requests.filter(item=>item.phase==='upstream_source').length,1);
  assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_type','browser_click']);
  assert.equal(state.saved.length,1);
});

test('native observations reach the actual case hook with redacted snapshot text and retained refs follow the saved section',async()=>{
  const fs=require('node:fs'),{parse}=require('acorn'),{reduceActivityProgress}=require('../../backend/lib/automationActivityProgress');
  const serviceSource=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8');
  let hook;
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee?.property?.name==='buildWithUpstreamPlaywright')hook=node.arguments[0].properties.find(property=>property.key?.name==='onObservation')?.value;
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  };visit(parse(serviceSource,{ecmaVersion:'latest'}));assert.ok(hook,'the real native case build must retain observations');
  const observed=[],events=[];let metadata={},savedEvidence;
  const progress=async event=>{events.push(event);metadata={...metadata,...reduceActivityProgress(metadata,{...event,details:{test_case_id:'case',...event.details}})};};
  const createBrowserEvidence=async(transactionId,input)=>{
    assert.equal(transactionId,'activity');assert.equal(input.transport,'upstream_playwright_mcp');assert.equal(input.active_step_id,'save');
    assert.doesNotMatch(JSON.stringify(input),/PRIVATE_NATIVE_DATA/);observed.push(input.observation);
    assert.equal(input.observation.result.content.filter(block=>block.type==='image').length,1);
    return {test_case_id:'case',snapshot_artifact_id:'snapshot-'+observed.length,screenshot_artifact_id:'image-'+observed.length,active_step_id:'save',observed_at:input.observation.observed_at,verification_status:'unverified'};
  };
  const {onObservation,setPreview}=new Function('assertAccess','transaction_id','test_case_id','allow_browser_actions','progress','appendEvent','require',`let pendingBrowserPreview;return {onObservation:(${serviceSource.slice(hook.start,hook.end)}),setPreview:value=>{pendingBrowserPreview=value;}};`)(async()=>{},'activity','case',true,progress,async()=>{},id=>{
    if(id==='./automationAgentActivity.service')return {createBrowserEvidence};
    return require(id);
  });
  const page='### Page\n- Page URL: https://app.test/start\n### Snapshot\n```yaml\n- textbox "Email": PRIVATE_NATIVE_DATA\n```';
  const image='MASKED_UI_PREVIEW_OUTSIDE_MODEL_CHANNEL';
  const state=fixture({call:async name=>{setPreview({tool:name,url:'https://app.test/start',observed_at:new Date().toISOString(),content:[{type:'image',mimeType:'image/jpeg',data:image}]});return native(name==='browser_navigate'?goto:click,page);},redact:text=>text.replaceAll('PRIVATE_NATIVE_DATA','[private parameter value]')});
  await state.run({onObservation,onSection:async(update,evidence)=>{state.saved.push(update);savedEvidence=evidence;}});
  assert.equal(observed.length,2);assert.match(observed[0].result.content[0].text,/textbox "Email": \[private parameter value\]/);
  assert.equal(metadata.workspace_application.snapshot_artifact_id,'snapshot-2');assert.equal(savedEvidence.snapshot_artifact_id,'snapshot-2');
  assert.equal(metadata.workspace_application.screenshot_artifact_id,'image-2');assert.equal(savedEvidence.screenshot_artifact_id,'image-2');
  assert.equal(JSON.stringify(state.requests).includes(image),false,'UI-only masked pixels never enter the configured model context.');
  assert.doesNotMatch(JSON.stringify(metadata),/textbox|PRIVATE_NATIVE_DATA|await page/);
  assert.equal(events.every(event=>event.phase==='automation.agent.observation'),true);
  for(const event of state.progress.filter(event=>['automation.agent.upstream.tool','automation.agent.section.started','automation.agent.source.started','automation.agent.instructions.started'].includes(event.phase)))assert.equal(event.details.active_step_id,'save');
});

test('terminal upstream failure persists the active step error while previously saved sections stay complete',async()=>{
  const {reduceActivityProgress}=require('../../backend/lib/automationActivityProgress');
  const steps=[step,{...step,id:'second',step_order:2}];
  let metadata=reduceActivityProgress({}, {phase:'automation.agent.plan',details:{test_case_id:'case',steps:steps.map(step=>({step_id:step.id,step_order:step.step_order}))}}),clicks=0;
  const progress=async event=>{metadata={...metadata,...reduceActivityProgress(metadata,{...event,details:{test_case_id:'case',...event.details}})};};
  const state=fixture({call:async name=>{
    if(name==='browser_navigate')return native(goto);
    if(++clicks===1)return native(click);
    return {isError:true,content:[{type:'text',text:'PRIVATE_NATIVE_FAILURE_TEXT'}]};
  }});
  await assert.rejects(state.run({steps,onProgress:progress,onSection:async update=>{
    state.saved.push(update);await progress({phase:'automation.agent.section.saved',details:{step_id:update.step.id,development_status:'completed'}});
  }}),error=>error.active_step_id==='second'&&error.saved_sections===1);
  const first=metadata.step_progress.find(row=>row.step_id==='save'),second=metadata.step_progress.find(row=>row.step_id==='second');
  assert.equal(first.instruction_status,'saved');assert.equal(first.status,'completed');
  assert.equal(second.status,'needs_attention');assert.equal(second.instruction_status,'not_saved');
  assert.equal(second.build_errors[0].code,'AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED');
  assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE_NATIVE_FAILURE_TEXT/);assert.equal(clicks,2);
});

test('later same-entered-name assertions retain symbolic public values even when that section has no explicit parameter references',async()=>{
  const first='BuildSampleFirst',last='BuildSampleLast';
  const fillFirst=`await page.getByLabel("First Name").fill(${JSON.stringify(first)});`,fillLast=`await page.getByLabel("Last Name").fill(${JSON.stringify(last)});`;
  const checks=`await expect(page.getByLabel("First Name")).toHaveValue(${JSON.stringify(first)});\nawait expect(page.getByLabel("Last Name")).toHaveValue(${JSON.stringify(last)});`;
  const steps=[{...step,id:'names',action:'Enter @r.employee_first_name and @r.employee_last_name',expected_result:'Both names are entered',parameter_references:['r.employee_first_name','r.employee_last_name']},{...step,id:'same-names',step_order:2,action:'Verify the same entered names are retained',expected_result:'Both names still have their entered values',parameter_references:[]}];
  const state=fixture({parameterBindings:{parameterValues:{'r.employee_first_name':first,'r.employee_last_name':last}},actor:(request,count)=>request.step.id==='names'&&count===1?{tool_calls:[{name:'browser_type',arguments:{ref:'first',text:'@r.employee_first_name'}},{name:'browser_type',arguments:{ref:'last',text:'@r.employee_last_name'}}]}:{done:true},call:(name,args)=>native(name==='browser_navigate'?goto:args.ref==='first'?fillFirst:fillLast),source:request=>({automation_code:request.step.id==='names'?[goto,fillFirst,fillLast,checks].join('\n'):checks})});
  const result=await state.run({steps});
  assert.deepEqual(state.dispatched.map(item=>item.name),['browser_navigate','browser_type','browser_type']);assert.equal(state.saved.length,2);
  const retained=result.updates[1].automation_code;assert.match(retained,/toHaveValue\(params\["r\.employee_first_name"\]\)/);assert.match(retained,/toHaveValue\(params\["r\.employee_last_name"\]\)/);
  assert.doesNotMatch(retained,/BuildSampleFirst|BuildSampleLast/);assert.ok(validSavedInstructionMapping(result.updates[1].automation_instructions,{source:retained,stepId:'same-names'}));
});
