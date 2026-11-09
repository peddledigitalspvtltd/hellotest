import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const {expect}=require('playwright/test');
const frontend=new URL('../../../platform/frontend/',import.meta.url);
const fixture=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import {DesignPage} from '/services/testing/frontend/pages/DesignPage';
import '/src/styles.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';
const session={token:'suite-identity-fixture',user:{id:'reader',name:'Reader',role:'admin'}};
sessionStorage.write(session);setCurrentScope('project','app');
for(const methods of Object.values(api))if(methods&&typeof methods==='object')for(const [key,value]of Object.entries(methods))if(typeof value==='function')methods[key]=async()=>[];
api.auth.session=async()=>session;
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.settings.getLocalization=async()=>({strings:{}});
api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
api.metadata.domain=async()=>({test_cases:{statuses:[{value:'active',label:'Active'}]}});
api.metadata.workspaceScopes=async()=>({projects:[{id:'project',name:'Project'}]});
api.projects.list=async()=>[{id:'project',name:'Project'}];
api.appTypes.list=async()=>[{id:'app',project_id:'project',name:'Web',type:'web'}];
const suite={id:'suite',display_id:'SUITE-41',app_type_id:'app',name:'OrangeHRM Login · 2026.11.1',test_case_ids:['auto','manual'],test_case_count:2,total_step_count:10,revision:1};
const cases=[{id:'auto',display_id:'AT-65',title:'Unbuilt login automation',automated:'yes',automation_status:'ready'},
 {id:'manual',display_id:'TC-65',title:'Manual login expectations',automated:'no'}].map(item=>({...item,app_type_id:'app',status:'active',suite_ids:['suite'],step_count:5,requirement_id:'story',requirement_ids:['story']}));
api.testSuites.list=async()=>[suite];
api.testCases.listPage=async()=>({items:cases,next_cursor:null,is_last:true});
api.requirements.list=async()=>[{id:'story',title:'Login story'}];
api.suiteTestCases.list=async()=>cases.map((item,index)=>({id:'mapping'+index,suite_id:'suite',test_case_id:item.id,sort_order:index+1}));
api.testSteps.list=async()=>cases.flatMap(item=>Array.from({length:5},(_,index)=>({id:item.id+'-'+index,test_case_id:item.id,step_order:index+1,step_type:'web',action:'Manual login instruction',expected_result:'Expected behavior',automation_code:null})));
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/design?suite=suite']}><AuthProvider><LocalizationProvider userId='reader'><DesignPage/></LocalizationProvider></AuthProvider></MemoryRouter></QueryClientProvider>);
`;

test('focused suite exposes its identity and an unbuilt automation case does not claim executable readiness',{timeout:90_000},async()=>{
  const name='suite-identity-'+randomUUID(),entry=new URL(name+'.tsx',frontend),doc=new URL(name+'.html',frontend);
  let browser;
  try{
    await writeFile(entry,fixture);
    await writeFile(doc,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.setDefaultTimeout(15_000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{errors.push('Unexpected live API call');return route.abort();});
    await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5197')+'/'+name+'.html');
    await expect(page.getByRole('heading',{level:1,name:'OrangeHRM Login · 2026.11.1',exact:true})).toBeVisible();
    await expect(page.locator('.page-header')).toContainText('SUITE-41');
    await page.getByRole('button',{name:'Expand Unassigned module',exact:true}).click();
    const card=page.locator('.suite-case-workspace-card').filter({hasText:'Unbuilt login automation'});
    await expect(card).toBeVisible();
    await expect(card.getByText('Case Type',{exact:true})).toBeVisible();
    await expect(card.getByText('Automation',{exact:true})).toBeVisible();
    await expect(card.getByText('No runs',{exact:true})).toBeVisible();
    await expect(card).toContainText('No run evidence yet. Build or review the saved instructions, then execute this case.');
    assert.equal(await card.getByText(/Automation readiness|100%|This case is healthy/).count(),0);
    assert.match(await card.locator('.tile-card-metric').getAttribute('title'),/classification only.*does not establish run readiness/);
    await page.screenshot({path:'/tmp/qaira-suite-identity-fixed.png',fullPage:true});
    for(const width of[1440,390]){
      await page.setViewportSize({width,height:1000});
      await expect(page.getByRole('heading',{level:1,name:'OrangeHRM Login · 2026.11.1',exact:true})).toBeVisible();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No document overflow at '+width);
    }
    await page.getByRole('button',{name:'Back to suite tiles',exact:true}).click();
    await expect(page.getByRole('heading',{level:1,name:'Test Suites',exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);
  }finally{
    await browser?.close();
    await Promise.allSettled([rm(entry,{force:true}),rm(doc,{force:true})]);
  }
});
