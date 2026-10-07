import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
const require=createRequire(new URL('../../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../',import.meta.url);
const fixture=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {AuthProvider,useAuth} from '/src/auth/AuthContext';import {SessionQueryBoundary} from '/src/auth/SessionQueryBoundary';import {api,sessionStorage} from '/src/lib/api';
window.makeSession=id=>({token:'fixture-'+id,user:{id,role:'admin',name:id}});
sessionStorage.write(window.makeSession('A'));api.auth.session=async()=>sessionStorage.read();api.auth.login=async()=>window.makeSession('B');api.opsTelemetry.endGrafanaSession=async()=>({});
window.pending=[];window.renders=[];window.client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
function Probe(){const auth=useAuth();const query=useQuery({queryKey:['private-data'],queryFn:()=>new Promise(resolve=>window.pending.push({resolve})),enabled:Boolean(auth.session)});
if(auth.session&&query.data)window.renders.push(auth.session.user.id+':'+query.data.owner);
return <main><span data-testid="identity">{auth.session?.user.id||'signed-out'}</span><span data-testid="owner">{query.data?.owner||'loading'}</span><button onClick={()=>query.refetch()}>Reload</button><button onClick={()=>auth.login({email:'B',password:'fixture'})}>Switch account</button><button onClick={auth.logout}>Log out</button></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={window.client}><AuthProvider><SessionQueryBoundary><Probe/></SessionQueryBoundary></AuthProvider></QueryClientProvider>);
`;
test('account transitions cannot render or restore previous user query data',{timeout:60000},async()=>{
 const name='session-isolation-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(tsx,fixture);await writeFile(html,`<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});const page=await browser.newPage();page.setDefaultTimeout(12000);
  await page.goto((process.env.VITE_TEST_URL||'http://localhost:5179')+'/'+name+'.html');await page.waitForFunction(()=>window.pending.length===1);await page.evaluate(()=>window.pending[0].resolve({owner:'A'}));await page.getByTestId('owner').filter({hasText:'A'}).waitFor();
  await page.getByRole('button',{name:'Reload',exact:true}).click();await page.waitForFunction(()=>window.pending.length===2);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.waitForFunction(()=>window.pending.length===3);await page.evaluate(()=>window.pending[2].resolve({owner:'B'}));await page.getByTestId('owner').filter({hasText:'B'}).waitFor();
  await page.evaluate(()=>window.pending[1].resolve({owner:'A'}));await page.waitForTimeout(50);
  assert.equal(await page.getByTestId('owner').textContent(),'B');assert.equal(await page.evaluate(()=>window.renders.includes('B:A')),false);
  await page.getByRole('button',{name:'Log out',exact:true}).click();await page.getByTestId('identity').filter({hasText:'signed-out'}).waitFor();assert.equal(await page.evaluate(()=>window.client.getQueryData(['private-data'])),undefined);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
