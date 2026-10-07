import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import http from "node:http";
import Fastify from "fastify";
const buildRoot=process.env.QUALITY_TEST_BUILD_ROOT?pathToFileURL(`${process.env.QUALITY_TEST_BUILD_ROOT}/`):new URL("../dist/",import.meta.url);
const { parseQualityInput }=await import(new URL("lib/qualityAgents/contracts.js",buildRoot));
const { QualityNetworkPolicy }=await import(new URL("lib/qualityAgents/network.js",buildRoot));
const { QualityAgentRuntime }=await import(new URL("lib/qualityAgents/runtime.js",buildRoot));
const { encodePng,decodePng,comparePng }=await import(new URL("lib/qualityAgents/png.js",buildRoot));
const { registerQualityAgentRoutes }=await import(new URL("lib/qualityAgents/routes.js",buildRoot));
const { createPrivilegedRunGuard,resolveTestEngineSharedSecret }=await import(new URL("lib/testEngineSecurity.js",buildRoot));
const input=(target,kind="web",suffix="1",options={})=>({client_run_id:`quality-test-${suffix}`,kind,target_url:target,scope:{project_id:"project-1",app_type_id:"app-1"},options,limits:{max_pages:3,max_duration_ms:20000}});

test("strict reviewed-action contracts reject secrets, arbitrary code and out-of-bound inputs",()=>{
  assert.equal(parseQualityInput(input("https://example.test/?view=smoke")).target_url,"https://example.test/?view=smoke");
  for(const value of ["","   ","  Ada  "])assert.equal(parseQualityInput(input("https://example.test","web","exact-fill",{approved_steps:[{action:"fill",selector:"#name",value}]})).options.approved_steps[0].value,value,"Reviewed fill values are preserved byte-for-byte, including an intentional field clear.");
  for(const value of [null,42,"a".repeat(501),"bad\u0000value","sk-abcdefghijklmnopqrstuv"])assert.throws(()=>parseQualityInput(input("https://example.test","web","invalid-fill",{approved_steps:[{action:"fill",selector:"#name",value}]})),error=>error.code==="QUALITY_INPUT_INVALID");
  for(const value of [input("file:///etc/passwd"),input("https://user:secret@example.test"),input("https://example.test/?token=hidden"),{...input("https://example.test"),credentials:{password:"hidden"}},input("https://example.test","web","1",{approved_steps:[{action:"evaluate",value:"alert(1)"}]}),input("https://example.test","web","1",{approved_steps:[{action:"fill",selector:"#password",value:"hidden"}]}),input("https://example.test","web","1",{approved_steps:[{action:"assert_url",url:"https://other.test"}]}),input("https://example.test","web","1",{viewport:{width:100000,height:800}})])assert.throws(()=>parseQualityInput(value),error=>error.code==="QUALITY_INPUT_INVALID");
});

test("network policy denies private DNS, forbidden origins and rebinding while allowing explicit QA hosts",async()=>{
  const mixed=new QualityNetworkPolicy("https://public.test",{},async()=>[{address:"93.184.216.34"},{address:"10.0.0.1"}]);
  await assert.rejects(mixed.resolve("https://public.test"),error=>error.code==="QUALITY_PRIVATE_TARGET");
  await assert.rejects(new QualityNetworkPolicy("http://127.0.0.1",{}).resolve("http://127.0.0.1"),error=>error.code==="QUALITY_PRIVATE_TARGET");
  let calls=0;const pinned=new QualityNetworkPolicy("https://public.test",{},async()=>{calls++;return[{address:calls===1?"93.184.216.34":"127.0.0.1"}];});
  assert.equal(await pinned.resolve("https://public.test/a"),"93.184.216.34");assert.equal(await pinned.resolve("https://public.test/b"),"93.184.216.34");assert.equal(calls,1,"Connections reuse the exact validated address instead of trusting re-resolved DNS.");
  await assert.rejects(pinned.resolve("https://different.test"),error=>error.code==="QUALITY_ORIGIN_DENIED");
  assert.equal(await new QualityNetworkPolicy("http://127.0.0.1",{QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS:"127.0.0.1"}).resolve("http://127.0.0.1"),"127.0.0.1");
});

test("PNG pixel comparison is deterministic and rejects incompatible dimensions",()=>{
  const image={width:2,height:2,pixels:Buffer.from([255,255,255,255,0,0,0,255,10,20,30,255,255,0,0,255])};
  const encoded=encodePng(image);assert.deepEqual(decodePng(encoded),image);assert.equal(comparePng(encoded,encoded).diff_ratio,0);
  const changed={...image,pixels:Buffer.from(image.pixels)};changed.pixels[0]=0;
  const compared=comparePng(encoded,encodePng(changed),16);assert.equal(compared.changed_pixels,1);assert.equal(compared.diff_ratio,.25);assert.equal(decodePng(compared.diff).width,2);
  assert.throws(()=>comparePng(encoded,encodePng({width:1,height:1,pixels:Buffer.from([0,0,0,255])})),error=>error.code==="QUALITY_BASELINE_DIMENSIONS");
});

