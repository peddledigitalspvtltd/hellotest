const test = require('node:test');
const assert = require('node:assert/strict');
let parse, limits;
test.before(async () => { ({parseApiSourceIntake:parse,API_SOURCE_LIMITS:limits}=await import('../../shared/apiSourceIntake.mjs')); });

test('a Postman collection becomes one ordered API case, preserving variables and documented response statuses', () => {
  const result=parse(JSON.stringify({info:{name:'Order lifecycle'},variable:[{key:'baseUrl',value:'https://api.example.test'}],auth:{type:'bearer',bearer:[{key:'token',value:'private-credential'}]},item:[
    {name:'Sign in',request:{method:'POST',url:'{{baseUrl}}/login',body:{mode:'raw',raw:'{"username":"qa","password":"private-password"}',options:{raw:{language:'json'}}}},response:[{code:201}]},
    {name:'Orders',item:[{name:'List orders',request:{method:'GET',url:'{{baseUrl}}/orders?token=private-query'},response:[{code:200}]}]}
  ]}));
  assert.equal(result.title,'Order lifecycle');assert.equal(result.steps.length,2);
  assert.deepEqual(result.steps.map(step=>step.step_order),[1,2]);
  assert.deepEqual(result.steps.map(step=>step.api_request.validations[0].expected),['201','200']);
  assert.equal(result.steps[0].api_request.url,'@t.baseurl/login');
  assert.equal(result.parameter_values.baseurl,'https://api.example.test');
  assert.doesNotMatch(JSON.stringify(result),/private-credential|private-password|private-query/);
  assert.ok(result.private_parameter_names.length>=2);
});

test('Postman form variables keep symbolic bindings and multiple examples do not invent HTTP 200', () => {
  const result=parse(JSON.stringify({item:[{name:'Form',request:{method:'POST',url:'https://api.example.test/login',body:{mode:'urlencoded',urlencoded:[{key:'user',value:'{{user}}'},{key:'password',value:'private-password'}]}},response:[{code:200},{code:401}]}]}));
  assert.match(result.steps[0].api_request.body,/user=@t.user/);
  assert.equal(result.steps[0].api_request.validations.length,0);
  assert.doesNotMatch(JSON.stringify(result),/private-password/);
  assert.ok(result.warnings.some(warning=>/multiple example statuses/.test(warning)));
});

test('a private query/body/header context hides opaque variable defaults as well as token-named variables',()=>{
  const result=parse(JSON.stringify({variable:[{key:'opaque',value:'private-opaque-default'}],item:[
    {request:{url:'https://api.example.test/login?api_key={{opaque}}'}},
    {request:{method:'POST',url:'https://api.example.test/login',body:{mode:'raw',raw:'{"password":"{{opaque}}"}',options:{raw:{language:'json'}}}}}
  ]}));
  assert.doesNotMatch(JSON.stringify(result),/private-opaque-default/);
  assert.ok(result.private_parameter_names.includes('t.opaque'));
  assert.equal(result.parameter_values.opaque,'');
  assert.match(result.steps[0].api_request.url,/api_key=@t.opaque/);
});

test('direct Postman response checks and captures retain login-to-request bindings without executing scripts',()=>{
  const result=parse(JSON.stringify({variable:[{key:'baseUrl',value:'https://api.example.test'},{key:'token',value:'private-saved-token'}],item:[
    {name:'Login',request:{method:'POST',url:'{{baseUrl}}/login'},event:[{listen:'test',script:{exec:[
      'const data = pm.response.json();',
      'pm.test("Signed in", () => { pm.response.to.have.status(201); });',
      'pm.environment.set("token", data.accessToken);',
      'pm.collectionVariables.set("opaque", data.accessToken);'
    ]}}]},
    {name:'Read projects',request:{method:'GET',url:'{{baseUrl}}/projects',header:[{key:'Authorization',value:'Bearer {{token}}'}]}},
    {name:'Read with auth scheme',request:{method:'GET',url:'{{baseUrl}}/projects',auth:{type:'bearer',bearer:[{key:'token',value:'{{opaque}}'}]}}}
  ]}));
  assert.deepEqual(result.steps[0].api_request.validations,[{kind:'status',expected:'201'}]);
  assert.deepEqual(result.steps[0].api_request.captures,[{path:'$.accessToken',parameter:'t.token'},{path:'$.accessToken',parameter:'t.opaque'}]);
  assert.equal(result.steps[1].api_request.headers[0].value,'Bearer @t.token');
  assert.equal(result.steps[2].api_request.headers[0].value,'Bearer @t.opaque');
  assert.ok(result.private_parameter_names.includes('t.opaque'));
  assert.doesNotMatch(JSON.stringify(result),/private-saved-token/);
});

