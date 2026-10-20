import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../../../platform/frontend/node_modules/typescript/lib/typescript.js';
const file=new URL('../../frontend/lib/automationBuildPipeline.ts',import.meta.url);
const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};new Function('module','exports',source)(module,module.exports);
const {automationBuildPipelineRequest}=module.exports;
test('UI cannot request real verification without permissions and interactive mode',()=>{
 for(const canVerify of [false,true])for(const interactive of [false,true]){
  assert.deepEqual(automationBuildPipelineRequest({mode:'verify_repair',driver:'mcp',canVerify,interactive}),{verification_mode:canVerify&&interactive?'verify_repair':'generate_only',verification_driver:'native',browser_driver:'mcp'});
 }
 assert.equal(automationBuildPipelineRequest({mode:'generate_only',driver:'mcp',canVerify:true,interactive:true}).verification_mode,'generate_only');
});

test('CLI verification choices keep MCP authoring and use the same guarded verification modes',()=>{
 for(const [choice,mode]of [['verify_cli','verify'],['verify_repair_cli','verify_repair']]){
  assert.deepEqual(automationBuildPipelineRequest({mode:choice,driver:'mcp',canVerify:true,interactive:true}),{verification_mode:mode,verification_driver:'playwright_test_cli',browser_driver:'mcp'});
  for(const [canVerify,interactive]of [[false,true],[true,false],[false,false]]){
   assert.deepEqual(automationBuildPipelineRequest({mode:choice,driver:'mcp',canVerify,interactive}),{verification_mode:'generate_only',verification_driver:'native',browser_driver:'mcp'});
  }
 }
});
