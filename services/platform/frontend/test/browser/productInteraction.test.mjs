import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const fixture = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';
import {FormField} from '/src/shared/components/FormField';
import {PageHeader} from '/src/shared/components/PageHeader';
import {CatalogActionMenu} from '/src/shared/components/CatalogActionMenu';
import {useDialogFocus} from '/src/shared/hooks/useDialogFocus';
import {api,sessionStorage} from '/src/lib/api';
import '/src/styles.css'; import '/src/dark-theme.css'; import '/src/modal-system.css'; import '/src/product-experience.css';
const session={token:'interaction-fixture',user:{id:'reviewer',role:'admin',name:'Reviewer',email:'reviewer@example.test'}};
sessionStorage.write(session);api.auth.session=async()=>session;api.featureFlags.snapshot=async()=>({flags:{}});
window.selectedActions=[];
const actions=[{label:'Edit',icon:<span aria-hidden>↗</span>,description:'Update the selected record',onClick:()=>window.selectedActions.push('edit')},{label:'Unavailable',icon:null,disabled:true,onClick:()=>window.selectedActions.push('unexpected')},{label:'Duplicate',icon:null,onClick:()=>window.selectedActions.push('duplicate')},{label:'Delete',icon:null,tone:'danger',onClick:()=>window.selectedActions.push('delete')}];
function Modal({close}){const ref=useDialogFocus({onClose:close});return <div className="modal-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label="Edit record" tabIndex={-1} className="modal-card" style={{width:500,padding:24}}><h2>Edit record</h2><FormField label="Record title" required><input id="authored-title" defaultValue="Checkout coverage"/></FormField><CatalogActionMenu label="Record actions" actions={actions}/><button onClick={close}>Close record</button></section></div>}
function App(){const [open,setOpen]=useState(false);return <main style={{padding:24}}><PageHeader title="Test cases" eyebrow="Design" description="Build reliable coverage for each customer journey."/><FormField label="Project name" hint="Choose a meaningful name"><input id="explicit-project"/></FormField><CatalogActionMenu label="Catalog actions" actions={actions}/><button onClick={()=>setOpen(true)}>Open record</button>{open&&<Modal close={()=>setOpen(false)}/>}</main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><AuthProvider><App/></AuthProvider></QueryClientProvider>);
`;
test('shared product controls preserve label, keyboard, portal and mobile behavior',{timeout:90000},async()=>{
 const name=`interaction-${randomUUID()}`,html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
 await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5179'}/${name}.html`);
 await page.getByText('Project name',{exact:true}).click();assert.equal(await page.getByLabel('Project name').evaluate(e=>e===document.activeElement),true);
 await page.getByRole('button',{name:'About this page'}).click();await page.getByRole('tooltip').getByText('Build reliable coverage for each customer journey.').waitFor();await page.keyboard.press('Escape');
 const trigger=page.getByRole('button',{name:'Catalog actions'});await trigger.focus();await page.keyboard.press('ArrowDown');assert.equal(await page.getByRole('menuitem',{name:'Edit Update the selected record'}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('ArrowDown');assert.equal(await page.getByRole('menuitem',{name:'Duplicate',exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('End');await page.keyboard.press('Home');await page.keyboard.press('d');assert.equal(await page.getByRole('menuitem',{name:'Duplicate',exact:true}).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.selectedActions),['duplicate']);assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
 await page.getByRole('button',{name:'Open record'}).click();await page.getByRole('dialog').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='authored-title');await page.getByRole('button',{name:'Record actions'}).focus();await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitem'&&document.activeElement?.textContent==='Delete');assert.equal(await page.getByRole('menuitem',{name:'Delete',exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.getByRole('menu').count(),0);assert.equal(await page.getByRole('button',{name:'Record actions'}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByRole('button',{name:'Open record'}).evaluate(e=>e===document.activeElement),true);
 await mkdir('/tmp/qaira-product-interaction',{recursive:true});
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open record'}).click();await page.getByRole('button',{name:'Record actions'}).click();const b=await page.getByRole('menu').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=391);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:`/tmp/qaira-product-interaction/modal-${theme}-390.png`});await page.keyboard.press('Escape');await page.keyboard.press('Escape');}
 assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
