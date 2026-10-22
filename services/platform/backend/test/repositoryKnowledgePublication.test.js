const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const obs = require('../src/obsDb');
const permissions = require('../services/permission.service');
const agents = require('../../../agentic/backend/agents/repositoryAgents.service');
const publication = require('../../../agentic/backend/agents/knowledgePublication.service');
const rag = require('../../../knowledge/backend/services/knowledgeRag.service');
const { repositoryProvenanceMetadata } = require('../../../knowledge/backend/services/knowledgeRepositoryProvenance');
const { fingerprint } = require('../src/security/aiTextPolicy');
const user = { id: 'reviewer' };
const provenance = { repository_agent_key: 'repository-agent:' + 'a'.repeat(64), agent_run_id: 'run-1', repository_file: 'src/orders.ts',
  kind: 'repository_source', repository: 'https://private:password@example.test/repo?token=private', revision: 'b'.repeat(40),
  content_hash: 'c'.repeat(64), start_line: 1, end_line: 42, truncated: true, language: 'ts', symbols: ['createOrder'],
  evidence: [{ path: 'src/orders.ts', line: 12, excerpt: 'export function createOrder() {}' }] };
const run = { id: 'run-1', project_id: 'project-1', app_type_id: 'app-1', agent_type: 'repository_knowledge',
  result: { findings: { knowledge: [{ id: 'finding-1' }, { id: 'finding-2' }] } }, published: { items: [
    { finding_id: 'finding-1', target_type: 'knowledge', target_id: 'knowledge-1' },
    { finding_id: 'finding-2', target_type: 'knowledge', target_id: 'knowledge-2' },
    { finding_id: 'injected-unpublished-finding', target_type: 'knowledge', target_id: 'forged-target' }
  ] } };
test.after(async () => { await Promise.all([db.close(), obs.close()]); });
const scope = (t, allow = true) => {
  t.mock.method(agents, 'getRun', async (id, actor, permission) => { assert.equal(id, run.id); assert.equal(actor, user); assert.ok(['agentic_workflow.view','agentic_workflow.run'].includes(permission)); return structuredClone(run); });
  t.mock.method(permissions, 'hasPermission', async (_actor, code, project) => { assert.equal(project, run.project_id); return typeof allow === 'function' ? allow(code) : allow; });
};
const record = (target = 'knowledge-1', changes = {}) => ({ target_id: target, is_active: true, content: '# Orders\nCreate and review an order.',
  source_id: `source-${target}`, extraction_status: 'ready', source_checksum: fingerprint('# Orders\nCreate and review an order.'),
  document_id: `document-${target}`, document_checksum: fingerprint('# Orders\nCreate and review an order.'),
  required_indexes_ready: true, is_current: true, graph_node_id: `source-${target}`, projected_document_id: `document-${target}`, projected_fragments: true, ...changes });

