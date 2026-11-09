import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {createPlaywrightCodeBindings} from '../../dist/lib/playwrightBindings.js';
import {registerAutomationPlaywrightMcp,PLAYWRIGHT_MCP_ENDPOINT} from '../../dist/lib/automationPlaywrightMcp.js';

const items=['10','25','50'];
const yaml='- list:\n'+items.map(item=>'  - listitem: '+JSON.stringify(item)).join('\n');
async function fixture(t) {
 const server=http.createServer((request,response)=>{
  response.setHeader('content-type','text/html');
  response.end(request.url==='/frame'
   ? '<!doctype html><title>Jobs frame</title><ul aria-label="Rows per page"><li>10</li><li>25</li><li>50</li></ul>'
   : '<!doctype html><title>Outer workspace</title><h1>Outer workspace</h1><iframe id="jobs" title="Jobs" src="/frame"></iframe>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return 'http://127.0.0.1:'+server.address().port+'/';
}
const bindings=page=>createPlaywrightCodeBindings(page,{parameterExpressions:true,interpolate:value=>value,resolveLocator:value=>value,resolveUrl:value=>value,assertionTimeout:300});

test('inline ARIA assertions require Playwright Test even for a correctly scoped same-origin iframe',{timeout:15000},async t=>{
 const url=await fixture(t),browser=await chromium.launch({headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto(url);
 await page.frameLocator('#jobs').getByRole('list',{name:'Rows per page'}).waitFor();
 const runtime=bindings(page);
 for(const locator of [runtime.page.locator('body'),runtime.page.frameLocator('#jobs').locator('body'),runtime.page.locator('#jobs').contentFrame().locator('body')])
  await assert.rejects(runtime.expect(locator).toMatchAriaSnapshot(yaml,{timeout:200}),/must be called during the test/);
 await runtime.expect(runtime.page.frameLocator('#jobs').getByRole('listitem')).toHaveText(items,{timeout:500});
 await runtime.expect(runtime.page.frameLocator('#jobs').getByRole('listitem')).toHaveCount(items.length,{timeout:500});
 const outer=await page.locator('body').ariaSnapshot();
 assert.match(outer,/iframe/);assert.doesNotMatch(outer,/listitem/);
});

test('pinned upstream list verification reads the iframe target but emits an unscoped body ARIA assertion',{timeout:30000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const url=await fixture(t),require=createRequire(import.meta.url);
 const upstream=createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
 const app=Fastify();
 await registerAutomationPlaywrightMcp(app,async()=>{},{launchBrowser:options=>upstream.chromium.launch({...options,executablePath:chromium.executablePath()})});
 t.after(()=>app.close());
 let session,id=0;
 const rpc=async(method,params)=>{
  const response=await app.inject({method:'POST',url:PLAYWRIGHT_MCP_ENDPOINT,headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:++id,method,params}});
  session ||= response.headers['mcp-session-id'];
  const packet=response.json();assert.equal(packet.error,undefined,JSON.stringify(packet.error));return packet.result;
 };
 await rpc('initialize',{protocolVersion:'2025-03-26',clientInfo:{name:'aria-scope-fixture',version:'1'},capabilities:{},_meta:{hellotest:{start_url:url}}});
 const call=async(name,args={})=>{
  const result=await rpc('tools/call',{name,arguments:args});
  assert.notEqual(result.isError,true,JSON.stringify(result));
  return result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n');
 };
 await call('browser_navigate',{url});
 const snapshot=await call('browser_snapshot');
 const target=snapshot.match(/list "Rows per page" \[ref=([^\]]+)\]/)?.[1];
 assert.ok(target,snapshot);
 const result=await call('browser_verify_list_visible',{element:'Rows per page options inside Jobs iframe',target,items});
 assert.match(result,/Done/);
 const code=result.match(/### Ran Playwright code\s+```(?:js|javascript)\s*([\s\S]*?)```/)?.[1];
 assert.ok(code,result);
 assert.match(code,/page\.locator\(['"]body['"]\)\)\.toMatchAriaSnapshot/);
 assert.doesNotMatch(code,/frameLocator|contentFrame/);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto(url);
 await page.frameLocator('#jobs').getByRole('list',{name:'Rows per page'}).waitFor();
 const runtime=bindings(page),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await assert.rejects(new AsyncFunction('page','expect',code)(runtime.page,runtime.expect),/must be called during the test/);
 await runtime.expect(runtime.page.frameLocator('#jobs').getByRole('listitem')).toHaveText(items,{timeout:500});
});

test('inside actual Playwright Test an outer body cannot match iframe list YAML while the proper frame scope passes',{timeout:20000},async t=>{
 const url=await fixture(t),directory=await mkdtemp(path.join(tmpdir(),'qaira-aria-scope-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const require=createRequire(import.meta.url),playwrightRoot=path.dirname(require.resolve('playwright/package.json'));
 const config=path.join(directory,'playwright.config.cjs');
 await writeFile(config,'module.exports='+JSON.stringify({testDir:directory,testMatch:'scope.spec.cjs',outputDir:path.join(directory,'results'),workers:1,retries:0,reporter:'json',timeout:10000,use:{headless:true,launchOptions:{executablePath:chromium.executablePath()}}})+';');
 const spec=`const {test}=require(${JSON.stringify(path.join(playwrightRoot,'test.js'))});\n`+
  `test('real ARIA frame scope',async({page})=>{\n`+
  `const {createPlaywrightCodeBindings}=await import(${JSON.stringify(new URL('../../dist/lib/playwrightBindings.js',import.meta.url).href)});\n`+
  `await page.goto(${JSON.stringify(url)});\n`+
  `await page.frameLocator('#jobs').getByRole('listitem').first().waitFor();\n`+
  `const {page:bound,expect}=createPlaywrightCodeBindings(page,{parameterExpressions:true,interpolate:v=>v,resolveLocator:v=>v,resolveUrl:v=>v,assertionTimeout:500});\n`+
  `await expect(bound.locator('body')).not.toMatchAriaSnapshot(${JSON.stringify(yaml)},{timeout:200});\n`+
  `await expect(bound.frameLocator('#jobs').locator('body')).toMatchAriaSnapshot(${JSON.stringify(yaml)},{timeout:500});\n`+
  `await expect(bound.locator('#jobs').contentFrame().locator('body')).toMatchAriaSnapshot(${JSON.stringify(yaml)},{timeout:500});\n`+
  `});\n`;
 await writeFile(path.join(directory,'scope.spec.cjs'),spec);
 const environment={CI:'1',NODE_ENV:'test'};
 for(const key of ['PATH','HOME','USERPROFILE','SYSTEMROOT','WINDIR','TMPDIR','TEMP','TMP','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH'])if(process.env[key]!==undefined)environment[key]=process.env[key];
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(playwrightRoot,'cli.js'),'test','--config',config],{cwd:directory,env:environment,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
 });
 assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.stats.expected,1);assert.equal(report.stats.unexpected,0);
});