test('conditional or mutated Postman scripts are not promoted into unconditional response contracts',()=>{
  const result=parse(JSON.stringify({item:[{request:{url:'https://api.example.test'},event:[{listen:'test',script:{exec:[
    'const data = pm.response.json(); data.token="different"; pm.environment.set("token",data.token);',
    'if (pm.response.code === 200) { pm.response.to.have.status(200); }'
  ]}}]}]}));
  assert.deepEqual(result.steps[0].api_request.captures,[]);
  assert.deepEqual(result.steps[0].api_request.validations,[]);
  assert.ok(result.warnings.some(warning=>warning.includes('scripts are never executed')));
});

test('multiple cURL commands produce multiple request steps without executing shell or inferring response statuses', () => {
  const result=parse(`curl -sSL 'https://api.example.test/orders' -H'Authorization: Bearer private-token'
curl -XPOST 'https://api.example.test/orders' --header='Content-Type: application/json' --data-raw '{"name":"Draft"}'
curl --get 'https://api.example.test/orders' --data-urlencode 'search=one two'`);
  assert.equal(result.steps.length,3);
  assert.deepEqual(result.steps.map(step=>step.api_request.method),['GET','POST','GET']);
  assert.equal(result.steps[2].api_request.url,'https://api.example.test/orders?search=one%20two');
  assert.equal(result.steps[1].api_request.body_mode,'json');
  assert.ok(result.steps.every(step=>!step.api_request.validations.length));
  assert.ok(result.steps.every(step=>step.expected_result===''),'Absent assertions remain absent instead of inventing successful outcomes.');
  assert.doesNotMatch(JSON.stringify(result),/private-token/);
  assert.equal(result.steps[0].api_request.follow_redirects,false);
});

test('cURL source rejects shell execution, file reads and unsupported request semantics atomically', () => {
  for(const source of ["curl https://api.example.test; rm -rf anything", "curl https://api.example.test | jq .", "curl 'https://api.example.test/$(whoami)'", 'curl https://api.example.test --data-binary @secret.json', 'curl https://api.example.test --form file=@image.png', "curl 'https://api.example.test"])
    assert.throws(()=>parse(source));
  assert.throws(()=>parse('curl https://api.example.test --request TRACE'),/method TRACE/);
});

test('HAR preserves observed statuses, bodies and order while removing recorded credentials', () => {
  const result=parse(JSON.stringify({log:{entries:[{request:{method:'POST',url:'https://api.example.test/login',headers:[{name:'Cookie',value:'session=private-cookie'}],postData:{mimeType:'application/json',text:'{"secret":"private-secret"}'}},response:{status:401}},{request:{method:'GET',url:'https://api.example.test/orders',headers:[]},response:{status:200}}]}}));
  assert.equal(result.steps.length,2);assert.equal(result.steps[0].api_request.validations[0].expected,'401');
  assert.doesNotMatch(JSON.stringify(result),/private-cookie|private-secret/);
  assert.equal(result.steps[1].api_request.body_mode,'none');
});

test('OpenAPI JSON expands all declared operations with explicit request examples and security locations', () => {
  const result=parse(JSON.stringify({openapi:'3.1.0',info:{title:'Orders API'},servers:[{url:'https://api.example.test'}],components:{securitySchemes:{key:{type:'apiKey',in:'query',name:'api_key'}}},security:[{key:[]}],paths:{'/orders':{get:{summary:'List orders',responses:{200:{description:'Listed'},500:{description:'Failure'}}},post:{summary:'Create order',requestBody:{content:{'application/json':{example:{name:'Example',password:'private-secret'}}}},responses:{201:{description:'Created'}}}},'/orders/{id}':{parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],delete:{responses:{204:{description:'Deleted'}}}}}}));
  assert.equal(result.steps.length,3);assert.equal(result.title,'Orders API');
  assert.ok(result.steps.every(step=>step.api_request.url.includes('api_key=@t.auth_api_key')));
  assert.ok(result.steps.every(step=>!step.api_request.headers.some(header=>header.key==='Authorization')));
  assert.match(result.steps[2].api_request.url,/@t.id/);
  assert.equal(result.steps[1].api_request.body_mode,'json');
  assert.doesNotMatch(JSON.stringify(result),/private-secret/);
});

