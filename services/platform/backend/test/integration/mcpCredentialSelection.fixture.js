const assert = require('node:assert/strict');

const project = 'mcp-p-a';
const credentialsPath = '/agentic-workflows/mcp/credentials';
const protocol = '2026-07-28';
const meta = {
  'io.modelcontextprotocol/protocolVersion': protocol,
  'io.modelcontextprotocol/clientCapabilities': {},
};

exports.verify = async ({ app, db, headers }) => {
  const issue = options => app.inject({ method: 'POST', url: credentialsPath, headers,
    payload: { project_id: project, client_id: 'exact-tools-fixture', ...options } });
  const rpc = async (credential, method, params = {}, name) => {
    const response = await app.inject({ method: 'POST', url: '/mcp', headers: {
      host: 'localhost', authorization: 'Bearer ' + credential.token, accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': protocol, 'Mcp-Method': method, ...(name && { 'Mcp-Name': name }),
    }, payload: { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } } });
    return { status: response.statusCode, body: response.json() };
  };
  const call = (credential, name, args) => rpc(credential, 'tools/call', { name, arguments: args }, name);
  const toolNames = async credential => {
    const { status, body } = await rpc(credential, 'tools/list');
    assert.equal(status, 200);
    return body.result.tools.map(tool => tool.name).sort();
  };
  const denied = ({ status, body }) => {
    assert.ok(status === 403 || body.error || body.result?.isError, JSON.stringify(body));
    assert.equal(body.result?.structuredContent, undefined);
  };
  const data = ({ status, body }) => {
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.result?.isError, undefined, JSON.stringify(body));
    assert.ok(body.result?.structuredContent?.data, JSON.stringify(body));
    return body.result.structuredContent.data;
  };
  const makeCredential = async (toolNames, lifetime) => {
    const response = await issue({ tool_names: toolNames, expires_in: lifetime });
    assert.equal(response.statusCode, 200, 'A configured tool and expiry preset must issue a credential.');
    assert.equal(response.headers['cache-control'], 'no-store');
    const credential = response.json();
    assert.deepEqual([...credential.tool_names].sort(), [...toolNames].sort());
    const claims = require('@hellotest/mcp/backend/auth').decode(credential.token);
    assert.equal(claims.exp - claims.iat, lifetime);
    assert.equal(Date.parse(credential.issued_at), claims.iat * 1000);
    assert.equal(Date.parse(credential.expires_at), claims.exp * 1000);
    const row = await db.prepare('SELECT tool_names, expires_at FROM mcp_credentials WHERE id=?').get(credential.id);
    assert.deepEqual([...row.tool_names].sort(), [...toolNames].sort());
    assert.equal(new Date(row.expires_at).getTime(), claims.exp * 1000);
    return credential;
  };

  const readTool = 'hellotest_test_cases_get';
  const writeTool = 'hellotest_story_create_prepare';
  const executeTool = 'hellotest_operation_execute';
  const selected = [readTool, writeTool, executeTool].sort();
  const standardPeriods = [3600, 86400, 604800, 2592000];
  let short;
  for (const lifetime of standardPeriods) {
    const credential = await makeCredential([readTool], lifetime);
    short ??= credential;
    assert.deepEqual(await toolNames(credential), [readTool]);
  }
  const scoped = await makeCredential(selected, 7776000);
  assert.deepEqual(await toolNames(scoped), selected);

  const before = await db.prepare('SELECT count(*)::int AS count FROM mcp_credentials').get();
  for (const options of [
    { tool_names: [], expires_in: 3600 },
    { tool_names: readTool, expires_in: 3600 },
    { tool_names: [readTool, 'hellotest_graph_expand'], expires_in: 3600 },
    { tool_names: [readTool], expires_in: 3601 },
    { tool_names: [readTool], expires_in: '3600' },
  ]) {
    assert.equal((await issue(options)).statusCode, 400, JSON.stringify(options));
  }
  assert.deepEqual(await db.prepare('SELECT count(*)::int AS count FROM mcp_credentials').get(), before);

  const list = await app.inject({ method: 'GET', url: `${credentialsPath}?project_id=${project}`, headers });
  assert.equal(list.statusCode, 200, list.body);
  const metadata = list.json().find(row => row.id === scoped.id);
  assert.ok(metadata);
  assert.deepEqual([...metadata.tool_names].sort(), selected);
  assert.equal(Date.parse(metadata.expires_at), Date.parse(scoped.expires_at));
  assert.equal(Object.hasOwn(metadata, 'token'), false);
  const otherProjectList = await app.inject({ method: 'GET', url: `${credentialsPath}?project_id=mcp-p-b`, headers });
  assert.equal(otherProjectList.statusCode, 200, otherProjectList.body);
  assert.ok(!otherProjectList.json().some(row => row.id === scoped.id));

  assert.equal(data(await call(scoped, readTool, { test_case_id: 'mcp-case-a' })).record.title, 'A visible case');
  const permission = await db.prepare("SELECT id FROM permissions WHERE code='testcase.view'").get();
  await db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run('mcp-fixture-role', permission.id);
  try {
    denied(await call(scoped, readTool, { test_case_id: 'mcp-case-a' }));
  } finally {
    await db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES (?,?)').run('mcp-fixture-role', permission.id);
  }
  const foreign = await call(scoped, readTool, { test_case_id: 'mcp-case-b' });
  denied(foreign);
  assert.doesNotMatch(JSON.stringify(foreign.body), /B private case/);
  denied(await call(scoped, 'hellotest_test_cases_list', {}));
  denied(await call(scoped, 'hellotest_test_case_create_prepare', {
    draft_key: 'unselected-test-case-create', app_type_id: 'mcp-app-a', title: 'Unselected creation fixture',
  }));
  const count = await db.prepare('SELECT count(*)::int AS count FROM test_cases WHERE title=?').get('Unselected creation fixture');
  assert.equal(count.count, 0);
  denied(await call(short, writeTool, { title: 'Unselected story plan fixture' }));

  const resource = (credential, uri) => rpc(credential, 'resources/read', { uri }, uri);
  for (const uri of ['hellotest://schema', `hellotest://projects/${project}/ontology`, `hellotest://projects/${project}/graph/ontology`]) {
    denied(await resource(scoped, uri));
  }
  denied(await rpc(scoped, 'prompts/get', { name: 'investigate_failure', arguments: { question: 'Show the failed case.' } }, 'investigate_failure'));
  const schemaReader = await makeCredential(['hellotest_database_schema'], 3600);
  assert.deepEqual(await toolNames(schemaReader), ['hellotest_database_schema']);
  const schema = await resource(schemaReader, 'hellotest://schema');
  assert.equal(schema.status, 200, JSON.stringify(schema.body));
  assert.equal(JSON.parse(schema.body.result.contents[0].text).scope.project_id, project);
  denied(await resource(schemaReader, `hellotest://projects/${project}/ontology`));

  await db.prepare('UPDATE mcp_credentials SET tool_names=?::jsonb WHERE id=?').run(JSON.stringify([readTool]), schemaReader.id);
  assert.equal((await rpc(schemaReader, 'tools/list')).status, 401, 'A changed stored selection cannot replace the one bound to the token.');

  const title = 'Scoped credential reviewed story fixture';
  const countStories = async () => (await db.prepare('SELECT count(*)::int AS count FROM requirements WHERE project_id=? AND title=?').get(project, title)).count;
  const plan = data(await call(scoped, writeTool, { title, description: 'Review this fixture before saving.' }));
  assert.equal(plan.state, 'requires_authorization');
  assert.equal(await countStories(), 0);
  assert.equal(data(await call(scoped, executeTool, { plan_id: plan.plan_id })).state, 'requires_authorization');
  assert.equal(await countStories(), 0);

  const approve = await app.inject({ method: 'POST', url: `/agentic-workflows/mcp/plans/${plan.plan_id}/authorize`, headers,
    payload: { project_id: project, digest: plan.digest } });
  assert.equal(approve.statusCode, 200, approve.body);
  const another = await makeCredential([executeTool], 3600);
  denied(await call(another, executeTool, { plan_id: plan.plan_id }));
  assert.equal(await countStories(), 0);
  assert.equal(data(await call(scoped, executeTool, { plan_id: plan.plan_id })).state, 'succeeded_verified');
  assert.equal(data(await call(scoped, executeTool, { plan_id: plan.plan_id })).state, 'succeeded_verified');
  assert.equal(await countStories(), 1);

  await db.prepare("UPDATE mcp_credentials SET expires_at=NOW()-INTERVAL '1 second' WHERE id=?").run(short.id);
  assert.equal((await rpc(short, 'tools/list')).status, 401);
  const revoked = await app.inject({ method: 'DELETE', url: `${credentialsPath}/${scoped.id}?project_id=${project}`, headers });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await rpc(scoped, 'tools/list')).status, 401);
  assert.equal((await call(scoped, readTool, { test_case_id: 'mcp-case-a' })).status, 401);
};
