const test=require('node:test');
const assert=require('node:assert/strict');
const {modelObservationHistory,browserPromptContext}=require('../../backend/lib/automationBrowserContext');
const url='https://fixture.test/login';
const observation=(step,tool,value,args={},extra={})=>({tool,execution_step_id:step,arguments:args,observed_at:'2026-10-18T12:00:00Z',
 result:{content:[{type:'text',text:JSON.stringify({source:'playwright',url,...value})}]},...extra});
const check=(step,assertion='visible')=>observation(step,'browser_assert',{assertion_outcome:'satisfied',match_count:1},{assertion,locator:'#retained-host-locator'});

test('prior successful checks become historical counts while current receipts and full host observations stay intact',()=>{
 const past=[observation('first','browser_navigate',{action_outcome:'completed'}),...['url','visible','visible','visible'].map(assertion=>check('first',assertion)),
  observation('second','browser_fill',{action_outcome:'completed',match_count:1,unique:true}),check('second','value'),check('second','field_valid')];
 const current=[observation('current','browser_fill',{action_outcome:'completed',match_count:1,unique:true},{locator:'#password'}),check('current','value')];
 const all=[...past,...current],before=structuredClone(all),projected=modelObservationHistory(all,'current');
 assert.deepEqual(projected.filter(row=>row.tool==='historical_assertion_summary'),[
  {tool:'historical_assertion_summary',step_id:'first',evidence_scope:'prior_section_only',satisfied_check_count:4},
  {tool:'historical_assertion_summary',step_id:'second',evidence_scope:'prior_section_only',satisfied_check_count:2}
 ]);
 assert.equal(projected.filter(row=>row.tool==='browser_assert').length,0);
 assert.deepEqual(browserPromptContext(all,'current',{compactModel:true}).current,browserPromptContext(current,'current',{compactModel:true}).current);
 assert.deepEqual(all,before); assert.equal(all.filter(row=>row.tool==='browser_assert').length,7);
 assert.ok(JSON.stringify(projected).length<JSON.stringify(past.map(row=>({tool:row.tool,step_id:row.execution_step_id,action_outcome:row.tool==='browser_assert'?undefined:'completed',assertion:row.arguments.assertion,assertion_outcome:row.tool==='browser_assert'?'satisfied':undefined,match_count:row.tool==='browser_navigate'?undefined:1,unique:row.tool==='browser_fill'?true:undefined,failed:false}))).length-300);
 assert.doesNotMatch(JSON.stringify(projected),/retained-host-locator|observed_at/);
});

test('prior failures, uncertain actions and current correction feedback never become success summaries',()=>{
 const failed=observation('prior','browser_assert',{}, {assertion:'text'}, {result:{isError:true,content:[{type:'text',text:JSON.stringify({source:'playwright',code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied'})}]}});
 const uncertain=observation('prior','browser_click',{action_outcome:'unknown'});
 const attempted=observation('prior','browser_fill',{action_outcome:'completed',match_count:1,unique:true});
 const feedback={tool:'automation_assertion_feedback',execution_step_id:'current',mcp_call:false,result:{isError:true,content:[{type:'text',text:JSON.stringify({code:'AUTOMATION_BROWSER_EXPECTED_PROSE_AS_TEXT',message:'Preserve this exact correction.',action_outcome:'not_attempted',remaining_contract:'browser_assert_required'})}]}};
 const rows=[check('prior'),failed,uncertain,attempted,feedback],history=modelObservationHistory(rows,'current');
 assert.equal(history[0].satisfied_check_count,1);assert.equal(history[1].tool,'browser_assert');assert.equal(history[1].failed,true);assert.equal(history[1].code,'BROWSER_ASSERTION_NOT_SATISFIED');
 assert.equal(history[2].tool,'browser_click');assert.equal(history[2].action_outcome,'unknown');assert.equal(history[3].tool,'browser_fill');assert.equal(history[3].action_outcome,'completed');
 assert.deepEqual(history[4],{tool:'automation_assertion_feedback',step_id:'current',mcp_call:false,code:'AUTOMATION_BROWSER_EXPECTED_PROSE_AS_TEXT',action_outcome:'not_attempted',remaining_contract:'browser_assert_required',message:'Preserve this exact correction.'});
 assert.equal(browserPromptContext(rows,'current',{compactModel:true}).current.recent_section_receipts.length,0,'historical successes never establish a current predicate');
});

test('unknown, unscoped and unperformed checks cannot earn historical success counts and future history stays bounded',()=>{
 const fake=check('past');fake.mcp_call=false;
 const unscoped=check(undefined),unknown=observation('past','browser_assert',{assertion_outcome:'unknown'},{assertion:'value'});
 const invalid=modelObservationHistory([fake,unscoped,unknown],'current');assert.equal(invalid.some(row=>row.tool==='historical_assertion_summary'),false);
 const prior=Array.from({length:40},(_,index)=>[check(`step-${index}`),check(`step-${index}`),observation(`step-${index}`,'browser_fill',{action_outcome:'completed'})]).flat();
 const current=check('current','field_valid');const rows=[...prior,current];
 const history=modelObservationHistory(rows,'current');assert.ok(history.length<=10);assert.ok(JSON.stringify(history).length<=4500);
 assert.deepEqual(browserPromptContext(rows,'current',{compactModel:true}).current,browserPromptContext([current],'current',{compactModel:true}).current);
});
