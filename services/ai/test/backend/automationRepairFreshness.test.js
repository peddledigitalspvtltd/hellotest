const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rules=require('../../backend/services/automationRepairRules');
const execution=require('../../../knowledge/backend/services/knowledgeExecution.service');
const diagnostics=require('../../../platform/backend/src/domain/executionStepEvidence');
const aiText=require('../../../platform/backend/src/security/aiTextPolicy');
const code=fs.readFileSync(require.resolve('../../backend/services/automationRepair.service'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const reads=[],writes=[],created=[];
 const current={id:'case',app_type_id:'app',app_type:'web',title:'Submit case',automated:'yes'};
 const steps=[{id:'setup',test_case_id:'case',step_order:1,action:'Open form',expected_result:'Form shown',step_type:'web',automation_code:'await web.expectVisible("#form");'},
  {id:'submit',test_case_id:'case',step_order:2,action:'Submit',expected_result:'',step_type:'web',automation_code:'await web.click("#old");'},
  {id:'oracle',test_case_id:'case',step_order:3,action:'Check result',expected_result:'Accepted',step_type:'web',automation_code:'await web.expectText("#state", "Accepted");'}];
 const frozenSteps=steps.map(step=>({...step,snapshot_step_id:'snapshot-'+step.id,execution_id:'failed',shared_parameter_values:{'t.shared_probe':'frozen-'+step.id},shared_parameter_template_values:{'t.shared_probe':'original-template-'+step.id},shared_parameter_sensitive_names:['t.shared_probe']}));
 const failure={id:'failed',build:'build',test_environment_id:'env',test_configuration_id:'configuration',test_data_set_id:'good',parameter_scope_default:'r',test_data_options:{override_shared_sections:false,runtime_policy:{override_shared_sections:false}},test_environment_snapshot:{base_url:'https://fixture.test'},test_configuration_snapshot:{browser:'chromium'},test_data_set_snapshot:{mode:'key_value',rows:[{key:'r.input',value:'valid'}]},execution_hooks:[],status:'failed',failure_result_id:'result',failure_error:'The submit locator was not found',failure_logs:{stepStatuses:{'snapshot-setup':'passed','snapshot-submit':'failed','snapshot-oracle':'skipped'}}};
 const originalCase={execution_id:'failed',test_case_id:'case',test_case_title:'Submit case',parameter_values:{'t.input':'frozen'},parameter_template_values:{'t.input':'frozen'},suite_parameter_values:{'s.region':'West'},suite_parameter_template_values:{'s.region':'West'},test_data_options:{override_shared_sections:false},test_data_set_id:'good',test_data_set_snapshot:clone(failure.test_data_set_snapshot),data_set_source:'run',execution_hooks:[]};
 let repairs={},runs={failed:failure},caseSnapshots={failed:[originalCase]},stepSnapshots={failed:frozenSteps};
 let onRead=()=>{},afterInsert=()=>{};
 const db={query:async()=>{},transaction:work=>async()=>{
  const before=clone({repairs,runs,caseSnapshots,stepSnapshots});
  try{return await work();}catch(error){({repairs,runs,caseSnapshots,stepSnapshots}=before);throw error;}
 },prepare:sql=>({get:async(...args)=>{
   reads.push(sql);onRead(sql,'get');
   if(sql.includes('JOIN app_types'))return current;
   if(sql.includes('JOIN execution_results'))return failure;
   if(sql.includes('FROM ai_automation_repairs'))return repairs[args.at(-1)];
   if(sql.includes('FROM execution_case_snapshots'))return caseSnapshots[args[0]]?.find(item=>item.test_case_id===args[1]);
   if(sql.includes('FROM executions'))return runs[args[0]];
   if(sql.includes('FROM test_data_sets'))return {id:'negative'};
   throw Error('Unexpected get: '+sql);
  },all:async(...args)=>{
   reads.push(sql);onRead(sql,'all');
   if(sql.includes('FROM test_steps'))return steps;
   if(sql.includes('FROM execution_step_snapshots'))return stepSnapshots[args[0]]||[];
   if(sql.includes('FROM execution_case_snapshots'))return caseSnapshots[args[0]]||[];
   if(sql.includes('FROM test_cases')||sql.includes('FROM test_data_sets'))return [];
   throw Error('Unexpected all: '+sql);
  },run:async(...args)=>{
   writes.push({sql,args});
   if(sql.startsWith('INSERT INTO ai_automation_repairs')){repairs[args[0]]={id:args[0],project_id:args[1],test_case_id:args[2],base:args[4],patch:args[5]};afterInsert();return;}
   if(sql.startsWith('UPDATE executions SET test_environment_snapshot')){
    Object.assign(runs[args.at(-1)],{test_environment_snapshot:args[0],test_configuration_snapshot:args[1],test_data_set_snapshot:args[2],execution_hooks:args[3],repair_validation:args[4],parameter_scope_default:args[5],test_data_options:args[6]});return;
   }
   if(sql.startsWith('UPDATE execution_case_snapshots SET parameter_values')){
    const keys=['parameter_values','parameter_template_values','suite_parameter_values','suite_parameter_template_values','test_data_options','test_data_set_id','test_data_set_name','test_data_set_snapshot','data_set_source','execution_hooks'];
    const target=caseSnapshots[args.at(-2)][0];keys.forEach((key,index)=>{target[key]=args[index];});return;
   }
   if(sql.startsWith('UPDATE execution_case_snapshots SET test_data_set_id')){Object.assign(caseSnapshots[args[2]][0],{test_data_set_id:args[0],test_data_set_snapshot:runs[args[1]].test_data_set_snapshot,data_set_source:'run'});return;}
   if(sql.startsWith('UPDATE execution_step_snapshots SET automation_code')){stepSnapshots[args[1]].find(step=>step.test_case_id===args[2]&&step.step_order===args[3]).automation_code=args[0];return;}
   if(sql.startsWith('UPDATE execution_step_snapshots AS target')){
    for(const target of stepSnapshots[args[0]].filter(step=>step.test_case_id===args[1])){
     const original=stepSnapshots[args[2]].find(step=>step.test_case_id===target.test_case_id&&step.step_order===target.step_order);
     if(original)for(const key of ['shared_parameter_values','shared_parameter_template_values','shared_parameter_sensitive_names'])target[key]=clone(original[key]);
    }
    return;
   }
   if(sql.startsWith('UPDATE ai_automation_repairs SET validation')){repairs[args[1]].validation=args[0];return;}
   throw Error('Unexpected write: '+sql);
  }})};
 const executions={invalidateExecutionCache:()=>{},createExecution:async input=>{
  const id='validation-'+created.length;created.push(input);
  runs[id]={...clone(failure),id,status:'queued',test_data_options:{override_shared_sections:true},test_data_set_snapshot:input.test_data_set_id==='negative'?{mode:'key_value',rows:[{key:'r.input',value:'invalid'}]}:clone(failure.test_data_set_snapshot)};
  caseSnapshots[id]=[{...clone(originalCase),execution_id:id}];stepSnapshots[id]=steps.map(step=>({...clone(step),execution_id:id,snapshot_step_id:id+'-'+step.id,shared_parameter_values:{'t.shared_probe':'REGENERATED-'+id},shared_parameter_template_values:{'t.shared_probe':'edited-template'},shared_parameter_sensitive_names:[]}));return{id};
 }};
 const obsDb={prepare:()=>({all:async()=>[]})},module={exports:{}};
 vm.runInNewContext(code,{module,Buffer,require:id=>{
  if(id.endsWith('/obsDb'))return obsDb;if(id.endsWith('/db'))return db;
  if(id.endsWith('/optionalEvidenceAccess.service'))return {getOptionalEvidenceAccess:async(user,project,codes)=>Object.fromEntries(codes.map(code=>[code,true]))};
  if(id.endsWith('/execution.service'))return executions;if(id.endsWith('/executionStepEvidence'))return diagnostics;
  if(id.endsWith('/aiTextPolicy'))return aiText;if(id.endsWith('/knowledgeExecution.service'))return execution;
  if(id==='./automationRepairRules')return rules;if(id==='./automationRepairContext')return require('../../backend/services/automationRepairContext');
  throw Error('Unexpected module: '+id);
 }});
 const service=module.exports,prepare=()=>service.prepare({projectId:'project',appTypeId:'app',user:{id:'reviewer'},input:{test_case_id:'case',execution_id:'failed'}});
 const patch=prepared=>rules.patch(prepared.base,{kind:'replace_locator',step_id:'submit',new_locator:'#new',rationale:'The observed snapshot identifies the replacement submit control.'});
 return {service,prepare,patch,reads,writes,created,failure,originalCase,steps,get runs(){return runs;},get repairs(){return repairs;},get stepSnapshots(){return stepSnapshots;},onRead(fn){onRead=fn;},afterInsert(fn){afterInsert=fn;}};
}

test('proposal save rejects changed diagnostics or frozen case values after model review',async()=>{
 for(const changed of ['diagnostics','case-data','run-policy','frozen-source']){
  const f=fixture(),prepared=await f.prepare();assert.equal(prepared.status,'eligible');
  assert.equal(prepared.base.failure_result_id,'result');assert.match(prepared.base.failure_source_hash,/^[a-f0-9]{64}$/);
  if(changed==='diagnostics')f.failure.failure_logs.stepStatuses['snapshot-submit']='passed';
  if(changed==='case-data')f.originalCase.parameter_values['t.input']='different';
  if(changed==='run-policy')f.failure.test_data_options.override_shared_sections=true;
  if(changed==='frozen-source')f.originalCase.test_data_set_snapshot.rows[0].value='different';
  await assert.rejects(f.service.save('project',{id:'reviewer'},'repair',prepared,f.patch(prepared)),/recorded failure evidence or frozen test data changed/);
  assert.equal(Object.keys(f.repairs).length,0,changed);
 }
});

test('an incomplete prerequisite stops focused repair before model context or proposal creation',async()=>{
 const f=fixture();delete f.failure.failure_logs.stepStatuses['snapshot-setup'];
 const prepared=await f.prepare();assert.equal(prepared.status,'needs_evidence');assert.match(prepared.detail,/successful prerequisites/);assert.equal(prepared.projection,undefined);
});

test('fresh proposal planning retains frozen run policies and refuses stale source failure data',async()=>{
 let f=fixture(),prepared=await f.prepare();
 await f.service.save('project',{id:'reviewer'},'repair',prepared,f.patch(prepared));
 const input={neighbor_ids:[],negative_data_set_id:'negative',oracle_step_id:'oracle',fixture_contract:'Use one isolated fixture per browser with a complete reset; known-invalid input must fail the acceptance oracle.'};
 f.failure.test_data_options.override_shared_sections=true;
 await assert.rejects(f.service.plan('project','repair',{id:'reviewer'},input),/recorded failure evidence/);assert.equal(f.created.length,0);
 f=fixture();prepared=await f.prepare();await f.service.save('project',{id:'reviewer'},'repair',prepared,f.patch(prepared));
 const result=await f.service.plan('project','repair',{id:'reviewer'},input);
 assert.equal(f.created.length,3);assert.equal(result.status,'unverified');
 for(const phase of ['original','patched','negative']){
  const runId=result.validation[phase].id;
  assert.deepEqual(f.runs[runId].test_data_options,f.failure.test_data_options,phase);
  assert.deepEqual(rules.sharedBindings(f.stepSnapshots[runId]),rules.sharedBindings(f.stepSnapshots.failed),phase);
  assert.notEqual(f.stepSnapshots[runId][0].snapshot_step_id,f.stepSnapshots.failed[0].snapshot_step_id);
  assert.equal(f.stepSnapshots[runId][1].automation_code,phase==='original'?'await web.click("#old");':'await web.click("#new");');
 }
 assert.equal(f.runs[result.validation.negative.id].test_data_set_snapshot.rows[0].value,'invalid','the negative dataset remains independent of copied shared bindings');
 const id=result.validation.patched.id;f.runs[id].test_data_options.runtime_policy.override_shared_sections=true;
 const changed=await f.service.load('project','repair');assert.equal(changed.verification.checks.find(check=>check.phase==='patched').status,'unknown');
});

test('aborted reviews cannot persist proposals and cancellation during save rolls back its write',async()=>{
 for(const when of ['before','during-source','after-insert']){
  const f=fixture(),prepared=await f.prepare(),controller=new AbortController();
  if(when==='before')controller.abort();
  if(when==='during-source')f.onRead(sql=>{if(sql.includes('FROM execution_case_snapshots'))controller.abort();});
  if(when==='after-insert')f.afterInsert(()=>controller.abort());
  await assert.rejects(execution.run({signal:controller.signal},()=>f.service.save('project',{id:'reviewer'},'repair',prepared,f.patch(prepared))),error=>error.code==='REQUEST_CANCELLED');
  assert.equal(Object.keys(f.repairs).length,0,when);
  assert.equal(f.writes.some(write=>write.sql.startsWith('INSERT')),when==='after-insert',when);
 }
});
