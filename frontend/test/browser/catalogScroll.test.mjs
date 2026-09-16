// Pagination lifecycle against the real shared component, with controlled requests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HierarchyLoadMoreButton} from '/src/components/HierarchyLoadMoreButton';
import '/src/styles.css';
function Catalog() {
  const [count,setCount]=useState(25),[fetching,setFetching]=useState(false),[revision,setRevision]=useState(0);
  const nextPage=()=>{window.requests=(window.requests||0)+1;setFetching(true);return new Promise(resolve=>{
    window.finishPage=()=>{setCount(value=>value+25);setFetching(false);resolve({isError:false})};
    window.failPage=()=>{setFetching(false);resolve({isError:true})};
  })};
  return <main style={{padding:20}}><button onClick={()=>setRevision(value=>value+1)}>Update toolbar {revision}</button>
    <section aria-label="Records" style={{height:320,width:'min(600px,90vw)',overflow:'auto',border:'1px solid #ccc',marginTop:20}}>
      <div style={{overflowY:'auto'}}>
      <ol style={{margin:0,padding:0}}>{Array.from({length:count},(_,index)=><li key={index} style={{height:40,boxSizing:'border-box',padding:8,listStyle:'none'}}>Record {index+1}</li>)}</ol>
      {count<75&&<HierarchyLoadMoreButton isLoading={fetching} onLoad={nextPage} loaded={count} scopeLabel="records" />}
      </div>
    </section>
  </main>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Catalog/></React.StrictMode>);
`;

const scopeFixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HierarchyAutoLoadSentinel} from '/src/components/HierarchyLoadMoreButton';
import '/src/styles.css';
window.requests=[];window.pending={};
function Catalog() {
  const [scope,setScope]=useState('first'),[revision,setRevision]=useState(0);
  const load=()=>{window.requests.push(scope);return new Promise((resolve,reject)=>{window.pending[scope]={resolve,reject}})};
  return <main><button onClick={()=>setScope('second')}>Switch scope</button><button onClick={()=>setRevision(value=>value+1)}>Rerender {revision}</button>
    <div>Scope {scope}</div><HierarchyAutoLoadSentinel isLoading={false} onLoad={load} progressKey={scope} scopeLabel="records" />
  </main>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Catalog/></React.StrictMode>);
`;

test('catalog scroll appends pages without blocking or draining, and pauses for retry after errors', {timeout:30000}, async()=>{
  const name='catalog-scroll-'+randomUUID();
  const html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
  let browser;
  try {
    await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx,fixture);
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const page=await browser.newPage({viewport:{width:1000,height:800}});
    page.setDefaultTimeout(5000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html`);
    await page.getByText('Record 25',{exact:true}).waitFor();
    const records=page.getByRole('region',{name:'Records',exact:true});
    assert.equal(await records.locator('li').count(),25);
    assert.equal(await page.getByRole('button',{name:/load more/i}).count(),0);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.requests||0),0,'Do not fetch pages until the scroll boundary is near');
    await records.evaluate(node=>node.scrollTop=600);
    await page.getByRole('status').filter({hasText:'Loading more records'}).waitFor();
    assert.equal(await page.evaluate(()=>window.requests),1);
    for(let i=0;i<3;i++)await page.getByRole('button',{name:/Update toolbar/}).click();
    assert.equal(await page.evaluate(()=>window.requests),1,'Rerenders cannot overlap the same page request');
    assert.equal(await records.locator('li').count(),25,'Existing rows stay mounted while fetching');
    assert.equal(await page.locator('.screen-loading-overlay').count(),0,'Pagination never displays a screen-centered loader');
    await page.evaluate(()=>window.failPage());
    await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>window.requests),1,'Failed pages do not automatically retry forever');
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.waitForFunction(()=>window.requests===2);
    const beforeAppend = await records.evaluate(node=>node.scrollTop);
    await page.evaluate(()=>window.finishPage());
    await page.getByText('Record 50',{exact:true}).waitFor();
    assert.equal(await records.locator('li').count(),50);
    assert.ok(Math.abs(await records.evaluate(node=>node.scrollTop)-beforeAppend)<=2,'Appending records preserves scroll position');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.requests),2,'The next offscreen page waits for scrolling');
    await records.evaluate(node=>node.scrollTop=1600);
    await page.waitForFunction(()=>window.requests===3);
    await page.evaluate(()=>window.finishPage());
    await page.getByText('Record 75',{exact:true}).waitFor();
    assert.equal(await records.locator('li').count(),75);
    assert.equal(await page.locator('.hierarchy-auto-load-sentinel').count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});

test('a pending request from the previous scope cannot block or fail the current scroll request', {timeout:15000}, async()=>{
  const name='catalog-scope-'+randomUUID();
  const html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
  let browser;
  try {
    await writeFile(html,`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx,scopeFixture);
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const page=await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html`);
    await page.waitForFunction(()=>window.requests?.length===1);
    await page.getByRole('button',{name:'Switch scope'}).click();
    await page.waitForFunction(()=>window.requests.length===2);
    assert.deepEqual(await page.evaluate(()=>window.requests),['first','second']);
    await page.evaluate(()=>window.pending.first.reject(new Error('Old scope failed')));
    await page.getByRole('button',{name:/Rerender/}).click();
    await page.waitForTimeout(150);
    assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),0,'A late failure must not affect the new scope');
    assert.equal(await page.evaluate(()=>window.requests.length),2,'The old request must not release the current request lock');
    await page.evaluate(()=>window.pending.second.reject(new Error('Current scope failed')));
    await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.waitForFunction(()=>window.requests.length===3);
    assert.deepEqual(await page.evaluate(()=>window.requests),['first','second','second']);
  } finally {await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
