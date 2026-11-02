const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('@hellotest/platform/backend/src/db');
const obs = require('@hellotest/platform/backend/src/obsDb');
const rag = require('../../backend/services/knowledgeRag.service');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
const vectors = require('../../backend/services/knowledgeVectorStore.service');
test.after(() => Promise.all([db.close(), obs.close()]));

function noProvider(t) {
  t.mock.method(permissions, 'hasPermission', async (_user, code) => code === 'requirement.view');
  t.mock.method(flags, 'areEnabled', async () => true);
  t.mock.method(selection, 'resolveLlmIntegrationForUsage', async () => null);
  t.mock.method(vectors, 'isConfigured', () => false);
}

test('overview counts and quality use the same source, revision and fragment authorization predicates', async t => {
  noProvider(t);
  const queries=[];
  t.mock.method(db,'prepare',sql=>({
    get:async(...params)=>{
      queries.push({sql,params});
      if(sql.includes('AS available'))return {available:false};
      if(sql.includes('AS average_score'))return {active_documents:0,current_pipeline_documents:0,review_required_documents:0,average_score:null};
      return {sources:0,documents:0,chunks:0};
    },all:async()=>[]
  }));
  await rag.getOverview({projectId:'project',userId:'reader',user:{id:'reader'}});
  const aggregate=queries.filter(query=>query.sql.includes('visible_sources'));
  assert.equal(aggregate.length,2);
  for(const {sql,params} of aggregate){
    assert.match(sql,/sources\.extraction_status <> 'archived'/);
    assert.match(sql,/bindings\.document_id = documents\.id/);
    assert.match(sql,/bindings\.chunk_id = chunks\.id/);
    assert.match(sql,/sources\.required_permission IN/);
    assert.ok(params.includes('reader'));assert.ok(params.includes('requirement.view'));assert.ok(!params.includes('testcase.view'));
  }
  const quality=aggregate.find(query=>query.sql.includes('AS average_score')).sql;
  assert.match(quality,/NOT EXISTS \(SELECT 1 FROM ai_knowledge_chunks all_fragments/,'Whole-document derived quality cannot expose denied fragment inputs.');
});

test('real PostgreSQL overview excludes denied evidence and derives quality only from fully readable revisions', {
  skip:process.env.KNOWLEDGE_POSTGRES_TEST!=='1'
},async t=>{
  noProvider(t);
  await db.transaction(async()=>{
    for(const statement of [
      "CREATE TEMP TABLE users(id TEXT PRIMARY KEY,status TEXT,default_role_id TEXT) ON COMMIT DROP",
      "CREATE TEMP TABLE roles(id TEXT PRIMARY KEY,name TEXT) ON COMMIT DROP",
      "CREATE TEMP TABLE project_members(user_id TEXT,project_id TEXT,role_id TEXT) ON COMMIT DROP",
      "CREATE TEMP TABLE ai_knowledge_sources(id TEXT PRIMARY KEY,project_id TEXT,extraction_status TEXT,required_permission TEXT) ON COMMIT DROP",
      "CREATE TEMP TABLE ai_knowledge_documents(id TEXT PRIMARY KEY,project_id TEXT,source_id TEXT,is_active BOOLEAN,metadata JSONB) ON COMMIT DROP",
      "CREATE TEMP TABLE ai_knowledge_chunks(id TEXT PRIMARY KEY,project_id TEXT,source_id TEXT,document_id TEXT) ON COMMIT DROP",
      "CREATE TEMP TABLE ai_knowledge_security_bindings(id TEXT,project_id TEXT,source_id TEXT,document_id TEXT,chunk_id TEXT,permission TEXT,principal_type TEXT,principal_id TEXT,effect TEXT,inherited BOOLEAN) ON COMMIT DROP",
      "CREATE TEMP TABLE ai_knowledge_collections(id TEXT,project_id TEXT) ON COMMIT DROP",
      "CREATE TEMP TABLE ai_knowledge_ingestion_jobs(id TEXT,project_id TEXT,created_by TEXT,created_at TIMESTAMPTZ) ON COMMIT DROP"
    ])await db.query(statement);
    await db.query("INSERT INTO users VALUES('reader','active',NULL)");
    for(const [source,permission,status,score] of [['partial',null,'ready',99],['denied',null,'ready',90],['domain','testcase.view','ready',80],['document-denied',null,'ready',70],['public',null,'ready',40],['archived',null,'archived',100]]){
      await db.prepare('INSERT INTO ai_knowledge_sources VALUES(?,?,?,?)').run(source,'project',status,permission);
      await db.prepare('INSERT INTO ai_knowledge_documents VALUES(?,?,?,?,?)').run('doc-'+source,'project',source,true,{context_quality:{score},processing_pipeline:{version:rag._internals.KNOWLEDGE_PROCESSING_VERSION}});
      await db.prepare('INSERT INTO ai_knowledge_chunks VALUES(?,?,?,?)').run('chunk-'+source,'project',source,'doc-'+source);
      await db.prepare("INSERT INTO ai_knowledge_security_bindings VALUES(?,?,?,NULL,NULL,'READ','PROJECT',?,'ALLOW',TRUE)").run(source+'-read','project',source,'project');
    }
    await db.query("INSERT INTO ai_knowledge_chunks VALUES('chunk-restricted','project','partial','doc-partial')");
    for(const [id,source,document,chunk] of [['source-deny','denied',null,null],['document-deny','document-denied','doc-document-denied',null],['fragment-deny','partial','doc-partial','chunk-restricted']]){
      await db.prepare("INSERT INTO ai_knowledge_security_bindings VALUES(?,?,?,?,?,'READ','USER','reader','DENY',FALSE)").run(id,'project',source,document,chunk);
    }
    const result=await rag.getOverview({projectId:'project',userId:'reader',user:{id:'reader'}});
    assert.equal(result.counts.sources,3,'Source permission, source ACL and archive state apply before counts.');
    assert.equal(result.counts.documents,2,'Denied revisions are not counted.');
    assert.equal(result.counts.chunks,2,'Denied fragments are not counted.');
    assert.equal(result.capabilities.context_processing.active_documents,1);
    assert.equal(result.capabilities.context_processing.average_score,40,'Restricted source/fragment quality is not declassified through a dashboard average.');
    await db.prepare("UPDATE ai_knowledge_security_bindings SET effect='DENY',inherited=FALSE WHERE id='public-read'").run();
    const revoked=await rag.getOverview({projectId:'project',userId:'reader',user:{id:'reader'}});
    assert.equal(revoked.counts.sources,2);assert.equal(revoked.counts.chunks,1);
    assert.equal(revoked.capabilities.context_processing.average_score,null);
  })();
});
