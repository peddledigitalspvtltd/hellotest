import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
const fixture=`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api} from '/src/lib/api';
import {RecorderStartControls} from '/services/automation/frontend/components/RecorderStartControls';
localStorage.setItem('hellotest.session',JSON.stringify({token:'signed-browser-session',user:{id:'user',role:'admin',status:'active'}}));
window.transportCalls=[];let nextRun=0,loseAck=true,recording;
window.fetch=async(url,options={})=>{
 const address=new URL(String(url),location.origin), path=address.pathname;
 const input=options.body?JSON.parse(options.body):null;
 window.transportCalls.push({url:address.href,path,input,headers:Object.fromEntries(new Headers(options.headers).entries())});
 let value={};
 if(path==='/api/v1/recorder/agent/status')value={ready:true,service:'hellotest-inspection-agent',protocol_version:1,agent_id:'machine',capabilities:{local_execution:true},execution_protocol_version:1};
 else if(path==='/api/executions/local-run'||path.endsWith('/local-dispatch')) {const id=path.endsWith('/local-dispatch')?'queued':'run-'+(++nextRun);value={id,started:true,execution_mode:'local',queued_for_engine_count:1,local_dispatch:{protocol_version:1,execution_id:id,claim_url:location.origin+'/api/executions/'+id+'/local-dispatch/claim',grant_token:'scoped-'+id,expires_at:new Date(Date.now()+600000).toISOString()}};}
 else if(path==='/api/v1/local-executions'){if(loseAck){loseAck=false;throw new TypeError('Lost agent response');}value={accepted:true,execution_id:input.execution_id,status:'accepted'};}
 else if(path==='/api/executions')value={id:'remote'};
 else if(path==='/api/v1/local-executions/run-1/cancel')throw new TypeError('Agent disconnected during cancellation');
 else if(path==='/api/executions/run-1/complete')value={id:'stopped',completed:true,status:'aborted'};
 else if(path.endsWith('/automation/recorder-session'))value={id:'prepare',transaction_id:'transaction',paired_recording_id:'prepare',paired_session_payload:{purpose:'automation-recording',start_url:'https://private.test/login'}};
 else if(path==='/api/v1/recorder/sessions')value={id:'recording',purpose:'automation-recording',status:'running'};
 else if(path.endsWith('/recording/stop'))value={id:'recording',purpose:'automation-recording',status:'stopped',actions:[{index:1,type:'click',locator:'#login'}],network:[]};
 else if(path.endsWith('/recording/finish'))value={test_case_id:'case',generated_step_count:1};
 else if(path==='/api/automation/browser-bridges')value={id:'bridge',token:'scoped-bridge',poll_url:location.origin+'/api/automation/browser-bridges/bridge/poll',result_url:location.origin+'/api/automation/browser-bridges/bridge/results',expires_at:new Date(Date.now()+600000).toISOString()};
 else if(path==='/api/v1/local-browser-bridges')value={accepted:true,bridge_id:'bridge'};
 else if(path.endsWith('/automation/build-batch'))value={transaction_id:'build',queued:true};
 else throw new Error('Unexpected request: '+path);
 return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
};
const base={project_id:'project',app_type_id:'app',created_by:'user'};
function App(){const [message,setMessage]=useState('Ready');const action=async work=>{try{const result=await work();setMessage('Accepted '+(result.id||result.transaction_id||result.test_case_id));}catch(error){setMessage(error.message);}};
return <main><h1>Paired automation</h1><button onClick={()=>action(()=>api.executions.createLocalRun({...base,test_case_ids:['case']}))}>Run case locally</button><button onClick={()=>action(()=>api.executions.create({...base,suite_ids:['suite'],execution_mode:'local'}))}>Run suite locally</button><button onClick={()=>action(()=>api.executions.start('queued',{execution_mode:'local'}))}>Start saved local run</button><button onClick={()=>action(()=>api.executions.create({...base,test_case_ids:['case'],execution_mode:'remote'}))}>Run remotely</button><button onClick={()=>action(()=>api.executions.complete('run-1',{status:'aborted'}))}>Cancel local run</button><RecorderStartControls platform="web" disabled={false} isStarting={false} hasSession={false} onStart={options=>action(async()=>{recording=await api.testCases.startRecorderSession('case',{...options,start_url:'https://private.test/login'});return recording;})}/><button onClick={()=>action(()=>api.testCases.finishRecorderSession('case',recording.id,{transaction_id:recording.transaction_id,recorder_mode:'local',recorder_target:'web'}))}>Save recording</button><button onClick={()=>action(()=>api.testCases.buildAutomationBatch({app_type_id:'app',test_case_ids:['case'],browser_location:'local',start_url:'https://private.test/login'}))}>Build on this computer</button><p role="status">{message}</p></main>}
createRoot(document.getElementById('root')).render(<App/>);
`;
test('production API routes case/suite/start, recorder and Engineer through the paired computer and keeps remote independent', {timeout:90000},async()=>{
 const name='paired-automation-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(html,'<html><body><div id="root"></div><script type="module" src="/'+name+'.tsx"></script></body></html>');await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5186')+'/'+name+'.html');await page.getByRole('heading',{name:'Paired automation'}).waitFor();
  await page.getByRole('button',{name:'Run case locally',exact:true}).click();await page.getByRole('status').filter({hasText:'could not confirm'}).waitFor();
  await page.getByRole('button',{name:'Run case locally',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted run-1'}).waitFor();
  assert.equal(await page.evaluate(()=>window.transportCalls.filter(c=>c.path==='/api/executions/local-run').length),1,'Lost local acknowledgment reconnects the original run');
  await page.getByRole('button',{name:'Run suite locally',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted run-2'}).waitFor();
  await page.getByRole('button',{name:'Start saved local run',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted queued'}).waitFor();
  await page.getByRole('button',{name:'Cancel local run',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted stopped'}).waitFor();
  assert.equal(await page.evaluate(()=>window.transportCalls.filter(c=>c.path==='/api/executions/run-1/complete').length),1,'Server cancellation persists even when the paired agent disconnects');
  let before=await page.evaluate(()=>window.transportCalls.filter(c=>c.url.startsWith('http://127.0.0.1:4311')).length);
  await page.getByRole('button',{name:'Run remotely',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted remote'}).waitFor();assert.equal(await page.evaluate(()=>window.transportCalls.filter(c=>c.url.startsWith('http://127.0.0.1:4311')).length),before);
  await page.getByRole('button',{name:'Local Playwright',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted recording'}).waitFor();
  await page.getByRole('button',{name:'Save recording',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted case'}).waitFor();
  await page.getByRole('button',{name:'Build on this computer',exact:true}).click();await page.getByRole('status').filter({hasText:'Accepted build'}).waitFor();
  const calls=await page.evaluate(()=>window.transportCalls);assert.deepEqual(calls.filter(c=>c.path==='/api/executions/local-run')[1].input.suite_ids,['suite']);
  assert.ok(calls.filter(c=>c.path==='/api/v1/local-executions').every(c=>c.headers['x-hellotest-agent-token']?.length===64));
  const capture=calls.find(c=>c.path.endsWith('/recording/finish')).input;assert.equal(capture.captured_session.status,'stopped');assert.equal(capture.paired_recording_id,'prepare');
  assert.equal(calls.find(c=>c.path.endsWith('/automation/build-batch')).input.paired_browser_bridge_id,'bridge');assert.ok(!JSON.stringify(calls.filter(c=>!c.url.startsWith('http://127.0.0.1:4311'))).includes('x-hellotest-agent-token'));assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);}
});
