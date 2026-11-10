import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {expect as nativeExpect} from 'playwright/test';
import {createPlaywrightCodeBindings} from '../../dist/lib/playwrightBindings.js';

async function fixture(t,{assertionTimeout=1000}={}){
 const app=Fastify(),foreign=Fastify();let localInputs=0,foreignInputs=0;
 const form=stage=>`<!doctype html><title>${stage}</title><label>Name<input id="name" data-stage="${stage}" oninput="fetch('/write',{method:'POST'});document.querySelector('output').textContent='Onboard for '+this.value"></label><output></output>`;
 app.get('/shell',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Top shell</title><iframe id="work" src="/one" style="width:600px;height:300px"></iframe>'));
 app.get('/native-shell',async(_req,reply)=>reply.type('text/html').send('<!doctype html><section id="frame-container"><iframe id="noncoreIframe" src="/one" style="width:600px;height:300px"></iframe></section>'));
 app.get('/nested-shell',async(_req,reply)=>reply.type('text/html').send('<!doctype html><iframe id="outer" data-testid="outer-frame" src="/nested-parent" style="width:700px;height:400px"></iframe>'));
 app.get('/nested-parent',async(_req,reply)=>reply.type('text/html').send('<!doctype html><section id="nested-container"><iframe id="inner" src="/one" style="width:600px;height:300px"></iframe></section>'));
 app.get('/waiting-shell',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Loading shell</title><main></main>'));
 app.get('/slow-frame',async(_req,reply)=>{await new Promise(resolve=>setTimeout(resolve,150));return reply.type('text/html').send(form('delayed')+'<table><tr><th>Owner(s)</th><th>Is Template</th></tr></table><p>Rows per page</p>');});
 app.get('/one',async(_req,reply)=>reply.type('text/html').send(form('one')));
 app.get('/two',async(_req,reply)=>reply.type('text/html').send(form('two')));
 foreign.get('/foreign',async(_req,reply)=>reply.type('text/html').send(form('foreign')));
 foreign.get('/shell',async(_req,reply)=>reply.type('text/html').send('<!doctype html><iframe id="work" src="/foreign" style="width:600px;height:300px"></iframe>'));
 app.post('/write',async()=>{localInputs++;return{ok:true};});foreign.post('/write',async()=>{foreignInputs++;return{ok:true};});
 const base=await app.listen({host:'127.0.0.1',port:0}),other=await foreign.listen({host:'127.0.0.1',port:0});
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage();await page.goto(base+'/shell');
 t.after(async()=>{await browser.close();await Promise.all([app.close(),foreign.close()]);});
 const values={'r.value':'Bounded frame fixture','r.url':base+'/shell','r.first':'Alex','r.last':'River','r.template':'Onboard'};
 const bindings=createPlaywrightCodeBindings(page,{interpolate:value=>value.replace(/@r\.[a-z_]+/g,reference=>values[reference.slice(1)]??reference),resolveLocator:value=>value,resolveUrl:value=>value,assertionTimeout});
 return{page,bindings,base,other,local:()=>localInputs,foreign:()=>foreignInputs};
}

test('ordinary native Run keeps same-origin frame navigation and exact parent expectations while rejecting foreign or ambiguous owners before input',{timeout:30000},async t=>{
 const f=await fixture(t),target=f.bindings.page.frameLocator('#work').getByLabel('Name',{exact:true});
 await target.fill('@r.value');await f.bindings.expect(target).toHaveValue('@r.value');
 await nativeExpect.poll(f.local).toBe(1);
 await f.page.locator('#work').evaluate(element=>{element.src='/two';});
 await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','two');
 await target.fill('Second current document');await f.bindings.expect(target).toHaveValue('Second current document');
 await nativeExpect.poll(f.local).toBe(2);
 await f.bindings.expect(f.bindings.page).toHaveURL('@r.url');await f.bindings.expect(f.bindings.page).toHaveTitle('Top shell');
 await f.page.locator('#work').evaluate((element,url)=>{element.src=url;},f.other+'/foreign');
 await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','foreign');
 await assert.rejects(target.fill('must not enter foreign frame'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 await assert.rejects(f.bindings.expect(target).toBeVisible(),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.foreign(),0);assert.equal(await f.page.frameLocator('#work').locator('#name').inputValue(),'');
 await f.page.locator('#work').evaluate(element=>{element.src='/two';});
 await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','two');
 await f.page.locator('#work').evaluate(element=>{element.parentElement.appendChild(element.cloneNode(true));});
 await assert.rejects(target.fill('must not choose first owner'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.local(),2);assert.equal(f.foreign(),0);
 await f.page.goto(f.other+'/shell');
 await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','foreign');
 await assert.rejects(target.fill('must not adopt a redirected parent origin'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.foreign(),0);
});

test('same-parent owner replacement invalidates a held locator instead of retargeting its input',{timeout:30000},async t=>{
 const f=await fixture(t),target=f.bindings.page.frameLocator('#work').getByLabel('Name',{exact:true});
 assert.equal(await target.inputValue(),'');
 await f.page.locator('#work').evaluate(element=>{const replacement=element.cloneNode(true);replacement.src='/two';element.replaceWith(replacement);});
 await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','two');
 await assert.rejects(target.fill('must not enter replacement'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.local(),0);assert.equal(await f.page.frameLocator('#work').locator('#name').inputValue(),'');
});

test('replacement after guard validation cannot race a pinned input into a foreign document or trigger replay',{timeout:30000},async t=>{
 const f=await fixture(t),target=f.bindings.page.frameLocator('#work').getByLabel('Name',{exact:true});
 assert.equal(await target.inputValue(),'');
 const probe=await f.page.frameLocator('#work').locator('#name').elementHandle(),prototype=Object.getPrototypeOf(probe),original=prototype.fill;await probe.dispose();
 let dispatches=0;
 prototype.fill=async function(value,options){
  dispatches++;
  await f.page.locator('#work').evaluate((element,url)=>{element.src=url;},f.other+'/foreign');
  await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','foreign');
  return original.call(this,value,{...options,timeout:500});
 };
 try{await assert.rejects(target.fill('must remain on pinned node'));}finally{prototype.fill=original;}
 assert.equal(dispatches,1,'an uncertain input acknowledgement is never replayed');
 assert.equal(f.local(),0);assert.equal(f.foreign(),0);assert.equal(await f.page.frameLocator('#work').locator('#name').inputValue(),'');
});

test('official Locator.contentFrame chains keep fullname/template bindings and reject foreign or ambiguous owners before input',{timeout:30000},async t=>{
 const f=await fixture(t);await f.page.goto(f.base+'/native-shell');
 const frame=f.bindings.page.locator('#frame-container').locator('#noncoreIframe').contentFrame();
 const target=frame.getByRole('textbox',{name:'Name',exact:true});
 await target.fill('@r.first @r.last');await f.bindings.expect(target).toHaveValue('@r.first @r.last');
 await f.bindings.expect(frame.getByText('@r.template for @r.first @r.last',{exact:true})).toBeVisible();
 await nativeExpect.poll(f.local).toBe(1);
 await f.page.locator('#noncoreIframe').evaluate((element,url)=>{element.src=url;},f.other+'/foreign');
 await nativeExpect(f.page.locator('#noncoreIframe').contentFrame().locator('#name')).toHaveAttribute('data-stage','foreign');
 await assert.rejects(target.fill('must not enter foreign frame'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 await assert.rejects(f.bindings.expect(target).toBeVisible(),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.foreign(),0);assert.equal(await f.page.locator('#noncoreIframe').contentFrame().locator('#name').inputValue(),'');
 await f.page.locator('#noncoreIframe').evaluate(element=>{element.src='/two';});
 await nativeExpect(f.page.locator('#noncoreIframe').contentFrame().locator('#name')).toHaveAttribute('data-stage','two');
 await f.page.locator('#noncoreIframe').evaluate(element=>{element.parentElement.appendChild(element.cloneNode(true));});
 await assert.rejects(target.fill('must not select an ambiguous owner'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.local(),1);assert.equal(f.foreign(),0);
});

test('nested native contentFrame and mixed frameLocator chains enforce the origin of every owner',{timeout:30000},async t=>{
 const f=await fixture(t);await f.page.goto(f.base+'/nested-shell');
 const target=f.bindings.page.getByTestId('outer-frame').contentFrame().locator('#nested-container').locator('#inner').contentFrame().getByLabel('Name',{exact:true});
 await target.fill('@r.value');await f.bindings.expect(target).toHaveValue('@r.value');
 const mixed=f.bindings.page.frameLocator('#outer').locator('#nested-container').locator('#inner').contentFrame().getByLabel('Name',{exact:true});
 await f.bindings.expect(mixed).toHaveValue('@r.value');
 await nativeExpect.poll(f.local).toBe(1);
 await f.page.frameLocator('#outer').locator('#inner').evaluate((element,url)=>{element.src=url;},f.other+'/foreign');
 await nativeExpect(f.page.frameLocator('#outer').locator('#inner').contentFrame().locator('#name')).toHaveAttribute('data-stage','foreign');
 await assert.rejects(target.fill('must not enter nested foreign document'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 await assert.rejects(mixed.inputValue(),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.foreign(),0);assert.equal(f.local(),1);
});

test('held contentFrame locators cannot adopt a replacement owner in the same parent document',{timeout:30000},async t=>{
 const f=await fixture(t),target=f.bindings.page.locator('#work').contentFrame().getByLabel('Name',{exact:true});
 assert.equal(await target.inputValue(),'');
 await f.page.locator('#work').evaluate(element=>{const replacement=element.cloneNode(true);replacement.src='/two';element.replaceWith(replacement);});
 await nativeExpect(f.page.locator('#work').contentFrame().locator('#name')).toHaveAttribute('data-stage','two');
 await assert.rejects(target.fill('must not enter replacement'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.equal(f.local(),0);assert.equal(f.foreign(),0);assert.equal(await f.page.locator('#work').contentFrame().locator('#name').inputValue(),'');
});

test('the first native iframe assertion waits for delayed attachment, visibility and an initial same-origin document commit',{timeout:30000},async t=>{
 const f=await fixture(t,{assertionTimeout:2000});await f.page.goto(f.base+'/waiting-shell');
 await f.page.evaluate(()=>{setTimeout(()=>{
  const frame=document.createElement('iframe');frame.id='noncoreIframe';frame.style.cssText='display:none;width:600px;height:300px';document.querySelector('main').appendChild(frame);
  setTimeout(()=>{frame.src='/slow-frame';},100);setTimeout(()=>{frame.style.display='block';},250);
 },75);});
 const frame=f.bindings.page.locator('#noncoreIframe').contentFrame();
 await f.bindings.expect(frame.getByRole('columnheader',{name:'Owner(s)',exact:true})).toBeVisible();
 await f.bindings.expect(frame.getByRole('columnheader',{name:'Is Template',exact:true})).toBeVisible();
 await f.bindings.expect(frame.getByText('Rows per page',{exact:true})).toBeVisible();
 assert.equal(f.local(),0,'readiness and assertions do not replay any input');
 await frame.getByLabel('Name',{exact:true}).fill('@r.value');await nativeExpect.poll(f.local).toBe(1);
});

test('initial frame visibility receives the configured assertion allowance beyond eight seconds',{timeout:30000},async t=>{
 const f=await fixture(t,{assertionTimeout:11000});await f.page.goto(f.base+'/waiting-shell');
 await f.page.evaluate(()=>{
  const frame=document.createElement('iframe');frame.id='noncoreIframe';frame.src='/one';frame.style.cssText='display:none;width:600px;height:300px';document.querySelector('main').appendChild(frame);
  setTimeout(()=>{frame.style.display='block';},8250);
 });
 const started=Date.now();await f.bindings.expect(f.bindings.page.locator('#noncoreIframe').contentFrame().getByLabel('Name',{exact:true})).toBeVisible();
 assert.ok(Date.now()-started>=8000);assert.equal(f.local(),0);
});

test('a first framed operation rejects loaded foreign and sandbox-opaque documents without spending the readiness budget',{timeout:30000},async t=>{
 for(const opaque of [false,true]){
  const f=await fixture(t,{assertionTimeout:11000});await f.page.goto(f.base+'/waiting-shell');
  await f.page.evaluate(({src,opaque})=>{
   const frame=document.createElement('iframe');frame.id='noncoreIframe';frame.src=src;frame.style.cssText='display:none;width:600px;height:300px';if(opaque)frame.setAttribute('sandbox','allow-scripts');document.querySelector('main').appendChild(frame);
  },{src:opaque?f.base+'/one':f.other+'/foreign',opaque});
  await nativeExpect(f.page.locator('#noncoreIframe').contentFrame().locator('#name')).toHaveAttribute('data-stage',opaque?'one':'foreign');
  const started=Date.now();await assert.rejects(f.bindings.page.locator('#noncoreIframe').contentFrame().getByLabel('Name',{exact:true}).fill('must not be entered'),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
  assert.ok(Date.now()-started<1000,'a loaded disallowed origin is rejected immediately, rather than waited into authorization');
  assert.equal(f.local(),0);assert.equal(f.foreign(),0);
 }
});

test('frame readiness and the native assertion consume one configured budget',{timeout:30000},async t=>{
 const f=await fixture(t,{assertionTimeout:1000});await f.page.goto(f.base+'/waiting-shell');
 await f.page.evaluate(()=>{
  const frame=document.createElement('iframe');frame.id='noncoreIframe';frame.src='/one';frame.style.cssText='display:none;width:600px;height:300px';document.querySelector('main').appendChild(frame);
  setTimeout(()=>{frame.style.display='block';},600);
 });
 const started=Date.now();await assert.rejects(f.bindings.expect(f.bindings.page.locator('#noncoreIframe').contentFrame().getByText('Never appears',{exact:true})).toBeVisible());
 assert.ok(Date.now()-started<1400,'the matcher does not restart its whole timeout after readiness');assert.equal(f.local(),0);
});

test('an explicit native assertion timeout also bounds its initial frame readiness',{timeout:30000},async t=>{
 const f=await fixture(t,{assertionTimeout:2000});await f.page.goto(f.base+'/waiting-shell');
 await f.page.evaluate(()=>{
  const frame=document.createElement('iframe');frame.id='noncoreIframe';frame.src='/one';frame.style.cssText='display:none;width:600px;height:300px';document.querySelector('main').appendChild(frame);
  setTimeout(()=>{frame.style.display='block';},900);
 });
 const started=Date.now();await assert.rejects(f.bindings.expect(f.bindings.page.locator('#noncoreIframe').contentFrame().getByLabel('Name',{exact:true})).toBeVisible({timeout:300}),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 assert.ok(Date.now()-started<650);assert.equal(f.local(),0);
});

test('a framed native assertion retains its real failure after consuming the default budget',{timeout:10000},async t=>{
 const f=await fixture(t,{assertionTimeout:300});
 const target=f.bindings.page.frameLocator('#work').getByText('Rows per page',{exact:true});
 const started=Date.now();
 await assert.rejects(f.bindings.expect(target).toBeVisible(),error=>{
  assert.notEqual(error.code,'AUTOMATION_FRAME_SCOPE_INVALID');
  assert.match(error.message,/toBeVisible|to\.be\.visible/);
  assert.match(error.message,/element\(s\) not found|Rows per page/);
  assert.doesNotMatch(error.message,/locator\.evaluate|Timeout 1ms/);
  return true;
 });
 assert.ok(Date.now()-started<900,'scope verification checks identity once without restarting the assertion');
 assert.equal(f.local(),0);assert.equal(f.foreign(),0);
});

test('a positive authored assertion timeout extends delayed frame readiness beyond the default',{timeout:10000},async t=>{
 const f=await fixture(t,{assertionTimeout:250});await f.page.goto(f.base+'/waiting-shell');
 await f.page.evaluate(()=>{
  const frame=document.createElement('iframe');frame.id='noncoreIframe';frame.src='/one';frame.style.cssText='display:none;width:600px;height:300px';document.querySelector('main').appendChild(frame);
  setTimeout(()=>{frame.style.display='block';},500);
 });
 const started=Date.now();
 await f.bindings.expect(f.bindings.page.locator('#noncoreIframe').contentFrame().getByLabel('Name',{exact:true})).toBeVisible({timeout:1200});
 assert.ok(Date.now()-started>=450);assert.equal(f.local(),0);
});

test('frame scope verification survives a delayed assertion reply and preserves its original error',{timeout:10000},async t=>{
 const f=await fixture(t,{assertionTimeout:300}),target=f.bindings.page.frameLocator('#work').getByLabel('Name',{exact:true});
 const original=new Error('Original framed assertion failure');let checks=0;
 const expect=f.bindings.expect.extend({async toHaveDelayedFrameReply(actual,fail){
  await nativeExpect(actual).toBeVisible();checks++;
  // The condition is observed before its deadline; protocol/model extension
  // delivery can finish later. Scope checking has a separate bounded allowance.
  await new Promise(resolve=>setTimeout(resolve,350));
  if(fail)throw original;
  return{pass:true,message:()=> 'The observed input remains visible'};
 }});
 await expect(target).toHaveDelayedFrameReply(false);
 await assert.rejects(expect(target).toHaveDelayedFrameReply(true),error=>error===original);
 assert.equal(checks,2);assert.equal(f.local(),0);assert.equal(f.foreign(),0);
});

test('post-assertion scope checks reject owner replacement, foreign documents and ambiguous owners',{timeout:20000},async t=>{
 const f=await fixture(t),target=f.bindings.page.locator('#work').contentFrame().getByLabel('Name',{exact:true});
 const expect=f.bindings.expect.extend({async toCheckThenChangeFrame(actual,change){
  await nativeExpect(actual).toBeVisible();await change();
  return{pass:true,message:()=> 'The input was visible before the frame changed'};
 }});
 const changes=[
  async()=>{await f.page.locator('#work').evaluate(element=>{const next=element.cloneNode(true);next.src='/two';element.replaceWith(next);});await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','two');},
  async()=>{await f.page.locator('#work').evaluate((element,url)=>{element.src=url;},f.other+'/foreign');await nativeExpect(f.page.frameLocator('#work').locator('#name')).toHaveAttribute('data-stage','foreign');},
  async()=>{await f.page.locator('#work').evaluate(element=>element.parentElement.appendChild(element.cloneNode(true)));}
 ];
 for(const change of changes){
  await f.page.goto(f.base+'/shell');
  await assert.rejects(expect(target).toCheckThenChangeFrame(change),{code:'AUTOMATION_FRAME_SCOPE_INVALID'});
 }
 assert.equal(f.local(),0);assert.equal(f.foreign(),0);
});
