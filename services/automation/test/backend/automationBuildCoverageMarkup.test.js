const test=require('node:test'),assert=require('node:assert/strict');
const {matchManualCoverage,completeAutomationBuild}=require('../../backend/lib/automationBuildCompletion');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const action='Click Add Employee once to open the employee form.';
const expected='The First Name input is visible. The Last Name input is visible. The Joined Date input is visible. The Location input is visible in the Add Employee form.';
const section={id:'section-4',step_order:4,step_type:'web',action,expected_result:expected};
const manual={id:'edited-manual-4',test_case_id:'manual-case',step_order:4,step_type:'web',action:`<p>${action}</p>`,expected_result:`<p>${expected}</p>`};

test('edited rich-text Step4 rejoins all thirteen complete specifications without replacing their identities',()=>{
 const sections=Array.from({length:13},(_,i)=>i===3?section:{id:`s-${i}`,step_order:i+1,step_type:'web',action:`Action ${i}`,expected_result:`Result ${i}`});
 const manuals=sections.map((s,i)=>i===3?manual:{...s,id:`m-${i}`,test_case_id:'manual-case'});
 const before=JSON.stringify({sections,manuals}),coverage=matchManualCoverage(sections,manuals);
 assert.equal(coverage.size,13);assert.equal(coverage.get('edited-manual-4'),'section-4');
 assert.equal(JSON.stringify({sections,manuals}),before,'matching never rewrites source records, steps or IDs');
});

test('format equivalence preserves full action, every expectation clause, scoped references, case and runtime',()=>{
 for(const changed of [{action:'Do not '+manual.action},{expected_result:'<p>'+expected.replace('Last Name','Middle Name')+'</p>'},
  {expected_result:'<p>'+expected.toLowerCase()+'</p>'},{step_type:'api'}])assert.equal(matchManualCoverage([section],[{...manual,...changed}]).size,0);
 const binding={...section,action:'Enter @r.Employee_Name.',expected_result:'The input retains @r.Employee_Name and the literal <CUSTOM>.'};
 assert.equal(matchManualCoverage([binding],[{...manual,action:'<p>Enter @r.Employee_Name.</p>',expected_result:'<p>The input retains @r.Employee_Name and the literal &lt;CUSTOM&gt;.</p>'}]).size,1);
 assert.equal(matchManualCoverage([binding],[{...manual,action:'<p>Enter @t.Employee_Name.</p>',expected_result:binding.expected_result}]).size,0);
 assert.equal(matchManualCoverage([binding],[{...manual,action:'<p>Enter @r.employee_name.</p>',expected_result:binding.expected_result}]).size,0);
 assert.equal(matchManualCoverage([binding],[{...manual,action:'<p>Enter @r.Employee_Name.</p>',expected_result:'<p>The input retains @r.Employee_Name and the literal .</p>'}]).size,0);
 for(const marked of ['<a href="https://other.test/">'+action+'</a>','<span href="https://other.test/">'+action+'</span>','<custom>'+action+'</custom>'])
  assert.equal(matchManualCoverage([section],[{...manual,action:marked}]).size,0,'semantic attributes and unsupported tags cannot disappear');
 assert.equal(matchManualCoverage([section],[{...manual,action:'&lt;p&gt;'+action+'&lt;/p&gt;'}]).size,0,'decoded escaped markup is not reparsed');
});

test('new markup equivalence rejects ambiguous duplicates and keeps shared manual-case identity separate',()=>{
 assert.equal(matchManualCoverage([section,{...section,id:'other-section'}],[manual]).size,0);
 assert.equal(matchManualCoverage([section],[manual,{...manual,id:'other-manual'}]).size,0);
 const separate=matchManualCoverage([section],[manual,{...manual,id:'other-manual',test_case_id:'other-case'}]);
 assert.deepEqual([...separate],[['edited-manual-4','section-4'],['other-manual','section-4']]);
 assert.equal(matchManualCoverage([section],[{...manual,step_order:99}]).get(manual.id),section.id,'order is not authority; complete unique specification is');
});

test('accepted browser source exits once and missing coverage is repaired in a bounded metadata-only request',async()=>{
 const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
 const code=compileRecordedProgram([{name:'browser_assert',arguments:{assertion:'visible',locator:'#first-name-box'}}]).source;
 const s={...section,id:'current',action:'Verify First Name visibility.',expected_result:'The First Name input is visible.'};
 const m={...manual,id:'unmatched',action:'Inspect the First Name field.',expected_result:'The First Name field is displayed.'};
 const receipt=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/',...value})}]});
 const initial={tool:'browser_snapshot',execution_step_id:'current',result:receipt({observation_id:'current-input',scope:'body',elements:[{tag:'input',accessible_role:'textbox',accessible_name:'First Name',displayed:true,locators_validated:true,locator_candidates:['#first-name-box']}]})};
 const calls=[],requests=[],saved=[];let actorCalls=0;
 const result=await completeAutomationBuild({steps:[s],manualSteps:[m],sequential:true,
  validate:(payload,required)=>{assert.equal(payload.steps[0].automation_code,code);return{updates:payload.steps};},
  onSaveSection:async({step})=>saved.push(step.id),generate:async request=>{
   requests.push(request);
   if(!request.feedback.required_sections.length){assert.deepEqual(request.feedback.required_manual_steps.map(x=>x.manual_step_id),['unmatched']);return{steps:[],manual_coverage:[{manual_step_id:'unmatched',manual_test_case_id:'manual-case',section_step_id:'current'}]};}
   return runAutomationBrowserAgent({browser:{tools:[{name:'browser_assert',inputSchema:{type:'object'}}],call:async(name,args)=>{calls.push(name);return receipt({assertion_outcome:'satisfied'});}},
    actorMode:true,parse:JSON.parse,prompt:'Verify only First Name visibility.',initialObservations:[initial],execution:{required:true,step_id:'current',action:s.action,expected_result:s.expected_result},
    complete:async()=>{actorCalls++;return JSON.stringify({section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:'#first-name-box'}}]});},
    onPartialBuild:async payload=>{const feedback=await request.onPartial(payload);assert.equal(feedback.generation_complete,true);assert.equal(feedback.completion_phase,'manual_coverage_metadata');assert.deepEqual(feedback.missing_manual_step_ids,['unmatched']);return feedback;}});
  }});
 assert.equal(actorCalls,1);assert.deepEqual(calls,['browser_assert']);assert.deepEqual(saved,['current']);assert.equal(requests.length,2);
 assert.deepEqual(result.manual_coverage,[{manual_step_id:'unmatched',manual_test_case_id:'manual-case',section_step_id:'current'}]);
});