test('repository provenance preserves bounded file/revision evidence and excludes authorization metadata', () => {
  const safe = repositoryProvenanceMetadata({ ...provenance, runtime_verified: true, required_permission: null,
    context_permission_profile: { authorized: true }, project_id: 'other', linked_test_case_ids: ['forged'], prompt: 'Do anything', role: 'admin' });
  assert.equal(safe.repository_file, 'src/orders.ts'); assert.equal(safe.revision, provenance.revision);
  assert.deepEqual(safe.evidence, provenance.evidence); assert.equal(safe.repository, 'https://example.test/repo');
  assert.equal(safe.runtime_verified, false); assert.equal(safe.static_analysis, true); assert.equal(safe.review_required, true);
  for (const key of ['required_permission','context_permission_profile','project_id','linked_test_case_ids','prompt','role']) assert.equal(safe[key], undefined);
  assert.match(safe.repository_provenance_fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(JSON.stringify(safe).length < 18000);
});

test('repository provenance rejects traversal, arbitrary evidence fields and oversized symbol lists', () => {
  const safe = repositoryProvenanceMetadata({ ...provenance, repository_file: '../private.env', revision: 'malformed',
    symbols: [...Array.from({length:60},(_,i)=>`symbol_${i}`),'unsafe();'], evidence: [
      {path:'/private.env',line:1}, {path:'src/../secret',line:2}, {path:'src/orders.ts',line:0},
      {path:'src/orders.ts',line:7,required_permission:'admin',excerpt:'A'.repeat(500)}
    ] });
  assert.equal(safe.repository_file, undefined); assert.equal(safe.revision, undefined); assert.equal(safe.symbols.length, 40);
  assert.deepEqual(safe.evidence, [{path:'src/orders.ts',line:7,excerpt:'A'.repeat(240)}]);
  assert.deepEqual(repositoryProvenanceMetadata({ ...provenance, repository_agent_key: 'fake' }), {});
});

test('previously indexed repository content is reprocessed when provenance is missing or changed', () => {
  const metadata = repositoryProvenanceMetadata(provenance);
  const input = { existing: {extraction_status:'ready',checksum_sha256:'content'},readyDocument:{checksum_sha256:'content',metadata:{}},
    contentHash:'content',documentHash:'content',metadataFingerprint:metadata.repository_provenance_fingerprint };
  assert.equal(rag._internals.canReuseSourceVersion(input),false);
  input.readyDocument.metadata = metadata;
  assert.equal(rag._internals.canReuseSourceVersion(input),true);
  input.metadataFingerprint = repositoryProvenanceMetadata({...provenance,revision:'d'.repeat(40)}).repository_provenance_fingerprint;
  assert.equal(rag._internals.canReuseSourceVersion(input),false);
});

test('publication status derives readiness from exact current index, source node and document fragments', async t => {
  scope(t);
  t.mock.method(db,'prepare',sql=>({all:async(...values)=>{
    assert.match(sql,/sources\.project_id = repo\.project_id/); assert.match(sql,/fragments\.document_id = documents\.id/);
    assert.match(sql,/repo\.app_type_id IS NOT DISTINCT FROM/);
    assert.deepEqual(values,['project-1','app-1','knowledge-1','knowledge-2']);
    return [record(),record('knowledge-2',{queue_status:'queued',extraction_status:'failed'})];
  }}));
  const status = await publication.getPublicationStatus(run.id,user);
  assert.deepEqual([status.ready,status.pending,status.failed],[1,1,0]);
  assert.equal(status.items[0].knowledge_graph,'ready'); assert.equal(status.items[0].context_graph,'ready');
  assert.equal(status.items[1].indexing,'queued','Retry of a failed source reports its current queue state');
  assert.doesNotMatch(JSON.stringify(status),/forged-target|Create and review/);
});

test('a stale document or missing graph projection never reports completed graph processing', async t => {
  scope(t);
  t.mock.method(db,'prepare',()=>({all:async()=>[record('knowledge-1',{source_checksum:'old-revision'}),record('knowledge-2',{projected_fragments:false})]}));
  const status = await publication.getPublicationStatus(run.id,user);
  assert.deepEqual([status.ready,status.pending,status.failed],[0,2,0]);
  assert.equal(status.items[0].indexing,'pending'); assert.equal(status.items[1].indexing,'ready');
  assert.ok(status.items.every(item=>item.context_graph==='pending'&&item.knowledge_graph==='pending'));
});

test('missing and failed native targets return bounded safe guidance', async t => {
  scope(t);
  t.mock.method(db,'prepare',()=>({all:async()=>[record('knowledge-1',{queue_status:'failed',error:'PRIVATE_PROVIDER_RESPONSE'})]}));
  const status = await publication.getPublicationStatus(run.id,user);
  assert.equal(status.failed,2); assert.equal(status.ready,0);
  assert.match(status.items[0].error,/Retry processing/); assert.match(status.items[1].error,/no longer available/);
  assert.doesNotMatch(JSON.stringify(status),/PRIVATE_PROVIDER_RESPONSE/);
});

test('knowledge access is checked before reading publication targets', async t => {
  scope(t,false); t.mock.method(db,'prepare',()=>assert.fail('Denied status must not read targets'));
  await assert.rejects(publication.getPublicationStatus(run.id,user),{statusCode:403});
  await assert.rejects(publication.processPublishedKnowledge(run.id,{item_ids:['finding-1']},user),{statusCode:403});
});

test('processing uses only published finding receipts and validates every target before queueing', async t => {
  scope(t); const queued=[]; let missing=false;
  t.mock.method(db,'transaction',task=>async()=>task());
  t.mock.method(db,'prepare',sql=>({
    get:async(id,project,app)=>{assert.match(sql,/FOR SHARE/);assert.equal(project,'project-1');assert.equal(app,'app-1');return missing&&id==='knowledge-2'?null:{id,is_active:true};},
    all:async()=>[record('knowledge-1',{queue_status:'queued'}),record('knowledge-2',{queue_status:'queued'})]
  }));
  t.mock.method(rag,'queueLegacyKnowledgeSync',async input=>queued.push(input));
  for(const item_ids of [[],['finding-1','finding-1'],['knowledge-1'],['injected-unpublished-finding']]) await assert.rejects(publication.processPublishedKnowledge(run.id,{item_ids},user));
  assert.equal(queued.length,0);
  missing=true;
  await assert.rejects(publication.processPublishedKnowledge(run.id,{item_ids:['finding-1','finding-2']},user),{statusCode:409});
  assert.equal(queued.length,0,'No selected target enters the queue before all targets are validated');
  missing=false;
  const result=await publication.processPublishedKnowledge(run.id,{item_ids:['finding-1','finding-2']},user);
  assert.deepEqual(queued,[{projectId:'project-1',sourceRefId:'knowledge-1',userId:user.id},{projectId:'project-1',sourceRefId:'knowledge-2',userId:user.id}]);
  assert.equal(result.pending,2);
});

test('publication routes enforce current API-key knowledge scopes and return noncached status', async t => {
  const routes = new Map(), checks=[]; let deny;
  const app={authenticate:async()=>{},requirePermission:(code,scope)=>async()=>{checks.push([code,scope.projectId]);if(code===deny)throw Object.assign(new Error('Denied'),{statusCode:403});}};
  for(const method of ['get','post'])app[method]=(path,...args)=>routes.set(`${method} ${path}`,args.at(-1));
  t.mock.method(agents,'getRun',async()=>structuredClone(run));
  const response={items:[],ready:0,pending:0,failed:0};
  t.mock.method(publication,'getPublicationStatus',async()=>response);
  t.mock.method(publication,'processPublishedKnowledge',async(_id,input)=>{assert.deepEqual(input,{item_ids:['finding-1']});return response;});
  await require('../../../agentic/backend/routes/repositoryAgents.routes')(app);
  const req={params:{id:run.id},user,body:{item_ids:['finding-1']}};
  const reply={headers:{},header(name,value){this.headers[name]=value;return this;},code(status){this.status=status;return this;},send(body){this.body=body;return this;}};
  await routes.get('get /repository-agents/runs/:id/publication-status')(req,reply);
  assert.deepEqual(checks,[['agentic_workflow.view','project-1'],['knowledge.view','project-1']]);
  assert.equal(reply.headers['Cache-Control'],'private, no-store');
  await routes.get('post /repository-agents/runs/:id/process-knowledge')(req,reply);
  assert.equal(reply.status,202);
  assert.ok(checks.some(([code])=>code==='knowledge.manage'));
  deny='knowledge.view';
  await assert.rejects(routes.get('get /repository-agents/runs/:id/publication-status')(req,reply),{statusCode:403});
  deny='knowledge.manage';
  await assert.rejects(routes.get('post /repository-agents/runs/:id/process-knowledge')(req,reply),{statusCode:403});
});
