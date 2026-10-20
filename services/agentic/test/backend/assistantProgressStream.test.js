const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const routes=require('../../backend/routes/agenticWorkflows.routes');
const assistant=require('../../backend/services/agenticAssistant.service');
const projects=require('@hellotest/platform/backend/public/projectAccess');
async function fixture(t,respond,authorize=async()=>{}) {
 t.mock.method(projects,'getProject',async()=>({id:'project'}));t.mock.method(assistant,'respond',respond);
 const handlers=new Map();
 await routes({authenticate:async()=>{},validate:()=>{},requirePermission:()=>authorize,
  get:(path,handler)=>handlers.set('GET '+path,handler),post:(path,options,handler)=>handlers.set('POST '+path,handler||options),put:()=>{},delete:()=>{},patch:()=>{}});
 const raw=new EventEmitter();raw.frames=[];raw.destroyed=false;raw.writableEnded=false;raw.writableLength=0;
 raw.writeHead=(status,headers)=>{raw.headers=headers;};raw.write=frame=>{raw.frames.push(frame);return true;};raw.end=()=>{raw.writableEnded=true;};raw.destroy=()=>{raw.destroyed=true;raw.emit('close');};
 const reply={raw,hijack(){this.hijacked=true;},getHeaders:()=>({})};
 const req={raw:new EventEmitter(),headers:{accept:'text/event-stream'},body:{project_id:'project',agent_id:'quality-evaluator',prompt:'Assess risk',context_scopes:['stories']},user:{id:'user'},log:{error:()=>{}}};
 return {req,reply,run:()=>handlers.get('POST /agentic-assistant/sessions')(req,reply)};
}
test('specialist stream forwards trusted progress and final schema result after authorization',async t=>{
 let input;const f=await fixture(t,async value=>{input=value;value.onProgress({contract_type:'AgentProgress',contract_version:'1.0',phase:'context',message:'Reading authorized story evidence'});return {transaction:{id:'review'},result:{response:'Checked outcome'}};});
 await f.run();const frames=f.reply.raw.frames.join('');assert.match(frames,/event: progress/);assert.match(frames,/event: result/);assert.equal(input.user.id,'user');assert.equal(f.reply.raw.headers['Content-Type'],'text/event-stream; charset=utf-8');assert.equal(f.reply.raw.listenerCount('close'),0);
});
test('stream does not take response ownership before project authorization',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;},async()=>{throw Object.assign(new Error('Denied'),{statusCode:403});});
 await assert.rejects(f.run(),error=>error.statusCode===403);assert.equal(calls,0);assert.equal(f.reply.hijacked,undefined);
});
test('stream hides internal errors but retains actionable agent errors and ends cleanly',async t=>{
 const f=await fixture(t,async()=>{throw Object.assign(new Error('PRIVATE_PROVIDER_BODY'),{statusCode:502,publicMessage:'The selected model is unavailable.',code:'AGENT_PROVIDER_ERROR'});});
 await f.run();const frames=f.reply.raw.frames.join('');assert.match(frames,/AGENT_PROVIDER_ERROR/);assert.match(frames,/selected model is unavailable/);assert.ok(!frames.includes('PRIVATE_PROVIDER_BODY'));assert.equal(f.reply.raw.writableEnded,true);
});
