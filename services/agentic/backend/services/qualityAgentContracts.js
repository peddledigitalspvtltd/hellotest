const { createHash } = require('node:crypto');
const fail = (message, statusCode = 400, code = 'QUALITY_AGENT_INVALID') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const text = (value, maximum = 500) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const hasSensitiveValue = value => /\b(?:Bearer|Basic)\s+\S+|-----BEGIN\s.*PRIVATE KEY|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\bsk-[A-Za-z0-9_-]{16,}|\bmcp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i.test(String(value||''));
const CREDENTIAL_VALUE=/^(?:mcp1\.|sk-|eyJ)/i;
const KINDS = new Set(['web','security','performance','accessibility','visual']);
const STATUS = new Set(['queued','running','completed','failed','cancelled']);
const LIMITS = Object.freeze({ max_pages: 5, max_duration_ms: 120000, max_steps: 12, max_artifact_bytes: 8 * 1024 * 1024 });
const AGENTS = [
  { id:'web',name:'Web Journey',description:'Autonomously crawl and perform bounded browser tasks using live page observations, or execute a reviewed journey.',checks:['Reviewed clicks, non-secret form inputs and observable assertions','Navigation failures, console errors and page evidence','Live observation/action/report loop over up to five same-origin pages'],limitations:['Credentials use configured project- and origin-scoped references; no secret values enter prompts','Autonomous missions require a model connection and reviewed execution scope; destructive/payment/communication actions need a separate workflow'],goal_support:'reviewed_journey' },
  { id:'security',name:'Security Posture',description:'Inspect browser-visible transport and response policies.',checks:['Security response headers','HTTPS and exposed browser policy configuration'],limitations:['Passive observations only; no exploitation, authenticated audit or penetration testing'],goal_support:'bounded_checks' },
  { id:'performance',name:'Navigation Performance',description:'Measure one browser navigation against explicit budgets.',checks:['Navigation timing and available LCP/CLS observations','Resource count and transfer bytes','Configured metric budgets'],limitations:['One browser navigation; not load testing or representative production percentiles'],goal_support:'bounded_checks' },
  { id:'accessibility',name:'Accessibility Review',description:'Inspect accessibility rules with selector-level evidence.',checks:['Engine-reported accessibility rules','Elements and labels requiring review'],limitations:['Automated rules do not certify WCAG conformance; manual review remains necessary'],goal_support:'bounded_checks' },
  { id:'visual',name:'Visual Regression',description:'Capture a screenshot and compare against an explicitly reviewed baseline.',checks:['Fixed viewport and explicit masks','Screenshot content hash and pixel difference evidence','Baseline approval before comparison'],limitations:['First capture requires baseline review and does not pass regression','Dynamic content and environment differences may require investigation'],goal_support:'bounded_checks' }
];
function targetUrl(value) {
  let url; try { url = new URL(value); } catch { throw fail('Enter a valid HTTP or HTTPS application URL.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw fail('Use an HTTP or HTTPS URL without embedded credentials.');
  if(hasSensitiveValue(decodeURIComponentSafe(url.href)))throw fail('Do not include authentication tokens or private keys in this URL.');
  if ([...url.searchParams.keys()].some(key=>/(?:password|passwd|secret|token|api.?key|authorization|credential)/i.test(key))) throw fail('Remove secret or authentication query parameters from this URL.');
  if (url.href.length > 2000) throw fail('Keep the application URL within 2,000 characters.');
  url.hash=''; return url.toString();
}
function decodeURIComponentSafe(value){try{return decodeURIComponent(value);}catch{return value;}}
function number(value, fallback, minimum, maximum, label) {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw fail(`${label} must be between ${minimum} and ${maximum}.`);
  return value;
}
function taskBrief(request) {
  const agent = AGENTS.find(item => item.id === request.kind);
  if (!agent) throw fail('Choose a supported quality agent.');
  return {agent_id:`browser-${agent.id}`,name:agent.name,intent:agent.description,goal:request.goal || '',
    checks:[...agent.checks],limitations:[...agent.limitations],target_url:request.target_url,
    execution_scope:{max_pages:request.options?.max_pages,max_duration_ms:request.options?.timeout_ms,
      ...(request.options?.mission || {})}};
}
function normalizeOptions(input = {}, kind) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Choose valid agent settings.');
  const options = { timeout_ms:number(input.timeout_ms,60000,5000,LIMITS.max_duration_ms,'Timeout'),max_pages:number(input.max_pages,1,1,LIMITS.max_pages,'Page count'),viewport:{ width:number(input.viewport?.width,1280,320,1920,'Viewport width'),height:number(input.viewport?.height,800,240,1200,'Viewport height') },wait_until:input.wait_until || 'domcontentloaded' };
  if (![options.timeout_ms,options.max_pages,options.viewport.width,options.viewport.height].every(Number.isSafeInteger)) throw fail('Timeout, page count and viewport dimensions must be whole numbers.');
  if (!['domcontentloaded','load'].includes(options.wait_until)) throw fail('Choose a supported navigation wait mode.');
  if(input.credential_ref!=null){if(typeof input.credential_ref!=='string'||CREDENTIAL_VALUE.test(input.credential_ref)||hasSensitiveValue(input.credential_ref)||! /^[A-Za-z0-9_.:-]{1,128}$/.test(input.credential_ref))throw fail('Choose a configured credential reference, never a credential value.');options.credential_ref=input.credential_ref;}
  if(input.mission!=null){const m=input.mission;if(!m||typeof m!=='object'||typeof m.allow_form_submission!=='boolean'||!Number.isSafeInteger(m.max_actions)||m.max_actions<1||m.max_actions>12)throw fail('Review a browser mission with 1–12 actions and an explicit form submission policy.');options.mission={max_actions:m.max_actions,allow_form_submission:m.allow_form_submission};}
  if (input.masks != null) {
    if (!Array.isArray(input.masks) || input.masks.length > 20 || input.masks.some(item=>typeof item !== 'string' || !item.trim() || item.length > 240)) throw fail('Choose at most twenty CSS masks, each within 240 characters.');
    options.masks=[...new Set(input.masks.map(item=>item.trim()))];
  }
  if (input.budgets != null) {
    if (typeof input.budgets !== 'object' || Array.isArray(input.budgets)) throw fail('Choose valid performance budgets.');
    const ranges={navigation_ms:[100,120000],lcp_ms:[100,120000],cls:[0,10],resource_count:[1,250],transfer_bytes:[1000,100000000]};
    options.budgets=Object.fromEntries(Object.entries(input.budgets).map(([key,value])=>{
      if (!ranges[key]) throw fail('Choose a supported performance metric.');
      return [key,number(value,undefined,...ranges[key],key)];
    }));
  }
  if (kind==='visual') {
    options.max_diff_ratio=number(input.max_diff_ratio,.005,0,1,'Allowed visual difference ratio');
    options.pixel_threshold=number(input.pixel_threshold,16,0,255,'Pixel threshold');
    if(!Number.isSafeInteger(options.pixel_threshold))throw fail('Pixel threshold must be a whole number.');
  }
  return options;
}
function normalizeSteps(steps, url) {
  if (!Array.isArray(steps) || steps.length > LIMITS.max_steps) throw fail('Review at most twelve typed journey steps.');
  return steps.map((step,index)=>{
    if (!step || !['click','fill','assert_text','assert_url'].includes(step.action)) throw fail('Journey steps must use supported browser actions.');
    const next={id:`step-${index+1}`,action:step.action,label:text(step.label,120) || `${step.action.replace('_',' ')} ${index+1}`};
    if (['click','fill','assert_text'].includes(step.action)) {
      if (typeof step.selector !== 'string' || !step.selector.trim() || step.selector.length>240 || /[\u0000-\u001f]/.test(step.selector)) throw fail(`Step ${index+1} needs a CSS selector within 240 characters, without control characters.`);
      next.selector=step.selector.trim();
    }
    if (step.action==='fill') {
      if (/password|passwd|secret|token|otp|credential|api.?key|credit.?card|cvv/i.test(next.selector)) throw fail('Secret, password and payment credential filling is unavailable in this isolated runner.');
      if (typeof step.value!=='string' || step.value.length>500 || /[\u0000-\u001f]/.test(step.value)) throw fail(`Step ${index+1} needs an input value within 500 characters, without control characters.`);
      if (hasSensitiveValue(step.value)) throw fail('Do not persist authentication tokens or private keys as journey inputs.');
      next.value=step.value;
    }
    if (step.action==='assert_text') {
      if (!text(step.text) || step.text.length>500 || /[\u0000-\u001f]/.test(step.text)) throw fail(`Step ${index+1} needs expected text within 500 characters, without control characters.`);
      next.text=step.text.trim();
    }
    if (step.action==='assert_url') {
      next.url=targetUrl(step.url);
      if (new URL(next.url).origin!==new URL(url).origin) throw fail('Journey URLs must remain on the selected application origin.');
    }
    return next;
  });
}
function contextSelection(input = {}) {
  const ids = value => Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0,255)))].slice(0,100) : [];
  const smart = input.smart_context || {};
  return { llm_integration_id: text(input.llm_integration_id,255) || null,
    context_scopes: ids(input.context_scopes || require('@hellotest/platform/shared/agentContextPolicies.json')[`browser-${input.kind}`]?.scopes || []).filter(scope => ['stories','test-cases','automation','runs','bugs','knowledge'].includes(scope)),
    evidence_scope: Object.fromEntries(require('@hellotest/platform/shared/agentEvidenceScopeFields.json').map(field => field.key).filter(key => text(input.evidence_scope?.[key],255)).map(key => [key,text(input.evidence_scope[key],255)])),
    smart_context: { query: text(smart.query,2000), source_ids: ids(smart.source_ids), source_kinds: ids(smart.source_kinds).slice(0,20),
      reviewed_context: require('@hellotest/platform/backend/src/security/aiTextPolicy').sanitizeAiText(text(smart.reviewed_context,12000)).text },
  };
}
function normalizeLaunch(input) {
  if (!KINDS.has(input?.kind)) throw fail('Choose a supported quality agent.');
  const project_id=text(input.project_id,255); if (!project_id || input.project_id.length>255) throw fail('Select a project.');
  const target_url=targetUrl(input.target_url),goal=text(input.goal || input.reviewed_plan?.goal,1500),options=normalizeOptions(input.options,input.kind);
  if ((typeof input.goal==='string'&&input.goal.length>1500)||(typeof input.reviewed_plan?.goal==='string'&&input.reviewed_plan.goal.length>1500)) throw fail('Keep the review goal within 1,500 characters.');
  if(hasSensitiveValue(goal))throw fail('Remove authentication tokens and private keys from the review goal.');
  let reviewed_plan;
  if (input.reviewed_plan) {
    if (input.kind!=='web' || input.reviewed_plan.reviewed!==true) throw fail('Explicitly review the Web Journey before running its steps.');
    reviewed_plan={reviewed:true,goal,steps:normalizeSteps(input.reviewed_plan.steps,target_url)};
  }
  if(options.mission&&!goal)throw fail('Describe the browser mission goal.');
  if (input.kind==='web' && goal && !options.mission && !reviewed_plan?.steps.length) throw fail('Review a concrete journey plan for this goal, or run the URL preset without a goal.',422,'QUALITY_AGENT_PLAN_REQUIRED');
  return {...contextSelection(input),project_id,app_type_id:text(input.app_type_id,255)||null,integration_id:text(input.integration_id,255)||null,kind:input.kind,target_url,goal,options,baseline_id:text(input.baseline_id,255)||null,...(reviewed_plan?{reviewed_plan}:{})};
}
function validateEngineRun(value, expected) {
  if (!value || value.contract_version!=='1.0' || !STATUS.has(value.state) || value.client_run_id!==expected.id || value.kind!==expected.kind || value.scope?.project_id!==expected.project_id || (value.scope?.app_type_id||null)!==(expected.app_type_id||null) || value.target_url!==expected.target_url || typeof value.id!=='string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.id) || (expected.engine_run_id&&value.id!==expected.engine_run_id)) throw fail('The Test Engine returned an invalid or incorrectly scoped run.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  if (!Array.isArray(value.findings) || value.findings.length>250 || !Array.isArray(value.artifacts) || value.artifacts.length>30 || !Array.isArray(value.stages) || value.stages.length>30 || !Array.isArray(value.limitations) || value.limitations.length>50 || !value.metrics || typeof value.metrics!=='object' || Array.isArray(value.metrics)) throw fail('The Test Engine returned incomplete quality evidence.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  for (const artifact of value.artifacts) if (!artifact || !/^[a-zA-Z0-9_-]{1,128}$/.test(artifact.id) || !['screenshot','visual_diff','report'].includes(artifact.type) || !['image/png','application/json','text/plain'].includes(artifact.content_type) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes<0 || artifact.bytes>LIMITS.max_artifact_bytes || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw fail('The Test Engine returned an invalid artifact manifest.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  for (const finding of value.findings) if (!finding || !['info','low','medium','high','critical'].includes(finding.severity) || !text(finding.id,128) || typeof finding.evidence!=='string' || typeof finding.title!=='string' || typeof finding.description!=='string') throw fail('The Test Engine returned invalid findings.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  if(value.findings.some(f=>f.id.length>128||f.title.length>300||f.description.length>4000||f.evidence.length>12000||typeof f.category!=='string'||f.category.length>150||f.selector?.length>500||f.recommendation?.length>4000)||value.limitations.some(x=>typeof x!=='string'||x.length>2000)||value.artifacts.some(a=>typeof a.name!=='string'||a.name.length>160)) throw fail('The Test Engine returned evidence exceeding its contract limits.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  for (const stage of value.stages) if (!stage || !['pending','running','completed','failed'].includes(stage.status) || typeof stage.id!=='string' || !stage.id.trim() || stage.id.length>128 || typeof stage.label!=='string' || stage.label.length>1200) throw fail('The Test Engine returned invalid execution stages.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  if (Object.keys(value.metrics).length>80 || Object.values(value.metrics).some(metric=>!['string','number','boolean'].includes(typeof metric)&&metric!==null) || Object.values(value.metrics).some(metric=>typeof metric==='number'&&!Number.isFinite(metric))) throw fail('The Test Engine returned invalid metrics.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  if (value.outcome!=null && !['passed','findings','needs_review','error'].includes(value.outcome)) throw fail('The Test Engine returned an invalid outcome.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
  if(value.decision_request)require('./browserMissionPlanner').observation(value.decision_request,expected.target_url);
  if(value.mission_report){const report=value.mission_report;if(!['running','completed','blocked','limit_reached','cancelled'].includes(report.status)||typeof report.summary!=='string'||report.summary.length>1200||!Array.isArray(report.actions)||report.actions.length>12||report.actions.some(a=>!Number.isSafeInteger(a.sequence)||typeof a.summary!=='string'||a.summary.length>1200||typeof a.url!=='string'||a.url.length>2000))throw fail('The engine returned an invalid mission report.',502,'QUALITY_AGENT_ENGINE_CONTRACT');}
  return value;
}
module.exports={taskBrief,contextSelection,AGENTS,LIMITS,KINDS,STATUS,fail,hash,text,hasSensitiveValue,targetUrl,normalizeOptions,normalizeSteps,normalizeLaunch,validateEngineRun};
