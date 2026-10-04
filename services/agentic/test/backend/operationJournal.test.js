const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
function fixture() {
  const rows = new Map(); let failSave = false;
  const db = { prepare(sql) { return { get:async(...args)=>{
    if(sql.startsWith('INSERT')) { if(rows.has(args[0])) return; rows.set(args[0],{id:args[0],request_hash:args[5],state:'in_flight'});return{id:args[0]}; }
    if(sql.startsWith('SELECT')) return rows.get(args[0]);
    if(failSave) throw new Error('Database acknowledgement unavailable');
    const row = rows.get(args[1]); row.state='response_received';row.response=args[0];return{id:row.id};
  },run:async(code,id)=>{const row=rows.get(id);if(row.state==='in_flight'){row.state='outcome_unknown';row.error_code=code;}} }; } };
  const file=require.resolve('../../backend/workflows/operationJournal'),local=createRequire(file),module={exports:{}};
  new Function('require','module',fs.readFileSync(file,'utf8'))(id=>id==='@hellotest/platform/backend/src/db'?db:local(id),module);
  return { journal:module.exports,rows,failSave:()=>{failSave=true;},input:{run:{id:'run',project_id:'project'},node:{id:'write',data:{kind:'mcpTool',connectionId:'server',mcpTool:'create_issue'}},input:[{title:'Defect'}],user:{id:'actor'}} };
}
test('a tool receipt reuses a received response and rejects changed arguments',async()=>{
  const f=fixture();let calls=0;
  const dispatch=async()=>{calls++;return{data:{id:'external-id',text:'Preserve the actual business result'}};};
  const first=await f.journal.invoke(f.input,dispatch),second=await f.journal.invoke(f.input,dispatch);
  assert.equal(calls,1);assert.deepEqual(first.data,second.data);assert.equal(second.operation_receipt.reused,true);assert.equal(first.operation_receipt.postcondition_verified,false);
  await assert.rejects(f.journal.invoke({...f.input,input:[{title:'Different operation'}]},dispatch),{code:'AGENT_OPERATION_CONFLICT'});
  assert.equal(calls,1);
});
test('an ambiguous provider failure cannot be automatically sent a second time',async()=>{
  const f=fixture();let calls=0;
  const dispatch=async()=>{calls++;throw Object.assign(new Error('Connection lost after dispatch'),{statusCode:503});};
  await assert.rejects(f.journal.invoke(f.input,dispatch),error=>error.outcome_unknown&&error.retryable===false&&Boolean(error.operation_id));
  await assert.rejects(f.journal.invoke(f.input,dispatch),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});
  assert.equal(calls,1);assert.equal([...f.rows.values()][0].state,'outcome_unknown');
});
test('receipt persistence failure preserves uncertainty instead of replaying a successful effect',async()=>{
  const f=fixture();f.failSave();let calls=0;
  const dispatch=async()=>{calls++;return{created:true};};
  await assert.rejects(f.journal.invoke(f.input,dispatch),error=>error.outcome_unknown===true);
  await assert.rejects(f.journal.invoke(f.input,dispatch),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN'});
  assert.equal(calls,1);
});
