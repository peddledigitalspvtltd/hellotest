import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'acorn';
const runtime=process.env.HELLOTEST_RUNTIME_TEST_BUILD?pathToFileURL(path.join(process.env.HELLOTEST_RUNTIME_TEST_BUILD,'lib/automationVerificationProgram.js')):new URL('../dist/lib/automationVerificationProgram.js',import.meta.url);
const verifier=process.env.HELLOTEST_RUNTIME_TEST_BUILD?pathToFileURL(path.join(process.env.HELLOTEST_RUNTIME_TEST_BUILD,'lib/automationVerification.js')):new URL('../dist/lib/automationVerification.js',import.meta.url);
const {compileRecordedProgram:compile,parameterTemplateParts}=await import(runtime.href);
const {validateAutomationVerificationRequest:validate}=await import(verifier.href);
const require=createRequire(import.meta.url);
const {compileRecordedProgram:hostCompile}=require('../../../services/automation/backend/lib/automationRecordedProgram');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const op=(assertion,value)=>({name:'browser_assert',arguments:{assertion,...(!assertion.startsWith('title')?{locator:'#status'}:{}),value}});
const request=operations=>({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:'https://fixture.test/form',sections:[{step_id:'status',automation_code:compile(operations)?.source||'throw new Error("invalid template");',operations}],parameters:{'t.item_name':'First name','s.client name':'Client'},replay_policy:{mode:'authorized_run',allow_mutations:true}});
const syntax=value=>Array.isArray(value)?value.map(syntax):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','raw'].includes(key)).map(([key,item])=>[key,syntax(item)])):value;

test('independent engine and host render the same bounded composite text assertion grammar',()=>{
  for(const assertion of ['text','text_contains','text_content','text_content_contains','title','title_normalized']){
    for(const layout of ['compact','inline']){
      const operations=[op(assertion,'Saved @t.item_name for @s.[Client name].')];
      const engine=compile(operations,{layout}),host=hostCompile(operations,{layout});
      assert.ok(engine);assert.ok(host);
      assert.deepEqual(syntax(parse(engine.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true})),syntax(parse(host.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true})));
      if(['text','text_contains'].includes(assertion)){
        assert.match(engine.source,/String\(params\["t.item_name"\]\)/);assert.match(engine.source,/String\(params\["s.client name"\]\)/);
      } else {
        assert.match(engine.source,/"Saved @t.item_name for @s\.\[Client name\]\."/);
        assert.doesNotMatch(engine.source,/String\(params\[/,'Direct matcher runtime expands the original template exactly once');
      }
      assert.doesNotThrow(()=>validate(request(operations)));
    }
  }
  assert.equal(parameterTemplateParts('A literal contact support@example.test'),null);
  assert.deepEqual(parameterTemplateParts('Saved @t.item_name'),[{literal:'Saved '},{key:'t.item_name',reference:'@t.item_name'}]);
});

test('compiled visible-text assertions read edited parameters without changing source or rescanning inserted values',async()=>{
  for(const assertion of ['text','text_contains']){
    const source=compile([op(assertion,'Saved @t.item_name')]).source;
    let shown;
    const locator={isVisible:async()=>true,innerText:async()=>shown};
    const page={locator:()=>locator};
    const expect={poll:callback=>({toBe:async expected=>assert.equal(await callback(),expected)})};
    const execute=new AsyncFunction('page','expect','params',source);
    for(const name of ['Build Fixture','Current Data','@t.literal_token','']){
      shown='Saved '+name;
      await execute(page,expect,{'t.item_name':name});
    }
    shown='Saved stale value';
    await assert.rejects(execute(page,expect,{'t.item_name':'Current Data'}));
  }
});

test('frozen verification requires every embedded binding and rejects altered or malformed templates before execution',()=>{
  const operations=[op('text','Saved @t.item_name for @s.[Client name].')];
  const valid=request(operations);assert.doesNotThrow(()=>validate(valid));
  for(const name of ['t.item_name','s.client name']){const missing=structuredClone(valid);delete missing.parameters[name];assert.throws(()=>validate(missing),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});}
  const forged=structuredClone(valid);forged.sections[0].automation_code=forged.sections[0].automation_code.replace('String(params["t.item_name"])','String(process.env.SECRET)');assert.throws(()=>validate(forged),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
  for(const value of ['Saved @t.','Saved @t.[missing','Saved @t.item_name and @s.'])assert.throws(()=>validate(request([op('text',value)])),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
});
