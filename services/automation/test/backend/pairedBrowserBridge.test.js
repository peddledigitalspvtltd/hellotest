const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const security = require('../../backend/lib/pairedLocalSecurity');

function fixture() {
  const bridges = new Map(), commands = new Map(), writes = [];
  const access = {active:true,allowed:true};
  const db = { transaction: fn => fn, prepare: sql => ({
    async get(...args) {
      if (/SELECT id,status,is_workspace_admin FROM users/.test(sql)) return {id:args[0],status:access.active?'active':'suspended'};
      if (/SELECT id FROM automation_paired_browser_bridges/.test(sql)) return bridges.get(args[0]);
      if (/SELECT \* FROM automation_paired_browser_bridges/.test(sql)) return bridges.get(args[0]);
      if (/bound_job_id=COALESCE/.test(sql)) {
        const row = bridges.get(args[1]);
        if (row.bound_job_id && row.bound_job_id !== args[0]) return undefined;
        row.bound_job_id = args[0]; return { id: row.id };
      }
      if (/SET status='delivered'/.test(sql)) {
        if ([...commands.values()].some(row => row.bridge_id === args[0] && row.status === 'delivered')) return undefined;
        const row = [...commands.values()].find(row => row.bridge_id === args[0] && row.status === 'queued');
        if (row) row.status = 'delivered'; return row;
      }
      if (/SELECT \* FROM automation_paired_browser_commands/.test(sql)) { const row = commands.get(args[0]); return row?.bridge_id === args[1] ? row : undefined; }
      if (/SELECT status,response_ciphertext/.test(sql)) return commands.get(args[0]);
      throw new Error(sql);
    },
    async run(...args) {
      writes.push({sql,args});
      if (/INSERT INTO automation_paired_browser_bridges/.test(sql)) {
        const [id,project_id,app_type_id,created_by,agent_id,paired_origin,allowed_case_ids,nonce,status,expires_at] = args;
        bridges.set(id,{id,project_id,app_type_id,created_by,agent_id,paired_origin,allowed_case_ids,nonce,status,expires_at,created_at:new Date().toISOString()});
      } else if (/INSERT INTO automation_paired_browser_commands/.test(sql)) {
        const [id,bridge_id,request_ciphertext] = args; commands.set(id,{id,bridge_id,request_ciphertext,status:'queued'});
      } else if (/SET started_at=/.test(sql)) bridges.get(args[0]).started_at ||= new Date().toISOString();
      else if (/SET status='completed'/.test(sql)) Object.assign(commands.get(args[1]),{status:'completed',response_ciphertext:args[0]});
      else if (/commands SET status='unknown'/.test(sql)) { const row=commands.get(args[0]); if (row && row.status !== 'completed') row.status='unknown'; }
      else if (/bridges SET status='closed'/.test(sql)) bridges.get(args[0]).status='closed';
      else throw new Error(sql);
    }
  }) };
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../../backend/services/pairedBrowserBridge.service'),'utf8'),{
    module,Response,URL,Buffer,Date,require:name=>name.endsWith('/src/db')?db:name.endsWith('/pairedLocalSecurity')?security
      :name.endsWith('/public/projectAccess')?{getProject:async()=>({})}
      :name.endsWith('/optionalEvidenceAccess.service')?{getOptionalEvidenceAccess:async()=>({'automation.build':access.allowed,'automation.ai':access.allowed})}:require(name)
  });
  return {...module.exports,bridges,commands,writes,access};
}
async function ready(f) {
  const grant = await f.create({caseIds:['one','two'],projectId:'project',appTypeId:'app',userId:'actor',agentId:'agent',pairedOrigin:'http://localhost:8080'});
  const auth = {bridgeId:grant.id,agentId:'agent',token:grant.token};
  await f.poll(auth);
  return {grant,auth,scope:{bridgeId:grant.id,projectId:'project',appTypeId:'app',userId:'actor',caseId:'one',jobId:'job'}};
}

test('paired browser grant confines agent, actor, project, application, case and job without exposing server credentials', async () => {
  const f=fixture(),{grant,auth,scope}=await ready(f);
  assert.match(grant.poll_url,new RegExp(`/api/local-browser-bridges/${grant.id}/poll$`));
  assert.match(grant.result_url,/\/result$/);
  assert.ok(new Date(grant.expires_at).getTime()-Date.now()<=60*60_000);
  await f.authorize(scope);
  await f.authorize({...scope,caseId:'two'});
  for (const change of [{projectId:'other'},{appTypeId:'other'},{userId:'other'},{caseId:'other'},{jobId:'other'}]) await assert.rejects(f.authorize({...scope,...change}),{code:'PAIRED_BROWSER_SCOPE'});
  for (const change of [{agentId:'other'},{token:'other'}]) await assert.rejects(f.poll({...auth,...change}),{code:'PAIRED_BROWSER_AUTH'});
  assert.ok(!JSON.stringify(f.writes).includes(grant.token),'Only a nonce is persisted; the bearer is derived for this agent and bridge.');
  f.access.allowed=false;
  await assert.rejects(f.authorize(scope),{code:'PAIRED_BROWSER_ACCESS'});
  f.access.allowed=true;f.access.active=false;
  await assert.rejects(f.authorize(scope),{code:'PAIRED_BROWSER_ACCESS'});
});

