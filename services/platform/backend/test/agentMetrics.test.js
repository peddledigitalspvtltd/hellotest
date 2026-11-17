const test=require('node:test');const assert=require('node:assert/strict');const metrics=require('../src/utils/agentMetrics');
test('all four actual runtime event shapes share bounded stage/model/tool/budget/failure metrics',()=>{
 for(const system of ['workflow','repository','quality','automation']){
  metrics.event(system,{phase:'compile',details:{duration_ms:17}});
  metrics.provider({agent_system:system},{stage:'provider_dispatch',dispatched:true,status:'succeeded',duration_ms:29});
  metrics.event(system,{phase:'tool.completed',details:{duration_ms:11}});
  metrics.event(system,{phase:'failed',level:'error',details:{code:'MODEL_BUDGET_EXCEEDED'}});
  metrics.event(system,{phase:'failed',level:'error',details:{code:'SOURCE_UNAVAILABLE'}});
 }
 const snapshot=metrics.snapshot();for(const family of ['workflow','repository','quality','automation'])for(const kind of ['stage','model_call','tool_call','budget_exhausted','failure'])assert.ok(snapshot.counts.some(v=>v.key.startsWith(family+'|'+kind+'|')));
 const before=snapshot.counts.reduce((n,v)=>n+v.value,0);metrics.event('workflow',{phase:'model.call',details:{stage:'provider_preflight',status:'failed',dispatched:false}});assert.equal(metrics.snapshot().counts.reduce((n,v)=>n+v.value,0),before);
 metrics.event('workflow',{phase:'failure',level:'error',details:{code:'private secret text'}});assert.doesNotMatch(metrics.format(),/private secret text/);assert.match(metrics.format(),/hellotest_agent_stage_latency_seconds_sum/);
});

test('model family attribution covers registered features without leaking model or actor labels',()=>{for(const[feature,system]of [['ai.agentic.repository.api_tests','repository'],['ai.agentic.browser.web','quality'],['ai.agentic.quality_plan','quality'],['ai.agentic.automation-engineer','automation'],['ai.agentic.workflow','workflow']])assert.equal(metrics.family({feature}),system);for (const feature of ['ai.bug.draft', 'ai.requirement.creation', 'ai.requirement.grooming', 'ai.test_case.design']) assert.equal(metrics.family({feature}), 'authoring');});

test('budget rejection before provider dispatch is visible without counting paid model work',()=>{const before=metrics.snapshot();const count=(state,kind)=>state.counts.filter(row=>row.key.startsWith('workflow|'+kind+'|')).reduce((sum,row)=>sum+row.value,0);metrics.provider({agent_system:'workflow'},{stage:'provider_preflight',dispatched:false,status:'failed',error_code:'AGENT_MODEL_BUDGET'});const after=metrics.snapshot();assert.equal(count(after,'model_call'),count(before,'model_call'));assert.equal(count(after,'budget_exhausted'),count(before,'budget_exhausted')+1);});
