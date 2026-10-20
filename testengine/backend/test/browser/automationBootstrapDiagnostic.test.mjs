import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../dist/lib/testEngineSecurity.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent');

test('local MCP bootstrap retains safe launch, navigation and snapshot diagnostics without actor or field actions',{timeout:90000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const started=Date.now(),marks=[],tools=[];let requests=0,session,failure;
 const mark=stage=>marks.push({stage,elapsed_ms:Date.now()-started});
 const safeError=error=>({name:error?.name,code:error?.code,statusCode:error?.statusCode,message:String(error?.message||'').slice(0,1200),
  ...(error?.cause?{cause:{name:error.cause.name,code:error.cause.code,message:String(error.cause.message||'').slice(0,1200)}}:{})});
 const app=Fastify();t.after(()=>app.close());
 app.get('/form',async(_request,reply)=>{requests++;return reply.type('text/html').send('<!doctype html><title>Local bootstrap</title><h1>Local bootstrap</h1><label>Name<input data-testid="diagnostic-name"></label>');});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()),{launchBrowser:async options=>{
  mark('chrome_launch_started');try{const browser=await chromium.launch(options);mark('chrome_launch_completed');browser.on('disconnected',()=>mark('chrome_disconnected'));return browser;}
  catch(error){marks.push({stage:'chrome_launch_failed',elapsed_ms:Date.now()-started,error:safeError(error)});throw error;}
 }});
 const origin=await app.listen({host:'127.0.0.1',port:0});
 try{
  session=await connectAutomationBrowser({integration:{base_url:origin},startUrl:`${origin}/form`,allowBrowserActions:true});mark('mcp_initialized');
  for(const [tool,args] of [['browser_navigate',{url:`${origin}/form`}],['browser_snapshot',{}]]){
   mark(tool+'_requested');
   try{
    const result=await session.call(tool,args);let receipt={};try{receipt=JSON.parse(result.content?.find(part=>part.type==='text')?.text||'{}');}catch{}
    tools.push({tool,isError:result.isError===true,receipt:Object.fromEntries(['source','code','message','action_outcome','assertion_outcome','retry_safe','launch_phase','url','title']
     .filter(key=>typeof receipt[key]==='string'||typeof receipt[key]==='boolean').map(key=>[key,typeof receipt[key]==='string'?receipt[key].slice(0,1200):receipt[key]]))});
    mark(tool+'_returned');if(result.isError)break;
   }catch(error){failure=safeError(error);mark(tool+'_client_error');break;}
  }
 }catch(error){failure=safeError(error);mark('initialization_client_error');}
 finally{
  await session?.close();mark('session_closed');
  const report={origin,requests,marks,tools,...(failure?{client_error:failure}:{})};
  await writeFile('/tmp/qaira-mcp-bootstrap-diagnostic.json',JSON.stringify(report,null,2));t.diagnostic(JSON.stringify(report));
 }
 assert.equal(failure,undefined,JSON.stringify(failure));assert.deepEqual(tools.map(item=>item.tool),['browser_navigate','browser_snapshot']);
 assert.equal(tools.some(item=>item.isError),false);assert.equal(requests,1);
});
