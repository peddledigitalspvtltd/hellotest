import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as intake from '../../shared/apiSourceIntake.mjs';
const source=readFileSync(new URL('../../frontend/lib/postmanImport.ts',import.meta.url),'utf8');
const exports={};
new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name.includes('apiSourceIntake')?intake:createRequire(import.meta.url)(name),exports);
const {parsePostmanCollectionTestCases:parse}=exports;

test('ordinary Postman import retains one case per request, scoped variables and only source-backed assertions',()=>{
 const result=parse(JSON.stringify({info:{name:'Payments'},variable:[{key:'baseUrl',value:'https://api.example.test'},{key:'token',value:'private-fixture-token'}],item:[
  {name:'Create payment',request:{method:'POST',url:'{{baseUrl}}/payments',header:[{key:'Authorization',value:'Bearer {{token}}'}]},response:[{code:201}]},
  {name:'List payments',request:{method:'GET',url:'{{baseUrl}}/payments'}}]}));
 assert.equal(result.rows.length,2);assert.ok(result.rows.every(row=>row.steps.length===1&&row.steps[0].step_order===1));
 assert.equal(result.rows[0].steps[0].api_request.validations[0].expected,'201');
 assert.deepEqual(result.rows[1].steps[0].api_request.validations,[]);
 assert.equal(result.rows[1].steps[0].expected_result,'');
 assert.match(result.rows[0].steps[0].api_request.url,/@t\.baseurl/);
 assert.doesNotMatch(JSON.stringify(result),/private-fixture-token/);
 assert.ok(result.rows[0].test_data_options.private_parameter_names.length);
 assert.equal(result.rows[1].parameter_values.baseurl,'https://api.example.test');
 assert.equal(result.rows[1].parameter_values.token,undefined,'Only referenced parameters belong to each imported case.');
});

test('nested Postman folder variable overrides retain their own values instead of changing other requests',()=>{
 const result=parse(JSON.stringify({info:{name:'Scoped requests'},variable:[{key:'baseUrl',value:'https://first.example.test'}],item:[
  {name:'First',request:{url:'{{baseUrl}}/items'}},{name:'Other environment',variable:[{key:'baseUrl',value:'https://second.example.test'}],item:[{name:'Second',request:{url:'{{baseUrl}}/items'}}]}]}));
 assert.equal(result.rows.length,2);
 assert.deepEqual(Object.values(result.rows[0].parameter_values),['https://first.example.test']);
 assert.deepEqual(Object.values(result.rows[1].parameter_values),['https://second.example.test']);
 assert.notEqual(result.rows[0].steps[0].api_request.url,result.rows[1].steps[0].api_request.url);
});

test('unsupported Postman bodies or methods return no successful prefix or fabricated empty case',()=>{
 for(const item of [{request:{method:'TRACE',url:'https://api.example.test'}},{request:{method:'POST',url:'https://api.example.test',body:{mode:'file',file:{src:'private.txt'}}}}]){
  const result=parse(JSON.stringify({item:[{request:{url:'https://api.example.test'}},item]}));assert.deepEqual(result.rows,[]);assert.ok(result.warnings.length);
 }
 assert.deepEqual(parse('{"info":{"name":"Empty"},"item":[]}').rows,[]);
});
