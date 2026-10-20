const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rules=require('../../backend/services/automationRepairRules');
const {compileRecordedProgram}=require('../../../automation/backend/lib/automationRecordedProgram');
const serviceSource=fs.readFileSync(require.resolve('../../backend/services/automationRepair.service'),'utf8');

function fixture(){
 const steps=[{id:'setup',step_order:1,step_type:'web',action:'Open form',expected_result:'Form displayed',automation_code:'await web.expectVisible("#form");'},
  {id:'last',step_order:2,step_type:'web',action:'Enter password',expected_result:'Password entered without errors',automation_code:compileRecordedProgram([{name:'browser_fill',arguments:{locator:'#old',value:'@r.password'}},{name:'browser_assert',arguments:{assertion:'field_valid',locator:'#old'}}]).source}];
 const current={id:'case',app_type_id:'app',title:'Password case'},base={test_case_id:'case',app_type_id:'app',steps,failed_step_ids:['last'],source_hash:rules.hash([current,steps])};
 const row={id:'repair',test_case_id:'case',base,patch:rules.patch(base,{kind:'replace_locator',step_id:'last',new_locator:'#password',rationale:'The captured native password field uses this current ID.'})};
 const db={transaction:work=>()=>work(),query:async()=>{},prepare:sql=>({get:async()=>sql.includes('ai_automation_repairs')?row:current,all:async()=>steps})};
 const module={exports:{}};
 vm.runInNewContext(serviceSource,{module,Buffer,require:id=>{
  if(id.endsWith('/obsDb'))return {};
  if(id.endsWith('/db'))return db;
  if(id.endsWith('/optionalEvidenceAccess.service'))return {};
  if(id.endsWith('/execution.service'))return {};
  if(id.endsWith('/executionStepEvidence'))return {};
  if(id.endsWith('/aiTextPolicy'))return {};
  if(id.endsWith('/knowledgeExecution.service'))return require('../../../knowledge/backend/services/knowledgeExecution.service');
  if(id==='./automationRepairRules')return rules;
  if(id==='./automationRepairContext')return require('../../backend/services/automationRepairContext');
  throw Error(`Unexpected dependency: ${id}`);
 }});
 return module.exports;
}

test('last-section poll oracle and no neighboring cases reach the real fixture guard',async()=>{
 const service=fixture();
 await assert.rejects(service.plan('project','repair',{id:'reviewer'},{neighbor_ids:[],oracle_step_id:'last',fixture_contract:''}),error=>error.statusCode===400&&/isolated fixture\/reset procedure/.test(error.message));
});
test('an assertion before the repaired section cannot protect a negative fixture',async()=>{
 const service=fixture();
 await assert.rejects(service.plan('project','repair',{id:'reviewer'},{neighbor_ids:[],oracle_step_id:'setup',fixture_contract:''}),/assertion in or after/i);
});
