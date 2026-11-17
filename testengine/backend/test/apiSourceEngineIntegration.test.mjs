import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {parseApiSourceIntake} from '../../../services/automation/shared/apiSourceIntake.mjs';
import {executeApiStepInEngine} from '../dist/lib/apiEngine.js';

test('imported Postman request steps execute login and a private captured-token successor in the API worker',async t=>{
 const received=[],password='WORKER_PRIVATE_PASSWORD',token='WORKER_CAPTURED_ACCESS_TOKEN';
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  received.push({method:req.method,url:req.url,authorization:req.headers.authorization,body});
  res.setHeader('content-type','application/json');
  if(req.method==='POST'&&req.url==='/login'){
   assert.deepEqual(JSON.parse(body),{username:'source-reviewer',password});
   res.statusCode=201;res.end(JSON.stringify({accessToken:token}));return;
  }
  assert.equal(req.url,'/projects');assert.equal(req.headers.authorization,`Bearer ${token}`);
  res.statusCode=200;res.end(JSON.stringify({projects:[{id:'project-1'}]}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const source={info:{name:'Login and list projects'},variable:[{key:'baseUrl',value:base},{key:'username',value:'source-reviewer'},{key:'password',value:'SOURCE_PASSWORD_MUST_NOT_SURVIVE'}],item:[
  {name:'Login',request:{method:'POST',url:'{{baseUrl}}/login',header:[{key:'Content-Type',value:'application/json'}],body:{mode:'raw',raw:'{"username":"{{username}}","password":"{{password}}"}',options:{raw:{language:'json'}}}},event:[{listen:'test',script:{exec:[
   'const payload = pm.response.json();',
   'pm.test("Created login session", () => { pm.response.to.have.status(201); });',
   'pm.environment.set("token", payload.accessToken);'
  ]}}]},
  {name:'List projects',request:{method:'GET',url:'{{baseUrl}}/projects',auth:{type:'bearer',bearer:[{key:'token',value:'{{token}}'}]}},event:[{listen:'test',script:{exec:['pm.test("Projects loaded", () => { pm.expect(pm.response.code).to.eql(200); });']}}]}
 ]};
 const imported=parseApiSourceIntake(JSON.stringify(source));
 assert.equal(imported.steps.length,2);assert.doesNotMatch(JSON.stringify(imported),/SOURCE_PASSWORD_MUST_NOT_SURVIVE/);
 assert.ok(imported.private_parameter_names.includes('t.password'));assert.ok(imported.private_parameter_names.includes('t.token'));
 const envelope={case_parameters:{...Object.fromEntries(Object.entries(imported.parameter_values).map(([key,value])=>[`t.${key}`,value])),'t.password':password},environment:{base_url:base},test_data_options:{private_parameter_names:imported.private_parameter_names}};
 const steps=imported.steps.map(step=>({...step,id:`imported-${step.step_order}`,order:step.step_order}));
 const first=await executeApiStepInEngine(envelope,steps[0]);
 assert.equal(first.status,'passed');assert.equal(first.captures['t.token'],token);
 const second=await executeApiStepInEngine(envelope,steps[1],first.captures);
 assert.equal(second.status,'passed');assert.deepEqual(received.map(row=>`${row.method} ${row.url}`),['POST /login','GET /projects']);
 for(const result of [first,second]){
  const svg=Buffer.from(result.evidence.dataUrl.split(',')[1],'base64').toString('utf8');
  assert.doesNotMatch(svg,/WORKER_PRIVATE_PASSWORD|WORKER_CAPTURED_ACCESS_TOKEN/,'Public diagnostic evidence must not contain private runtime data.');
 }
});
