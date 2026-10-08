import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QualityAgentRuntime} from '../dist/lib/qualityAgents/runtime.js';
import {missionCredential,validateMissionDecision} from '../dist/lib/qualityAgents/mission.js';
const delay=()=>new Promise(r=>setTimeout(r,30));
async function until(runtime,id,predicate){const end=Date.now()+25000;while(Date.now()<end){const run=runtime.get(id);if(predicate(run))return run;await delay();}throw Error('Browser mission timed out');}
const input=(target,ref)=>({client_run_id:'browser-mission-'+crypto.randomUUID(),kind:'web',target_url:target,scope:{project_id:'p',app_type_id:'a'},limits:{max_pages:5,max_duration_ms:25000},options:{mission:{goal:'Find the product price and report it',max_actions:5,allow_form_submission:false},...(ref?{credential_ref:ref}:{})}});
test('credential references enforce exact project and origin and never accept arbitrary environment names',()=>{
 const value=input('https://shop.test/','qa-login');
 const entry={id:'qa-login',project_ids:['p'],origin:'https://shop.test',type:'http_basic',username_env:'QUALITY_SECRET_USER',password_env:'QUALITY_SECRET_PASSWORD'};
 const env={QUALITY_AGENT_CREDENTIAL_REFERENCES:JSON.stringify([entry]),QUALITY_SECRET_USER:'user',QUALITY_SECRET_PASSWORD:'password'};
 assert.equal(missionCredential(value,env).httpCredentials.origin,'https://shop.test');
 assert.throws(()=>missionCredential({...value,scope:{project_id:'other'}},env),e=>e.code==='QUALITY_CREDENTIAL_SCOPE');
 assert.throws(()=>missionCredential({...value,target_url:'https://evil.test/'},env),e=>e.code==='QUALITY_CREDENTIAL_SCOPE');
 assert.throws(()=>missionCredential(value,{...env,QUALITY_AGENT_CREDENTIAL_REFERENCES:JSON.stringify([{...entry,password_env:'HOME'}])}),e=>e.code==='QUALITY_CREDENTIAL_UNAVAILABLE');
});
test('decisions must use current observed non-sensitive elements and approved origin',()=>{
 const obs={sequence:1,url:'https://shop.test/',title:'Shop',text:'Shop',elements:[{id:'element-1',tag:'input',label:'Password',type:'password',sensitive:true}]};
 for(const decision of [{action:'fill',element_id:'element-1',value:'secret',summary:'Login'},{action:'click',element_id:'element-2',summary:'Click'},{action:'navigate',url:'https://evil.test',summary:'Visit'},{action:'evaluate',summary:'Run script'}])assert.throws(()=>validateMissionDecision(decision,obs,obs.url));
});
test('real autonomous browser adapts to fresh observations, retains extraction/report and rejects stale decisions',{timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'browser-mission-'));let runtime;
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/product'?'<html><title>Product</title><h1>Product</h1><p hidden>Price: $42</p><p>Price: $42</p><div hidden>hidden-private-content</div></html>':'<html><title>Shop</title><h1>Shop</h1><a href="/product">Product details</a><input type="password" value="hidden-password"></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const target=`http://127.0.0.1:${server.address().port}/`;
 try {
  runtime=await new QualityAgentRuntime({directory:dir,executablePath:process.env.CHROME_EXECUTABLE,environment:{QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS:'127.0.0.1'}}).initialize();
  const accepted=await runtime.accept(input(target));
  const first=await until(runtime,accepted.id,r=>Boolean(r.decision_request));
  assert.equal(JSON.stringify(first.decision_request).includes('hidden-password'),false);
  const link=first.decision_request.elements.find(e=>e.label==='Product details');assert.ok(link);
  await assert.rejects(runtime.decide(accepted.id,{sequence:2,scope:first.scope,decision:{action:'click',element_id:link.id,summary:'Open product'}}),e=>e.code==='QUALITY_DECISION_STALE');
  await assert.rejects(runtime.decide(accepted.id,{sequence:1,scope:{project_id:'other'},decision:{action:'click',element_id:link.id,summary:'Open product'}}),e=>e.code==='QUALITY_RUN_NOT_FOUND');
  await runtime.decide(accepted.id,{sequence:1,scope:first.scope,decision:{action:'click',element_id:link.id,summary:'Open product details'}});
  const second=await until(runtime,accepted.id,r=>r.decision_request?.sequence===2);assert.match(second.decision_request.text,/Price: \$42/);assert.equal(second.decision_request.text.includes('hidden-private-content'),false);
  await runtime.decide(accepted.id,{sequence:2,scope:second.scope,decision:{action:'extract',summary:'Record the observed product price'}});
  const third=await until(runtime,accepted.id,r=>r.decision_request?.sequence===3);
  await runtime.decide(accepted.id,{sequence:3,scope:third.scope,decision:{action:'assert_text',text:'Price: $42',summary:'Verify the observed product price is visible'}});
  const verified=await until(runtime,accepted.id,r=>r.decision_request?.sequence===4);await runtime.decide(accepted.id,{sequence:4,scope:verified.scope,decision:{action:'complete',summary:'The product price is $42, observed and checked on the product page.'}});
  const done=await until(runtime,accepted.id,r=>['completed','failed'].includes(r.state));assert.equal(done.state,'completed',JSON.stringify(done.error));assert.equal(done.mission_report.status,'completed');assert.equal(done.mission_report.actions.length,4);assert.match(done.findings.find(f=>f.category==='extraction').evidence,/Price: \$42/);assert.ok(done.artifacts.some(a=>a.type==='screenshot'));assert.ok(done.artifacts.some(a=>a.type==='report'));
  assert.equal('decision_request' in done,false);
  const persisted=JSON.parse(await readFile(join(dir,'runs',accepted.id+'.json'),'utf8'));assert.equal('decision_request' in persisted.run,false);
  await assert.rejects(runtime.decide(accepted.id,{sequence:3,scope:done.scope,decision:{action:'complete',summary:'Done'}}),e=>e.code==='QUALITY_RUN_FINISHED');
  const cancelled=await runtime.accept(input(target));await until(runtime,cancelled.id,r=>Boolean(r.decision_request));await runtime.cancel(cancelled.id);assert.equal(runtime.get(cancelled.id).state,'cancelled');
 }finally{await runtime?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
