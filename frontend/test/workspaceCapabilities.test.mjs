import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as permissions from '../src/lib/permissions.ts';
const load=(file,resolve=()=>({}))=>{const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(resolve,exports);return exports;};
const generatedPolicy=JSON.parse(readFileSync(new URL('../src/lib/featurePolicy.generated.json',import.meta.url),'utf8'));
const flags=load('../src/lib/featureFlags.ts',name=>name.endsWith('.json')?{default:generatedPolicy}:permissions);
const {WORKSPACE_CAPABILITIES,capabilityAvailability,searchCapabilities}=load('../src/lib/workspaceCapabilities.ts',name=>name.includes('permissions')?permissions:flags);
const context={session:{user:{id:'a',role:'admin'}},projectId:'project',flags:{flags:new Proxy({},{get:()=>true})}};
test('all registered destinations have explicit permission coverage and unique stable identifiers',()=>{
 assert.equal(new Set(WORKSPACE_CAPABILITIES.map(item=>item.id)).size,WORKSPACE_CAPABILITIES.length);
 for(const item of WORKSPACE_CAPABILITIES) assert.equal(capabilityAvailability(item,context),'available',item.to);
});
test('capability discovery distinguishes no project, disabled policy, inaccessible roles and failed refresh',()=>{
 const item=WORKSPACE_CAPABILITIES.find(item=>item.id==='objects');
 assert.equal(capabilityAvailability(item,{...context,projectId:''}),'project');
 assert.equal(capabilityAvailability(item,{...context,flags:{flags:{}}}),'disabled');
 assert.equal(capabilityAvailability(item,{...context,flagsError:true}),'unavailable');
 assert.equal(capabilityAvailability(item,{...context,session:{user:{id:'b',role:'member',project_permissions:{project:[]}}}}),'restricted');
 const local=WORKSPACE_CAPABILITIES.find(item=>item.id==='local-runs');
 assert.equal(capabilityAvailability(local,{...context,flags:{flags:{'hellotest.manual.runs':true,'hellotest.automation.workspace':true}}}),'disabled');
});
test('search matches tasks, all query tokens and accented translated labels',()=>{
 assert.ok(searchCapabilities('api').some(item=>item.id==='agents'));
 assert.equal(searchCapabilities('zzzzzz').length,0);
 assert.equal(searchCapabilities('ejecucion',[{name:'Ejecución de pruebas',description:'',group:'execute'}]).length,1);
 assert.equal(searchCapabilities('api unknown').length,0);
});
const localization=load('../src/lib/localization.ts');
const {parseLocalizationPack}=load('../src/lib/localizationPack.ts',()=>localization);
test('workspace packs cover new shared controls and reject malformed imports without dropping values silently',()=>{
 assert.ok(localization.DEFAULT_LOCALIZATION_STRINGS['shell.find']);
 assert.ok(localization.DEFAULT_LOCALIZATION_STRINGS['capability.agents.description']);
 assert.deepEqual(parseLocalizationPack('{"nav.dashboard":"Inicio","meta.language":"es"}'),{'nav.dashboard':'Inicio','meta.language':'es'});
 for(const text of ['[]','{"nav.dashboard":12}','{"meta.direction":"invalid"}','{"meta.language":"bad_tag"}','{"__proto__":"value"}']) assert.throws(()=>parseLocalizationPack(text));
});
