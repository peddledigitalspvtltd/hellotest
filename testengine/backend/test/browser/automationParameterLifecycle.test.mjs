import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createWebRunSession} from '../../dist/lib/webEngine.js';
import {compileRecordedProgram} from '../../dist/lib/automationVerificationProgram.js';
import {buildPlaywrightArtifact} from '../../../../services/automation/shared/playwrightArtifact.mjs';
import {assertTypeScriptExportCompiles} from '../../../../services/automation/test/browser/playwrightExportFixture.mjs';

const require=createRequire(import.meta.url);
const {interpolateText}=await import('../../dist/lib/runtimeContext.js');

test('saved Build Agent, recording and instruction programs use edited scoped data on fresh runs and current in-section captures',{timeout:90000},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'qaira-parameter-lifecycle-'));
  const previous=process.env.ARTIFACT_ROOT;process.env.ARTIFACT_ROOT=root;
  const upload=path.join(root,'payload.txt');await writeFile(upload,'Fixture upload');
  const app=Fastify();
  app.get('/form',async(_req,reply)=>reply.type('text/html').send('<!doctype html><label>Name<input id="name"></label><label>Region<select id="region"><option>East</option><option>West</option></select></label><label>Upload<input id="file" type="file"></label>'));
  const origin=await app.listen({host:'127.0.0.1',port:0});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.ARTIFACT_ROOT;else process.env.ARTIFACT_ROOT=previous;});
  const programs={
    build:[
      'capture("r.current",params["t.account.email"]);',
      'await page.locator("#name").fill(params["r.current"]);',
      'await expect(page.locator("#name")).toHaveValue("@r.current");',
      'await page.locator("#name").fill("");await page.locator("#name").focus();',
      'await page.keyboard.insertText("@t.[account.email]");',
      'await expect(page.locator("#name")).toHaveValue("@t.[account.email]");',
      'await page.locator("#region").selectOption({label:"@s.region"});',
      'await expect(page.locator("#region")).toHaveValue("@s.region");',
      'await page.locator("#file").setInputFiles("@t.file");',
      'expect(await page.locator("#file").evaluate(element=>element.files.length)).toBe(1);',
      'await page.waitForURL("@r.current_url");'
    ].join('\n'),
    recording:compileRecordedProgram([
      {name:'browser_fill',arguments:{locator:'#name',value:'@t.[account.email]'}},
      {name:'browser_assert',arguments:{assertion:'value',locator:'#name',value:'@t.[account.email]'}},
      {name:'browser_select_option',arguments:{locator:'#region',value:'@s.region'}},
      {name:'browser_assert',arguments:{assertion:'value',locator:'#region',value:'@s.region'}}
    ]).source,
    instructions:'await web.fill("#name","@t.[account.email]");await web.expectValue("#name","@t.[account.email]",{match:"equals"});await web.select("#region","@s.region");await web.expectValue("#region","@s.region",{match:"equals"});'
  };
  // Simulate a durable save/reload boundary. Neither a mode switch nor edited
  // data may rewrite the saved source or copy inherited data into own values.
  const saved=JSON.stringify(programs);
  for(const [version,name,region] of [[1,'first@example.test','East'],[2,'updated@example.test','West']]){
    const reloaded=JSON.parse(saved);
    for(const [mode,source] of Object.entries(reloaded)){
      const envelope={engine_run_id:`parameter-${mode}-${version}`,browser:'chromium',headless:true,web_engine:{active:'playwright'},environment:{base_url:origin+'/form'},
        run_timeout_seconds:20,max_repair_attempts:0,parameters_frozen:true,case_parameters:{'t.account.email':name,'t.file':upload},suite_parameters:{region},run_parameters:{current_url:origin+'/form'},
        artifact_policy:{video_mode:'off',trace_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps:[]};
      const session=createWebRunSession(envelope);
      try{
        await session.start();
        const result=await session.runStep({id:mode,order:1,step_type:'web',action:'Enter @t.[account.email]',expected_result:'Selected name and @s.region remain current',automation_code:source});
        assert.equal(result.status,'passed',`${mode} version ${version}: ${result.note}`);
        if(mode==='build')assert.equal(result.captures['r.current'],name,'same-section code reads the explicit capture immediately');
        assert.equal(interpolateText('@t.[account.email] / @s.region',session.context),name+' / '+region);
      }finally{await session.stop();}
    }
  }
  assert.equal(JSON.stringify(programs),saved,'each mode keeps symbolic saved source unchanged');
});

test('standalone Playwright replay keeps current data for keyboard, URL and upload operations across data rows',{timeout:90000},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'qaira-portable-parameters-'));
  const file=path.join(directory,'payload.txt');await writeFile(file,'Fixture upload');
  const app=Fastify();app.get('/form',async(_req,reply)=>reply.type('text/html').send('<!doctype html><label>Name<input id="name"></label><input id="file" type="file">'));
  const origin=await app.listen({host:'127.0.0.1',port:0});
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  const artifact=buildPlaywrightArtifact({testCase:{id:'portable-parameters',title:'Current portable data'},baseURL:origin+'/form',rows:[{'t.name':'First','t.file':file,'r.url':origin+'/form'},{'t.name':'Changed','t.file':file,'r.url':origin+'/form'}],steps:[
    {id:'data',step_order:1,step_type:'web',action:'Use the current input',automation_code:'capture("r.current",params["t.name"]);await page.locator("#name").focus();await page.keyboard.insertText("@r.current");await expect(page.locator("#name")).toHaveValue("@t.name");await page.locator("#file").setInputFiles("@t.file");expect(await page.locator("#file").evaluate(element=>element.files.length)).toBe(1);await page.waitForURL("@r.url");'}
  ]});
  const spec=path.join(directory,'parameters.spec.ts');await writeFile(spec,artifact);assertTypeScriptExportCompiles([spec]);
  const forwarding=path.join(directory,'node_modules/@playwright/test');await mkdir(forwarding,{recursive:true});
  await writeFile(path.join(forwarding,'package.json'),JSON.stringify({name:'@playwright/test',type:'module',exports:'./index.mjs'}));
  await writeFile(path.join(forwarding,'index.mjs'),`export * from ${JSON.stringify(pathToFileURL(require.resolve('playwright/test')).href)};`);
  const config=path.join(directory,'playwright.config.cjs');await writeFile(config,'module.exports='+JSON.stringify({testDir:directory,testMatch:'parameters.spec.ts',workers:1,retries:0,reporter:'json',outputDir:path.join(directory,'results'),use:{headless:true}}));
  const result=await new Promise((resolve,reject)=>{
    let stdout='',stderr='';const child=spawn(process.execPath,[fileURLToPath(new URL('../../node_modules/playwright/cli.js',import.meta.url)),'test','--config',config],{env:{...process.env,QAIRA_DATA_JSON:'{}',QAIRA_BASE_URL:''}});
    t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(result.code,0,result.stdout+'\n'+result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.stats.expected,2);assert.equal(report.stats.unexpected,0);
});
