const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');

const actor={user:{id:'reviewer'},projectId:'project',clientId:'host'};
const operations=[
  {id:'build',method:'POST',path:'/test-cases/:id/automation/generator-jobs',permission:'automation.build',read:false,prepare:true,exposure:'planned_action',reason:null,path_parameters:['id']},
  {id:'status',method:'GET',path:'/test-cases/automation/jobs/:transactionId',permission:'automation.build',read:true,prepare:false,exposure:'read',reason:null,path_parameters:['transactionId']}
];
const calls=[];
const fail=(message,statusCode=403,code='DENIED')=>Object.assign(new Error(message),{publicMessage:message,statusCode,code});
const backplane={bounded:value=>value,auditFailure(){},
  prepare:async(a,input)=>{assert.equal(a,actor);calls.push(input);return {plan_id:'immutable-plan',digest:'a'.repeat(64),state:'requires_authorization',preview:{operation:operations[0],arguments:input.arguments},expires_at:'2026-11-06T00:15:00Z',authorization:'Review the original plan in Agent Studio.'};},
  read:async(a,input)=>{assert.equal(a,actor);calls.push(input);return {data:{transaction_id:'original-transaction',status:'running'},observed_at:'2026-11-06T00:00:00Z',bounded:true};}
};
const file=require.resolve('../../backend/mcpServer'),local=createRequire(file),moduleStub={exports:{}};
const mocks={
  './backplane':backplane,
  './registry':{all:()=>operations,revision:()=> 'test-registry'},
  './projections':{entities:{projects:{}},schema:async()=>({})},
  './auth':{permit:async a=>{if(a.projectId!==actor.projectId)throw fail('Foreign project.');},fail},
  '@hellotest/platform/backend/src/db':{prepare:()=>({run:async()=>{}})}
};
new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:local(id),moduleStub,moduleStub.exports);
const server=moduleStub.exports;
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
async function rpc(method,params={}){
  const response=await server.handler.fetch(new Request('http://localhost/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':method,...(params.name?{'Mcp-Name':params.name}:{})},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:meta}})}),{authInfo:{token:'internal-fixture',clientId:'host',scopes:[],extra:{actor}}});
  assert.equal(response.status,200);
  return (await response.json()).result;
}
test.after(()=>server.handler.close());

test('real MCP SDK advertises Automation Engineer domain tools and prepares the existing durable command',async()=>{
  const catalog=await rpc('tools/list');
  for(const name of ['hellotest_automation_engineer_prepare','hellotest_automation_engineer_status']){
    const tool=catalog.tools.find(tool=>tool.name===name);assert.ok(tool,name);
    assert.equal(tool.inputSchema.additionalProperties,false);
    assert.equal(tool.outputSchema.properties.data.type,'object');
  }
  assert.equal(catalog.tools.some(tool=>/^browser_/.test(tool.name)),false,'HelloTest exposes domain capabilities without proxying upstream browser tools.');
  const result=await rpc('tools/call',{name:'hellotest_automation_engineer_prepare',arguments:{test_case_id:'saved-case',test_suite_id:'reviewed-suite',test_data_set_id:'saved-data'}});
  assert.equal(result.isError,undefined);
  assert.deepEqual(result.structuredContent.scope,{project_id:'project',subject:'reviewer'});
  assert.equal(result.structuredContent.data.state,'requires_authorization');
  assert.deepEqual(calls.at(-1),{operation_id:'build',arguments:{path:{id:'saved-case'},body:{test_suite_id:'reviewed-suite',test_data_set_id:'saved-data',ai_feature:'ai.agentic.automation-engineer',verification_mode:'generate_only'}}});
});

test('real MCP SDK returns original job progress and rejects client-selected identity before preparing',async()=>{
  const result=await rpc('tools/call',{name:'hellotest_automation_engineer_status',arguments:{transaction_id:'original-transaction'}});
  assert.equal(result.structuredContent.data.record.status,'running');
  assert.deepEqual(calls.at(-1),{operation_id:'status',arguments:{path:{transactionId:'original-transaction'}}});
  const count=calls.length;
  const rejected=await rpc('tools/call',{name:'hellotest_automation_engineer_prepare',arguments:{test_case_id:'saved-case',project_id:'other',approved:true}});
  assert.equal(rejected.isError,true);
  assert.equal(calls.length,count);
});
