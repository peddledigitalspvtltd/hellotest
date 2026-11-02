import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const directory=process.env.AGENT_LIVE_OUTCOME_DIR;
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const root=new URL('../../../platform/frontend/',import.meta.url);

// This is a renderer check over retained REAL provider outputs. It never
// invokes a model, accepts a proposal or substitutes a fixture for a live call.
test('retained live specialist outcomes render their complete results and export typed outcomes', {skip:!directory,timeout:180000},async()=>{
  const profiles=JSON.parse(await readFile(new URL('../../shared/workflowSpecialists.json',import.meta.url),'utf8'));
  const recordings=[];
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.json')).sort()){
    const id=name.slice(0,-5),recording=JSON.parse(await readFile(path.join(directory,name),'utf8'));
    if(profiles[id]&&recording.result)recordings.push({id,name:profiles[id].name,...recording});
  }
  const matrix=JSON.parse(await readFile(directory.replace(/-outcomes\/?$/,'')+'.json','utf8'));
  const recordedIds=new Set(recordings.map(record=>record.id));
  for(const id of Object.keys(profiles)){
    const receipt=matrix.results.find(item=>item.agent_id===id);
    assert.ok(receipt?.model_calls?.some(call=>call.status==='succeeded'&&call.http_status===200),id+' needs an actual provider receipt');
    if(!recordedIds.has(id)){
      assert.equal(receipt.status,'failed',id+' can lack a rendered result only when the native contract rejected it');
      assert.ok(receipt.error?.message,id+' retains the rejection diagnostics');
    }
  }
  assert.equal(recordings.length,Object.keys(profiles).length-matrix.results.filter(item=>item.status==='failed'&&!recordedIds.has(item.agent_id)).length);
  if(process.env.AGENT_LIVE_CUSTOM_REPORT){
    const custom=JSON.parse(await readFile(process.env.AGENT_LIVE_CUSTOM_REPORT,'utf8'));
    assert.ok(custom.model_calls.some(call=>call.status==='succeeded'&&call.http_status===200));
    assert.ok(custom.result,'Only an accepted native custom result can be rendered.');
    recordings.push({id:custom.agent_id,name:custom.definition.name,...custom});
  }
  const name='agent-live-outcome-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
  const screenshotDir='/tmp/qaira-agent-outcomes-live';
  const fixture=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{AuthProvider}from'/src/auth/AuthContext';import{api,sessionStorage}from'/src/lib/api';import{setCurrentScope}from'/src/platform/hooks/useCurrentProject';import{AgenticOutcomePanel}from'/services/agentic/frontend/components/AgenticExperience';import'/src/styles.css';import'/src/modal-system.css';import'/src/product-experience.css';
  const recordings=${JSON.stringify(recordings)};
  sessionStorage.write({token:'renderer-fixture',user:{id:'reviewer',role:'admin'}});setCurrentScope('sample-project','sample-app-web');api.auth.session=async()=>({token:'renderer-fixture',user:{id:'reviewer',role:'admin'}});api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.metadata.domain=async()=>({test_cases:{types:[{value:'functional',label:'Functional'},{value:'regression',label:'Regression'}]}});api.agentProposals.list=async()=>[];api.agentProposals.accept=async()=>{throw Error('Renderer validation cannot accept a proposal.');};api.llmTraces.list=async()=>({items:[],next_cursor:null});api.llmTraces.detail=async()=>({status:'succeeded',content_access:false,capture:{redacted:true}});Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.exportedBrief=value;}}});
  function App(){const[index,setIndex]=useState(0),record=recordings[index];return<main style={{padding:16,minWidth:0}}><label>Recorded specialist<select aria-label="Recorded specialist" value={index}onChange={event=>setIndex(Number(event.target.value))}>{recordings.map((item,index)=><option key={item.id}value={index}>{item.name}</option>)}</select></label><AgenticOutcomePanel key={record.id}result={record.result}citations={record.citations||[]}provenance={record.provenance}sessionId={'renderer-'+record.id}/></main>;}createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><AuthProvider><App/></AuthProvider></MemoryRouter></QueryClientProvider>);`;
  let browser;
  try{
    await writeFile(html,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx,fixture);await mkdir(screenshotDir,{recursive:true});
    browser=await require('playwright').chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
    for(const[index,record]of recordings.entries()){
      await page.getByLabel('Recorded specialist',{exact:true}).selectOption(String(index));
      const panel=page.locator('.agent-outcome-panel'),tabs=panel.getByRole('tablist');
      const names=await tabs.getByRole('tab').allTextContents();
      assert.ok(names.indexOf('Full brief')<names.findIndex(value=>value.startsWith('Outcome'))&&names.findIndex(value=>value.startsWith('Outcome'))<names.findIndex(value=>value.startsWith('Model calls')));
      await tabs.getByRole('tab',{name:/^Outcome/}).click();
      const artifacts=record.result.artifacts||[];
      if(artifacts.length){
        const review=panel.getByRole('region',{name:'Structured agent proposals'});
        assert.equal(await review.getByRole('radio').count(),artifacts.length,record.id);
        for(const[artifactIndex,artifact]of artifacts.entries()){
          await review.getByRole('radio').nth(artifactIndex).check();
          if(artifact.kind==='story')assert.equal(await review.getByLabel('Story title',{exact:true}).inputValue(),artifact.title,record.id);
          else if(['test_case','automation'].includes(artifact.kind))await review.getByRole('heading',{name:artifact.title,exact:true}).waitFor();
          else assert.equal(await review.getByLabel('Title',{exact:true}).inputValue(),artifact.title,record.id);
        }
      }else if(!record.result.automation_repair){
        const body=await panel.getByLabel('Resulting agent assessment',{exact:true}).innerText();
        assert.ok(body.trim().length>20,record.id+' retains a substantive result');
        assert.doesNotMatch(body,/\[object Object\]/);
      }else await panel.getByRole('region',{name:'Automation repair verification'}).waitFor();
      await panel.getByRole('button',{name:'Copy brief',exact:true}).click();
      const exported=await page.evaluate(()=>window.exportedBrief);
      assert.ok(exported.includes(record.result.response),record.id+' exports the complete model narrative');
      if(artifacts.length){
        const payloads=[...exported.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match=>JSON.parse(match[1]));
        assert.deepEqual(payloads.find(Array.isArray),artifacts,record.id+' exports every native artifact field');
      }
      if(record.result.automation_repair)assert.ok(exported.includes(JSON.stringify(record.result.automation_repair,null,2)));
      if(['test-designer','story-architect','release-readiness'].includes(record.id)){
        await page.screenshot({path:path.join(screenshotDir,record.id+'-desktop.png'),fullPage:true});
        await page.setViewportSize({width:390,height:1000});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),record.id+' fits mobile');
        await page.screenshot({path:path.join(screenshotDir,record.id+'-mobile.png'),fullPage:true});
        await page.setViewportSize({width:1440,height:1000});
      }
    }
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await Promise.allSettled([rm(html,{force:true}),rm(tsx,{force:true})]);}
});
