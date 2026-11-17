const assert=require('node:assert/strict');

// Tool-set scopes on the real schema and the real HTTP transport: what a default credential can reach,
// what a writing set adds, what the credential list shows, and how the platform's own credentials differ.
exports.verify=async({app,db,headers})=>{
  const project='mcp-p-a';
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
  const created=[];
  const create=body=>app.inject({method:'POST',url:'/agentic-workflows/mcp/credentials',headers,payload:{project_id:project,client_id:'tool-set-fixture',...body}});
  const post=(token,payload,name)=>app.inject({method:'POST',url:'/mcp',headers:{host:'localhost',authorization:'Bearer '+token,accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':payload.method,...(name?{'Mcp-Name':name}:{})},payload});
  const toolNames=async token=>{
    const response=await post(token,{jsonrpc:'2.0',id:1,method:'tools/list',params:{_meta:meta}});
    assert.equal(response.statusCode,200,response.body);
    return response.json().result.tools.map(tool=>tool.name).sort();
  };
  const plans=async()=>(await db.prepare('SELECT COUNT(*)::int AS count FROM mcp_action_plans').get()).count;
  try{
    // A credential is read-only unless a writing set is asked for.
    const standard=await create({});assert.equal(standard.statusCode,200,standard.body);
    const readOnly=standard.json();created.push(readOnly.id);
    assert.deepEqual(readOnly.scopes,['knowledge','records']);
    const stored=await db.prepare('SELECT scopes,internal FROM mcp_credentials WHERE id=?').get(readOnly.id);
    assert.deepEqual(stored.scopes,['knowledge','records']);assert.equal(stored.internal,false);
    const readNames=await toolNames(readOnly.token);
    for(const name of ['hellotest_context_build','hellotest_graph_context','hellotest_capabilities','hellotest_database_query'])assert.ok(readNames.includes(name),name);
    assert.deepEqual(readNames.filter(name=>/_prepare$|_execute$|_status$/.test(name)),[],'nothing that prepares, runs or tracks a change');

    // Calling a tool outside the credential's sets fails and prepares nothing.
    const before=await plans();
    const hidden=await post(readOnly.token,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'hellotest_operation_prepare',arguments:{operation_id:'anything',arguments:{}},_meta:meta}},'hellotest_operation_prepare');
    assert.ok(hidden.statusCode!==200||hidden.json().error||hidden.json().result?.isError,hidden.body);
    assert.equal(hidden.json().result?.structuredContent,undefined);
    assert.equal(await plans(),before);

    // A writing set brings discovery with it and nothing else.
    const writing=await create({scopes:['actions']});assert.equal(writing.statusCode,200,writing.body);
    const writer=writing.json();created.push(writer.id);
    assert.deepEqual(writer.scopes,['records','actions']);
    const writerNames=await toolNames(writer.token);
    for(const name of ['hellotest_operation_prepare','hellotest_operation_execute','hellotest_capabilities'])assert.ok(writerNames.includes(name),name);
    assert.ok(!writerNames.includes('hellotest_context_build')&&!writerNames.includes('hellotest_automation_engineer_prepare'),'knowledge and automation were not asked for');

    // Unknown sets are refused with a message that says what is available, and issue nothing.
    const rows=(await db.prepare("SELECT COUNT(*)::int AS count FROM mcp_credentials WHERE client_id LIKE 'tool-set-fixture-%'").get()).count;
    for(const scopes of [['admin'],[],'everything']){
      const refused=await create({scopes});assert.equal(refused.statusCode,400,refused.body);assert.match(refused.body,/knowledge, records, actions, automation/);
    }
    assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM mcp_credentials WHERE client_id LIKE 'tool-set-fixture-%'").get()).count,rows);

    // The platform's own credentials are internal, narrow and short; they never appear in a person's list.
    const mcpAuth=require('@hellotest/mcp/backend/auth');
    const platform=await mcpAuth.issue({id:'mcp-a'},project,'tool-set-internal',{scopes:['knowledge'],internal:true,ttlSeconds:180});created.push(platform.id);
    const internalRow=await db.prepare('SELECT scopes,internal,EXTRACT(EPOCH FROM (expires_at-created_at))::int AS seconds FROM mcp_credentials WHERE id=?').get(platform.id);
    assert.deepEqual(internalRow.scopes,['knowledge']);assert.equal(internalRow.internal,true);assert.ok(internalRow.seconds>=175&&internalRow.seconds<=185);
    const internalNames=await toolNames(platform.token);
    assert.ok(internalNames.includes('hellotest_context_build')&&!internalNames.includes('hellotest_capabilities'),'the retrieval credential is knowledge only');
    const listed=await app.inject({method:'GET',url:`/agentic-workflows/mcp/credentials?project_id=${project}`,headers});assert.equal(listed.statusCode,200,listed.body);
    const rowsListed=listed.json();
    assert.deepEqual(rowsListed.find(row=>row.id===writer.id).scopes,['records','actions'],'the list shows each credential\'s access');
    assert.ok(!rowsListed.some(row=>row.id===platform.id),'internal credentials are not shown');

    // Credentials stored before tool sets existed take the read-only default from the column default.
    await db.prepare('INSERT INTO mcp_credentials(id,user_id,project_id,client_id,expires_at) VALUES (?,?,?,?,NOW() + INTERVAL \'1 hour\')').run('legacy-credential','mcp-a',project,'legacy-fixture');created.push('legacy-credential');
    const legacy=await db.prepare('SELECT scopes,internal FROM mcp_credentials WHERE id=?').get('legacy-credential');
    assert.deepEqual(legacy.scopes,['knowledge','records']);assert.equal(legacy.internal,false);

    // The discovery endpoint publishes the sets and does not claim OAuth.
    const discovery=await app.inject({method:'GET',url:`/agentic-workflows/mcp/server?project_id=${project}`,headers});assert.equal(discovery.statusCode,200,discovery.body);
    const contract=discovery.json();
    assert.deepEqual(contract.tool_sets.map(set=>set.id),['knowledge','records','actions','automation']);
    assert.ok(contract.tool_sets.every(set=>set.tool_count>0));
    assert.equal(contract.tools.reduce((sum,tool)=>sum+(tool.tool_set?1:0),0),contract.tools.length,'every published tool belongs to a set');
    assert.equal(contract.tools.some(tool=>tool.name==='hellotest_graph_expand'),false,'the retired one-hop graph tool is no longer published');
    assert.deepEqual(contract.client_contract.default_scopes,['knowledge','records']);assert.equal(contract.client_contract.oauth_supported,false);
  }finally{
    for(const id of created)await db.prepare('DELETE FROM mcp_credentials WHERE id=?').run(id).catch(()=>{});
  }
};
