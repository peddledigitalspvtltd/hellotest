import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
const output=fileURLToPath(new URL('../../../../.hellotest/reports/workflow-execution-ux/',import.meta.url));
const base=(await readFile(new URL('agentWorkspace.test.mjs',import.meta.url),'utf8')).match(/const fixture = `([\s\S]*?)`;\nconst specialists/)[1];
const setup=`
window.enablePreviewFixture();
const labels=['Manual Sprint trigger','Read all Sprint Stories','For each Story','AI Story Assurance','AI Test Case Generator','AI Test Case Quality Assurance','AI Automation Engineer','Sprint results and Library cases'];
const tasks=['','','','story-assurance','test-case-generation','test-case-assurance','automation-engineer',''];
const ids=['request','sprint-stories','each-story','story-assurance','test-case-generation','test-case-assurance','automation-engineer','sprint-output'];
const nodes=ids.map((id,index)=>({id,type:'agenticStep',position:{x:index*290,y:150},data:{kind:index===0?'trigger':index===1?'apiTool':index===2?'loop':index===7?'output':'artifactTask',artifactTask:tasks[index],label:labels[index]}}));
const longRecords=Array.from({length:45},(_,index)=>({id:'evidence-'+(index+1),summary:'Recorded evidence '+(index+1)+': inspect the selected Story and preserve exact source boundaries. '.repeat(5),passed:index%2===0}));
const draft={client_id:'draft-1',title:'Preserve the remaining order when refunding one line item',description:'A generated manual draft saved automatically with AI provenance and review pending.',authoring_mode:'structured',requirement_ids:['layout-story'],parameter_values:{customer:'[Missing: reviewed customer fixture]'},steps:Array.from({length:18},(_,index)=>({step_order:index+1,step_type:'web',action:'Recorded review step '+(index+1)+': use approved refund context without inventing implementation details.',expected_result:index===17?'FINAL_STEP_REACHABLE: only the selected line item is refunded.':'The recorded outcome '+(index+1)+' matches the selected Story.'}))};
const packet={story_id:'layout-story',story:{id:'layout-story',title:'Partial refunds with clear receipts'},cases:[draft],case_assurance:[{verification:{status:'passed'},assurance_review:{automation_readiness:{status:'needs_input',summary:'The Story does not supply its executable contract.',evidence_refs:['requirement:layout-story'],missing_context:[{kind:'api_contract',reason:'Provide reviewed API method, path and response schema.',evidence_refs:['requirement:layout-story'],step_refs:['step:1']}]}}}],automation:[null],automation_input_required:[{case_index:0,message:'Provide the reviewed refund API contract and concrete test data.',required_parameters:['customer'],required_context:['Reviewed refund API method, path and response schema']}]};
const publication={mode:'automatic',status:'saved',manual_cases_saved:1,automation_cases_saved:0,approved:false,requires_review:true,receipts:[{id:'layout-library-case',story_id:'layout-story',case_index:0,kind:'manual',saved:true,requires_review:true}]};
window.layoutRun={id:'execution-layout-fixture',workflow_id:'layout-workflow',workflow_name:'Sprint Automator · Recovery improvements',project_id:'project',app_type_id:'app',execution_mode:'review',status:'needs_review',trigger_kind:'manual',created_at:'2026-10-27T10:00:00Z',started_at:'2026-10-27T10:00:00Z',completed_at:'2026-10-27T10:01:00Z',input_payload:{sprint_id:'layout-sprint',max_cases_per_story:1},workflow_snapshot:{settings:{template_id:'sprint-automator',library_publication_mode:'automatic'},nodes,edges:nodes.slice(1).map((node,index)=>({id:'layout-edge-'+index,source:nodes[index].id,target:node.id})),runtime_contract:{automatic_library_publication:true}},node_results:nodes.map((node,index)=>({node_id:node.id,node_name:node.data.label,node_type:node.data.kind,status:'completed',attempts:1,started_at:'2026-10-27T10:00:00Z',completed_at:'2026-10-27T10:01:00Z',input:{input:{selected_story_id:'layout-story',records:longRecords},request:{sprint_id:'layout-sprint'},prompt:'Recorded exact instruction for '+node.data.label},output:index>=3&&index<=6?{artifact_task:tasks[index],generation_mode:'native',data:[packet],...(index===4?{library_publication:publication}:{})}:{records:longRecords,summary:'Recorded output for '+node.data.label,end:'FINAL_OUTPUT_REACHABLE'},logs:Array.from({length:8},(_,logIndex)=>({at:'2026-10-27T10:00:00Z',level:'info',message:'Recorded event '+(logIndex+1)+' for '+node.data.label}))})),output_payload:{summary:'Saved 1 manual Test Case pending review. Additional automation inputs are still needed.',project_changes_applied:true}};
window.previewRecord=window.layoutRun;
api.agenticWorkflows.getRun=async()=>structuredClone(window.layoutRun);
api.agenticWorkflows.listRuns=async()=>[structuredClone(window.layoutRun)];
`;
const fixture=base.replace('function RouteObserver()',setup+'\nfunction RouteObserver()');

