import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {registerAutomationMcp} from '../dist/lib/automationMcp.js';

async function protocol(app,startUrl){
 let session;const rpc=async(method,params={})=>{
  const response=await app.inject({method:'POST',url:'/api/v1/automation/mcp',headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:1,method,params}});
  if(method==='initialize')session=response.headers['mcp-session-id'];return response.json();
 };
 await rpc('initialize',{_meta:{hellotest:{start_url:startUrl,allow_browser_actions:true}}});
 return async(name,args={})=>{const response=await rpc('tools/call',{name,arguments:args});assert.ok(!response.error&&!response.result.isError,JSON.stringify(response));return response.result;};
}

test('screenshots mask static controls in allowed frames and foreign owner boxes without reading foreign DOM',{timeout:10000},async t=>{
 const app=Fastify();t.after(()=>app.close());const selected=[];
 const ready={loaded:true,loadState:'complete',usable:true,actionable:true,busy:false,signature:1};
 const child={url:()=> 'https://fixture.test/child',locator:selector=>{selected.push({scope:'child',selector});return {scope:'child',selector};}};
 const foreign={url:()=> 'https://foreign.test/frame',locator:()=>{throw Error('Foreign DOM must not be inspected');}};
 let captured;
 const page={isClosed:()=>false,url:()=> 'https://fixture.test/start',on(){},setDefaultTimeout(){},goto:async()=>({status:()=>200}),evaluate:async()=>ready,
  locator:selector=>{selected.push({scope:'main',selector});return {scope:'main',selector};},screenshot:async options=>{captured=options;return Buffer.from([255,216,255,1,2,3]);}};
 page.frames=()=>[page,child,foreign];page.mainFrame=()=>page;
 const browser={isConnected:()=>true,newContext:async()=>({route:async()=>{},newPage:async()=>page,on(){}}),close:async()=>{}};
 await registerAutomationMcp(app,async()=>{},{validateTarget:async()=>{},launchBrowser:async()=>browser,createProxy:async()=>({server:'http://fixture-proxy.test',close:async()=>{}})});
 const call=await protocol(app,'https://fixture.test/start');await call('browser_navigate',{url:'https://fixture.test/start'});const result=await call('browser_screenshot');
 assert.equal(selected.length,2);assert.deepEqual(selected.map(row=>row.scope),['main','child']);
 for(const row of selected)for(const selector of ['input','select','textarea','contenteditable','textbox','searchbox','combobox','spinbutton','iframe','frame'])assert.ok(row.selector.includes(selector));
 assert.deepEqual(captured.mask,selected);assert.equal(captured.maskColor,'#000000');assert.ok(captured.timeout>0&&captured.timeout<=5000);
 const metadata=JSON.parse(result.content.find(block=>block.type==='text').text);assert.equal(metadata.privacyMasked,true);assert.equal(metadata.optional,true);assert.doesNotMatch(JSON.stringify(metadata),/selector|value|secret/i);
});

test('real MCP screenshot pixels hide value-entry controls in main and same-origin frames without changing their values',{timeout:30000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const app=Fastify();let native;
 const controls='<input id="text" value="fixture confidential text"><textarea id="area">fixture confidential text</textarea><select id="select"><option>fixture confidential text</option></select><div id="editable" contenteditable="true">fixture confidential text</div><div id="role" role="textbox">fixture confidential text</div>';
 const css='<style>body{margin:0;background:white}input,textarea,select,[contenteditable],[role="textbox"]{display:block;box-sizing:border-box;width:240px;height:40px;margin:8px;background:white;color:black;border:1px solid black}#marker{position:absolute;left:300px;top:20px;width:80px;height:40px;background:#00ff00}iframe{display:block;width:600px;height:260px;border:0}</style>';
 app.get('/main',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Private controls</title>'+css+controls+'<div id="marker"></div><iframe id="child" src="/child"></iframe>'));
 app.get('/child',async(_r,reply)=>reply.type('text/html').send('<!doctype html>'+css+controls+'<div id="marker"></div>'));
 await registerAutomationMcp(app,async()=>{},{launchBrowser:async options=>{native=await chromium.launch(options);return native;}});
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const call=await protocol(app,base+'/main');await call('browser_navigate',{url:base+'/main'});
 const page=native.contexts()[0].pages()[0],child=page.frames().find(frame=>frame.url()===base+'/child');assert.ok(child);
 const entries=[];for(const frame of [page.mainFrame(),child])for(const id of ['text','area','select','editable','role'])entries.push(await frame.locator('#'+id).boundingBox());
 assert.ok(entries.every(Boolean));const centers=entries.map(box=>({x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)}));
 const markers=await Promise.all([page.locator('#marker').boundingBox(),child.locator('#marker').boundingBox()]);
 const points=[...centers,...markers.map(box=>({x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)}))];
 const result=await call('browser_screenshot'),image=result.content.find(block=>block.type==='image');assert.ok(image);
 assert.equal(JSON.parse(result.content.find(block=>block.type==='text').text).privacyMasked,true);
 const pixels=await page.evaluate(async({data,points})=>{const image=new Image();image.src='data:image/jpeg;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return points.map(point=>Array.from(context.getImageData(point.x,point.y,1,1).data));},{data:image.data,points});
 assert.ok(pixels.slice(0,centers.length).every(pixel=>pixel.slice(0,3).every(channel=>channel<=8)),'Every value-entry center must contain only the opaque privacy mask');
 assert.ok(pixels.slice(centers.length).every(([r,g,b])=>r<30&&g>200&&b<30),'Other content in both documents remains visible');
 for(const frame of [page.mainFrame(),child])assert.equal(await frame.locator('#text').inputValue(),'fixture confidential text','Native masking must preserve original controls');
});
