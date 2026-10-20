import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {createRequire} from 'node:module';
import {createInspectionProxy} from '../../dist/lib/inspectionProxy.js';import {chromium} from 'playwright';

test('exact local origin mapping reaches its configured endpoint while keeping browser URLs and Host headers portable',{timeout:30000},async t=>{
 const previous=process.env.RECORDER_TARGET_ORIGIN_ALIASES,requests=[];
 const server=http.createServer((req,res)=>{requests.push({url:req.url,host:req.headers.host});res.setHeader('content-type','text/html');res.end('<!doctype html><title>Local routed application</title><label>Name<input id="name"></label>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 process.env.RECORDER_TARGET_ORIGIN_ALIASES=JSON.stringify({'http://localhost:8080':`http://127.0.0.1:${server.address().port}`});
 const proxy=await createInspectionProxy();let browser;
 t.after(async()=>{await browser?.close();await proxy.close();await new Promise(resolve=>server.close(resolve));if(previous===undefined)delete process.env.RECORDER_TARGET_ORIGIN_ALIASES;else process.env.RECORDER_TARGET_ORIGIN_ALIASES=previous;});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),proxy:{server:proxy.server,bypass:'<-loopback>'}});
 const page=await browser.newPage();await page.goto('http://localhost:8080/auth');assert.equal(await page.title(),'Local routed application');assert.equal(page.url(),'http://localhost:8080/auth');assert.ok(requests.some(row=>row.url==='/auth'&&row.host==='localhost:8080'));
 await page.locator('#name').fill('Local fixture');assert.equal(await page.locator('#name').inputValue(),'Local fixture');
 const denied=await page.goto('http://localhost:8081/auth');assert.equal(denied.status(),403);assert.ok(requests.every(row=>row.host==='localhost:8080'));
});
