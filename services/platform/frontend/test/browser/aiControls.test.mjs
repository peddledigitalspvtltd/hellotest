import test from 'node:test';import assert from 'node:assert/strict';import{readFile,writeFile,rm}from'node:fs/promises';import{createRequire}from'node:module';import{randomUUID}from'node:crypto';
const require=createRequire(new URL('../../../../../testengine/backend/package.json',import.meta.url));const{chromium}=require('playwright');const root=new URL('../../',import.meta.url);const catalog=JSON.parse(await readFile(new URL('../../../shared/aiFeatureCatalog.json',import.meta.url),'utf8'));
test('AI Controls tabs, draft/publish, optimization review and responsive layout',{timeout:90000},async()=>{
 const name='ai-controls-'+randomUUID();let browser;
 try{
 await writeFile(new URL(name+'.tsx',root),`import React from'react';import{createRoot}from'react-dom/client';import{AiControls}from'./admin/AiControls';import'./admin/admin.css';createRoot(document.getElementById('root')).render(<main style={{padding:24,maxWidth:1400,margin:'0 auto'}}><AiControls onDirtyChange={()=>{}}/></main>);`);
 await writeFile(new URL(name+'.html',root),`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
 const features=catalog.map(item=>({...item,config:structuredClone(item.defaults),revision:0,published_version:0,published_at:null,draft:null,history:[],fingerprint:'fixture'}));
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;let body={};
 if(path.endsWith('/ai-configuration/metrics'))body={items:[],window_hours:24,note:'Transport outcomes, not semantic scores.',trace_storage:{failed_writes:0}};
 else if(path.endsWith('/ai-configuration'))body={features};
 else if(path.endsWith('/integrations'))body=[];
 else {const match=path.match(/ai-configuration\/(.*?)\/(draft|publish|optimize)/);if(match){const item=features.find(item=>item.id===decodeURIComponent(match[1])),input=request.postDataJSON();assert.ok(item);writes.push({mode:match[2],input});
 if(match[2]==='optimize')body={proposal:{...input.config,prompt:'A reviewed optimized prompt for this feature.'},summary:'Clarified the task.',changes:['Explicit evidence handling.'],trace_id:'fixture'};
 else{item.revision++;if(match[2]==='draft')item.draft={config:input.config,at:new Date().toISOString()};else{item.config=input.config;item.draft=null;item.published_version++;item.history=[{version:item.published_version,config:item.config,at:new Date().toISOString()}];}body=item;}}
 }
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);await page.getByRole('heading',{name:'Case authoring',exact:true}).waitFor();
 for(const tab of ['Instructions','Guardrails','MCP context','Output contract','Model & limits','Metrics','Versions']){await page.getByRole('tab',{name:tab,exact:true}).click();assert.equal(await page.getByRole('tabpanel').count(),1);assert.equal(await page.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true');}
 await page.getByRole('tab',{name:'Instructions',exact:true}).click();await page.getByLabel('Primary prompt').fill('A new grounded test authoring prompt.');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft saved'}).waitFor();assert.equal(writes.at(-1).input.expected_revision,0);
 await page.getByRole('button',{name:'Optimize prompt',exact:true}).click();await page.getByRole('region',{name:'Review prompt optimization'}).waitFor();assert.equal(writes.filter(item=>item.mode==='publish').length,0);
 await page.getByRole('button',{name:'Use in draft',exact:true}).click();assert.equal(await page.getByLabel('Primary prompt').inputValue(),'A reviewed optimized prompt for this feature.');await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('status').filter({hasText:'Published.'}).waitFor();assert.equal(writes.at(-1).input.expected_revision,1);
 const select=page.getByLabel('Feature family');for(const group of [...new Set(catalog.map(item=>item.group))]){await select.selectOption(group);assert.ok(await page.locator('.ai-feature-list button').count()>0);}
 await select.selectOption('All features');await page.getByLabel('Search AI features').fill('Story completion');await page.locator('.ai-feature-list button').first().click();await page.getByRole('heading',{name:'Story completion',exact:true}).waitFor();
 for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`No overflow at ${width}px`);}
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/ai-controls-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:900});await page.screenshot({path:'/tmp/ai-controls-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
