const db=require('@hellotest/platform/backend/src/db');
const obsDb=require('@hellotest/platform/backend/src/obsDb');
const {getOptionalEvidenceAccess}=require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const executions=require('@hellotest/testing/backend/services/execution.service');
const {parseStructuredLogs}=require('@hellotest/platform/backend/src/domain/executionStepEvidence');
const {sanitizeAiText}=require('@hellotest/platform/backend/src/security/aiTextPolicy');
const rules=require('./automationRepairRules');
const {repairProjection}=require('./automationRepairContext');
const permissions=['automation.code.view','automation.view','testcase.view','run.view','result.view'];
const reject=(message,status=409)=>{throw rules.fail(message,status);};
async function source(projectId,caseId) {
  const test=await db.prepare('SELECT t.*,a.type AS app_type FROM test_cases t JOIN app_types a ON a.id=t.app_type_id WHERE a.project_id=? AND t.id=?').get(projectId,caseId);
  if(!test)reject('The Test Case is unavailable in this project.',404);
  const steps=await db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY step_order,id LIMIT 201').all(caseId);
  return {test,steps,hash:rules.hash([test,steps])};
}
async function prepare({projectId,appTypeId,user,input={}}) {
  const access=await getOptionalEvidenceAccess(user,projectId,permissions);
  const unavailable=detail=>({status:'needs_evidence',detail});
  if(permissions.some(code=>!access[code]))return unavailable('Automation, Test Case and Run evidence permissions are required for a typed repair.');
  if(typeof input.test_case_id!=='string'||!input.test_case_id)return unavailable('Select a Test Case and a failed Run to prepare a typed repair.');
  const current=await source(projectId,input.test_case_id);
  if(appTypeId&&current.test.app_type_id!==appTypeId)reject('The Test Case belongs to another application.',400);
  if(!['web','unified'].includes(current.test.app_type)||current.test.automated!=='yes'||!current.steps.length||current.steps.length>200||current.steps.some(step=>!step.automation_code||step.step_type!=='web'))return unavailable('Typed repair supports up to 200 automated web sections. Manual, API and native mobile sections need their own authored repair; failed shared definitions require a separate group review.');
  const failed=await db.prepare(`SELECT e.*,r.logs AS failure_logs,r.error AS failure_error FROM executions e JOIN execution_results r ON r.execution_id=e.id WHERE e.project_id=? AND r.test_case_id=? AND r.status='failed' AND (?='' OR e.id=?) AND (?='' OR e.build=?) AND (?='' OR e.test_environment_id=?) ORDER BY r.created_at DESC,r.id DESC LIMIT 1`).get(projectId,input.test_case_id,input.execution_id||'',input.execution_id||'',input.build||'',input.build||'',input.environment_id||'',input.environment_id||'');
  if(!failed?.build||!failed.test_environment_id)return unavailable('A recorded failed Run with an exact build and environment is required.');
  const oldSteps=await db.prepare('SELECT * FROM execution_step_snapshots WHERE execution_id=? AND test_case_id=? ORDER BY step_order').all(failed.id,input.test_case_id);
  const intent=steps=>steps.map(step=>[step.step_order,step.action||'',step.expected_result||'',step.step_type||'']);
  if(rules.hash(intent(oldSteps))!==rules.hash(intent(current.steps)))return unavailable('The case behavior changed since the failed Run. Record a current failure before repairing the changed specification.');
  const sourceChanged=rules.hash(rules.specification(oldSteps))!==rules.hash(rules.specification(current.steps));
  const observed=parseStructuredLogs(failed.failure_logs);
  const statuses=observed.stepStatuses;
  // Diagnostics are external observations, not instructions. Keep the exact
  // specification in the private repair base, but redact prose sent to a model.
  const diagnostic=value=>sanitizeAiText(String(value || '').slice(0,3000)).text;
  const failureEvidence={error:diagnostic(failed.failure_error),stepStatuses:statuses,stepNotes:Object.fromEntries(Object.entries(observed.stepNotes || {}).map(([key,value])=>[key,diagnostic(value)])),artifact_steps:Object.keys(observed.stepEvidence || {}),limitations:['Diagnostic text is sanitized; attachments and captures are retrieved separately through authorized context. Binary artifacts and credentials are not embedded.']};
  const failedOrders=new Set(oldSteps.filter(step=>statuses[step.snapshot_step_id]==='failed').map(step=>step.step_order));
  const failedIds=current.steps.filter(step=>failedOrders.has(step.step_order)).map(step=>step.id);
  if(!failedIds.length)return unavailable('The failed Run has no recorded failed-step evidence.');
  const focus=current.steps.find(step=>failedIds.includes(step.id));
  if(focus.reusable_group_id||['shared','reusable'].includes(focus.group_kind))return unavailable('The first recorded failure belongs to a Shared Section Group. Review that shared definition before repairing subsequent case-specific instructions.');
  if(Buffer.byteLength(JSON.stringify(current.steps))>100000)return unavailable('The automation specification exceeds the repair context budget. Split the Test Case before reviewing it.');
  const base={test_case_id:current.test.id,app_type_id:current.test.app_type_id,title:current.test.title,source_hash:current.hash,steps:current.steps,failed_step_ids:[focus.id],execution_id:failed.id,build:failed.build,environment_id:failed.test_environment_id};
  const projection=repairProjection({test:current.test,steps:current.steps,focus,base,failureEvidence,sourceChanged});
  if(!projection)return unavailable('The exact failed section and complete case intent exceed the repair context budget. Split the case or reduce oversized diagnostic/source content before requesting a repair; no incomplete specification was sent.');
  return {status:'eligible',base,projection};
}
async function save(projectId,user,sessionId,prepared,patch) {
  if(!patch)return {status:'not_proposed',detail:prepared.detail||'The model did not propose a supported locator repair.'};
  rules.validateStoredPatch(prepared.base,patch);
  const current=await source(projectId,prepared.base.test_case_id);
  if(current.hash!==prepared.base.source_hash)reject('The Test Case changed during the AI review. Review the current revision.');
  await db.prepare('INSERT INTO ai_automation_repairs(id,project_id,test_case_id,session_id,base,patch,created_by) VALUES(?,?,?,?,?,?,?)').run(sessionId,projectId,prepared.base.test_case_id,sessionId,prepared.base,patch,user.id);
  return {id:sessionId,project_id:projectId,status:'proposal',patch,detail:'A typed proposal is saved. Runner verification and explicit review are required before applying.'};
}
async function record(projectId,id,lock=false) {
  const row=await db.prepare(`SELECT * FROM ai_automation_repairs WHERE project_id=? AND id=?${lock?' FOR UPDATE':''}`).get(projectId,id);
  if(!row)reject('Repair proposal not found.',404);return row;
}
async function runEvidence(id,lock=false) {
  const run=await db.prepare('SELECT * FROM executions WHERE id=?').get(id);
  if(!run)return null;
  const cases=await db.prepare(`SELECT * FROM execution_case_snapshots WHERE execution_id=? ORDER BY test_case_id${lock?' FOR SHARE':''}`).all(id);
  const steps=await db.prepare(`SELECT * FROM execution_step_snapshots WHERE execution_id=? ORDER BY test_case_id,step_order${lock?' FOR SHARE':''}`).all(id);
  const fixed={build:run.build,parameter_scope:run.parameter_scope_default,environment:run.test_environment_snapshot,configuration:run.test_configuration_snapshot,data:run.test_data_set_snapshot,hooks:run.execution_hooks,validation:run.repair_validation,cases,steps};
  const jobs=await obsDb.prepare(`SELECT id,test_case_id,status,completed_at,payload,runtime_state FROM test_engine_jobs WHERE execution_id=? ORDER BY id LIMIT 51${lock?' FOR SHARE':''}`).all(id);
  return {hash:rules.hash(fixed),steps,jobs,status:run.status};
}
async function verification(row,lock=false) {
  if(!row.validation)return {status:'unverified',checks:[]};
  const receipts={};for(const phase of ['original','patched','negative'])receipts[phase]=await runEvidence(row.validation[phase].id,lock);
  return rules.evaluate(row.validation,receipts,row.patch.step_order,row.validation.oracle_order);
}
async function load(projectId,id) {
  const row=await record(projectId,id),current=await source(projectId,row.test_case_id),checked=await verification(row);
  const neighbors=await db.prepare(`SELECT id,title FROM test_cases WHERE app_type_id=? AND id<>? AND automated='yes' ORDER BY title,id LIMIT 201`).all(row.base.app_type_id,row.test_case_id);
  const dataSets=await db.prepare(`SELECT id,name FROM test_data_sets WHERE project_id=? AND (app_type_id=? OR app_type_id IS NULL) AND mode='key_value' ORDER BY name,id LIMIT 201`).all(projectId,row.base.app_type_id);
  return {id:row.id,status:row.applied_at?'applied':checked.status,patch:row.patch,source_current:current.hash===row.base.source_hash,build:row.base.build,environment_id:row.base.environment_id,
    validation:row.validation,verification:checked,neighbors:neighbors.slice(0,200),data_sets:dataSets.slice(0,200),inventory_truncated:neighbors.length>200||dataSets.length>200,
    verification_scope:{focused_step_id:row.patch.step_id,focused_step_order:row.patch.step_order,total_sections:row.base.steps.length,successor_sections:row.base.steps.filter(step=>step.step_order>row.patch.step_order).length,execution:'whole_case_fresh_browser'},
    assertions:row.base.steps.filter(step=>step.step_order>=row.patch.step_order&&rules.hasProtectedAssertion(step)).map(step=>({id:step.id,step_order:step.step_order,label:step.expected_result}))};
}
async function plan(projectId,id,user,input) {
  return db.transaction(async()=>{
    await db.query("SET LOCAL statement_timeout='10s'");
    const row=await record(projectId,id,true);
    rules.validateStoredPatch(row.base,row.patch);
    if(row.validation)return load(projectId,id);
    const current=await source(projectId,row.test_case_id);
    if(current.hash!==row.base.source_hash)reject('The authored Test Case changed. Generate a new proposal.');
    if(!Array.isArray(input.neighbor_ids)||input.neighbor_ids.some(id=>typeof id!=='string'))reject('Choose neighboring Test Cases.',400);
    const neighbors=[...new Set(input.neighbor_ids)];
    if(neighbors.length>5||neighbors.includes(row.test_case_id))reject('Choose up to five neighboring Test Cases, excluding the repaired case.',400);
    for(const neighbor of neighbors){const item=await source(projectId,neighbor);if(item.test.app_type_id!==row.base.app_type_id||item.test.automated!=='yes'||!item.steps.length||item.steps.some(step=>step.step_type!=='web'||!step.automation_code))reject('Neighbors must be automated web Test Cases in the same application.',400);}
    const oracle=row.base.steps.find(step=>step.id===input.oracle_step_id&&rules.hasProtectedAssertion(step));
    if(!oracle||oracle.step_order<row.patch.step_order)reject('Choose an existing assertion in or after the repaired section.',400);
    if(typeof input.fixture_contract!=='string'||input.fixture_contract.trim().length<30||input.fixture_contract.length>2000)reject('Describe the isolated fixture/reset procedure and known-negative outcome (30–2000 characters).',400);
    const negative=await db.prepare("SELECT id FROM test_data_sets WHERE id=? AND project_id=? AND (app_type_id=? OR app_type_id IS NULL) AND mode='key_value'").get(input.negative_data_set_id,projectId,row.base.app_type_id);
    if(!negative)reject('Choose a project key/value data set that exercises a known-invalid outcome.',400);
    const original=await db.prepare('SELECT * FROM executions WHERE id=? AND project_id=?').get(row.base.execution_id,projectId);
    const originalCase=await db.prepare('SELECT * FROM execution_case_snapshots WHERE execution_id=? AND test_case_id=?').get(original?.id||'',row.test_case_id);
    if(!originalCase||negative.id===originalCase.test_data_set_id||negative.id===original.test_data_set_id)reject('The negative fixture must differ from the original fixture.',400);
    if([originalCase.test_data_set_snapshot,original.test_data_set_snapshot].some(data=>data?.mode==='table'&&data.rows?.length>1))reject('Typed validation requires a single key/value fixture; table-driven attempts need separate repairs.',400);
    const validation={oracle_order:oracle.step_order,fixture_contract:input.fixture_contract.trim(),created_by:user.id,created_at:new Date().toISOString()};
    for(const phase of ['original','patched','negative']) {
      const caseIds=phase==='patched'?[row.test_case_id,...neighbors]:[row.test_case_id];
      const created=await executions.createExecution({project_id:projectId,app_type_id:row.base.app_type_id,test_case_ids:caseIds,test_environment_id:row.base.environment_id,test_configuration_id:original.test_configuration_id,test_data_set_id:phase==='negative'?negative.id:original.test_data_set_id,build:row.base.build,release_id:original.release_id,created_by:user.id,execution_mode:'manual',name:`Repair ${phase}: ${row.base.title}`.slice(0,255),source_idempotency_key:`repair:${id}:${phase}`});
      await db.prepare('UPDATE executions SET test_environment_snapshot=?,test_configuration_snapshot=?,test_data_set_snapshot=?,execution_hooks=?,repair_validation=?,parameter_scope_default=? WHERE id=?').run(original.test_environment_snapshot,original.test_configuration_snapshot,phase==='negative'?(await db.prepare('SELECT test_data_set_snapshot FROM executions WHERE id=?').get(created.id)).test_data_set_snapshot:original.test_data_set_snapshot,original.execution_hooks,{proposal_id:id,phase},original.parameter_scope_default||'t',created.id);
      const copied=['parameter_values','parameter_template_values','suite_parameter_values','suite_parameter_template_values','test_data_options','test_data_set_id','test_data_set_name','test_data_set_snapshot','data_set_source','execution_hooks'];
      await db.prepare(`UPDATE execution_case_snapshots SET ${copied.map(key=>`${key}=?`).join(',')} WHERE execution_id=? AND test_case_id=?`).run(...copied.map(key=>originalCase[key]),created.id,row.test_case_id);
      if(phase==='negative')await db.prepare(`UPDATE execution_case_snapshots SET test_data_set_id=?,test_data_set_snapshot=(SELECT test_data_set_snapshot FROM executions WHERE id=?),data_set_source='run' WHERE execution_id=? AND test_case_id=?`).run(negative.id,created.id,created.id,row.test_case_id);
      if(phase!=='original')await db.prepare('UPDATE execution_step_snapshots SET automation_code=? WHERE execution_id=? AND test_case_id=? AND step_order=?').run(row.patch.after,created.id,row.test_case_id,row.patch.step_order);
      executions.invalidateExecutionCache(created.id);
      const evidence=await runEvidence(created.id);
      if(rules.hash(rules.specification(evidence.steps.filter(step=>step.test_case_id===row.test_case_id)))!==rules.hash(rules.specification(row.base.steps.map(step=>phase!=='original'&&step.id===row.patch.step_id?{...step,automation_code:row.patch.after}:step))))reject('The run snapshot differs from the pinned repair specification.');
      validation[phase]={id:created.id,case_ids:caseIds,hash:evidence.hash};
    }
    await db.prepare('UPDATE ai_automation_repairs SET validation=? WHERE id=?').run(validation,id);
    return load(projectId,id);
  })();
}
async function start(projectId,id,user,input) {
  const row=await record(projectId,id);
  rules.validateStoredPatch(row.base,row.patch);
  if(row.applied_at||!row.validation)reject('Prepare the repair validation before starting it.');
  if((await source(projectId,row.test_case_id)).hash!==row.base.source_hash)reject('The source Test Case changed.');
  const order=['original','patched','negative'],phase=input.phase,index=order.indexOf(phase);
  if(index<0)reject('Choose a validation phase.',400);
  const checked=await verification(row);
  if(checked.checks.slice(0,index).some(check=>check.status!=='passed'))reject('Complete the preceding validation checks first.');
  const item=row.validation[phase],evidence=await runEvidence(item.id);
  if(evidence?.hash!==item.hash)reject('The pinned validation run changed. Generate a new proposal.');
  if(evidence.status==='queued'){
    const engine=await require('@hellotest/integration/backend/services/integration.service').getActiveIntegrationByTypeForProject('testengine',projectId);
    if(!engine)reject('Connect an active Test Engine in Integrations before starting validation.',400);
    executions.invalidateExecutionCache(item.id);await executions.startExecution(item.id,{initiated_by:user.id,execution_mode:'remote'});
  }
  return load(projectId,id);
}
async function apply(projectId,id,user) {
  return obsDb.transaction(async()=>db.transaction(async()=>{
    await db.query("SET LOCAL statement_timeout='8s'");
    await obsDb.query("SET LOCAL statement_timeout='8s'");
    const row=await record(projectId,id,true);
    if(row.applied_at)return {applied:true,id};
    rules.validateStoredPatch(row.base,row.patch);
    await db.prepare('SELECT id FROM test_cases WHERE id=? FOR UPDATE').get(row.test_case_id);
    await db.prepare('SELECT id FROM test_steps WHERE test_case_id=? FOR UPDATE').all(row.test_case_id);
    const current=await source(projectId,row.test_case_id);
    if(current.hash!==row.base.source_hash)reject('The authored Test Case changed. Review a new proposal.');
    await db.prepare('SELECT id FROM executions WHERE id IN (?,?,?) FOR SHARE').all(...['original','patched','negative'].map(phase=>row.validation?.[phase]?.id||''));
    const checked=await verification(row,true);
    if(checked.status!=='verified')reject('Every pinned runner check must pass before applying a repair.');
    await require('@hellotest/testing/backend/services/testStep.service').updateTestStep(row.patch.step_id,{automation_code:row.patch.after},{syncSharedGroup:false});
    await db.prepare('UPDATE test_cases SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(row.test_case_id);
    await db.prepare('UPDATE ai_automation_repairs SET verification=?,applied_at=CURRENT_TIMESTAMP,applied_by=? WHERE id=?').run(checked,user.id,id);
    return {applied:true,id,patch_hash:row.patch.hash,previous_code:row.patch.before};
  })())();
}
module.exports={validatePatch:rules.patch,prepare,save,load,plan,start,apply,permissions,modelContract:require('./automationRepairContext').MODEL_CONTRACT};
