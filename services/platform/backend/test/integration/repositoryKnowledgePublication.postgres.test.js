const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('published repository knowledge creates current graph evidence, preserves provenance, retrieves context and repairs projections', {
  skip: process.env.REPOSITORY_KNOWLEDGE_POSTGRES !== '1', timeout: 120000
}, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_repository_knowledge_\d+$/);
  const db = require('../../src/db');
  const obs = require('../../src/obsDb');
  const agents = require('../../../../agentic/backend/agents/repositoryAgents.service');
  const { publishRun } = require('../../../../agentic/backend/agents/publish');
  const publication = require('../../../../agentic/backend/agents/knowledgePublication.service');
  const rag = require('../../../../knowledge/backend/services/knowledgeRag.service');
  const graph = require('../../../../knowledge/backend/services/knowledgeGraph.service');
  const retrieval = require('../../../../knowledge/backend/services/knowledgeRetrieval.service');
  t.mock.method(require('../../../../knowledge/backend/services/knowledgeIntentPlanning.service'),'planIntent',async()=>({mode:'disabled',plan:null}));
  t.mock.method(require('../../../../knowledge/backend/services/knowledgeEnrichment.service'),'enrichDocument',async()=>({sections:[],mode:'standard',reason:'NO_MODEL_FOR_FIXTURE'}));
  try {
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../instance-setup-data/schema-setup/schema.sql'),'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    const projectId=randomUUID(), appId=randomUUID(), userId=randomUUID(), roleId=randomUUID(), runId=randomUUID();
    await db.prepare('INSERT INTO roles(id,name) VALUES (?,?)').run(roleId,'Repository knowledge validation');
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES (?,?,?,?,TRUE,'active')").run(userId,'knowledge-validation@example.test','not-a-login','Knowledge validation');
    await db.prepare('INSERT INTO projects(id,name,created_by) VALUES (?,?,?)').run(projectId,'Disposable repository knowledge',userId);
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES (?,?,?,?)').run(randomUUID(),projectId,userId,roleId);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES (?,?,?,'web')").run(appId,projectId,'Repository application');
    const user={id:userId,role:'admin'};
    const finding={id:'source-orders',title:'Checkout order repository contract',content:'# Checkout order contract\nCheckout order requests validate the order identifier before storing the order.\nThe checkout module preserves the original order identifier in its response.',
      metadata:{kind:'repository_source',repository_file:'src/orders.ts',start_line:1,end_line:20,content_hash:'c'.repeat(64),language:'ts',symbols:['createOrder'],context_permission_profile:{forged:true},required_permission:null},
      evidence:[{path:'src/orders.ts',line:4,excerpt:'export function createOrder(orderId) {'}]};
    await db.prepare(`INSERT INTO repository_agent_runs(id,project_id,app_type_id,agent_type,status,source,compiler_version,result,created_by)
      VALUES (?,?,?,'repository_knowledge','completed',?,?,?,?)`).run(runId,projectId,appId,
      {repository_url:'https://example.test/orders',commit_sha:'b'.repeat(40)},'fixture-v1',{findings:{knowledge:[finding]},artifacts:[]},userId);
    const published=await publishRun(runId,{item_ids:[finding.id]},user);
    const targetId=published.items[0].target_id;
    let status=await publication.getPublicationStatus(runId,user);
    assert.equal(status.items[0].indexing,'queued');assert.equal(status.pending,1);
    assert.equal(status.items[0].context_graph,'pending');
    const outcomes=await rag.processLegacyKnowledgeSyncOutbox({limit:1});
    assert.deepEqual(outcomes.map(item=>item.status),['completed']);
    status=await publication.getPublicationStatus(runId,user);
    assert.equal(status.ready,1,JSON.stringify(status));
    assert.equal(status.items[0].knowledge_graph,'ready');assert.equal(status.items[0].context_graph,'ready');
    const first=status.items[0];
    const current=await db.prepare(`SELECT sources.metadata AS source_metadata,documents.metadata AS document_metadata
      FROM ai_knowledge_sources sources JOIN ai_knowledge_documents documents ON documents.source_id=sources.id
      WHERE sources.id=? AND documents.id=? AND documents.is_active=TRUE`).get(first.source_id,first.document_id);
    for(const metadata of [current.source_metadata,current.document_metadata]) {
      assert.equal(metadata.repository_file,'src/orders.ts');assert.equal(metadata.revision,'b'.repeat(40));
      assert.equal(metadata.content_hash,'c'.repeat(64));assert.equal(metadata.agent_run_id,runId);
      assert.deepEqual(metadata.evidence,finding.evidence);assert.equal(metadata.runtime_verified,false);
      assert.equal(metadata.context_permission_profile,undefined);assert.equal(metadata.required_permission,undefined);
    }
    const resolved=await graph.resolve({projectId,user,app_type_id:appId,identifiers:[{kind:'knowledge_item',ref_id:targetId}],limit:2});
    assert.equal(resolved.nodes.length,1);assert.equal(resolved.nodes[0].id,first.source_id);
    const packet=await retrieval.retrieveDirect({projectId,appTypeId:appId,user,query:'Checkout order identifier',
      filters:{source_ids:[first.source_id],source_kinds:['knowledge_item'],requested_scopes:['knowledge']},
      budgets:{max_query_cost_usd:0.001,max_context_tokens:3000,max_evidence_items:4,deadline_ms:10000}});
    assert.ok(packet.evidence.some(item=>item.source_id===first.source_id&&item.document_id===first.document_id),JSON.stringify(packet));
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM ai_knowledge_graph_edges WHERE project_id=?').get(projectId)).count,0,'Static file evidence must not invent graph relationships');
    await db.prepare('DELETE FROM ai_knowledge_graph_projection_states WHERE document_id=?').run(first.document_id);
    status=await publication.getPublicationStatus(runId,user);assert.equal(status.ready,0);assert.equal(status.items[0].knowledge_graph,'pending');
    await publication.processPublishedKnowledge(runId,{item_ids:[finding.id]},user);
    assert.equal((await publication.getPublicationStatus(runId,user)).items[0].indexing,'queued');
    assert.deepEqual((await rag.processLegacyKnowledgeSyncOutbox({limit:1})).map(item=>item.status),['completed']);
    const repaired=await publication.getPublicationStatus(runId,user);
    assert.equal(repaired.ready,1);assert.notEqual(repaired.items[0].document_id,first.document_id,'Graph repair promotes a complete new revision and retains the old immutable document');
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM ai_knowledge_documents WHERE source_id=?').get(first.source_id)).count,2);
    await db.prepare('UPDATE ai_knowledge_repo SET is_active=FALSE WHERE id=? AND project_id=?').run(targetId,projectId);
    const archived=await publication.getPublicationStatus(runId,user);
    assert.equal(archived.items[0].indexing,'archived');assert.equal(archived.ready,0);
    await assert.rejects(publication.processPublishedKnowledge(runId,{item_ids:[finding.id]},user),{statusCode:409});
    const createdCases=[];
    for(const agentType of ['api_tests','component_tests']){
      const sourceRunId=randomUUID();
      const contract={id:'case-'+agentType,title:agentType==='api_tests'?'Create an order through the declared API':'Checkout displays the order action',
        method:'POST',path:'/orders',expected_status:201,content_type:'application/json',body:{name:'@t.name'},
        steps:[{action:'Prepare the reviewed environment',expected_result:'The necessary state is available'},{action:'Send POST /orders',expected_result:'The service returns the declared201 response'}],
        evidence:[{path:'src/orders.ts',line:4}]};
      await db.prepare(`INSERT INTO repository_agent_runs(id,project_id,app_type_id,agent_type,status,source,compiler_version,result,created_by)
        VALUES (?,?,?,?,'completed',?,?,?,?)`).run(sourceRunId,projectId,appId,agentType,{name:'fixture-source.zip'},'fixture-v1',{findings:{test_cases:[contract]},artifacts:[]},userId);
      const selection={item_ids:[contract.id],...(agentType==='component_tests'?{automation_start_url:'https://app.example.test/checkout'}:{})};
      const receipt=await publishRun(sourceRunId,selection,user);
      assert.equal(receipt.items[0].target_type,'automation');assert.match(receipt.items[0].url,/^\/automation\?case=/);
      const saved=await db.prepare('SELECT automated,automation_status,automation_start_url,review_status FROM test_cases WHERE id=?').get(receipt.items[0].target_id);
      assert.equal(saved.automated,'yes');assert.equal(saved.automation_status,'incomplete');assert.equal(saved.review_status,'pending');
      const steps=await db.prepare('SELECT step_type,api_request FROM test_steps WHERE test_case_id=? ORDER BY step_order').all(receipt.items[0].target_id);
      if(agentType==='api_tests'){
        assert.equal(steps.length,1);assert.equal(steps[0].step_type,'api');assert.equal(steps[0].api_request.method,'POST');
        assert.equal(steps[0].api_request.url,'@r.base_url/orders');assert.equal(saved.automation_start_url,null);
      }else assert.equal(saved.automation_start_url,'https://app.example.test/checkout');
      assert.deepEqual((await publishRun(sourceRunId,selection,user)).items,receipt.items);
      createdCases.push(receipt.items[0].target_id);
    }
    assert.equal(new Set(createdCases).size,2);
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count,2,'Repeated acceptance creates exactly one Automation case per finding');
    console.log(JSON.stringify({repository_provenance_retained:true,graph_resolved:true,context_evidence:packet.evidence.length,projection_repaired:true}));
  } finally { await agents.shutdown();await Promise.all([db.close(),obs.close()]); }
});