test('OpenAPI YAML and Swagger body examples are parsed without inventing values from schemas', () => {
  const yaml='openapi: 3.0.3\ninfo:\n  title: Example API\nservers:\n  - url: https://api.example.test\npaths:\n  /items:\n    post:\n      requestBody:\n        content:\n          application/json:\n            schema:\n              type: object\n              properties:\n                name:\n                  type: string\n      responses:\n        "201":\n          description: Created\n';
  const result=parse(yaml);assert.equal(result.steps.length,1);assert.equal(result.steps[0].api_request.body,'@t.request_body_1');
  assert.equal(result.parameter_values.request_body_1,'');
  const swagger=parse(JSON.stringify({swagger:'2.0',info:{title:'Legacy'},host:'api.example.test',basePath:'/v1',paths:{'/orders':{post:{parameters:[{name:'payload',in:'body',schema:{type:'object',example:{name:'Explicit example'}}}],responses:{201:{description:'Created'}}}}}}));
  assert.equal(JSON.parse(swagger.steps[0].api_request.body).name,'Explicit example');
});

test('unresolved refs, unsupported binary bodies, oversized and over-budget sources never return a successful prefix', () => {
  assert.throws(()=>parse(JSON.stringify({openapi:'3.0.3',paths:{'/items':{post:{requestBody:{$ref:'https://private.example/body'},responses:{200:{}}}}}})),/External OpenAPI references/);
  assert.throws(()=>parse(JSON.stringify({log:{entries:[{request:{method:'GET',url:'https://api.example.test'}},{request:{method:'POST',url:'https://api.example.test/file',postData:{mimeType:'multipart/form-data',params:[{name:'file',fileName:'test.png'}]}}}]}})),/No requests were imported/);
  assert.throws(()=>parse(' '.repeat(limits.maxBytes+1)+'x'),/2 MB/);
  assert.throws(()=>parse(Array.from({length:201},()=> 'curl https://api.example.test').join('\n')),/200 requests/);
  assert.throws(()=>parse('openapi: 3.0.3\npaths: &paths\n  /test: *paths'),/valid JSON or YAML/);
});


test('existing scoped credentials and exact JSON message checks survive import without private-value duplication', () => {
  const result=parse(JSON.stringify({item:[{name:'Login',request:{method:'POST',url:'@r.api_base_url/auth/login',header:[{key:'Authorization',value:'Bearer @s.session_token'}],body:{mode:'raw',raw:'{"password":"@r.admin_password"}',options:{raw:{language:'json'}}}},event:[{listen:'test',script:{exec:[
    'const body=pm.response.json(); pm.test("reject",()=>{pm.response.to.have.status(401);pm.expect(body.message).to.eql("Invalid credentials");});'
  ]}}]}]}),{format:'postman'});
  const request=result.steps[0].api_request;
  assert.match(request.body,/@r.admin_password/);assert.equal(request.headers[0].value,'Bearer @s.session_token');assert.equal(request.url,'@r.api_base_url/auth/login');
  assert.deepEqual(result.parameter_values,{});assert.deepEqual(result.private_parameter_names,[]);
  assert.deepEqual(request.validations,[{kind:'status',expected:'401'},{kind:'json_path',target:'$.message',operator:'eq',expected:'Invalid credentials'}]);
});

test('conditional JSON assertions remain omitted with an actionable review note',()=>{
  const result=parse(JSON.stringify({item:[{request:{url:'https://example.test'},event:[{listen:'test',script:{exec:['if(pm.response.code===200){pm.expect(pm.response.json().success).to.equal(true);}']}}]}]}),{format:'postman'});
  assert.deepEqual(result.steps[0].api_request.validations,[]);assert.ok(result.warnings.some(item=>/literal JSON equality/.test(item)));
});


test('literal credential assertions are redacted while public privacy-control booleans stay intact',()=>{
 const result=parse(JSON.stringify({item:[{request:{url:'https://example.test'},event:[{listen:'test',script:{exec:['const body=pm.response.json();pm.expect(body.accessToken).to.eql("literal-private-token");pm.expect(body.is_secret).to.equal(false);']}}]}]}),{format:'postman'});
 assert.doesNotMatch(JSON.stringify(result),/literal-private-token/);assert.match(result.steps[0].api_request.validations[0].expected,/@t\.imported_/);assert.equal(result.steps[0].api_request.validations[1].expected,'false');
});
