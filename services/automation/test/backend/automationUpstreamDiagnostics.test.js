const test=require('node:test');
const assert=require('node:assert/strict');
const {connectUpstreamPlaywright,trustedModelImage}=require('../../backend/lib/automationUpstreamMcpClient');
const {buildWithUpstreamPlaywright,toolsForPolicy,validateRequest}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const {imageUserContent}=require('@hellotest/platform/backend/src/utils/aiReferenceImages');
const startUrl='https://shop.test/product';
const goto=`await page.goto(${JSON.stringify(startUrl)});`;
const names=['browser_navigate','browser_console_messages','browser_network_requests','browser_take_screenshot','browser_network_request','browser_route','browser_run_code'];
const tools=names.map(name=>({name,inputSchema:{type:'object',properties:name==='browser_navigate'?{url:{type:'string'}}:{}}}));
// Minimal JPEG frame header exercises the shared structural image validator;
// the host browser tests separately verify real masked screenshot capture.
const jpeg=Buffer.from([255,216,255,192,0,8,8,0,1,0,1,0]).toString('base64');
const modelImage={schema:'hellotest.masked-browser-image.v1',tool:'browser_take_screenshot',content:[{type:'image',mimeType:'image/jpeg',data:jpeg}]};
const integration={base_url:'https://engine.test',config:{shared_secret:'diagnostic-testengine-fixture-secret'}};
function transport(t,{metadata=modelImage}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  if(init.method==='DELETE')return new Response(null,{status:204});
  const rpc=JSON.parse(init.body);calls.push(rpc);
  if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
  let result;
  if(rpc.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},_meta:{hellotest:{provider:'playwright_mcp_upstream',upstream_package:'@playwright/mcp',upstream_version:'0.0.84'}}};
  else if(rpc.method==='tools/list')result={tools};
  else{
   const name=rpc.params.name;
   result={content:[{type:'text',text:name==='browser_navigate'?`### Ran Playwright code\n\x60\x60\x60js\n${goto}\n\x60\x60\x60\n### Snapshot\n- heading "Product" [ref=e1]`
    :name==='browser_network_requests'?'[GET] https://shop.test/api/price?token=PRIVATE_TOKEN&email=buyer@example.com => [503]'
     :name==='browser_console_messages'?'Price service unavailable; password=PRIVATE_PASSWORD buyer@example.com':'Raw screenshot result'}],isError:false};
   if(name==='browser_take_screenshot')result.content.push({type:'image',mimeType:'image/png',data:'RAW_UNMASKED_PIXELS'});
  }
  return Response.json({jsonrpc:'2.0',id:rpc.id,result,...(rpc.params?.name==='browser_take_screenshot'&&metadata?{_meta:{hellotest:{model_image:metadata}}}:{})},{headers:{'mcp-session-id':'diagnostic-session'}});
 });
 return calls;
}

test('the LLM can inspect bounded network, console and trusted masked image evidence without gaining request bodies or mutation tools',async t=>{
 const calls=transport(t),browser=await connectUpstreamPlaywright({integration,startUrl,captureModelImages:true});
 const packets=[],images=[];let turn=0;
 const result=await buildWithUpstreamPlaywright({steps:[{id:'product',step_order:1,step_type:'web',action:'Inspect product rendering',expected_result:'The product heading is visible'}],startUrl,interactive:true,browser,validate:inspectExecutablePlan,
  complete:async request=>{
   const packet=JSON.parse(request.prompt);
   if(request.phase==='upstream_browser_actor'){
    packets.push(packet);images.push(request.referenceImages);
    const order=['browser_network_requests','browser_console_messages','browser_take_screenshot'];
    return turn<order.length?{tool:{name:order[turn++],arguments:{}}}:{done:true};
   }
   assert.equal(request.referenceImages.length,1);
   assert.equal(imageUserContent(request.prompt,request.referenceImages)[1].image_url.url,`data:image/jpeg;base64,${jpeg}`);
   return {automation_code:goto+'\nawait expect(page.getByRole("heading",{name:"Product",exact:true})).toBeVisible();'};
  }});
 assert.equal(result.updates.length,1);
 assert.deepEqual(calls.filter(call=>call.method==='tools/call').map(call=>call.params.name),['browser_navigate','browser_network_requests','browser_console_messages','browser_take_screenshot']);
 const evidence=JSON.stringify(packets);
 assert.match(evidence,/503/);assert.match(evidence,/Price service unavailable/);assert.match(evidence,/shop.test\/api\/price/);
 assert.doesNotMatch(evidence,/PRIVATE_TOKEN|PRIVATE_PASSWORD|buyer@example.com|RAW_UNMASKED_PIXELS/);
 assert.equal(images.at(-1).length,1);assert.equal(images[0].length,0);
 assert.ok(packets.at(-1).recent_section_observations.some(item=>item.tool==='browser_network_requests'&&item.result.content));
 for(const name of ['browser_network_request','browser_route','browser_run_code'])assert.ok(!packets[0].available_tools.includes(name));
 assert.equal(calls[0].params._meta.hellotest.capture_model_images,true);
});

test('raw or spoofed native images and malformed host image metadata cannot become model evidence',async t=>{
 for(const metadata of [null,{...modelImage,schema:'page-authored'}, {...modelImage,tool:'browser_click'},
  {...modelImage,content:[{type:'image',mimeType:'image/jpeg',data:'invalid'}]}])await t.test(String(metadata?.schema),async t=>{
  transport(t,{metadata});const browser=await connectUpstreamPlaywright({integration,startUrl,captureModelImages:true});
  const result=await browser.call('browser_take_screenshot',{});
  assert.equal(trustedModelImage(result),undefined);assert.equal(trustedModelImage({...result}),undefined);await browser.close();
 });
});

test('text-only models do not enable screenshot delivery, while file-output arguments stay forbidden',async t=>{
 const calls=transport(t),browser=await connectUpstreamPlaywright({integration,startUrl});
 const result=await browser.call('browser_take_screenshot',{});assert.equal(trustedModelImage(result),undefined);
 assert.equal(calls[0].params._meta.hellotest.capture_model_images,undefined);
 const catalog=new Map(toolsForPolicy(tools,true).map(tool=>[tool.name,tool]));
 assert.throws(()=>validateRequest({name:'browser_console_messages',arguments:{filename:'private.log'}},catalog,{interactive:true,startUrl}),{code:'AUTOMATION_UPSTREAM_TOOL_INVALID'});
 await browser.close();
});
