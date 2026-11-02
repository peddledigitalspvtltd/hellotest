const test=require('node:test');
const assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db');
const obs=require('@hellotest/platform/backend/src/obsDb');
const rag=require('../../backend/services/knowledgeRag.service');
const permissions=require('@hellotest/platform/backend/services/permission.service');
const flags=require('@hellotest/platform/backend/services/featureFlag.service');
test.after(()=>Promise.all([db.close(),obs.close()]));

for(const mode of ['inactive_owner','revoked_permission','disabled_capability'])test(`queued text ingestion fails before reading or indexing evidence after ${mode}`,async t=>{
  const job={id:'queued-job',project_id:'project',created_by:'owner',input_count:1,config:{title:'Queued text source'},status:'running'};
  const queries=[],writes=[];let claimed=false,terminal='running';
  t.mock.method(db,'transaction',task=>()=>task());
  t.mock.method(db,'prepare',sql=>({
    get:async(...args)=>{
      queries.push({sql,args});
      if(sql.includes("WHERE status = 'queued'")){if(claimed)return undefined;claimed=true;return{id:job.id};}
      if(sql.includes("SET status = 'running'"))return job;
      if(sql.includes('FROM users')){assert.match(sql,/status = 'active'/);return mode==='inactive_owner'?undefined:{id:'owner',is_workspace_admin:true};}
      if(sql.includes('SELECT * FROM ai_knowledge_ingestion_jobs'))return{...job,status:terminal};
      assert.fail('Revoked work must not read native records or existing evidence: '+sql);
    },
    all:async()=>{
      if(sql.includes('SELECT payload'))assert.fail('Current authority is required before loading a retained text/file payload.');
      if(sql.includes('FROM ai_knowledge_ingestion_results'))return[];
      assert.fail('Revoked work must not load evidence fragments: '+sql);
    },
    run:async(...args)=>{writes.push({sql,args});if(sql.includes('processed_count = ?'))terminal=args[0];return{changes:1};}
  }));
  t.mock.method(permissions,'hasPermission',async(_user,permission,project)=>{
    assert.notEqual(mode,'inactive_owner','A suspended administrator must not enter the admin permission fast path.');
    assert.equal(permission,'knowledge.manage');assert.equal(project,'project');return mode!=='revoked_permission';
  });
  t.mock.method(flags,'areEnabled',async()=>mode!=='disabled_capability');
  t.mock.method(globalThis,'fetch',()=>assert.fail('Revoked ingestion cannot send model or vector requests.'));
  const result=await rag.processQueuedIngestions({limit:1});
  assert.deepEqual(result,[{id:job.id,status:'failed'}]);
  assert.ok(queries.some(query=>query.sql.includes('FROM users')));
  assert.ok(!writes.some(write=>/INSERT INTO ai_knowledge_(?:sources|documents|chunks)/.test(write.sql)));
  assert.ok(writes.some(write=>write.sql.includes('processed_count = ?')&&write.args[0]==='failed'),'The failed attempt remains inspectable and can be retried after authority is restored.');
});