async function geometry(page){
 return page.evaluate(()=>{
  const rect=element=>{if(!element)return null;const r=element.getBoundingClientRect(),s=getComputedStyle(element);return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop,overflowY:s.overflowY};};
  const dialog=document.querySelector('[role="dialog"][aria-label="Workflow execution details"]');
  return {viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,dialog:rect(dialog),execution:rect(document.querySelector('.studio-execution')),workspace:rect(document.querySelector('.studio-execution .studio-execution-workspace, .studio-execution .studio-workspace')),graph:rect(document.querySelector('.studio-execution .studio-canvas')),steps:rect(document.querySelector('.studio-execution-steps')),inspector:rect(document.querySelector('.studio-execution .studio-inspector')),inspectorContent:rect(document.querySelector('.studio-execution .studio-inspector-content')),scrollContainers:dialog?[dialog,...dialog.querySelectorAll('*')].filter(element=>element.scrollHeight>element.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(element).overflowY)).map(element=>({tag:element.tagName,className:typeof element.className==='string'?element.className:'',...rect(element)})):[]};
 });
}

async function capture(page,name){
 await page.screenshot({path:output+'/'+name+'.png',fullPage:true,animations:'disabled'});
 return geometry(page);
}

async function scrollState(locator){return locator.evaluate(element=>({top:element.scrollTop,height:element.clientHeight,total:element.scrollHeight}));}

