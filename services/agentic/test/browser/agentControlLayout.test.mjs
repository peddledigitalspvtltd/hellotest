import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
const fixture=`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{AuthProvider}from'/src/auth/AuthContext';import{api,sessionStorage}from'/src/lib/api';
import{AiLlmSelect}from'/services/ai/frontend/components/AiLlmSelect';import{AgentContextSources}from'/services/agentic/frontend/components/AgentContextSources';import{AgentEvidenceScope}from'/services/agentic/frontend/components/AgentEvidenceScope';import{SmartContextWorkbench}from'/services/ai/frontend/components/SmartContextWorkbench';
import'/src/styles.css';import'/src/product-experience.css';import'/services/agentic/frontend/components/AgenticExperience.css';import'/services/agentic/frontend/quality/QualityAgentLab.css';import'/services/agentic/frontend/agents/RepositoryAgents.css';
const session={token:'layout-fixture',user:{id:'reviewer',name:'Reviewer',role:'admin'}};sessionStorage.write(session);api.auth.session=async()=>session;api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function App(){const[id,setId]=useState('');const[scopes,setScopes]=useState(['stories','test-cases','knowledge']);const[evidence,setEvidence]=useState({});return <main style={{padding:24}}>{['quality-command','repository-agent-source-card'].map(name=><section key={name} className={name}><h2>{name}</h2><div className='agent-command-composer__controls'><AiLlmSelect autoSelect={false} integrations={[{id:'model',name:'A deliberately long model provider name',model:'review-model',type:'llm'}]} value={id} onChange={setId}/><AgentContextSources values={scopes} onChange={setScopes}/><AgentEvidenceScope scopes={scopes} values={evidence} onChange={(key,value)=>setEvidence({...evidence,[key]:value})}/><SmartContextWorkbench projectId='project' initialQuery='Review source quality' onApply={()=>{}} buttonClassName='agent-command-smart-context'/></div></section>)}</main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><App/></AuthProvider></QueryClientProvider>);
`;
test('quality and source-agent controls align and wrap without overflow', {timeout:45000},async()=>{
 const name='agent-control-layout-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body><div id='root'></div><script type='module' src='/${name}.tsx'></script></body></html>`);
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5197')+'/'+name+'.html');await page.getByRole('heading',{name:'quality-command'}).waitFor();
  for(const width of [1440,820,390]){
   await page.setViewportSize({width,height:850});
   for(const row of await page.locator('.agent-command-composer__controls').all()){
    const boxes=await row.locator('.ai-llm-select, summary, .agent-command-smart-context').evaluateAll(elements=>elements.map(element=>{const rect=element.getBoundingClientRect();return {element:element.className || element.parentElement.className,x:rect.x,y:rect.y,width:rect.width,height:rect.height};}));
    assert.equal(boxes.length,4);for(const box of boxes){assert.ok(Math.abs(box.height-36)<=1,JSON.stringify({width,box}));assert.ok(box.x+box.width<=width+1,'control stays inside viewport');}
    if(width===1440)assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<=1),'all desktop controls share one baseline '+JSON.stringify(boxes));
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
  }
  await mkdir('/tmp/qaira-agent-layout',{recursive:true});await page.screenshot({path:'/tmp/qaira-agent-layout/mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));}
});
