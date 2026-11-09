import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);

async function fixture(){
 const existing=await readFile(new URL('storyCatalogPages.test.mjs',import.meta.url),'utf8');
 let source=runInNewContext(existing.match(/const fixture\s*=\s*(`[^]*?`);/)[1]);
 source=source.replace("const mode = new URLSearchParams(location.search).get('mode') === 'backlog' ? 'backlog' : 'stories';","const mode = 'sprints';");
 source=source.replace("setCurrentScope('story-project','story-app');","setCurrentScope('','');window.releaseScope=()=>setCurrentScope('story-project','story-app');");
 source=source.replace("api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});",`const accessGate=new Promise(resolve=>{window.releaseAccess=resolve;});
api.featureFlags.snapshot=async()=>{await accessGate;window.accessResolved=true;return {flags:new Proxy({},{get:()=>new URLSearchParams(location.search).get('failure')!=='capability'})};};`);
 const injection=`
const params=new URLSearchParams(location.search),storyId='00000000-0000-4000-8000-000000000831';
const routeId=params.get('id')||storyId;
let failure=params.get('failure')||'';
const detailGate=new Promise(resolve=>{window.releaseDetail=resolve;});
window.recoverDetail=()=>{failure='';};window.detailCalls=[];
const selectedStory={...stories[0],id:storyId,display_id:'Req_831',title:'Deep-linked employee onboarding',iteration_id:'route-sprint',sprint:'2026.11.2',revision:1,acceptance_criteria:['An employee can be prepared for onboarding.']};
api.requirements.get=async(id,input)=>{window.detailCalls.push({id,input});await detailGate;if(['403','404','500'].includes(failure))throw Object.assign(new Error('PRIVATE_PROVIDER_FAILURE'),{status:Number(failure)});return selectedStory;};
api.requirements.editMetadata=async()=>({fields:[],core_fields:[],required_fields:[],workflow_statuses:{statuses:[{value:'open',label:'Open'}],default_status:'open'}});
api.requirementIterations.list=async()=>[{id:'route-sprint',project_id:'story-project',name:'2026.11.2',requirement_ids:[],state:'active'}];
api.requirementIterations.listRequirements=async()=>({items:[],is_last:true});
`;
 source=source.replace('const client=new QueryClient',injection+'\nconst client=new QueryClient');
 source=source.replace("{path:'/requirements',element:<RequirementsPage workspaceMode={mode}/>}","{path:'/sprints',element:<RequirementsPage workspaceMode={mode}/>}");
 source=source.replace("initialEntries:['/requirements']","initialEntries:['/sprints?keep=1&requirement='+encodeURIComponent(routeId)]");
 source=source.replace("createRoot(document.getElementById('root'))", "window.storyRoute=router.state.location.pathname+router.state.location.search;router.subscribe(state=>{window.storyRoute=state.location.pathname+state.location.search;});\ncreateRoot(document.getElementById('root'))");
 return source;
}

test('Sprint Story deep links retain UUID/display IDs through context and detail hydration and expose scoped failures',{timeout:120000},async()=>{
 const name='story-deep-link-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(tsx,await fixture());await writeFile(html,`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  for(const [id,failure]of [['00000000-0000-4000-8000-000000000831',''],['Req_831',''],['Req_831','404'],['Req_831','403'],['Req_831','capability']]){
   const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   page.setDefaultTimeout(20000);
   await page.route('**/api/**',route=>route.fulfill({status:500,json:{message:'Unexpected fixture request'}}));
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5187'}/${name}.html?id=${encodeURIComponent(id)}&failure=${failure}`);
   await page.waitForFunction(()=>window.releaseAccess&&window.releaseScope);
   const expected='/sprints?keep=1&requirement='+encodeURIComponent(id);
   assert.equal(await page.evaluate(()=>window.storyRoute),expected);
   await page.evaluate(()=>window.releaseAccess());await page.waitForFunction(()=>window.accessResolved);
   assert.equal(await page.evaluate(()=>window.storyRoute),expected,'Missing project context never discards the route');
   assert.equal(await page.evaluate(()=>window.detailCalls.length),0);
   await page.evaluate(()=>window.releaseScope());
   if(failure==='capability'){
    await page.getByRole('alert').filter({hasText:'You do not have access to this Story in the current project.'}).waitFor();
    assert.equal(await page.evaluate(()=>window.detailCalls.length),0,'Denied capabilities never dispatch a Story request');
    assert.equal(await page.getByRole('button',{name:'Retry Story',exact:true}).count(),0);
   }else{
    await page.waitForFunction(()=>window.detailCalls.length===1);
    assert.equal(await page.evaluate(()=>window.storyRoute),expected,'A disabled Sprint catalog is not evidence that the pending Story is missing');
    assert.equal(await page.getByLabel('Story Title').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.calls.catalog.length),0,'Sprint deep links do not load the unbounded Story catalog');
    await page.evaluate(()=>window.releaseDetail());
    if(failure){
     const message=failure==='404'?'This Story could not be found in the current project.':'You do not have access to this Story in the current project.';
     await page.getByRole('alert').filter({hasText:message}).waitFor();
     assert.equal(await page.getByLabel('Story Title').isVisible(),false);
     assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_PROVIDER_FAILURE'));
     assert.equal(await page.evaluate(()=>window.storyRoute),expected,'Authoritative failure keeps an addressable link');
     await page.evaluate(()=>window.recoverDetail());await page.getByRole('button',{name:'Retry Story',exact:true}).click();
    }
    const title=page.getByLabel('Story Title');
    try{await title.waitFor();}catch(error){throw new Error(JSON.stringify({id,failure,errors,route:await page.evaluate(()=>window.storyRoute),calls:await page.evaluate(()=>window.detailCalls),body:(await page.locator('body').innerText()).slice(0,3000)}));}
    assert.equal(await title.inputValue(),'Deep-linked employee onboarding');
    const calls=await page.evaluate(()=>window.detailCalls);
    assert.ok(calls.every(call=>call.input.project_id==='story-project'));
    assert.equal(calls[0].id,id,'Both UUID and display-ID routes reach the scoped detail endpoint');
   }
   assert.equal(await page.evaluate(()=>window.storyRoute),expected);
   await page.getByRole('button',{name:'Back to Story tiles',exact:true}).click();
   await page.waitForFunction(()=>window.storyRoute==='/sprints?keep=1');
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser?.close();await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);}
});
