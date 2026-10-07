import { chromium, type Browser, type Page, type Response } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { QualityArtifact, QualityBaseline, QualityFinding, QualityRun, QualityRunInput, QualityStage } from "../../contracts/qualityAgents.js";
import { parseQualityInput, publicUrl, QualityError, safeText } from "./contracts.js";
import { createQualityProxy, QualityNetworkPolicy } from "./network.js";
import { comparePng } from "./png.js";
import { scanAccessibility, scanSecurity } from "./scanners.js";

type StoredRun = { input: QualityRunInput; run: QualityRun; fingerprint: string };
type RuntimeOptions = { directory?: string; executablePath?: string; environment?: NodeJS.ProcessEnv; concurrency?: number };
const terminal = (run: QualityRun) => ["completed", "failed", "cancelled"].includes(run.state);
const timestamp = () => new Date().toISOString();
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class QualityAgentRuntime {
  readonly directory: string;
  private records = new Map<string, StoredRun>();
  private baselines = new Map<string, QualityBaseline>();
  private controllers = new Map<string, AbortController>();
  private writes = new Map<string, Promise<void>>();
  private queue: string[] = [];
  private active = 0;
  private executions = new Map<string, Promise<void>>();
  private closing = false;
  private acceptLock = Promise.resolve();
  private baselineLock = Promise.resolve();
  private readonly environment: NodeJS.ProcessEnv;
  constructor(private readonly options: RuntimeOptions = {}) {
    this.environment = options.environment || process.env;
    this.directory = resolve(options.directory || this.environment.QUALITY_AGENT_DATA_DIR || "./data/quality-agents");
  }
  capabilities() {
    const configured=this.options.executablePath||this.environment.QUALITY_AGENT_BROWSER_PATH||this.environment.PLAYWRIGHT_EXECUTABLE_PATH;
    const available=existsSync(configured||chromium.executablePath());
    return {contract_version:"1.0",available:available&&!this.closing,browser:{available,engine:"chromium",verification:available?"binary_present":"binary_missing",configured_path:Boolean(configured)},checks:{web:"reviewed_playwright_journeys",security:"passive_browser_posture",performance:"single_navigation_metrics",accessibility:"axe-core",visual:"reviewed_baseline_pixel_diff"},limits:{concurrency:this.options.concurrency||2,queued_runs:32,max_pages:5,max_duration_ms:120000,max_requests:250,max_artifacts:10,max_artifact_bytes:8*1024*1024,retained_runs:1000},active_runs:this.active,queued_runs:this.queue.length,limitations:["Browser availability verifies the installed binary, not a completed test launch.","Private QA targets and additional resource origins require exact administrator allowlists."]};
  }
  async initialize() {
    for (const name of ["runs", "artifacts", "baselines"]) await mkdir(join(this.directory,name), { recursive:true, mode:0o700 });
    const files = (await readdir(join(this.directory,"runs"))).filter(name=>/^[a-f0-9-]+\.json$/.test(name)).slice(0,1000);
    for (const name of files) {
      try {
        const stored = JSON.parse(await readFile(join(this.directory,"runs",name),"utf8")) as StoredRun;
        stored.input = parseQualityInput(stored.input);
        if (stored.run.id !== name.slice(0,-5) || stored.run.contract_version !== "1.0") continue;
        this.records.set(stored.run.id,stored);
        if (!terminal(stored.run)) {
          stored.run.state="failed";stored.run.outcome="error";stored.run.finished_at=timestamp();stored.run.error={code:"QUALITY_ENGINE_RESTARTED",message:"The engine restarted before this run finished. Review retained evidence and launch a new run."};
          for (const stage of stored.run.stages) if(stage.status==="running") stage.status="failed";
          await this.persist(stored);
        }
      } catch { /* Corrupt records are never executed or exposed. */ }
    }
    for (const name of (await readdir(join(this.directory,"baselines"))).filter(name=>/^[a-f0-9-]+\.json$/.test(name)).slice(0,1000)) {
      try { const baseline = JSON.parse(await readFile(join(this.directory,"baselines",name),"utf8")) as QualityBaseline; if(baseline.id===name.slice(0,-5)) this.baselines.set(baseline.id,baseline); } catch { /* Do not use corrupt baseline metadata. */ }
    }
    return this;
  }
  private async atomic(path: string, bytes: string | Buffer) {
    const temporary=`${path}.${randomUUID()}.tmp`;await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,path);
  }
  private persist(stored: StoredRun) {
    stored.run.updated_at=timestamp();
    const bytes=JSON.stringify(stored);const previous=this.writes.get(stored.run.id)||Promise.resolve();
    const next=previous.catch(()=>undefined).then(()=>this.atomic(join(this.directory,"runs",`${stored.run.id}.json`),bytes));
    this.writes.set(stored.run.id,next);return next;
  }
  get(id: string) { const record=this.records.get(id);return record?clone(record.run):null; }
  list(projectId: string) { return [...this.records.values()].map(record=>record.run).filter(run=>run.scope.project_id===projectId).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,100).map(clone); }
  listBaselines(projectId: string) { return [...this.baselines.values()].filter(baseline=>baseline.scope.project_id===projectId).map(clone); }
  async archive(id:string) {
    let unlock!:()=>void;const previous=this.baselineLock;this.baselineLock=new Promise(resolve=>{unlock=resolve;});await previous;
    try {
      const stored=this.records.get(id);if(!stored)throw new QualityError("QUALITY_RUN_NOT_FOUND","Quality run was not found.",404);
      if(!terminal(stored.run))throw new QualityError("QUALITY_RUN_ACTIVE","Cancel or finish a run before archiving its engine evidence.",409);
      // A cancelled run can still be closing its browser or saving an in-flight artifact.
      await this.executions.get(id);
      if([...this.baselines.values()].some(baseline=>baseline.source_run_id===id))throw new QualityError("QUALITY_BASELINE_RETAINED","This run supplies a reviewed visual baseline and its evidence must be retained.",409);
      await this.writes.get(id)?.catch(()=>undefined);await rm(join(this.directory,"runs",`${id}.json`),{force:true});await rm(join(this.directory,"artifacts",id),{recursive:true,force:true});this.records.delete(id);this.writes.delete(id);return {id,archived:true};
    } finally { unlock(); }
  }
  private async pruneExpired() {
    const days=Math.min(365,Math.max(1,Number(this.environment.QUALITY_AGENT_RETENTION_DAYS)||7));const cutoff=Date.now()-days*86400000;
    const protectedRuns=new Set([...this.baselines.values()].map(baseline=>baseline.source_run_id));
    for(const record of [...this.records.values()].sort((a,b)=>a.run.created_at.localeCompare(b.run.created_at)))if(terminal(record.run)&&Date.parse(record.run.finished_at||record.run.created_at)<cutoff&&!protectedRuns.has(record.run.id))try{await this.archive(record.run.id);}catch(error){if(!(error instanceof QualityError&&error.code==="QUALITY_BASELINE_RETAINED"))throw error;}
  }
  async accept(value: unknown): Promise<QualityRun> {
    const input=parseQualityInput(value);let unlock!:()=>void;const previous=this.acceptLock;this.acceptLock=new Promise(resolve=>{unlock=resolve;});await previous;
    try {
      if(this.closing) throw new QualityError("QUALITY_ENGINE_STOPPING","The quality engine is shutting down.",503);
      const fingerprint=hash(JSON.stringify(input));
      const existing=[...this.records.values()].find(record=>record.input.client_run_id===input.client_run_id&&record.input.scope.project_id===input.scope.project_id);
      if(existing){if(existing.fingerprint!==fingerprint)throw new QualityError("QUALITY_IDEMPOTENCY_CONFLICT","This client_run_id already belongs to a different reviewed request.",409);return clone(existing.run);}
      await this.pruneExpired();
      if(this.queue.length>=32 || this.records.size>=1000)throw new QualityError("QUALITY_CAPACITY_EXCEEDED","The quality-engine queue or retained-run limit is full. An administrator can archive terminal runs; reviewed baseline evidence is retained.",429);
      await new QualityNetworkPolicy(input.target_url,this.environment).resolve(input.target_url);
      if(input.options?.baseline_id){const baseline=this.baselines.get(input.options.baseline_id);if(!baseline||baseline.scope.project_id!==input.scope.project_id||baseline.scope.app_type_id!==input.scope.app_type_id)throw new QualityError("QUALITY_BASELINE_SCOPE","The selected baseline does not belong to this project/application scope.",403);}
      const now=timestamp();const run:QualityRun={contract_version:"1.0",id:randomUUID(),client_run_id:input.client_run_id,kind:input.kind,target_url:input.target_url,scope:input.scope,state:"queued",outcome:null,created_at:now,updated_at:now,stages:[{id:"queued",label:"Reviewed run accepted",status:"completed",completed_at:now}],findings:[],metrics:{},limitations:[],artifacts:[]};
      const stored={input,run,fingerprint};this.records.set(run.id,stored);
      try { await this.persist(stored); } catch(error) { this.records.delete(run.id);this.writes.delete(run.id);throw error; }
      this.queue.push(run.id);this.pump();return clone(run);
    }finally{unlock();}
  }
  private pump() { while(!this.closing&&this.active<(this.options.concurrency||2)&&this.queue.length){const id=this.queue.shift()!;const stored=this.records.get(id);if(!stored||terminal(stored.run))continue;this.active++;const execution=this.execute(stored).catch(()=>undefined).finally(()=>{this.active--;this.executions.delete(id);this.pump();});this.executions.set(id,execution);} }
  private async stage(stored: StoredRun,id:string,label:string,status:QualityStage["status"]="running") {
    let stage=stored.run.stages.find(item=>item.id===id);if(!stage){stage={id,label,status,started_at:timestamp()};stored.run.stages.push(stage);}else stage.status=status;
    if(status==="completed"||status==="failed")stage.completed_at=timestamp();await this.persist(stored);
  }
  private async artifact(stored:StoredRun,bytes:Buffer,name:string,type:QualityArtifact["type"],contentType:string) {
    if(stored.run.artifacts.length>=10 || bytes.length>8*1024*1024)throw new QualityError("QUALITY_ARTIFACT_LIMIT","The evidence artifact limit was reached (10 artifacts, 8 MiB each).",413);
    const artifact:QualityArtifact={id:randomUUID(),name,type,content_type:contentType,bytes:bytes.length,sha256:hash(bytes)};
    await mkdir(join(this.directory,"artifacts",stored.run.id),{recursive:true,mode:0o700});await this.atomic(join(this.directory,"artifacts",stored.run.id,artifact.id),bytes);stored.run.artifacts.push(artifact);await this.persist(stored);return artifact;
  }
  async readArtifact(runId:string,artifactId:string) {
    const stored=this.records.get(runId),artifact=stored?.run.artifacts.find(item=>item.id===artifactId);
    if(!artifact)throw new QualityError("QUALITY_ARTIFACT_NOT_FOUND","Evidence artifact was not found.",404);
    const bytes=await readFile(join(this.directory,"artifacts",runId,artifactId));if(hash(bytes)!==artifact.sha256)throw new QualityError("QUALITY_ARTIFACT_CORRUPT","The saved evidence failed its integrity check.",409);return {artifact:clone(artifact),bytes};
  }
  async reviewBaseline(value: {scope:{project_id:string;app_type_id?:string|null};source_run_id:string;artifact_id:string;reviewed_by:string}) {
    let unlock!:()=>void;const previous=this.baselineLock;this.baselineLock=new Promise(resolve=>{unlock=resolve;});await previous;
    try {
    const stored=this.records.get(value.source_run_id);
    if(!stored||stored.run.kind!=="visual"||stored.run.state!=="completed"||stored.run.scope.project_id!==value.scope.project_id||(stored.run.scope.app_type_id||null)!==(value.scope.app_type_id||null))throw new QualityError("QUALITY_BASELINE_SCOPE","A reviewed baseline must come from a completed visual run in this exact project/application scope.",409);
    if(typeof value.reviewed_by!=="string"||!value.reviewed_by.trim()||value.reviewed_by.length>255)throw new QualityError("QUALITY_BASELINE_REVIEW_REQUIRED","The baseline review must identify its authorized reviewer.");
    const existing=[...this.baselines.values()].find(baseline=>baseline.source_run_id===value.source_run_id&&baseline.artifact_id===value.artifact_id);if(existing)return clone(existing);
    const evidence=await this.readArtifact(value.source_run_id,value.artifact_id);if(evidence.artifact.type!=="screenshot")throw new QualityError("QUALITY_BASELINE_INVALID","Only a visual-run screenshot can become a baseline.");
    const baseline:QualityBaseline={id:randomUUID(),scope:clone(stored.run.scope),target_url:stored.input.target_url,viewport:stored.input.options?.viewport||{width:1280,height:800},masks:stored.input.options?.masks||[],sha256:evidence.artifact.sha256,source_run_id:stored.run.id,artifact_id:value.artifact_id,reviewed_by:value.reviewed_by.trim(),created_at:timestamp()};
    await this.atomic(join(this.directory,"baselines",`${baseline.id}.png`),evidence.bytes);await this.atomic(join(this.directory,"baselines",`${baseline.id}.json`),JSON.stringify(baseline));this.baselines.set(baseline.id,baseline);return clone(baseline);
    } finally { unlock(); }
  }
  async cancel(id:string) {
    const stored=this.records.get(id);if(!stored)throw new QualityError("QUALITY_RUN_NOT_FOUND","Quality run was not found.",404);
    if(terminal(stored.run))return clone(stored.run);
    this.controllers.get(id)?.abort("cancelled");stored.run.state="cancelled";stored.run.outcome=null;stored.run.finished_at=timestamp();for(const stage of stored.run.stages)if(stage.status==="running")stage.status="failed";await this.persist(stored);return clone(stored.run);
  }
  async cancelByClient(clientId:string,scope:{project_id:string;app_type_id?:string|null}) {
    const stored=[...this.records.values()].find(record=>record.run.client_run_id===clientId&&record.run.scope.project_id===scope.project_id&&(record.run.scope.app_type_id||null)===(scope.app_type_id||null));
    if(!stored)throw new QualityError("QUALITY_RUN_NOT_FOUND","The scoped client run has not been accepted by this engine.",404);return this.cancel(stored.run.id);
  }
  async close() { this.closing=true;for(const id of [...this.records.keys()]){const stored=this.records.get(id)!;if(!terminal(stored.run))await this.cancel(id);}await Promise.allSettled([...this.executions.values()]);await Promise.allSettled([...this.writes.values()]); }
  private async execute(stored:StoredRun) {
    const controller=new AbortController();this.controllers.set(stored.run.id,controller);
    let browser:Browser|undefined,activePage:Page|undefined,proxy:Awaited<ReturnType<typeof createQualityProxy>>|undefined;
    const deadline=Date.now()+(stored.input.limits?.max_duration_ms||60000);
    const active=()=>{if(controller.signal.aborted||terminal(stored.run))throw new QualityError(controller.signal.reason==="timeout"?"QUALITY_TIMEOUT":controller.signal.reason==="resource_limit"?"QUALITY_REQUEST_LIMIT":"QUALITY_CANCELLED",controller.signal.reason==="timeout"?"The bounded browser run exceeded its time limit.":controller.signal.reason==="resource_limit"?"The browser exceeded its 250-request limit.":"The run was cancelled.",409);};
    const timer=setTimeout(()=>controller.abort("timeout"),stored.input.limits?.max_duration_ms||60000);timer.unref?.();
    const abort=()=>{void browser?.close().catch(()=>undefined);};controller.signal.addEventListener("abort",abort);
    const findings=(items:QualityFinding[])=>{stored.run.findings.push(...items.slice(0,100-stored.run.findings.length));};
    try {
      active();stored.run.state="running";stored.run.started_at=timestamp();await this.stage(stored,"browser","Opening a protected browser");
      const policy=new QualityNetworkPolicy(stored.input.target_url,this.environment);await policy.resolve(stored.input.target_url);active();proxy=await createQualityProxy(policy);
      const executable=this.options.executablePath||this.environment.QUALITY_AGENT_BROWSER_PATH||this.environment.PLAYWRIGHT_EXECUTABLE_PATH;
      browser=await chromium.launch({headless:true,timeout:Math.max(1,Math.min(10000,deadline-Date.now())),proxy:{server:proxy.server,bypass:""},...(executable?{executablePath:executable}:{}),args:["--proxy-bypass-list=<-loopback>","--disable-quic","--disable-background-networking","--force-webrtc-ip-handling-policy=disable_non_proxied_udp"]});active();
      const context=await browser.newContext({viewport:stored.input.options?.viewport||{width:1280,height:800},deviceScaleFactor:1,locale:"en-US",timezoneId:"UTC",colorScheme:"light",reducedMotion:"reduce",serviceWorkers:"block",acceptDownloads:false});
      let blocked=0,requests=0,popups=0;const requestErrors:string[]=[],consoleErrors:string[]=[];
      await context.route("**/*",async route=>{requests++;if(requests>250){blocked++;controller.abort("resource_limit");await route.abort("blockedbyclient").catch(()=>undefined);return;}if(!policy.allows(route.request().url())){blocked++;await route.abort("blockedbyclient");return;}try{await policy.resolve(route.request().url());if(controller.signal.aborted)await route.abort();else await route.continue();}catch{blocked++;await route.abort("blockedbyclient").catch(()=>undefined);}});
      context.on("page",page=>{if(context.pages().length>1){popups++;void page.close();}});
      const page=await context.newPage();activePage=page;page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(Math.max(1,Math.min(30000,deadline-Date.now())));
      page.on("pageerror",error=>{if(consoleErrors.length<20)consoleErrors.push(safeText(error.message,500));});
      page.on("console",message=>{if(message.type()==="error"&&consoleErrors.length<20)consoleErrors.push(safeText(message.text(),500));});
      page.on("requestfailed",request=>{if(requestErrors.length<20)requestErrors.push(`${publicUrl(request.url())}: ${safeText(request.failure()?.errorText,120)}`);});
      await page.addInitScript(()=>{const observed={lcp:null as number|null,cls:0};(window as unknown as {__qualityMetrics:typeof observed}).__qualityMetrics=observed;try{new PerformanceObserver(list=>{for(const entry of list.getEntries())observed.lcp=entry.startTime;}).observe({type:"largest-contentful-paint",buffered:true});new PerformanceObserver(list=>{for(const entry of list.getEntries() as Array<PerformanceEntry&{hadRecentInput?:boolean;value?:number}>)if(!entry.hadRecentInput)observed.cls+=entry.value||0;}).observe({type:"layout-shift",buffered:true});}catch{/* Unsupported browser metrics remain unavailable. */}});
      await this.stage(stored,"browser","Opening a protected browser","completed");active();await this.stage(stored,"navigation","Navigating the approved target");
      const start=Date.now();let response:Response|null=await page.goto(stored.input.target_url,{waitUntil:stored.input.options?.wait_until||"load"});active();
      stored.run.metrics.navigation_wall_ms=Date.now()-start;stored.run.metrics.http_status=response?.status()||null;
      if(response&&response.status()>=400)findings([{id:"web-http-status",category:"navigation",severity:"high",title:"The target returned an HTTP error",description:"The browser's main document response was unsuccessful.",evidence:`HTTP ${response.status()} at ${publicUrl(page.url())}.`}]);
      await this.stage(stored,"navigation","Navigating the approved target","completed");await this.stage(stored,"analysis",`Running ${stored.input.kind} checks`);active();
      let visited=1;
      if(stored.input.kind==="web") {
        for(const [index,step] of (stored.input.options?.approved_steps||[]).entries()) {
          active();await this.stage(stored,`step-${index+1}`,`Step ${index+1}: ${step.action.replace(/_/g," ")}`);
          const before=page.url();const locator=page.locator(step.selector||"body");
          if(step.action==="click")await locator.click();
          if(step.action==="fill") {const sensitive=await locator.evaluate(element=>{const input=element as HTMLInputElement;return /password|token|secret|credential|api.?key|one.time.code|otp/i.test([input.type,input.name,input.id,input.autocomplete].join(" "));});if(sensitive)throw new QualityError("QUALITY_SENSITIVE_FIELD","This journey attempted to fill a sensitive field. Use a separately approved authenticated test workflow.",403);await locator.fill(step.value!);}
          if(step.action==="assert_text") {let matched=false;const end=Math.min(deadline,Date.now()+8000);while(Date.now()<end){active();if((await locator.innerText()).includes(step.text!)){matched=true;break;}await page.waitForTimeout(100);}if(!matched)throw new QualityError("QUALITY_ASSERTION_FAILED",`Step ${index+1}: expected text was not found in the approved element.`,422);}
          if(step.action==="assert_url") {const end=Math.min(deadline,Date.now()+8000);while(Date.now()<end&&new URL(page.url()).href!==new URL(step.url!).href){active();await page.waitForTimeout(100);}if(new URL(page.url()).href!==new URL(step.url!).href)throw new QualityError("QUALITY_ASSERTION_FAILED",`Step ${index+1}: the current URL did not match the reviewed expectation.`,422);}
          active();if(page.url()!==before)visited++;if(visited>(stored.input.limits?.max_pages||1))throw new QualityError("QUALITY_PAGE_LIMIT","The reviewed journey exceeded its page navigation limit.",422);await this.stage(stored,`step-${index+1}`,`Step ${index+1}: ${step.action.replace(/_/g," ")}`,"completed");
        }
        if(!stored.input.options?.approved_steps?.length&&((stored.input.limits?.max_pages||1)>1)){
          const links=await page.locator("a[href]").evaluateAll(nodes=>nodes.map(node=>(node as HTMLAnchorElement).href));
          const urls=[...new Set(links)].filter(value=>policy.allows(value)&&new URL(value).origin===new URL(stored.input.target_url).origin&&value!==stored.input.target_url&&!/logout|log-out|signout|delete|remove|unsubscribe/i.test(new URL(value).pathname)).slice(0,(stored.input.limits?.max_pages||1)-1);
          for(const url of urls){active();response=await page.goto(url,{waitUntil:"load"});visited++;if(response&&response.status()>=400)findings([{id:`web-link-${visited}`,category:"navigation",severity:"medium",title:"Linked page returned an HTTP error",description:"A bounded same-origin link navigation failed.",evidence:`HTTP ${response.status()} at ${publicUrl(url)}.`}]);}
        }
        stored.run.metrics.journey_steps_completed=stored.input.options?.approved_steps?.length||0;
        stored.run.limitations.push(stored.input.options?.approved_steps?.length?"Only the explicitly reviewed journey actions were performed. No model-generated actions or credential entry were executed.":"Bounded same-origin navigation smoke checks only. Forms were not submitted and business workflow completeness was not inferred.");
      }
      if(stored.input.kind==="security"){const scan=await scanSecurity(page,response);findings(scan.findings);Object.assign(stored.run.metrics,scan.metrics);stored.run.limitations.push(...scan.limitations);}
      if(stored.input.kind==="accessibility"){const scan=await scanAccessibility(page);findings(scan.findings);Object.assign(stored.run.metrics,scan.metrics);stored.run.limitations.push(...scan.limitations);if(scan.metrics.needs_manual_review&&!scan.findings.length)stored.run.outcome="needs_review";}
      if(stored.input.kind==="performance"){
        const metrics=await page.evaluate(()=>{const navigation=performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming|undefined;const resources=performance.getEntriesByType("resource") as PerformanceResourceTiming[];const observed=(window as unknown as {__qualityMetrics?:{lcp:number|null;cls:number}}).__qualityMetrics;return {dom_content_loaded_ms:navigation?.domContentLoadedEventEnd||null,load_ms:navigation?.loadEventEnd||null,ttfb_ms:navigation?navigation.responseStart-navigation.requestStart:null,lcp_ms:observed?.lcp??null,cls:observed?.cls??null,resource_count:resources.length,transfer_bytes:resources.reduce((sum,item)=>sum+item.transferSize,0)+(navigation?.transferSize||0),cross_origin_transfer_unknown:resources.filter(item=>item.transferSize===0&&new URL(item.name).origin!==location.origin).length};});
        Object.assign(stored.run.metrics,metrics);const budgets={navigation_ms:4000,lcp_ms:2500,cls:.1,resource_count:100,transfer_bytes:2000000,...stored.input.options?.budgets};
        for(const [key,budget] of Object.entries(budgets)){const metric=key==="navigation_ms"?stored.run.metrics.navigation_wall_ms:stored.run.metrics[key];if(typeof metric==="number"&&metric>budget)findings([{id:`performance-${key}`,category:"performance_budget",severity:"medium",title:`${key.replace(/_/g," ")} exceeds the reviewed budget`,description:"The observed browser navigation exceeded this explicit threshold.",evidence:`Observed ${metric}; budget ${budget}.`}]);stored.run.metrics[`budget_${key}`]=budget;}
        stored.run.limitations.push("One isolated Chromium navigation measurement; this is not load testing or a field Core Web Vitals assessment.","Resource transfer size may be hidden by cross-origin Timing-Allow-Origin policy. LCP is provisional at capture time; cache, network and machine load affect measurements.");
      }
      active();stored.run.metrics.visited_pages=visited;stored.run.metrics.browser_requests=requests;stored.run.metrics.blocked_requests=blocked;stored.run.metrics.blocked_popups=popups;
      if(blocked){stored.run.limitations.push(`${blocked} resource requests were blocked by target-origin, private-network or resource-count policy. Measurements reflect this constrained browser session.`);if(!stored.run.findings.length)stored.run.outcome="needs_review";}
      if(stored.input.kind==="web") {
        if(consoleErrors.length)findings([{id:"web-console-errors",category:"browser_error",severity:"medium",title:"Browser errors were observed",description:"The isolated browser reported page or console errors.",evidence:consoleErrors.join("\n")}]);
        if(requestErrors.length)findings([{id:"web-request-errors",category:"network",severity:"medium",title:"Some browser requests failed",description:"The browser reported failed resource requests; policy-blocked destinations may contribute.",evidence:requestErrors.join("\n")}]);
      }
      await this.stage(stored,"analysis",`Running ${stored.input.kind} checks`,"completed");await this.stage(stored,"artifacts","Saving browser evidence");
      await page.evaluate(async()=>{if(document.fonts)await document.fonts.ready;});active();
      const masks=["input[type=password]","[data-sensitive]",...(stored.input.options?.masks||[])].map(selector=>page.locator(selector));
      const screenshot=await page.screenshot({type:"png",animations:"disabled",caret:"hide",fullPage:false,mask:masks,maskColor:"#e5e7eb",timeout:8000});active();
      await this.artifact(stored,screenshot,stored.input.kind==="visual"?"Visual candidate.png":"Browser evidence.png","screenshot","image/png");
      if(stored.input.kind==="visual"){
        stored.run.limitations.push("Deterministic viewport pixel comparison. Animations and caret are disabled; font rendering, dynamic content and environment changes can still affect pixels. Baselines require an explicit human review.");
        const baselineId=stored.input.options?.baseline_id;
        if(!baselineId){stored.run.outcome="needs_review";stored.run.limitations.push("No reviewed baseline was supplied. The candidate screenshot is evidence for review, not a passing visual-regression result.");}
        else {
          const baseline=this.baselines.get(baselineId)!;const viewport=stored.input.options?.viewport||{width:1280,height:800};
          if(baseline.target_url!==stored.input.target_url||JSON.stringify(baseline.viewport)!==JSON.stringify(viewport)||JSON.stringify(baseline.masks)!==JSON.stringify(stored.input.options?.masks||[]))throw new QualityError("QUALITY_BASELINE_CONFIGURATION","The baseline target, viewport or masks do not match this run.",409);
          const bytes=await readFile(join(this.directory,"baselines",`${baseline.id}.png`));if(hash(bytes)!==baseline.sha256)throw new QualityError("QUALITY_BASELINE_CORRUPT","The reviewed baseline failed its integrity check.",409);
          const compared=comparePng(bytes,screenshot,stored.input.options?.pixel_threshold??16);Object.assign(stored.run.metrics,{changed_pixels:compared.changed_pixels,total_pixels:compared.total_pixels,diff_ratio:compared.diff_ratio,max_diff_ratio:stored.input.options?.max_diff_ratio??.005,pixel_threshold:stored.input.options?.pixel_threshold??16,baseline_id:baseline.id});
          await this.artifact(stored,compared.diff,"Visual difference.png","visual_diff","image/png");if(compared.diff_ratio>(stored.input.options?.max_diff_ratio??.005))findings([{id:"visual-pixel-change",category:"visual_regression",severity:"medium",title:"Rendered pixels exceed the reviewed difference budget",description:"The current viewport differs from its explicitly reviewed baseline.",evidence:`${compared.changed_pixels} of ${compared.total_pixels} pixels changed (${(compared.diff_ratio*100).toFixed(3)}%).`}]);
        }
      }
      active();stored.run.outcome=stored.run.outcome|| (stored.run.findings.length?"findings":"passed");stored.run.finished_at=timestamp();
      await this.stage(stored,"artifacts","Saving browser evidence","completed");await this.stage(stored,"completed","Checks finished","completed");
      await this.artifact(stored,Buffer.from(JSON.stringify({...stored.run,state:"completed"},null,2)),"Quality evidence.json","report","application/json");active();stored.run.state="completed";await this.persist(stored);
    }catch(error){
      if(stored.run.state!=="cancelled") {
        const failure=error instanceof QualityError?error:new QualityError("QUALITY_BROWSER_FAILED","The browser run could not complete. Check the target, browser installation and network policy.",500);
        const errorResult=controller.signal.reason==="timeout"?{code:"QUALITY_TIMEOUT",message:"The bounded browser run exceeded its time limit."}:controller.signal.reason==="resource_limit"?{code:"QUALITY_REQUEST_LIMIT",message:"The browser exceeded its 250-request limit."}:{code:failure.code,message:safeText(failure.message)};
        for(const stage of stored.run.stages)if(stage.status==="running")stage.status="failed";
        if(!controller.signal.aborted&&activePage&&!activePage.isClosed())try{const screenshot=await activePage.screenshot({type:"png",animations:"disabled",caret:"hide",fullPage:false,mask:[activePage.locator('input[type=password],[data-sensitive]'),...(stored.input.options?.masks||[]).map(selector=>activePage!.locator(selector))],timeout:2000});await this.artifact(stored,screenshot,"Failure evidence.png","screenshot","image/png");}catch{/* Failure capture is best effort and never changes the run outcome. */}
        // Cancellation may happen while failure evidence is being saved.
        if((stored.run as QualityRun).state!=="cancelled"){stored.run.state="failed";stored.run.outcome="error";stored.run.error=errorResult;stored.run.finished_at=timestamp();await this.persist(stored);}
      }
    }finally{clearTimeout(timer);controller.signal.removeEventListener("abort",abort);await browser?.close().catch(()=>undefined);await proxy?.close().catch(()=>undefined);this.controllers.delete(stored.run.id);}
  }
}
