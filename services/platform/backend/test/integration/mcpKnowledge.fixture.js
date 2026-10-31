const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');

// Real PostgreSQL, authenticated MCP transport, native Knowledge APIs, current
// source ACL checks and saved read-back receipts. Indexing stays in its durable
// queue; this fixture never invokes an extraction or model provider.
exports.verify = async ({ app, db, createToken }) => {
  const project = 'mcp-p-a', application = 'mcp-app-a', user = 'mcp-a';
  const prefix = 'MCP Knowledge lifecycle fixture';
  const headers = { authorization: 'Bearer ' + createToken({ id: user }) };
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  const added = [], plans = [], items = [], collections = [];
  let credential, primaryError, providerCalls = 0;
  const originalFetch = global.fetch;
  const binding = await db.prepare('SELECT effect FROM ai_knowledge_security_bindings WHERE id=?').get('mcp-binding');
  assert.ok(binding, 'The authorised source fixture must exist.');
  const before = {
    items: (await db.prepare('SELECT id FROM ai_knowledge_repo WHERE project_id=?').all(project)).map(row => row.id).sort(),
    collections: (await db.prepare('SELECT id FROM ai_knowledge_collections WHERE project_id=?').all(project)).map(row => row.id).sort(),
    outbox: (await db.prepare('SELECT id FROM ai_knowledge_sync_outbox WHERE project_id=?').all(project)).map(row => row.id).sort()
  };

  async function rpc(name, args = {}) {
    const response = await app.inject({ method: 'POST', url: '/mcp', headers: { host: 'localhost', authorization: 'Bearer ' + credential.token, accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: meta } } });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json().result;
    assert.ok(result, response.body);
    return result;
  }
  async function call(name, args = {}) {
    const result = await rpc(name, args);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.structuredContent.scope.project_id, project);
    assert.equal(result.structuredContent.scope.subject, user);
    return result.structuredContent.data;
  }
  async function operation(method, path) {
    const catalog = await call('hellotest_capabilities', { query: path, limit: 50 });
    const selected = catalog.operations.find(item => item.method === method && item.path === path);
    assert.ok(selected, `${method} ${path} must be callable`);
    return selected;
  }
  async function prepare(op, path, body = {}) {
    const plan = await call('hellotest_operation_prepare', { operation_id: op.id, arguments: { path, body } });
    assert.equal(plan.state, 'requires_authorization');
    plans.push(plan.plan_id);
    return plan;
  }
  async function authorize(plan) {
    return app.inject({ method: 'POST', url: `/agentic-workflows/mcp/plans/${encodeURIComponent(plan.plan_id)}/authorize`, headers, payload: { project_id: project, digest: plan.digest } });
  }
  async function execute(plan) {
    const approved = await authorize(plan);
    assert.equal(approved.statusCode, 200, approved.body);
    const receipt = await call('hellotest_operation_execute', { plan_id: plan.plan_id });
    assert.equal(receipt.state, 'succeeded_verified', JSON.stringify(receipt));
    return receipt;
  }
  async function read(op, path) {
    return (await call('hellotest_operation_read', { operation_id: op.id, arguments: { path } })).data;
  }

  try {
    global.fetch = async () => { providerCalls++; throw new Error('Knowledge lifecycle authoring must not invoke a remote provider.'); };
    const permission = await db.prepare('SELECT id FROM permissions WHERE code=?').get('knowledge.manage');
    assert.ok(permission);
    if (!await db.prepare('SELECT 1 AS present FROM role_permissions WHERE role_id=? AND permission_id=?').get('mcp-fixture-role', permission.id)) {
      await db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)').run('mcp-fixture-role', permission.id);
      added.push(permission.id);
    }
    const issued = await app.inject({ method: 'POST', url: '/agentic-workflows/mcp/credentials', headers, payload: { project_id: project, client_id: 'knowledge-lifecycle-fixture' } });
    assert.equal(issued.statusCode, 200, issued.body);
    credential = issued.json();

    const textBase = '/projects/:project_id/knowledge';
    const textCreate = await operation('POST', textBase), textGet = await operation('GET', textBase + '/:id');
    const textUpdate = await operation('PUT', textBase + '/:id'), textDelete = await operation('DELETE', textBase + '/:id');
    const initial = { app_type_id: application, title: prefix + ' text', description: 'An observed release rule.', content_type: 'markdown', content: 'A release requires passing tests and an explicit review.', metadata: { authoring_origin: 'mcp-fixture', version: 1 }, linked_test_cases: ['mcp-case-a'], source_uri: 'https://docs.example.test/release-rule', is_active: true };
    const creation = await prepare(textCreate, { project_id: project }, initial);
    assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM ai_knowledge_repo WHERE project_id=? AND title=?').get(project, initial.title)).count, 0, 'Preparation does not save or index Knowledge content.');
    assert.equal((await call('hellotest_operation_execute', { plan_id: creation.plan_id })).state, 'requires_authorization');
    const created = await execute(creation);
    items.push(created.domain_id);
    const itemPath = { project_id: project, id: created.domain_id };
    const saved = await read(textGet, itemPath);
    assert.equal(saved.asset_type, 'unknown', 'Omitted asset_type uses the native non-null domain default.');
    for (const key of ['app_type_id', 'title', 'description', 'content_type', 'content', 'source_uri', 'is_active']) assert.equal(saved[key], initial[key], key);
    assert.deepEqual(saved.metadata, initial.metadata);
    assert.deepEqual(saved.linked_test_cases, ['mcp-case-a']);
    assert.equal(saved.embedding, undefined, 'Embeddings are not delegated as public Knowledge content.');
    const queued = await db.prepare('SELECT action,status FROM ai_knowledge_sync_outbox WHERE project_id=? AND source_ref_id=?').get(project, created.domain_id);
    assert.deepEqual(queued, { action: 'upsert', status: 'queued' }, 'Native authoring queues indexing without invoking a provider.');
    assert.equal((await call('hellotest_operation_execute', { plan_id: creation.plan_id })).domain_id, created.domain_id);
    assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM ai_knowledge_repo WHERE id=?').get(created.domain_id)).count, 1);

    // A current indexed representation protects the same information as its
    // raw legacy authoring row. Neither exact reads, list/search, native feature
    // prefetch nor the ContextPacket boundary may bypass source/fragment DENY.
    const mirror = randomUUID(), document = randomUUID(), chunk = randomUUID(), sourceDeny = randomUUID(), fragmentDeny = randomUUID();
    const checksum = createHash('sha256').update(initial.content).digest('hex');
    {
      await db.prepare("INSERT INTO ai_knowledge_sources(id,project_id,app_type_id,source_kind,source_ref_id,title,extraction_status,revision_token) VALUES(?,?,?,'knowledge_item',?,?,'ready','fixture')").run(mirror, project, application, created.domain_id, initial.title);
      await db.prepare('INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256) VALUES(?,?,?,?,?,?)').run(document, project, mirror, initial.title, initial.content, checksum);
      await db.prepare("INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content,search_vector) VALUES(?,?,?,?,0,?,to_tsvector('simple',?))").run(chunk, project, document, mirror, initial.content, initial.content);
      await db.prepare("INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready) VALUES(?,?,?,1,TRUE,'ready','not_configured',TRUE)").run(document, project, mirror);
      await db.prepare("INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited) VALUES(?,?,?,'PROJECT',?,'ALLOW',TRUE),(?,?,?,'USER',?,'DENY',FALSE)").run(randomUUID(), project, mirror, project, sourceDeny, project, mirror, user);
      const textList = await operation('GET', textBase), textSearch = await operation('GET', textBase + '/search');
      async function assertLegacyDenied(label) {
        const exact = await rpc('hellotest_operation_read', { operation_id: textGet.id, arguments: { path: itemPath } });
        assert.equal(exact.isError, true, label + ': the raw legacy item is unavailable.');
        assert.ok(!JSON.stringify(exact).includes(initial.content));
        const originalReceipt=await call('hellotest_operation_status',{plan_id:creation.plan_id});
        assert.equal(originalReceipt.state,'succeeded_verified');assert.equal(originalReceipt.receipt.data,undefined,label+': persisted receipts cannot bypass a later source restriction.');
        assert.ok(originalReceipt.receipt.content_withheld);
        const replayed=await call('hellotest_operation_execute',{plan_id:creation.plan_id});
        assert.equal(replayed.state,'succeeded_verified');assert.equal(replayed.data,undefined);
        const list = await rpc('hellotest_operation_read', { operation_id: textList.id, arguments: { path: { project_id: project } } });
        assert.ok(!JSON.stringify(list).includes(initial.content), label + ': list cannot expose the protected raw item.');
        const search = await rpc('hellotest_operation_read', { operation_id: textSearch.id, arguments: { path: { project_id: project }, query: { query: prefix } } });
        assert.ok(!JSON.stringify(search).includes(initial.content), label + ': search cannot expose the protected raw item.');
        const native = await app.inject({ method: 'GET', url: `/projects/${project}/knowledge/${created.domain_id}`, headers });
        assert.equal(native.statusCode, 404, native.body);
        const nativeList = await app.inject({ method: 'GET', url: `/projects/${project}/knowledge`, headers });
        assert.equal(nativeList.statusCode, 200, nativeList.body);
        assert.ok(!nativeList.body.includes(initial.content), label + ': native UI list applies the same source ACL.');
        const legacy = require('../../../../knowledge/backend/services/aiKnowledge.service');
        const prefetch = await legacy.buildKnowledgeContextPackage(project, { app_type_id: application, limit: 5, user: { id: user } });
        assert.ok(!JSON.stringify(prefetch).includes(initial.content), label + ': optional native feature prefetch cannot merge restricted legacy content.');
        assert.deepEqual(await legacy.getActiveKnowledgeForLLM(project, application, { id: user }), []);
        const context = await call('hellotest_context_build', { question: initial.content, app_type_id: application, filters: { source_ids: [mirror], source_kinds: ['knowledge_item'], requested_scopes: ['knowledge'] }, budgets: { max_query_cost_usd: 0, deadline_ms: 3000, max_tool_calls: 4, max_context_tokens: 1000 } });
        assert.ok(!JSON.stringify(context.packet.evidence).includes(initial.content), label + ': indexed retrieval and native authoring agree on the denial.');
      }
      await assertLegacyDenied('Source DENY');
      await db.prepare('DELETE FROM ai_knowledge_security_bindings WHERE id=?').run(sourceDeny);
      await db.prepare("INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,document_id,chunk_id,principal_type,principal_id,effect,inherited) VALUES(?,?,?,?,?,'USER',?,'DENY',FALSE)").run(fragmentDeny, project, mirror, document, chunk, user);
      await assertLegacyDenied('Fragment DENY');
      await db.prepare('DELETE FROM ai_knowledge_security_bindings WHERE id=?').run(fragmentDeny);
      assert.equal((await read(textGet, itemPath)).content, initial.content, 'An entirely authorised indexed representation remains readable.');
      await db.prepare("UPDATE ai_knowledge_sources SET app_type_id=NULL,extraction_status='archived' WHERE id=?").run(mirror);
      await db.prepare("INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited) VALUES(?,?,?,'USER',?,'DENY',FALSE)").run(randomUUID(), project, mirror, user);
      assert.equal((await read(textGet, itemPath)).content, initial.content, 'A retained source from a different application scope cannot deny the current native item.');
      await db.prepare('DELETE FROM ai_knowledge_sources WHERE id=?').run(mirror);
    }

    // This API replaces the whole native text item. Explicitly retain every
    // optional field that should survive replacement and verify exact content.
    const replacement = { ...initial, asset_type: null, title: prefix + ' revised text', content: 'Passing tests and an independent release review are required.', metadata: { authoring_origin: 'mcp-fixture', version: 2 } };
    const replacementPlan=await prepare(textUpdate, itemPath, replacement);
    assert.equal(replacementPlan.preview.arguments.body.asset_type,'unknown','Review shows the native canonical value for an explicitly cleared asset type.');
    await execute(replacementPlan);
    const revised = await read(textGet, itemPath);
    assert.equal(revised.asset_type, 'unknown');
    assert.equal(revised.title, replacement.title);
    assert.equal(revised.content, replacement.content);
    assert.deepEqual(revised.metadata, replacement.metadata);
    const invalidLink = await rpc('hellotest_operation_prepare', { operation_id: textUpdate.id, arguments: { path: itemPath, body: { ...replacement, linked_test_cases: ['mcp-case-b'] } } });
    assert.equal(invalidLink.isError, true, 'A project-bound Knowledge item cannot link a Test Case from another project.');
    assert.equal((await db.prepare('SELECT content FROM ai_knowledge_repo WHERE id=?').get(created.domain_id)).content, replacement.content);
    const foreignPath = await rpc('hellotest_operation_read', { operation_id: textGet.id, arguments: { path: { ...itemPath, project_id: 'mcp-p-b' } } });
    assert.equal(foreignPath.isError, true, 'The native user can access B; this MCP credential remains bound to A.');

    const collectionCreate = await operation('POST', '/knowledge/collections'), collectionGet = await operation('GET', '/knowledge/collections/:id');
    const collectionUpdate = await operation('PUT', '/knowledge/collections/:id'), collectionDelete = await operation('DELETE', '/knowledge/collections/:id');
    const sourceGet = await operation('GET', '/knowledge/sources/:id');
    const link = await operation('POST', '/knowledge/collections/:id/sources'), unlink = await operation('DELETE', '/knowledge/collections/:id/sources');
    const collection = await execute(await prepare(collectionCreate, {}, { app_type_id: application, name: prefix + ' collection', description: 'A reviewed release source selection.', color: 'blue', retrieval_config: { mode: 'hybrid' } }));
    collections.push(collection.domain_id);
    const collectionPath = { id: collection.domain_id };
    assert.equal((await read(collectionGet, collectionPath)).source_count, undefined, 'Native aggregate counts are withheld until they enforce principal source ACL.');
    await execute(await prepare(collectionUpdate, collectionPath, { name: prefix + ' revised collection', description: 'The source selection was reviewed.', color: 'green', retrieval_config: { mode: 'lexical' } }));
    const editedCollection = await read(collectionGet, collectionPath);
    assert.equal(editedCollection.name, prefix + ' revised collection');
    assert.deepEqual(editedCollection.retrieval_config, { mode: 'lexical' });

    const allowedSource = await read(sourceGet, { id: 'mcp-source' });
    assert.equal(allowedSource.source.id, 'mcp-source');
    const reviewedLink = await prepare(link, collectionPath, { source_ids: ['mcp-source'] });
    // Source ACL is checked again at authorization, even though the project,
    // collection and requested source were all valid when the plan was made.
    await db.prepare("UPDATE ai_knowledge_security_bindings SET effect='DENY' WHERE id=?").run('mcp-binding');
    try {
      const deniedRead = await rpc('hellotest_operation_read', { operation_id: sourceGet.id, arguments: { path: { id: 'mcp-source' } } });
      assert.equal(deniedRead.isError, true);
      assert.doesNotMatch(JSON.stringify(deniedRead), /Release requires passing tests|Release rule/);
      const denied = await authorize(reviewedLink);
      assert.ok([403, 404].includes(denied.statusCode), denied.body);
      assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM ai_knowledge_collection_sources WHERE collection_id=?').get(collection.domain_id)).count, 0);
    } finally {
      await db.prepare('UPDATE ai_knowledge_security_bindings SET effect=? WHERE id=?').run(binding.effect, 'mcp-binding');
    }
    await execute(reviewedLink);
    assert.deepEqual((await db.prepare('SELECT source_id FROM ai_knowledge_collection_sources WHERE collection_id=? ORDER BY source_id').all(collection.domain_id)).map(row => row.source_id), ['mcp-source']);
    assert.equal((await read(collectionGet, collectionPath)).source_count, undefined);

    const staleUnlink = await prepare(unlink, collectionPath, { source_ids: ['mcp-source'] });
    const nativeRemoved = await app.inject({ method: 'DELETE', url: `/knowledge/collections/${collection.domain_id}/sources`, headers, payload: { source_ids: ['mcp-source'] } });
    assert.equal(nativeRemoved.statusCode, 200, nativeRemoved.body);
    const staleApproval = await authorize(staleUnlink);
    assert.equal(staleApproval.statusCode, 409, staleApproval.body);
    assert.equal(staleApproval.json().code, 'MCP_STALE_PLAN', 'Membership changes invalidate a review even when the parent revision stays unchanged.');
    await execute(await prepare(link, collectionPath, { source_ids: ['mcp-source'] }));
    await execute(await prepare(unlink, collectionPath, { source_ids: ['mcp-source'] }));
    assert.equal((await read(collectionGet, collectionPath)).source_count, undefined);
    assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM ai_knowledge_collection_sources WHERE collection_id=?').get(collection.domain_id)).count, 0);
    const removedCollection = await execute(await prepare(collectionDelete, collectionPath));
    assert.equal(removedCollection.verification.kind, 'record_absence');
    assert.equal(await db.prepare('SELECT id FROM ai_knowledge_collections WHERE id=?').get(collection.domain_id), undefined);

    const removedText = await execute(await prepare(textDelete, itemPath));
    assert.equal(removedText.verification.kind, 'record_absence');
    assert.equal(await db.prepare('SELECT id FROM ai_knowledge_repo WHERE id=?').get(created.domain_id), undefined);
    assert.deepEqual(await db.prepare('SELECT action,status FROM ai_knowledge_sync_outbox WHERE project_id=? AND source_ref_id=?').get(project, created.domain_id), { action: 'archive', status: 'queued' });
    assert.equal((await read(sourceGet, { id: 'mcp-source' })).source.id, 'mcp-source', 'Deleting authored text or its collection does not delete an independent indexed source.');
    assert.equal(providerCalls, 0);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    global.fetch = originalFetch;
    const errors = [], cleanup = async task => { try { await task(); } catch (error) { errors.push(error); } };
    await cleanup(() => db.prepare('UPDATE ai_knowledge_security_bindings SET effect=? WHERE id=?').run(binding.effect, 'mcp-binding'));
    // Include committed rows whose receipts were lost before an assertion could
    // record their IDs; preserve everything that existed before this fixture.
    await cleanup(async () => { const rows = await db.prepare('SELECT id FROM ai_knowledge_repo WHERE project_id=? AND title LIKE ?').all(project, prefix + '%'); items.push(...rows.map(row => row.id).filter(id => !before.items.includes(id))); });
    await cleanup(async () => { const rows = await db.prepare('SELECT id FROM ai_knowledge_collections WHERE project_id=? AND name LIKE ?').all(project, prefix + '%'); collections.push(...rows.map(row => row.id).filter(id => !before.collections.includes(id))); });
    for (const id of new Set(collections)) await cleanup(() => db.prepare('DELETE FROM ai_knowledge_collections WHERE id=? AND project_id=?').run(id, project));
    for (const id of new Set(items)) {
      await cleanup(() => db.prepare("DELETE FROM ai_knowledge_sources WHERE project_id=? AND source_kind='knowledge_item' AND source_ref_id=?").run(project, id));
      await cleanup(() => db.prepare('DELETE FROM ai_knowledge_sync_outbox WHERE project_id=? AND source_ref_id=?').run(project, id));
      await cleanup(() => db.prepare('DELETE FROM ai_knowledge_repo WHERE id=? AND project_id=?').run(id, project));
    }
    for (const id of plans) await cleanup(() => db.prepare('DELETE FROM mcp_action_plans WHERE id=?').run(id));
    if (credential?.id) await cleanup(() => db.prepare('DELETE FROM mcp_credentials WHERE id=?').run(credential.id));
    for (const id of added) await cleanup(() => db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run('mcp-fixture-role', id));
    await cleanup(async () => assert.deepEqual((await db.prepare('SELECT id FROM ai_knowledge_repo WHERE project_id=?').all(project)).map(row => row.id).sort(), before.items));
    await cleanup(async () => assert.deepEqual((await db.prepare('SELECT id FROM ai_knowledge_collections WHERE project_id=?').all(project)).map(row => row.id).sort(), before.collections));
    await cleanup(async () => assert.deepEqual((await db.prepare('SELECT id FROM ai_knowledge_sync_outbox WHERE project_id=?').all(project)).map(row => row.id).sort(), before.outbox));
    if (errors.length) { if (primaryError) primaryError.cleanupErrors = errors; else throw new AggregateError(errors, 'MCP Knowledge fixture cleanup failed: ' + errors.map(error => error.message).join('; ')); }
  }
};
