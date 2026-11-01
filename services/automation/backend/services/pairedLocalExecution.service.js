const {randomUUID,randomBytes} = require('node:crypto');
const db = require('@hellotest/platform/backend/src/db');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const projects = require('@hellotest/platform/backend/public/projectAccess');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const security = require('../lib/pairedLocalSecurity');
const {fail,id,origin,digest,derive,equal,seal,open,publicApiBase} = security;
const aad = row => `${row.id}:${row.execution_id}:${row.actor_id}`;
const token = row => derive('execution-claim',row.id,row.execution_id,row.actor_id,row.agent_id,row.grant_nonce);
const callbackKey = (row,engineRunId,testCaseId) => derive('execution-callback',row.id,row.execution_id,row.actor_id,engineRunId,testCaseId,row.grant_nonce);
const receipt = row => ({protocol_version:1,execution_id:row.execution_id,dispatch_id:row.id,
  claim_url:`${publicApiBase(row.application_origin)}/executions/${encodeURIComponent(row.execution_id)}/local-dispatch/claim`,
  grant_token:token(row),expires_at:new Date(row.claim_expires_at).toISOString()});

function createService(dependencies={}) {
  const store=dependencies.db||db,grants=dependencies.permissions||permissions,access=dependencies.projects||projects,features=dependencies.flags||flags;
  const dispatch=()=>dependencies.dispatch||require('./testEngineDispatch.service');
  async function authorize(projectId,actorId) {
    const user=await store.prepare("SELECT id,is_workspace_admin,CASE WHEN is_workspace_admin THEN 'admin' ELSE 'member' END AS role FROM users WHERE id=? AND status='active'").get(actorId);
    if(!user)throw fail('The local execution owner is no longer active.',403,'PAIRED_LOCAL_FORBIDDEN');
    await access.getProject(projectId,user.id);
    if(!await grants.hasPermission(user,'automation.run.local',projectId)
      ||!await features.areEnabled(features.getFeatureKeysForPermission('automation.run.local'),{user}))throw fail('Local execution permission is no longer available.',403,'PAIRED_LOCAL_FORBIDDEN');
    return user;
  }
  async function prepare({execution,plan,user,agentId,applicationOrigin,requestHash,integration}={}) {
    id(execution?.id,'execution');id(user?.id,'owner');agentId=id(agentId,'agent');applicationOrigin=origin(applicationOrigin);
    await authorize(execution.project_id,user.id);
    if(!['queued','running'].includes(execution.status))throw fail('This Run has finished. Create a new Run to execute its saved cases.',409,'PAIRED_LOCAL_RUN_FINISHED');
    return store.transaction(async()=>{
      await store.prepare('SELECT id FROM executions WHERE id=? FOR UPDATE').get(execution.id);
      const current=await store.prepare('SELECT * FROM automation_paired_dispatches WHERE execution_id=?').get(execution.id);
      if(current) {
        if(current.actor_id!==user.id||current.agent_id!==agentId||current.application_origin!==applicationOrigin)throw fail('This Run is already assigned to another paired browser or machine.',409,'PAIRED_LOCAL_ASSIGNED');
        if(requestHash&&current.request_hash!==requestHash)throw fail('This request identity belongs to different local Run inputs.',409,'PAIRED_LOCAL_REQUEST_CONFLICT');
        if(current.state==='cancelled'||new Date(current.claim_expires_at).getTime()<=Date.now())throw fail('The original local dispatch has expired or stopped. Inspect its results before starting a new Run.',409,'PAIRED_LOCAL_EXPIRED');
        return {id:execution.id,started:true,execution_mode:'local',local_dispatch:receipt(current),idempotent_replay:true};
      }
      if(!plan?.eligibleCases?.length||plan.eligibleCases.length>100)throw fail('Select between one and 100 executable case/data-row instances for a paired local Run.',422,'PAIRED_LOCAL_BUDGET');
      const row={id:randomUUID(),execution_id:execution.id,project_id:execution.project_id,actor_id:user.id,agent_id:agentId,application_origin:applicationOrigin,
        request_hash:requestHash||digest({execution_id:execution.id,agentId,applicationOrigin}),grant_nonce:randomBytes(32).toString('hex'),claim_expires_at:new Date(Date.now()+10*60*1000).toISOString(),callback_expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString()};
      const prepared=await dispatch().preparePairedLocalDispatch({plan,integration,initiatedBy:user.id,pairedDispatchId:row.id,liveBaseUrl:'http://127.0.0.1:4311',
        callbackFor:item=>({url:`${publicApiBase(applicationOrigin)}/testengine/callbacks/runs`,signing_secret:callbackKey(row,item.engine_run_id,item.case_snapshot.test_case_id)})});
      const envelopes=prepared.envelopes;
      if(!Array.isArray(envelopes)||envelopes.length!==plan.eligibleCases.length||envelopes.some(envelope=>envelope.hellotest_execution_id!==execution.id||envelope.project?.id!==execution.project_id))throw fail('The saved local execution plan is invalid.',502,'PAIRED_LOCAL_CONTRACT');
      const value={protocol_version:1,dispatch_id:row.id,execution_id:execution.id,agent_id:agentId,expires_at:row.callback_expires_at,
        control_url:`${publicApiBase(applicationOrigin)}/executions/${encodeURIComponent(execution.id)}/local-dispatch/control`,envelopes};
      const cipher=seal(value,aad(row));
      await store.prepare(`INSERT INTO automation_paired_dispatches
        (id,execution_id,project_id,actor_id,agent_id,application_origin,request_hash,grant_nonce,envelope_cipher,claim_expires_at,callback_expires_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,row.execution_id,row.project_id,row.actor_id,row.agent_id,row.application_origin,row.request_hash,row.grant_nonce,cipher,row.claim_expires_at,row.callback_expires_at);
      await store.prepare("UPDATE executions SET execution_mode='local',trigger='local',status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),revision=revision+1 WHERE id=? AND status IN ('queued','running')").run(execution.id);
      const {envelopes:omitted,...summary}=prepared;
      return {id:execution.id,started:true,execution_mode:'local',...summary,local_dispatch:receipt(row)};
    })();
  }
  async function resolveGrant({executionId,grantToken,agentId,control=false}) {
    id(executionId,'execution');
    const row=await store.prepare('SELECT * FROM automation_paired_dispatches WHERE execution_id=?').get(executionId);
    if(!row||!equal(token(row),grantToken)||agentId!==row.agent_id)throw fail('This local dispatch credential does not match the paired machine.',401,'PAIRED_LOCAL_GRANT_INVALID');
    if(new Date(control?row.callback_expires_at:row.claim_expires_at).getTime()<=Date.now())throw fail('The local dispatch credential has expired.',401,'PAIRED_LOCAL_EXPIRED');
    await authorize(row.project_id,row.actor_id);
    const execution=await store.prepare('SELECT id,status,project_id FROM executions WHERE id=?').get(row.execution_id);
    if(!execution||execution.project_id!==row.project_id)throw fail('The local Run is unavailable.',404,'PAIRED_LOCAL_NOT_FOUND');
    return {row,execution};
  }
  async function claim(input) {
    const {row,execution}=await resolveGrant(input);
    if(row.state==='cancelled'||execution.status!=='running')throw fail('The local Run is no longer running.',409,'PAIRED_LOCAL_RUN_FINISHED');
    const bundle=open(row.envelope_cipher,aad(row));
    await store.prepare("UPDATE automation_paired_dispatches SET state='claimed',claimed_at=COALESCE(claimed_at,CURRENT_TIMESTAMP) WHERE id=? AND state IN ('pending','claimed')").run(row.id);
    return bundle;
  }
  async function control(input) {
    const {row,execution}=await resolveGrant({...input,control:true});
    return {execution_id:row.execution_id,status:execution.status,cancelled:row.state==='cancelled'||execution.status!=='running'};
  }
  async function callbackSecretFor({execution,payload,transaction}) {
    const row=await store.prepare('SELECT * FROM automation_paired_dispatches WHERE id=? AND execution_id=?').get(transaction?.metadata?.paired_dispatch_id,execution.id);
    if(!row||row.project_id!==execution.project_id||row.actor_id!==transaction.created_by||row.state!=='claimed'||new Date(row.callback_expires_at).getTime()<=Date.now())throw fail('This result does not match an active paired local dispatch.',401,'PAIRED_LOCAL_GRANT_INVALID');
    if(['aborted','cancelled'].includes(execution.status))throw fail('The local Run was stopped; later results cannot change it.',409,'PAIRED_LOCAL_RUN_FINISHED');
    await authorize(row.project_id,row.actor_id);
    const expected=transaction.metadata.data_set_iteration_index??null,actual=payload.data_set_iteration?.index??null;
    if(expected!==actual)throw fail('This result belongs to a different local data row.',403,'PAIRED_LOCAL_SCOPE');
    return callbackKey(row,payload.engine_run_id,payload.hellotest_test_case_id);
  }
  return {prepare,claim,control,callbackSecretFor};
}
module.exports={...createService(),createService,security};
