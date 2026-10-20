const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const rules=require('../../backend/services/automationRepairRules');
const dispatch=fs.readFileSync(require.resolve('../../../automation/backend/services/testEngineDispatch.service'),'utf8');

function envelopeBuilder(){
 const part=(start,end)=>dispatch.slice(dispatch.indexOf(start),dispatch.indexOf(end,dispatch.indexOf(start)));
 const normalizeText=value=>value==null?null:String(value).trim();
 const dependencies={normalizeText,normalizeJsonValue:(value,fallback)=>value??fallback,normalizeInteger:(value,fallback)=>value==null?fallback:Number(value),
  preserveFrozenEngineEnvelope:require('../../../platform/backend/src/utils/frozenRunParameterCompatibility').preserveFrozenEngineEnvelope,
  configurationTargetsForRead:()=>[],normalizeEngineBrowser:(value,fallback)=>value||fallback,resolveExecutionPolicy:async()=>({}),
  normalizeSessionMode:(value,fallback)=>value||fallback,normalizeTestEngineWebEngine:(value,fallback)=>value||fallback,
  normalizeStoredReferenceList:()=>[],buildManualSpec:()=>({}),configuredRepairBrief:async()=>({}),
  resolveExecutionHooks:({caseSnapshot})=>caseSnapshot.execution_hooks,toEngineKeyValueEntries:value=>value||[],toEngineDataSetRows:rows=>rows||[]};
 return new Function(...Object.keys(dependencies),part('const normalizeStringRecord =','const normalizeCapturedValuesRecord =')
  +part('const resolveCaseDataSetContext =','const resolveEngineStepType =')
  +part('const buildEngineEnvelope =','const summarizeWarnings =')+'\nreturn buildEngineEnvelope;')(...Object.values(dependencies));
}

test('actual dispatcher keeps negative fixture data outside invariant execution settings and preserves pinned hooks',async()=>{
 const build=envelopeBuilder(),hooks=[{id:'case-before',scope:'test',phase:'pre',steps:[{id:'setup',automation_code:'await web.expectVisible("#form");'}]}];
 const common={engineRunId:'engine',project:{id:'project'},appType:{id:'app',type:'web'},integration:{config:{}},objectRepository:[],stepsByCaseId:{},
  steps:[{id:'snapshot-1',automation_code:'await web.click("#submit");'},{id:'snapshot-2',automation_code:'await web.expectText("#status", "Accepted");'}]};
 const payloads={};
 for(const phase of ['original','patched','negative'])payloads[phase]=await build({...common,
  execution:{id:phase,repair_validation:{phase},parameter_scope_default:'r',parameter_values:{'r.global':'unchanged'},test_environment:{snapshot:{base_url:'https://fixture.test'}}},
  caseSnapshot:{test_case_id:'case',parameter_values:{'t.local':'fixed'},suite_parameter_values:{'s.shared':'fixed'},execution_hooks:hooks,test_data_set_id:phase==='negative'?'bad':'good',test_data_set_name:'Fixture',data_set_source:'run',test_data_set_snapshot:{mode:'key_value',rows:[{key:'r.value',value:phase==='negative'?'bad':'good'}]}}});
 assert.notDeepEqual(payloads.negative.data_set.rows,payloads.original.data_set.rows);
 for(const phase of ['patched','negative'])for(const key of ['run_parameters','case_parameters','suite_parameters','hooks','environment','configuration','browser','timeouts','execution_policy','web_engine'])assert.deepEqual(payloads[phase][key],payloads.original[key],`${phase} ${key}`);
 const manifest={},receipts={};
 for(const phase of ['original','patched','negative']){
  manifest[phase]={hash:phase,case_ids:['case']};
  const statuses={'snapshot-1':phase==='original'?'failed':'passed','snapshot-2':phase==='negative'?'failed':'passed','test:pre:case-before:setup':'passed'};
  receipts[phase]={hash:phase,steps:common.steps.map((step,index)=>({...step,test_case_id:'case',snapshot_step_id:step.id,step_order:index+1,expected_result:index===1?'Accepted':''})),jobs:[{id:phase,test_case_id:'case',completed_at:'2026-10-19',status:phase==='patched'?'completed':'failed',payload:payloads[phase],runtime_state:{logs:{stepStatuses:statuses,...(phase==='negative'?{stepAutomationDetails:{'snapshot-2':{line_results:[{line:1,status:'failed',attempt:1,error:'Expected protected text "Accepted"; received "Rejected".'}]}}}:{})}}}]};
 }
 assert.equal(rules.evaluate(manifest,receipts,1,2).status,'verified');
 payloads.negative.hooks=[];assert.notEqual(rules.evaluate(manifest,receipts,1,2).status,'verified','negative data may differ, setup hooks may not');
});
