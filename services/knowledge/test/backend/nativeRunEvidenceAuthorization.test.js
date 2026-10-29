const test=require('node:test'),assert=require('node:assert/strict');
const retrieval=require('../../backend/services/knowledgeRetrieval.service');
const permissions=require('@hellotest/platform/backend/services/permission.service');
const flags=require('@hellotest/platform/backend/services/featureFlag.service');
const projects=require('@hellotest/platform/backend/public/projectAccess');
const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
test.after(()=>Promise.all([db.close(),obs.close()]));
test('Run failure packets retain all native permissions and fail closed after access changes',async t=>{
  const denied=new Set();
  t.mock.method(permissions,'hasPermission',async(_actor,code)=>code!=='knowledge.view'&&!denied.has(code));
  t.mock.method(projects,'getProject',async()=>({id:'project'}));
  t.mock.method(flags,'getDisabledPermissionCodes',async()=>[]);
  const hit={source_kind:'live_project',source_id:'live-project-project-run-failure-1',chunk_id:'failure',citation:{id:'K-failure'},
    content:JSON.stringify({evidence_type:'authoritative_live_execution_failures',evidence_permissions:['run.view','result.view','testcase.view','comment.view'],result_id:'result'})};
  const read=()=>retrieval.authorizeFreshEvidence({projectId:'project',user:{id:'actor'},hits:[hit]});
  assert.equal((await read()).allowed.length,1);
  for(const permission of ['run.view','result.view','testcase.view','comment.view']){
    denied.add(permission);assert.equal((await read()).allowed.length,0,permission);denied.clear();
  }
  assert.equal((await retrieval.authorizeFreshEvidence({projectId:'other-project',user:{id:'actor'},hits:[hit]})).allowed.length,0);
});
