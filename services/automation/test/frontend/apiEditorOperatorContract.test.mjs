import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const require=createRequire(resolve(root,'services/platform/frontend/package.json')),ts=require('typescript'),React=require('react');
const shared=await import(pathToFileURL(resolve(root,'services/automation/shared/apiValidation.mjs')));
const requestSource=await import(pathToFileURL(resolve(root,'services/automation/shared/apiRequestSource.mjs')));
const {validateAuthoredApiRequest}=require(resolve(root,'services/platform/backend/src/utils/testStepAutomation.js'));
const candidate=root;
const source=readFileSync(resolve(candidate,'services/automation/frontend/lib/stepAutomation.ts'),'utf8');
const module={exports:{}};
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
new Function('require','exports','module',compiled)(name=>name==='../../shared/apiValidation.mjs'?shared:name==='../../shared/apiRequestSource.mjs'?requestSource:require(name),module.exports,module);
const {normalizeApiRequest}=module.exports;
const request=validations=>({method:'POST',url:'@r.api_base_url/auth/signup/request-code',headers:[{key:'Content-Type',value:'application/json'}],body_mode:'json',body:'{"email":"@t.email","password":"@r.admin_password"}',validations,captures:[]});
const serialized=validations=>JSON.parse(JSON.stringify(normalizeApiRequest(request(validations))));
for(const status of ['200','400','401','409'])test(`imported HTTP ${status} remains saveable after editing a symbolic request body`,()=>{
 const payload=serialized([{kind:'status',expected:status}]);
 assert.equal(payload.validations[0].operator,undefined,'Serialization must not invent an operator on a fixed status check');
 assert.equal(payload.body,request([]).body,'Private environment binding must remain symbolic');
 assert.doesNotThrow(()=>validateAuthoredApiRequest(payload));
 assert.equal(payload.validations[0].expected,status);
});
test('status and exact error-message assertions round trip together through strict save contract',()=>{
 const rows=[{kind:'status',expected:'400'},{kind:'json_path',target:'$.message',operator:'eq',expected:"Field 'email' must be at least 3 characters"}];
 const payload=serialized(rows);assert.doesNotThrow(()=>validateAuthoredApiRequest(payload));
 assert.equal(payload.validations[0].operator,undefined);assert.deepEqual(payload.validations[1],rows[1]);
});
test('explicit JSON/header comparisons and response-time limits retain their actual operators',()=>{
 const rows=[{kind:'json_path',target:'$.message',operator:'ne',expected:'Unexpected'},{kind:'json_path',target:'$.requestId',operator:'exists',expected:''},{kind:'header',target:'x-error',operator:'ne',expected:'wrong'},{kind:'response_time',operator:'lte',expected:'10000'}];
 const payload=serialized(rows);assert.doesNotThrow(()=>validateAuthoredApiRequest(payload));
 assert.deepEqual(payload.validations.map(row=>row.operator),['ne','exists','ne','lte']);
});
test('an explicitly unsupported status comparator remains rejected instead of being silently weakened',()=>{
 const payload=serialized([{kind:'status',operator:'ne',expected:'400'}]);assert.equal(payload.validations[0].operator,'ne');
 assert.throws(()=>validateAuthoredApiRequest(payload),/Use operators on JSON-path assertions/);
});
test('the actual Add validation handler creates a strict-contract compatible status row',()=>{
 const file=resolve(candidate,'services/automation/frontend/components/StepAutomationEditor.tsx'),text=readFileSync(file,'utf8');
 const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=['apiValidationOperatorOptions','ApiValidationRowsEditor'];
 const selected=tree.statements.filter(node=>names.includes(node.name?.text));assert.equal(selected.length,2);
 const js=ts.transpileModule(selected.map(node=>node.getText(tree)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 const empty=()=>null;
 const render=new Function('React','resolveStepParameterText','AutomationParameterInput','ValidationPassedIcon','ValidationFailedIcon',js+'\nreturn ApiValidationRowsEditor;')(React,value=>String(value||''),empty,empty,empty);
 let changed;const result=render({validations:[{kind:'status',target:'',expected:'400'}],onChange:next=>{changed=next;}});
 const visit=node=>Array.isArray(node)?node.flatMap(visit):node&&typeof node==='object'?[node,...visit(node.props?.children)]:[];
 assert.ok(visit(result).some(node=>node.type==='select'&&node.props['aria-label']==='Assertion kind 1'));
 assert.ok(visit(result).some(node=>node.type==='input'&&node.props['aria-label']==='Assertion target 1'));
 const add=visit(result).find(node=>node.type==='button'&&node.props.children==='Add validation');assert.ok(add,'Exercise the current rendered handler');add.props.onClick();
 assert.equal(changed.length,2);assert.equal(changed[1].operator,undefined,'Add validation must not emit an invalid status operator');
 assert.doesNotThrow(()=>validateAuthoredApiRequest(request(changed)));
});
