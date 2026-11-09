import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildPlaywrightArtifact} from '../../shared/playwrightArtifact.mjs';
import {markExpressionParameterBindings} from '../../shared/automationParameterMode.mjs';
import {assertTypeScriptExportCompiles} from '../browser/playwrightExportFixture.mjs';

test('the real standalone runtime resolves marked params once per section and keeps legacy/API interpolation and repository behavior',async t=>{
 const marked=markExpressionParameterBindings([
  'await page.goto(params["r.url"] + "client");',
  'await page.locator(params["r.field"]).fill(params["r.message"]);',
  'await expect(page.locator(params["r.field"])).toHaveValue(params["r.message"]);',
  'await page.getByRole("textbox",{name:params["r.label"]}).fill("@r.other");',
  'await expect(page.getByRole("textbox",{name:params["r.label"]})).toHaveValue("@r.other");'
 ].join('\n'));
 const values={'r.url':'https://app.test/','r.field':'Profile.Message','r.message':'@r.other','r.label':'reader@r.other.test','r.other':'EXPANDED'};
 const steps=[{id:'native',step_order:1,step_type:'web',action:'Enter native data',automation_code:marked},
  {id:'legacy',step_order:2,step_type:'web',action:'Legacy input',automation_code:'await page.locator("#legacy").fill("@r.other"); await expect(page.locator("#legacy")).toHaveValue("@r.other");'},
  {id:'api',step_order:3,step_type:'api',action:'API data',api_request:{method:'GET',url:'/api',query_params:[{key:'message',value:'@r.other'}],validations:[{kind:'status',expected:'200'}]}}];
 const source=buildPlaywrightArtifact({testCase:{id:'case',title:'Portable expression fixture'},steps,rows:[values],objects:{'profile.message':'#field'}});
 assert.deepEqual([...source.matchAll(/setParameterBindingsMode\((true|false)\);/g)].map(match=>match[1]),['true','false','false']);
 const calls=[],fields=new Map(),runs=[];
 const locator=target=>({count:async()=>1,click:async()=>{},fill:async value=>{calls.push(['fill',target,value]);fields.set(target,value);},inputValue:async()=>fields.get(target)});
 const page={goto:async url=>calls.push(['goto',url]),locator,getByRole:(role,options)=>{calls.push(['role',role,options.name]);return locator(options.name);},isClosed:()=>false};
 const expect=actual=>({toHaveValue:async expected=>assert.equal(await actual.inputValue(),expected),toBe:expected=>assert.equal(actual,expected)});
 expect.configure=()=>expect;
 const runner=(_title,fn)=>runs.push(fn({page,request:{fetch:async(url,options)=>{calls.push(['api',url,options.params.message]);return {text:async()=>'{"ok":true}',status:()=>200,headers:()=>({})};}},context:{},browser:{},browserName:'chromium'},{attach:async()=>{}}));
 runner.use=()=>{};runner.setTimeout=()=>{};runner.step=async(_name,fn)=>fn();
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports','process',compiled)(name=>{assert.equal(name,'@playwright/test');return {test:runner,expect};},{},{env:{}});
 await Promise.all(runs);
 assert.equal(runs.length,1);assert.deepEqual(calls.filter(call=>call[0]==='goto'),[['goto','https://app.test/client']]);
 assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['fill','#field','@r.other'])));
 assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['role','textbox','reader@r.other.test'])));
 assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['fill','reader@r.other.test','@r.other'])));
 assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['fill','#legacy','EXPANDED'])));
 assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['api','/api','EXPANDED'])));
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-expression-export-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'automation.spec.ts');await writeFile(file,source);assertTypeScriptExportCompiles([file]);
});