async function verifyInteractions(page,dialog){
 const measurements={phase:'after',desktopInitial:await capture(page,'after-desktop-initial')};
 let bounds=await dialog.boundingBox();
 assert.ok(bounds.width<=1392&&bounds.x>=24,'desktop dialog leaves useful viewport gutters');
 assert.ok(bounds.height<=852&&bounds.y>=24,'desktop dialog stays inside the viewport');
 assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
 const content=dialog.getByRole('region',{name:'Execution content',exact:true});
 await content.waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Hide steps',exact:true}).getAttribute('aria-expanded'),'true');
 const graph=dialog.locator('.studio-canvas');
 const graphBefore=(await graph.boundingBox()).width;
 await dialog.getByRole('button',{name:'Hide steps',exact:true}).click();
 assert.equal(await dialog.getByRole('button',{name:'Show steps',exact:true}).getAttribute('aria-expanded'),'false');
 assert.equal(await dialog.locator('.studio-execution-steps').isVisible(),false);
 assert.ok((await graph.boundingBox()).width>graphBefore+100,'hiding steps gives space to the graph');
 await dialog.getByRole('button',{name:'Show steps',exact:true}).click();
 assert.equal(await dialog.locator('.studio-execution-steps ol > li').count(),8);
 const graphWithDetails=(await graph.boundingBox()).width;
 await dialog.getByRole('button',{name:'Hide details',exact:true}).click();
 assert.equal(await dialog.getByRole('button',{name:'Show details',exact:true}).getAttribute('aria-expanded'),'false');
 assert.equal(await dialog.locator('.studio-inspector').isVisible(),false);
 assert.ok((await graph.boundingBox()).width>graphWithDetails+100,'hiding details gives space to the graph');
 await dialog.locator('.studio-execution-steps button').filter({hasText:'AI Test Case Generator'}).click();
 const inspector=dialog.locator('.studio-inspector');await inspector.waitFor();
 assert.match(await dialog.getByRole('textbox',{name:'Node output JSON',exact:true}).inputValue(),/layout-story/);
 await inspector.getByRole('button',{name:'Input',exact:true}).click();
 assert.equal(JSON.parse(await inspector.getByRole('textbox',{name:'Node input JSON',exact:true}).inputValue()).selected_story_id,'layout-story');
 await inspector.getByRole('button',{name:'Output',exact:true}).click();
 const json=inspector.getByRole('textbox',{name:'Node output JSON',exact:true});
 const originalJson=await json.inputValue();await json.hover();await page.mouse.wheel(0,900);
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Node output JSON"]')?.scrollTop>0);
 await json.focus();await json.press('Home');await json.press('PageDown');
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Node output JSON"]')?.scrollTop>0);
 assert.ok((await scrollState(json)).top>0,'keyboard scrolling moves through saved JSON');
 assert.equal(await json.inputValue(),originalJson,'scrolling preserves exact read-only output');
 assert.equal(await json.evaluate(element=>element.readOnly),true);
 measurements.desktopSelected=await capture(page,'after-desktop-node-output');
 await inspector.getByRole('button',{name:'Expand node details',exact:true}).click();
 const expanded=page.getByRole('dialog',{name:'Inspect AI Test Case Generator',exact:true});await expanded.waitFor();
 assert.equal(await expanded.locator('.is-two-pane').count(),1);
 assert.equal(await expanded.getByRole('textbox',{name:'Node input JSON',exact:true}).isVisible(),true);
 assert.equal(await expanded.getByRole('textbox',{name:'Node output JSON',exact:true}).isVisible(),true);
 await capture(page,'after-desktop-expanded');
 await page.keyboard.press('Escape');await expanded.waitFor({state:'hidden'});
 assert.equal(await inspector.getByRole('button',{name:'Expand node details',exact:true}).evaluate(element=>element===document.activeElement),true,'closing expanded details restores focus to its trigger');
 await inspector.getByRole('button',{name:'Hide node details',exact:true}).click();
 assert.equal(await inspector.isVisible(),false);
 await dialog.locator('.react-flow__node[data-id="test-case-generation"]').click();
 await inspector.waitFor();assert.match(await json.inputValue(),/layout-story/);
 const zoom=()=>graph.locator('.react-flow__viewport').evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).a);
 const initialZoom=await zoom();
 console.log(JSON.stringify({camera:'before-focus',zoom:initialZoom,selected:await dialog.locator('.studio-execution-steps button[aria-pressed="true"]').innerText()}));
 await dialog.getByRole('button',{name:'Focus selected step',exact:true}).click();
 await page.waitForFunction(previous=>{const element=document.querySelector('.studio-execution .react-flow__viewport');return element&&new DOMMatrix(getComputedStyle(element).transform).a>previous+0.1;},initialZoom);
 await page.waitForTimeout(250); // Allow the requested 200ms camera transition to finish.
 const focusedZoom=await zoom();
 console.log(JSON.stringify({camera:'after-focus',zoom:focusedZoom,selected:await dialog.locator('.studio-execution-steps button[aria-pressed="true"]').innerText()}));
 measurements.desktopFocused=await capture(page,'after-desktop-focused-step');
 await dialog.getByRole('button',{name:'Hide steps',exact:true}).click();
 await page.waitForTimeout(450);
 assert.ok(Math.abs(await zoom()-focusedZoom)<0.02,'collapsing a panel preserves the requested graph zoom');
 await dialog.getByRole('button',{name:'Show steps',exact:true}).click();
 await dialog.getByRole('button',{name:'Next step',exact:true}).click();
 assert.equal(await dialog.locator('.studio-execution-steps button[aria-pressed="true"]').innerText().then(text=>text.includes('AI Test Case Quality Assurance')),true);
 await dialog.getByRole('button',{name:'Previous step',exact:true}).click();
 assert.match(await dialog.locator('.studio-execution-steps button[aria-pressed="true"]').innerText(),/AI Test Case Generator/);
 const regularWidth=(await dialog.boundingBox()).width;
 await dialog.getByRole('button',{name:'Maximize execution',exact:true}).click();
 assert.ok((await dialog.boundingBox()).width>regularWidth,'execution size changes only when requested');
 assert.ok(Math.abs(await zoom()-focusedZoom)<0.02,'maximizing preserves the requested graph zoom');
 await dialog.getByRole('button',{name:'Restore execution',exact:true}).click();
 assert.ok(Math.abs((await dialog.boundingBox()).width-regularWidth)<=2);
 await dialog.getByRole('button',{name:'Results',exact:true}).click();
 assert.equal(await dialog.locator('.studio-execution-workspace').count(),0,'Results has its own tab instead of displacing the graph');
 await content.getByText('Partial refunds with clear receipts · 1 Test Case',{exact:true}).click();
 const headerBefore=(await dialog.locator('.studio-execution > .studio-header').boundingBox()).y;
 await content.hover();await page.mouse.wheel(0,5000);
 await page.waitForFunction(()=>document.querySelector('[aria-label="Execution content"]')?.scrollTop>0);
 await content.focus();await content.press('End');
 await page.waitForFunction(()=>{const element=document.querySelector('[aria-label="Execution content"]');return element&&element.scrollHeight-element.scrollTop-element.clientHeight<=3;});
 let state=await scrollState(content);assert.ok(state.total-state.top-state.height<=3,'keyboard End reaches the actual Results bottom');
 await content.getByText(/FINAL_STEP_REACHABLE/).waitFor();
 const finalStep=await content.getByText(/FINAL_STEP_REACHABLE/).boundingBox();
 const contentBounds=await content.boundingBox();assert.ok(finalStep.y>=contentBounds.y&&finalStep.y<contentBounds.y+contentBounds.height,'the last recorded step can be reached');
 const headerAfter=(await dialog.locator('.studio-execution > .studio-header').boundingBox()).y;
 assert.ok(Math.abs(headerAfter-headerBefore)<=1,'execution header stays fixed while results scroll');
 measurements.desktopResultsBottom=await capture(page,'after-desktop-results-bottom');
 await content.press('Home');await page.waitForFunction(()=>document.querySelector('[aria-label="Execution content"]')?.scrollTop<=2);
 await page.waitForTimeout(150); // Do not overlap opposite native keyboard scroll animations.
 assert.ok((await scrollState(content)).top<=2);
 await content.press('PageDown');await page.waitForFunction(()=>document.querySelector('[aria-label="Execution content"]')?.scrollTop>0);
 assert.ok((await scrollState(content)).top>0,'content region supports PageDown');
 await page.setViewportSize({width:1920,height:1080});
 assert.ok((await dialog.boundingBox()).width<=1440,'large desktop keeps a bounded default width');
 await page.setViewportSize({width:390,height:844});await page.reload();
 await dialog.waitFor();await dialog.getByRole('button',{name:'Show steps',exact:true}).waitFor();
 assert.equal(await dialog.locator('.studio-execution-steps').isVisible(),false,'mobile opens with the steps list collapsed');
 bounds=await dialog.boundingBox();assert.ok(bounds.x>=7&&bounds.width<=376);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
 measurements.mobileInitial=await capture(page,'after-mobile-initial');
 measurements.mobileGraphControls=await graph.evaluate(element=>{const controls=element.querySelector('.react-flow__controls');const box=target=>{if(!target)return null;const r=target.getBoundingClientRect(),s=getComputedStyle(target);return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,display:s.display,visibility:s.visibility,overflow:s.overflow};};return {canvas:box(element),flow:box(element.querySelector('.react-flow')),controls:box(controls),buttons:controls?.querySelectorAll('button').length};});
 console.log(JSON.stringify({mobile_graph_controls:measurements.mobileGraphControls}));
 assert.equal(measurements.mobileGraphControls.buttons,4);
 assert.equal(await graph.getByRole('button',{name:'Focus selected step',exact:true}).isVisible(),true,'mobile retains graph zoom and focus controls');
 assert.ok(measurements.mobileGraphControls.controls.height>100);
 assert.ok(measurements.mobileGraphControls.controls.bottom<=measurements.mobileGraphControls.canvas.bottom+1);
 const editorButton=await dialog.getByRole('button',{name:'Open in editor',exact:true}).boundingBox();
 assert.ok(editorButton.width<=36,'mobile editor action uses its accessible icon without clipped stacked text');
 await dialog.getByRole('button',{name:'Show steps',exact:true}).click();
 await dialog.locator('.studio-execution-steps button').filter({hasText:'AI Test Case Generator'}).click();
 await dialog.getByRole('button',{name:'Hide steps',exact:true}).click();
 await content.focus();await content.press('End');
 await inspector.getByRole('textbox',{name:'Node output JSON',exact:true}).waitFor();
 const mobileOutput=await inspector.getByRole('textbox',{name:'Node output JSON',exact:true}).boundingBox();
 const mobileDialog=await dialog.boundingBox();assert.ok(mobileOutput.y<mobileDialog.y+mobileDialog.height,'mobile node data is reachable inside its scroll body');
 measurements.mobileNode=await capture(page,'after-mobile-node-output');
 await dialog.getByRole('button',{name:'Results',exact:true}).click();
 await content.getByText('Partial refunds with clear receipts · 1 Test Case',{exact:true}).click();
 await content.hover();await page.mouse.wheel(0,10000);await content.focus();await content.press('End');
 await page.waitForFunction(()=>{const element=document.querySelector('[aria-label="Execution content"]');return element&&element.scrollHeight-element.scrollTop-element.clientHeight<=3;});
 state=await scrollState(content);assert.ok(state.total-state.top-state.height<=3,'mobile Results bottom is reachable');
 measurements.mobileResultsBottom=await capture(page,'after-mobile-results-bottom');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByRole('dialog',{name:'Workflow executions',exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog',{name:'Workflow executions',exact:true}).isVisible(),true);
 await writeFile(output+'/after-measurements.json',JSON.stringify(measurements,null,2));
}

test('execution layout baseline and interaction regression use the real eight-step React workspace', {timeout:120000},async()=>{
 const name='execution-layout-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 const phase=process.env.WORKFLOW_EXECUTION_LAYOUT_PHASE||'after';let browser,page;
 try{
  await mkdir(output,{recursive:true});await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'No live requests in isolated execution layout fixture'})}));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/agentic-workflows?view=runs&workflow_run=execution-layout-fixture')}`);
  const dialog=page.getByRole('dialog',{name:'Workflow execution details',exact:true});await dialog.waitFor();
  await page.getByRole('textbox',{name:'Node output JSON',exact:true}).waitFor();
  if(phase!=='before'){await verifyInteractions(page,dialog);assert.deepEqual(errors,[]);return;}
  const measurements={phase,desktopInitial:await capture(page,phase+'-desktop-initial')};
  assert.equal(await dialog.locator('.studio-execution-steps ol > li').count(),8);
  await dialog.locator('.studio-execution-steps button').filter({hasText:'AI Test Case Generator'}).click();
  const outputBox=page.getByRole('textbox',{name:'Node output JSON',exact:true});assert.match(await outputBox.inputValue(),/layout-story/);
  measurements.desktopSelected=await capture(page,phase+'-desktop-node-output');
  measurements.desktopBottom=await dialog.evaluate(element=>{element.scrollTop=element.scrollHeight;return {scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,bottomReached:Math.abs(element.scrollHeight-element.scrollTop-element.clientHeight)<=2};});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{document.querySelectorAll('[role="dialog"],.studio-inspector-content').forEach(element=>{element.scrollTop=0;});});
  measurements.mobileInitial=await capture(page,phase+'-mobile-node-output');
  measurements.mobileBottom=await dialog.evaluate(element=>{element.scrollTop=element.scrollHeight;return {scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,bottomReached:Math.abs(element.scrollHeight-element.scrollTop-element.clientHeight)<=2};});
  await capture(page,phase+'-mobile-bottom');
  await writeFile(output+'/'+phase+'-measurements.json',JSON.stringify(measurements,null,2));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({phase,screenshots:output,desktop:measurements.desktopInitial.dialog,mobile:measurements.mobileInitial.dialog,desktopScrollContainers:measurements.desktopInitial.scrollContainers.length,mobileScrollContainers:measurements.mobileInitial.scrollContainers.length}));
 }catch(error){if(page){await page.screenshot({path:output+'/'+phase+'-failure.png',fullPage:true}).catch(()=>{});await writeFile(output+'/'+phase+'-failure-measurements.json',JSON.stringify({error:error.message,geometry:await geometry(page),focus:await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),text:document.activeElement?.textContent?.slice(0,120)}))},null,2)).catch(()=>{});}throw error;}
 finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
