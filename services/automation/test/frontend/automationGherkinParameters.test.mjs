import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const modules=new Map();
function load(url){
  if(modules.has(url.href))return modules.get(url.href);
  const exports={};modules.set(url.href,exports);const require=createRequire(url);
  const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',code)(exports,id=>{
    if(id.endsWith('/RichTextEditor'))return {richTextToPlainText:value=>String(value||'')};
    const file=require.resolve(id.startsWith('.')&&!/\.[a-z]+$/i.test(id)?id+'.ts':id);
    return file.endsWith('.ts')?load(pathToFileURL(file)):require(file);
  });
  return exports;
}
const {buildAutomationGherkin}=load(new URL('../../frontend/lib/automationGherkin.ts',import.meta.url));
const step={id:'entry',step_order:1,step_type:'web',action:'Enter @t.[account.email].',expected_result:'Stored @t.[account.email].',automation_code:'await web.fill("#name", params["t.account.email"]);await web.expectValue("#name", params["t.account.email"]);'};

test('Gherkin projects bracketed data names to example columns without replacing source or losing punctuation',()=>{
  const dataSet={mode:'table',columns:['t.account.email'],rows:[{'t.account.email':'first@example.test'}]};
  const source=structuredClone(step);
  const first=buildAutomationGherkin('Configured account',[step],dataSet);
  assert.match(first,/Type <t\.account\.email> into #name/);
  assert.match(first,/Stored <t\.account\.email>\./);
  assert.match(first,/first@example\.test/);
  const changed=buildAutomationGherkin('Configured account',[step],{...dataSet,rows:[{'t.account.email':'changed@example.test'}]});
  assert.match(changed,/changed@example\.test/);assert.doesNotMatch(changed,/first@example\.test/);
  assert.deepEqual(step,source,'new data reprojects Gherkin, leaving executable @references intact');
});

test('Gherkin keeps scoped tokens and ordinary email text literal when no dataset examples own the binding',()=>{
  const result=buildAutomationGherkin('Input @t.user.',[{...step,action:'Contact mail@t.user',expected_result:'Stored @t.user.',automation_code:'await web.fill("#name", params["t.user"]);'}],undefined,{parameterValues:{'t.user':'Current'}});
  assert.match(result,/Feature: Input @t\.user\./);
  assert.match(result,/Type @t\.user into #name/);
  assert.match(result,/Contact mail@t\.user/);
  assert.doesNotMatch(result,/Type Current|Contact mailCurrent/,'values stay dynamic tokens for the parameter-aware editor');
});