async function waitTerminal(runtime,id){const end=Date.now()+30000;while(Date.now()<end){const run=runtime.get(id);if(["completed","failed","cancelled"].includes(run.state))return run;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error("Real browser run did not reach a terminal state.");}

test("five actual browser agents produce persisted evidence, reviewed journeys and explicit visual baselines",{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),"quality-agent-real-"));let changed=false;let deniedHits=0;let runtime,app;
  const denied=http.createServer((_,reply)=>{deniedHits++;reply.end("This origin must never be requested.");});await new Promise(resolve=>denied.listen(0,"127.0.0.1",resolve));
  const other=`http://127.0.0.1:${denied.address().port}`;
  const server=http.createServer((request,reply)=>{
    if(request.url.startsWith("/redirect")){reply.writeHead(302,{location:other});reply.end();return;}
    if(request.url.startsWith("/slow")){setTimeout(()=>reply.end("slow"),10000).unref();return;}
    const external=request.url.startsWith("/external")?`<img src="${other}/resource.png" alt="External fixture">`:"";
    const body=`<!doctype html><html lang="en"><head><title>Quality fixture</title><style>body{margin:20px;background:${changed?"#ffe3e3":"white"};font:16px Arial}button,input{font:inherit}#summary{white-space:pre}</style></head><body><main><h1>Quality fixture</h1><label for="name">Name</label><input id="name"><button id="greet" onclick="document.querySelector('#summary').textContent='Hello ['+document.querySelector('#name').value+']'">Greet</button><p id="summary">Ready</p><img id="missing-alt" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='blue'/%3E%3C/svg%3E"><button id="unnamed"></button><input id="innocent" type="password" value="not-to-be-filled"><a href="/second">Second page</a>${external}</main></body></html>`;
    reply.writeHead(200,{"content-type":"text/html","content-length":Buffer.byteLength(body),"x-content-type-options":"nosniff"});reply.end(body);
  });await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const target=`http://127.0.0.1:${server.address().port}/?view=smoke`;
  try{
    runtime=await new QualityAgentRuntime({directory,executablePath:process.env.CHROME_EXECUTABLE,environment:{QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS:"127.0.0.1"},concurrency:1}).initialize();
    app=Fastify();await registerQualityAgentRoutes(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret({TESTENGINE_SHARED_SECRET:"quality-agent-test-only"})),runtime);
    assert.equal((await app.inject({method:"POST",url:"/api/v1/quality-agents/runs",payload:input(target)})).statusCode,401,"Engine execution requires the shared privileged guard.");
    const options={viewport:{width:640,height:480},approved_steps:[{action:"fill",selector:"#name",value:"Ada"},{action:"click",selector:"#greet"},{action:"assert_text",selector:"#summary",text:"Hello [Ada]"},{action:"fill",selector:"#name",value:""},{action:"click",selector:"#greet"},{action:"assert_text",selector:"#summary",text:"Hello []"},{action:"fill",selector:"#name",value:"  Ada  "},{action:"click",selector:"#greet"},{action:"assert_text",selector:"#summary",text:"Hello [  Ada  ]"},{action:"assert_url",url:target}]};
    const accepted=await runtime.accept(input(target,"web","journey",options));assert.equal(accepted.target_url,target,"Safe query parameters are preserved for cross-layer identity.");
    const web=await waitTerminal(runtime,accepted.id);assert.equal(web.state,"completed",JSON.stringify(web.error));assert.equal(web.metrics.journey_steps_completed,10);assert.equal(web.stages.filter(stage=>stage.id.startsWith("step-")&&stage.status==="completed").length,10);assert.ok(web.artifacts.some(artifact=>artifact.type==="screenshot"));
    assert.equal((await runtime.accept(input(target,"web","journey",options))).id,web.id);await assert.rejects(runtime.accept(input(target,"web","journey",{...options,wait_until:"domcontentloaded"})),error=>error.code==="QUALITY_IDEMPOTENCY_CONFLICT");
    const security=await waitTerminal(runtime,(await runtime.accept(input(target,"security","security"))).id);assert.equal(security.state,"completed");assert.ok(security.findings.some(finding=>finding.id==="security-csp"));assert.match(security.limitations.join(" "),/No exploit/);
    const performance=await waitTerminal(runtime,(await runtime.accept(input(target,"performance","performance"))).id);assert.equal(performance.state,"completed");assert.equal(typeof performance.metrics.navigation_wall_ms,"number");assert.equal(typeof performance.metrics.transfer_bytes,"number");assert.match(performance.limitations.join(" "),/not load testing/);assert.equal("score" in performance.metrics,false);
    const accessibility=await waitTerminal(runtime,(await runtime.accept(input(target,"accessibility","accessibility"))).id);assert.equal(accessibility.state,"completed",JSON.stringify(accessibility.error));assert.equal(accessibility.metrics.check_engine,"axe_core","The shipped accessibility agent uses actual axe-core rules.");assert.ok(accessibility.findings.some(finding=>/alternative|alt/i.test(finding.title)));assert.match(accessibility.limitations.join(" "),/conformance/);
    const visualOptions={viewport:{width:640,height:480}};const visual=await waitTerminal(runtime,(await runtime.accept(input(target,"visual","visual",visualOptions))).id);assert.equal(visual.outcome,"needs_review");const screenshot=visual.artifacts.find(artifact=>artifact.type==="screenshot");
    const review={scope:visual.scope,source_run_id:visual.id,artifact_id:screenshot.id,reviewed_by:"authorized-reviewer"};
    const promoting=runtime.reviewBaseline(review);const archiving=runtime.archive(visual.id);const baseline=await promoting;await assert.rejects(archiving,error=>error.code==="QUALITY_BASELINE_RETAINED","Concurrent archiving cannot remove source evidence while a reviewed baseline is promoted.");assert.equal((await runtime.reviewBaseline(review)).id,baseline.id,"Review retries cannot create duplicate baselines.");
    const matched=await waitTerminal(runtime,(await runtime.accept(input(target,"visual","matched",{...visualOptions,baseline_id:baseline.id}))).id);assert.equal(matched.state,"completed",JSON.stringify(matched.error));assert.equal(matched.metrics.diff_ratio,0);assert.equal(matched.outcome,"passed");assert.ok(matched.artifacts.some(artifact=>artifact.type==="visual_diff"));
    changed=true;const difference=await waitTerminal(runtime,(await runtime.accept(input(target,"visual","changed",{...visualOptions,baseline_id:baseline.id}))).id);assert.equal(difference.outcome,"findings");assert.ok(difference.metrics.changed_pixels>0);
    const mismatch=await waitTerminal(runtime,(await runtime.accept(input(target,"visual","mismatch",{viewport:{width:800,height:480},baseline_id:baseline.id}))).id);assert.equal(mismatch.error.code,"QUALITY_BASELINE_CONFIGURATION");
    const sensitive=await waitTerminal(runtime,(await runtime.accept(input(target,"web","sensitive",{approved_steps:[{action:"fill",selector:"#innocent",value:"ordinary-text"}]}))).id);assert.equal(sensitive.error.code,"QUALITY_SENSITIVE_FIELD","Actual password fields cannot hide behind innocent selector names.");
    const redirected=await waitTerminal(runtime,(await runtime.accept(input(new URL("/redirect",target).href,"web","redirect"))).id);assert.notEqual(redirected.outcome,"passed");assert.equal(deniedHits,0,"Cross-origin redirects never reach another private service.");
    const constrained=await waitTerminal(runtime,(await runtime.accept(input(new URL("/external",target).href,"performance","blocked"))).id);assert.ok(constrained.metrics.blocked_requests>0);assert.notEqual(constrained.outcome,"passed","Blocked-resource measurements cannot claim an unqualified pass.");assert.equal(deniedHits,0);
    const slow=await runtime.accept(input(new URL("/slow",target).href,"web","cancel"));await new Promise(resolve=>setTimeout(resolve,100));await assert.rejects(runtime.cancelByClient(slow.client_run_id,{project_id:"other-project"}),error=>error.code==="QUALITY_RUN_NOT_FOUND");assert.equal((await runtime.cancelByClient(slow.client_run_id,slow.scope)).state,"cancelled");await new Promise(resolve=>setTimeout(resolve,100));assert.equal(runtime.get(slow.id).state,"cancelled");
    await runtime.archive(slow.id);assert.equal(runtime.get(slow.id),null,"Archiving waits for cancelled browser cleanup before deleting its records.");
    const evidence=await runtime.readArtifact(web.id,web.artifacts[0].id);assert.equal(evidence.bytes.length,evidence.artifact.bytes);await assert.rejects(runtime.readArtifact(web.id,"../../secret"),error=>error.code==="QUALITY_ARTIFACT_NOT_FOUND");
    await assert.rejects(runtime.archive(visual.id),error=>error.code==="QUALITY_BASELINE_RETAINED");await runtime.archive(security.id);assert.equal(runtime.get(security.id),null);
    await app.close();app=null;
    for(const run of [performance,visual]){const path=join(directory,"runs",`${run.id}.json`);const saved=JSON.parse(await readFile(path,"utf8"));saved.run.finished_at=new Date(Date.now()-8*86400000).toISOString();await writeFile(path,JSON.stringify(saved));}
    const restored=await new QualityAgentRuntime({directory,executablePath:process.env.CHROME_EXECUTABLE,environment:{QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS:"127.0.0.1"}}).initialize();
    try{assert.equal(restored.get(web.id).state,"completed");assert.equal(restored.listBaselines("project-1")[0].id,baseline.id);await waitTerminal(restored,(await restored.accept(input(target,"security","retention"))).id);assert.equal(restored.get(performance.id),null,"Expired terminal evidence is pruned before acceptance.");assert.equal(restored.get(visual.id).state,"completed","Reviewed baseline source evidence survives retention.");}finally{await restored.close();}
  }finally{await app?.close();await runtime?.close();server.closeAllConnections();denied.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>denied.close(resolve))]);await rm(directory,{recursive:true,force:true});}
});
