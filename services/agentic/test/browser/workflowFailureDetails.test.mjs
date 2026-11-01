import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const {expect}=require('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);
const fixture=`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkflowFailureDetails} from '/services/agentic/frontend/workflows/WorkflowFailureDetails';
import '/src/styles.css';import '/src/dark-theme.css';import '/services/agentic/frontend/workflows/WorkflowStudio.css';
const initial={code:'AI_OUTPUT_SCHEMA_VIOLATION',message:'The review did not match its output contract.',category:'validation',status_code:502,retryable:false,generation_received:true,effect_dispatched:false,completed_sections:1,total_sections:3,
 origin:{node_id:'test-case-assurance',node_name:'AI Test Case Quality Assurance',loop_node_id:'each-story',batch_index:0,iteration_path:['each-story',0]},
 artifact:{artifact_task:'test-case-assurance',story_id:'story-review-fixture',case_index:0,case_client_id:'case-client-fixture-'+ 'long-reference-'.repeat(8)},
 model_execution:{model_calls:2,max_model_calls:2,deadline_ms:60000,format_repair_attempted:true,candidate:'PRIVATE_NESTED_CANDIDATE'},
 validation_errors:[{path:'/insights/0/kind',keyword:'enum',message:'must be one of the declared finding categories',candidate:'PRIVATE_ISSUE_CANDIDATE'},
  {path:'/automation_readiness',keyword:'required',required_property:'status',message:'is required'}],
 provider_error:{request_id:'fixture-provider-request',raw_body:'PRIVATE_PROVIDER_BODY'},model_candidate:'PRIVATE_MODEL_CANDIDATE',prompt:'PRIVATE_PROMPT'};
function App(){const [value,setValue]=useState(initial);window.showWorkflowFailure=setValue;return <main style={{maxWidth:680,margin:'0 auto',padding:20,boxSizing:'border-box'}}><h1>Workflow error diagnostics</h1><WorkflowFailureDetails value={value}/></main>;}
createRoot(document.getElementById('root')).render(<App/>);
`;

test('workflow error details explain the exact case, model repair and validation paths without revealing candidates',{timeout:60000},async()=>{
 const name='workflow-error-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5186')+'/'+name+'.html');
  await page.getByRole('heading',{name:'Workflow error diagnostics'}).waitFor();const disclosure=page.locator('.studio-failure-details'),summary=disclosure.locator('summary');
  await summary.focus();await summary.press('Enter');await page.getByRole('region',{name:'Output validation issues'}).waitFor();
  const read=label=>disclosure.locator('dl > div').filter({has:page.locator('dt').filter({hasText:new RegExp('^'+label+'$')})}).locator('dd');
  await expect(read('Story')).toHaveText('story-review-fixture');await expect(read('Test Case')).toHaveText('1');await expect(read('Loop batch')).toHaveText('1');await expect(read('Model calls')).toHaveText('2 / 2');await expect(read('Format repair')).toHaveText('Attempted');await expect(read('Model time budget')).toHaveText('60 seconds');
  const issues=page.getByRole('region',{name:'Output validation issues'});await expect(issues.getByText('/insights/0/kind',{exact:true})).toBeVisible();await expect(issues.getByText('status',{exact:true})).toBeVisible();assert.match(await issues.innerText(),/Missing field status/);
  const json=page.getByRole('textbox',{name:'Node failure details JSON'}),recorded=JSON.parse(await json.inputValue());assert.equal(recorded.artifact.case_index,0);assert.equal(recorded.model_execution.model_calls,2);assert.equal(recorded.validation_errors[1].required_property,'status');assert.equal(recorded.effect_dispatched,false);assert.equal(recorded.completed_sections,1);assert.equal(recorded.total_sections,3);assert.doesNotMatch(await json.inputValue(),/PRIVATE/);assert.doesNotMatch(await disclosure.innerText(),/PRIVATE/);assert.equal(await json.evaluate(element=>element.readOnly),true);
  await mkdir('/tmp/qaira-workflow-assurance-errors',{recursive:true});
  for(const width of [1280,768,390]){
   await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'error diagnostics fit '+width);assert.equal(await disclosure.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);await expect(issues.getByText('/insights/0/kind',{exact:true})).toBeVisible();await page.screenshot({path:'/tmp/qaira-workflow-assurance-errors/diagnostics-'+width+'.png',fullPage:true});
  }
  await page.evaluate(()=>window.showWorkflowFailure({code:'AI_OUTPUT_SCHEMA_VIOLATION',model_execution:{model_calls:0,max_model_calls:2,format_repair_attempted:false},artifact:{case_index:0},validation_errors:[{keyword:'required',required_property:'summary'}]}));
  await expect(read('Model calls')).toHaveText('0 / 2');await expect(read('Format repair')).toHaveText('Not attempted');await expect(issues.getByText('(root)',{exact:true})).toBeVisible();
  await summary.focus();await summary.press('Enter');await expect(issues).toBeHidden();await summary.press('Enter');await expect(issues).toBeVisible();assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);}
});