test('browser MCP command/result exchange is encrypted, at most once and accepts only identical receipt retries',async()=>{
  const f=fixture(),{auth,scope}=await ready(f);
  const pending=f.exchange({scope,method:'tools/call',params:{name:'browser_fill',arguments:{locator:'#password',value:'PRIVATE_BROWSER_INPUT'}}});
  let delivery;
  for (let attempt=0;attempt<20&&!delivery?.command;attempt++){await new Promise(resolve=>setImmediate(resolve));delivery=await f.poll(auth);}
  assert.equal(delivery.command.params.arguments.value,'PRIVATE_BROWSER_INPUT');
  assert.equal((await f.poll(auth)).command,null,'Delivered action is not offered again if its acknowledgement was lost.');
  const receipt={status:200,body:{jsonrpc:'2.0',id:delivery.command.id,result:{content:[{type:'text',text:'PRIVATE_BROWSER_EVIDENCE'}]}}};
  await assert.rejects(f.result({...auth,commandId:delivery.command.id,response:{...receipt,body:{...receipt.body,id:'unrelated'}}}),{code:'PAIRED_BROWSER_RECEIPT'});
  await f.result({...auth,commandId:delivery.command.id,response:receipt});
  assert.equal((await f.result({...auth,commandId:delivery.command.id,response:receipt})).replayed,true);
  assert.equal((await pending).body.result.content[0].text,'PRIVATE_BROWSER_EVIDENCE');
  await assert.rejects(f.result({...auth,commandId:delivery.command.id,response:{...receipt,status:500}}),/different result/);
  assert.doesNotMatch(JSON.stringify(f.writes),/PRIVATE_BROWSER_INPUT|PRIVATE_BROWSER_EVIDENCE/);
  assert.equal(f.commands.size,1);
});

test('lost local browser acknowledgement closes the bridge and never repeats an uncertain action',async()=>{
  const f=fixture(),{auth,scope}=await ready(f);
  await assert.rejects(f.exchange({scope,method:'tools/call',params:{name:'browser_click',arguments:{locator:'#submit'}},timeoutMs:5}),{code:'PAIRED_BROWSER_ACKNOWLEDGEMENT_UNKNOWN',nonRetryable:true});
  assert.equal([...f.commands.values()][0].status,'unknown');
  assert.equal((await f.poll(auth)).state,'closed');
  await assert.rejects(f.exchange({scope,method:'tools/call',params:{name:'browser_click'}}),{code:'PAIRED_BROWSER_UNAVAILABLE'});
  assert.equal(f.commands.size,1);
});

test('bridge fetch transport preserves MCP session and caller correlation across native JSON RPC envelopes',async()=>{
  const f=fixture(),{auth,scope}=await ready(f),transport=await f.createTransport(scope);
  const pending=transport('paired-browser-mcp',{method:'POST',headers:{'mcp-session-id':'session'},body:JSON.stringify({jsonrpc:'2.0',id:42,method:'tools/list',params:{}})});
  let command;
  for(let attempt=0;attempt<20&&!command;attempt++){await new Promise(resolve=>setImmediate(resolve));command=(await f.poll(auth)).command;}
  assert.equal(command.session_id,'session');
  await f.result({...auth,commandId:command.id,response:{status:200,session_id:'session',body:{jsonrpc:'2.0',id:command.id,result:{tools:[]}}}});
  const response=await pending;
  assert.equal(response.headers.get('mcp-session-id'),'session');
  assert.equal((await response.json()).id,42);
});

test('a local build can queue before the first outbound poll and native verification retains its own receipt',async()=>{
  const f=fixture();
  const grant=await f.create({caseIds:['one'],projectId:'project',appTypeId:'app',userId:'actor',agentId:'agent',pairedOrigin:'http://localhost:8080'});
  const auth={bridgeId:grant.id,agentId:'agent',token:grant.token};
  const scope={bridgeId:grant.id,projectId:'project',appTypeId:'app',userId:'actor',caseId:'one',jobId:'job'};
  const pending=f.exchange({scope,method:'verification/run',params:{schema_version:1,verification_id:'verification',execution_driver:'native'}});
  let command;
  for(let attempt=0;attempt<20&&!command;attempt++){await new Promise(resolve=>setImmediate(resolve));command=(await f.poll(auth)).command;}
  assert.equal(command.method,'verification/run');
  assert.equal(command.params.execution_driver,'native');
  await f.result({...auth,commandId:command.id,response:{status:200,body:{schema_version:1,verification_id:'verification',status:'passed'}}});
  assert.equal((await pending).body.verification_id,'verification');
});
