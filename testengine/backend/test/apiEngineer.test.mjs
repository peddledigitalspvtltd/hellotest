import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {executeApiStepInEngine} from '../dist/lib/apiEngine.js';

test('native Test Engine executes API request contracts and chains captures without opening a browser',async t=>{
 const received=[];
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({url:req.url,method:req.method,headers:req.headers,body});res.setHeader('content-type','application/json');res.setHeader('x-contract','orders-v1');res.statusCode=req.method==='POST'?201:200;res.end(JSON.stringify({id:41,state:'created',token:'captured-fixture-token'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const envelope={environment:{base_url:base,variables:[{key:'api_token',value:'fixture-credential',is_secret:true}]},case_parameters:{'t.name':'Alice'}};
 const request={method:'POST',url:'/orders',query_params:[{key:'region',value:'east'},{key:'region',value:'west'}],cookies:[{key:'session',value:'fixture-session'}],auth:{type:'bearer',credential_reference:'@r.api_token'},body_mode:'json',body:'{"name":"@t.name"}',validations:[{kind:'status',expected:'201'},{kind:'header_present',target:'x-contract'},{kind:'body_not_contains',expected:'failure'},{kind:'json_path',target:'$.id',operator:'gt',expected:'0'},{kind:'json_schema',expected:'{"type":"object","required":["id","state"],"properties":{"id":{"type":"integer"},"state":{"const":"created"}}}'},{kind:'response_time',expected:'5000'}],captures:[{path:'$.token',parameter:'@r.order_token'}]};
 const first=await executeApiStepInEngine(envelope,{id:'create',order:1,step_type:'api',api_request:request});
 assert.equal(first.status,'passed');assert.equal(first.detail.assertions.length,6);assert.equal(received[0].headers.authorization,'Bearer fixture-credential');assert.equal(received[0].headers.cookie,'session=fixture-session');assert.equal(received[0].body,'{"name":"Alice"}');assert.match(received[0].url,/region=east&region=west/);assert.equal(first.detail.request.headers.authorization,'[credential reference]');
 const second=await executeApiStepInEngine(envelope,{id:'lookup',order:2,step_type:'api',api_request:{method:'GET',url:'/orders/41',auth:{type:'api_key',credential_reference:'@r.order_token',location:'query',key_name:'access_token'},validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.state',expected:'created'}]}},first.captures);
 assert.equal(second.status,'passed');assert.match(received[1].url,/access_token=captured-fixture-token/);assert.doesNotMatch(second.detail.request.url,/captured-fixture-token/);
 const failed=await executeApiStepInEngine(envelope,{id:'bad-schema',order:3,step_type:'api',api_request:{method:'GET',url:'/orders/41',validations:[{kind:'json_schema',expected:'{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}'}]}});
 assert.equal(failed.status,'failed');assert.match(failed.note,/JSON Schema/);
 await assert.rejects(executeApiStepInEngine(envelope,{id:'missing-auth',order:4,step_type:'api',api_request:{method:'GET',url:'/orders/41',auth:{type:'bearer',credential_reference:'@r.missing'}}}),/credential_reference/);
 assert.equal(received.length,3,'missing credentials stop before target dispatch');
 const missing=await executeApiStepInEngine(envelope,{api_request:{method:'GET',url:'/orders',captures:[{path:'$.missing',parameter:'@r.next_id'}]}});
 assert.equal(missing.status,'failed');assert.match(missing.note,/Required response capture/);
});

test('redirect policy and JSON schema failure remain observable in real HTTP responses',async t=>{
 let redirected=0;
 const server=http.createServer((req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{location:'/final'});res.end();return;}
  if(req.url==='/invalid'){res.setHeader('content-type','application/json');res.end('not json');return;}
  redirected++;res.setHeader('content-type','application/json');res.end('{"done":true}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const manual=await executeApiStepInEngine({}, {api_request:{url:`${base}/redirect`,follow_redirects:false,validations:[{kind:'status',expected:'302'}]}});
 assert.equal(manual.status,'passed');assert.equal(redirected,0);
 const followed=await executeApiStepInEngine({}, {api_request:{url:`${base}/redirect`,validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.done',expected:'true'}]}});
 assert.equal(followed.status,'passed');assert.equal(redirected,1);
 const invalid=await executeApiStepInEngine({}, {api_request:{url:`${base}/invalid`,validations:[{kind:'json_schema',expected:'{"type":"null"}'}]}});
 assert.equal(invalid.status,'failed');assert.match(invalid.note,/not valid JSON/);
});
