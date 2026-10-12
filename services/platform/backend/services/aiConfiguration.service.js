const { createHash } = require('node:crypto');
const Ajv = require('ajv');
const db = require('../src/db');
const catalog = require('../../shared/aiFeatureCatalog.json');
const KEY = 'ai_feature_configuration:';
const byId = new Map(catalog.map(item => [item.id, item]));
const aliases = new Map(catalog.flatMap(item => [item.id, ...item.aliases].map(key => [key, item.id])));
const ajv = new Ajv({ allErrors: false, strict: true, validateFormats: false, ownProperties: true });
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, code: 'AI_CONFIGURATION_INVALID' });
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const featureId = (operation, usageKey) => {
  if (usageKey && !['ai.knowledge.assistant','ai.agentic.workflow','ai.agentic.quality_plan'].includes(usageKey) && aliases.has(usageKey)) return aliases.get(usageKey);
  return aliases.get(String(operation || '').replace(/\.json-mode-compatibility$/, '')) || aliases.get(usageKey) || null;
};
const definition = id => { const item = byId.get(id); if (!item) throw fail('Unknown AI feature.',404); return item; };

function validate(input, id) {
  const item = definition(id);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Provide a feature configuration object.');
  const allowed = Object.keys(item.defaults);
  if (Object.keys(input).some(key => !allowed.includes(key))) throw fail('Unknown configuration field.');
  const value = { ...copy(item.defaults), ...input };
  if(value.instruction_format_version!==3)throw fail('Reload the current instruction template format before saving.');
  for (const field of ['role','task','domain','prompt','guardrails']) {
    if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > (field === 'prompt' ? item.maxLength : field==='guardrails'?32768:16000)) throw fail(`Invalid ${field}: use bounded, nonempty text.`);
    value[field] = value[field].trim();
  }
  for (const [field,min,max,integer] of [['temperature',0,2,false],['top_p',0.01,1,false],['max_output_tokens',256,16384,true]]) {
    if (value[field] == null && field === 'top_p') continue;
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < min || value[field] > max || (integer && !Number.isSafeInteger(value[field]))) throw fail(`Invalid ${field}.`);
  }
  if (value.integration_id != null && (typeof value.integration_id !== 'string' || !value.integration_id.trim() || value.integration_id.length > 128)) throw fail('Invalid model integration.');
  const c = value.context;
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(key => !['mode','token_budget','max_items','required','focus'].includes(key)) || !['mcp','none'].includes(c.mode)
      || !Number.isSafeInteger(c.token_budget) || c.token_budget < 256 || c.token_budget > 8000 || !Number.isSafeInteger(c.max_items) || c.max_items < 1 || c.max_items > 40
      || typeof c.required !== 'boolean' || typeof c.focus !== 'string' || c.focus.length > 4000 || (c.mode === 'none' && c.required)) throw fail('Invalid MCP context policy.');
  if (item.defaults.context.mode === 'none' && c.mode !== 'none') throw fail('Retrieval planning, ingestion and embeddings cannot recursively retrieve context.');
  if (value.output_schema != null) {
    if (item.transport !== 'chat' || item.output_kind === 'html' || !value.output_schema || typeof value.output_schema !== 'object' || Array.isArray(value.output_schema) || value.output_schema.type !== 'object') throw fail('Output schema must describe a JSON object.');
    const encoded = JSON.stringify(value.output_schema);
    if (encoded.length > 24000) throw fail('Output schemas must fit within 24 KB.');
    // No remote references or executable expressions. Bound validation complexity.
    let nodes=0;
    const inspect=(node,depth=0)=>{ if (++nodes>1000 || depth>12) throw fail('Output schema is too complex.');
      if (node && typeof node==='object') for(const [key,val] of Object.entries(node)) {
        if (['$ref','$dynamicRef','$recursiveRef','$id','$async','pattern','patternProperties','format'].includes(key)) throw fail(`Schema keyword ${key} is not supported.`);
        inspect(val,depth+1);
      }
    }; inspect(value.output_schema);
    try { ajv.compile(value.output_schema); } catch(error) { throw fail('Invalid output schema: '+String(error.message).slice(0,300)); }
  }
  const blocks=value.instruction_blocks;
  if(!blocks || typeof blocks!=='object' || Array.isArray(blocks) || Object.keys(blocks).length!==Object.keys(item.defaults.instruction_blocks).length)throw fail('Instruction blocks must preserve the registered block keys.');
  for(const [key,original] of Object.entries(item.defaults.instruction_blocks)) {
    if(typeof blocks[key]!=='string'||(!blocks[key].trim()&&!item.optional_instruction_blocks?.includes(key))||blocks[key].length>(item.instruction_limits?.[key]||16000))throw fail(`Invalid instruction block: ${key}.`);
    if(blocks[key].includes('⟦HELLOTEST_AI:'))throw fail('Instruction blocks cannot contain nested runtime markers.');
  }
  if(Object.keys(blocks).some(key=>!Object.hasOwn(item.defaults.instruction_blocks,key)))throw fail('Unknown instruction block.');
  if (Buffer.byteLength(JSON.stringify(value)) > 200000) throw fail('Configuration exceeds 200 KB.');
  return value;
}
async function legacyOverrides() {
  const rows = await db.prepare('SELECT key,value FROM app_settings WHERE key IN (?,?)').all('workspace_governed_preference:ai_prompt_registry_overrides','workspace_governed_preference:ai_prompt_registry_llm_overrides');
  return Object.fromEntries(rows.map(row => [row.key.split(':').at(-1),row.value || {}]));
}
function adaptStored(item, stored, inheritedBlocks=item.defaults.instruction_blocks) {
  const config={...copy(item.defaults),...stored,instruction_format_version:3};
  const previous={...stored?.instruction_blocks};
  const format=stored?.instruction_format_version || 1;
  if(format<2) for(const [key,fragments] of Object.entries(item.legacy_instruction_block_migrations || item.instruction_block_migrations || {})) {
    if(fragments.slice(1).some(fragment=>Object.hasOwn(previous,fragment.key)))previous[key]=fragments.map(fragment=>typeof previous[fragment.key]==='string'?previous[fragment.key]:fragment.default).join('\n');
  }
  if(format<3 && item.guardrail_migration) {
    const old=item.guardrail_migration,policy=previous['platform.requestPolicy'] || old.request_policy;
    config.guardrails=config.guardrails===old.default && policy===old.request_policy ? item.defaults.guardrails : [config.guardrails,policy].filter(Boolean).join('\n\n');
  }
  if(item.prompt_default_migrations?.includes(config.prompt))config.prompt=item.defaults.prompt;
  config.instruction_blocks=Object.fromEntries(Object.entries(item.defaults.instruction_blocks).map(([key,value])=>{
    const fragments=item.instruction_layout_migrations?.[key];
    // Historical versions used one field per template line. Preserve every
    // reviewed edit when loading drafts, published versions and rollbacks.
    if(format<3 && fragments?.some(fragment=>Object.hasOwn(previous,fragment.key))) {
      return [key,fragments.map(fragment=>typeof previous[fragment.key]==='string'?previous[fragment.key]:fragment.default).join('\n')];
    }
    if(key.startsWith('template.') && item.legacy_instruction_blocks?.[key]===previous[key])return [key,value];
    return [key,typeof previous[key]==='string'?previous[key]:inheritedBlocks[key] ?? value];
  }));
  if(format<3 && item.legacy_instruction_blocks) {
    const transferred=new Set(Object.values(item.instruction_layout_migrations || {}).flat().map(fragment=>fragment.key));
    const edits=Object.entries(item.legacy_instruction_blocks).filter(([key,original])=>!transferred.has(key)&&!key.startsWith('template.')&&typeof previous[key]==='string'&&previous[key]!==original);
    config.instruction_blocks['legacy.reviewed']=edits.map(([key,value])=>`Previously reviewed guidance (${key}):\n${previous[key]}`).join('\n\n');
  }
  return config;
}
function effective(item, record, legacy={}, parent=null, instructionSources=[]) {
  const base = copy(item.defaults);
  for(const source of instructionSources) for(const [key,value] of Object.entries(source.config.instruction_blocks)) {
    if(Object.hasOwn(base.instruction_blocks,key))base.instruction_blocks[key]=value;
  }
  const inherited = !record?.published && parent && (parent.published_version || parent.fingerprint !== hash(parent.defaults));
  if (inherited) {
    for (const key of ['temperature','top_p','max_output_tokens','context','integration_id','guardrails','output_schema']) base[key] = copy(parent.config[key]);
    base.prompt = `${parent.config.prompt}\nSpecific agent intent: ${item.defaults.prompt}`.slice(0,item.maxLength);
    base.instruction_blocks = Object.fromEntries(Object.entries(item.defaults.instruction_blocks).map(([key,value])=>[key,parent.config.instruction_blocks?.[key] || value]));
  }
  const oldPrompt = legacy.ai_prompt_registry_overrides?.[item.id];
  if (typeof oldPrompt === 'string' && oldPrompt.trim()) base.prompt=item.prompt_default_migrations?.includes(oldPrompt)?item.defaults.prompt:oldPrompt.slice(0,item.maxLength);
  const oldIntegration = legacy.ai_prompt_registry_llm_overrides?.[item.id];
  if (typeof oldIntegration==='string' && oldIntegration.trim()) base.integration_id=oldIntegration;
  const config=record?.published?adaptStored(item,record.published.config,base.instruction_blocks):base;
  return { ...item, defaults: copy(item.defaults), config, revision:record?.revision || 0,
    inherited_from:inherited?{id:parent.id,version:parent.published_version,fingerprint:parent.fingerprint}:null,
    published_version:record?.published?.version || 0, published_at:record?.published?.at || null,
    draft:record?.draft?{...record.draft,config:adaptStored(item,record.draft.config,base.instruction_blocks)}:null, history:record?.history || [], fingerprint:hash(config) };
}
function publicFeature(profile) {
  const {instruction_block_migrations,legacy_instruction_blocks,legacy_instruction_block_migrations,instruction_layout_migrations,guardrail_migration,prompt_default_migrations,...result}=profile;
  return result;
}
async function list() {
  const [rows,legacy] = await Promise.all([db.prepare('SELECT key,value FROM app_settings WHERE key LIKE ?').all(KEY+'%'),legacyOverrides()]);
  const records = new Map(rows.map(row=>[row.key.slice(KEY.length),row.value]));
  const resolved = new Map();
  const resolveItem = item => { if (!resolved.has(item.id)) resolved.set(item.id,effective(item,records.get(item.id),legacy,item.parent_id ? resolveItem(definition(item.parent_id)) : null,(item.instruction_sources||[]).map(id=>resolveItem(definition(id))))); return resolved.get(item.id); };
  return { features:catalog.map(item=>publicFeature(resolveItem(item))), groups:[...new Set(catalog.map(item=>item.group))],
    protections:['Verified project permissions','MCP identity and source ACLs','Native artifact validators','Reviewed writes and execution limits'], retention_days:14 };
}
async function resolve(id) {
  const item=definition(id);
  const row=await db.prepare("SELECT jsonb_build_object('published',value->'published','revision',value->'revision') AS value FROM app_settings WHERE key = ?").get(KEY+id);
  return effective(item,row?.value,row?.value?.published?{}:await legacyOverrides(),item.parent_id && !row?.value?.published ? await resolve(item.parent_id) : null,await Promise.all((item.instruction_sources||[]).map(resolve)));
}
async function detail(id) {
  const item=definition(id);
  const row=await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY+id);
  return publicFeature(effective(item,row?.value,await legacyOverrides(),item.parent_id && !row?.value?.published ? await resolve(item.parent_id) : null,await Promise.all((item.instruction_sources||[]).map(resolve))));
}
async function checkProvider(config) {
  if(!config?.integration_id)return;
  let provider;
  try{provider=await require('@hellotest/integration/backend/services/integration.service').getIntegration(config.integration_id);}catch{throw fail('The configured LLM integration is unavailable. Select an active provider before publication.',422);}
  if(provider.type!=='llm'||!provider.is_active)throw fail('Select an active LLM integration.',422);
}
async function mutate(id, body, actor, mode) {
  if (!['draft','publish','rollback'].includes(mode)) throw fail('Unsupported AI configuration action.');
  if (definition(id).runtime_status === 'reserved') throw fail('This reserved profile has no model invocation to configure.',422);
  if(definition(id).transport==='embedding')throw fail('Embedding models follow the Knowledge Assistant integration to preserve document/query index compatibility. Manage them in Backend integrations.',422);
  if (!body || !Number.isSafeInteger(body.expected_revision) || body.expected_revision<0) throw fail('An expected revision is required.');
  const config=mode==='rollback'?null:validate(body.config,id);
  await checkProvider(config);
  return db.transaction(async()=>{
    // Serialize all writers including a feature's first publication.
    await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(KEY+id);
    const row=await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY+id);
    const current=row?.value||{revision:0,history:[]};
    if(current.revision!==body.expected_revision)throw fail('This feature changed. Reload and review the latest version before saving.',409);
    const next={...current,revision:current.revision+1};
    if(mode==='draft') next.draft={config,at:new Date().toISOString(),actor_id:actor.actorId};
    else {
      if(mode==='rollback'&&(!Number.isSafeInteger(body.version)||body.version<1))throw fail('Choose an available historical version.');
      const historical=mode==='rollback'?await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`ai_feature_version:${id}:${body.version}`):null;
      const restored=mode==='rollback'?historical?.value?.config||current.history.find(v=>v.version===body.version)?.config:config;
      if(!restored)throw fail('The selected historical version is unavailable.',404);
      // Early records kept reviewed snapshots inline. Archive them before
      // reducing history to metadata, so publication cannot erase rollback data.
      for(const snapshot of (current.history||[]).slice(0,30))if(snapshot.config&&Number.isSafeInteger(snapshot.version)&&snapshot.version>0) {
        await db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING').run(`ai_feature_version:${id}:${snapshot.version}`,snapshot);
      }
      const version={config:validate(adaptStored(definition(id),restored),id),version:(current.published?.version||0)+1,at:new Date().toISOString(),actor_id:actor.actorId};
      await db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING').run(`ai_feature_version:${id}:${version.version}`,version);
      await checkProvider(version.config);
      next.published=version;next.draft=null;next.history=[version,...(current.history||[])].slice(0,30).map(({config,...metadata})=>metadata);
      if(version.version>30)await db.prepare('DELETE FROM app_settings WHERE key = ?').run(`ai_feature_version:${id}:${version.version-30}`);
    }
    await db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP').run(KEY+id,next);
    await require('./adminPortal.service').recordAudit({...actor,action:`ai_configuration.${mode}`,targetType:'ai_feature',targetId:id,summary:`${mode==='draft'?'Saved draft for':mode==='rollback'?'Restored':'Published'} ${definition(id).label}.`,metadata:{revision:next.revision,version:next.published?.version||0,fingerprint:hash(config||next.published.config)}});
    return effective(definition(id),next,await legacyOverrides());
  })();
}
async function publishedOverrides() {
  const rows=await db.prepare("SELECT key,value->'published' AS published FROM app_settings WHERE key LIKE ?").all(KEY+'%');
  const prompts={},integrations={};
  for(const row of rows) {const id=row.key.slice(KEY.length),config=row.published?.config;if(config&&byId.has(id)){prompts[id]=config.prompt;integrations[id]=config.integration_id;}}
  return {prompts,integrations};
}
async function metrics() {
  const obs=require('../src/obsDb');
  const result=await obs.pool.query({text:`SELECT feature,operation,capture->>'configuration_version' AS configuration_version,COUNT(*)::integer calls,
    COUNT(*) FILTER(WHERE status='succeeded')::integer successes,
    COUNT(*) FILTER(WHERE status IN ('failed','invalid'))::integer failures,
    COUNT(*) FILTER(WHERE status='invalid')::integer invalid,
    COUNT(*) FILTER(WHERE correction_of IS NOT NULL)::integer corrections,
    COUNT(*) FILTER(WHERE capture->>'mcp_context' IN ('unavailable','scope_missing'))::integer context_gaps,
    COUNT(*) FILTER(WHERE capture->>'configuration_version' IS NULL)::integer unconfigured,
    ROUND(AVG(duration_ms))::integer average_ms,percentile_cont(0.95) WITHIN GROUP(ORDER BY duration_ms) p95_ms,
    COALESCE(SUM(CASE WHEN usage->>'total_tokens' ~ '^[0-9]{1,16}$' THEN (usage->>'total_tokens')::bigint ELSE 0 END),0)::text total_tokens,
    COUNT(*) FILTER(WHERE usage->>'total_tokens' IS NULL)::integer usage_unknown
    FROM llm_request_traces WHERE started_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AND expires_at > CURRENT_TIMESTAMP
    GROUP BY feature,operation,capture->>'configuration_version' ORDER BY calls DESC LIMIT 250`,values:[],query_timeout:4000});
  return {items:result.rows,window_hours:24,retention_days:14,trace_storage:require('../src/utils/llmTraceCapture').diagnostics(),note:'Provider transport outcomes, not semantic quality scores. Unknown token usage is reported separately.'};
}
module.exports={list,detail,resolve,mutate,metrics,publishedOverrides,featureId,validate,catalog,hash};

module.exports.optimize = async (id, input, actor) => {
  if (definition(id).runtime_status === 'reserved') throw fail('This reserved profile has no model invocation to optimize.',422);
  if(input.integration_id!=null&&(typeof input.integration_id!=='string'||!input.integration_id.trim()||input.integration_id.length>128))throw fail('Invalid optimizer integration.');
  const config=validate(input.config,id);
  const selection=require('@hellotest/integration/backend/services/aiLlmSelection.service');
  const integration=await selection.resolveLlmIntegrationForUsage({userId:actor.actorId,usageKey:'ai.admin.prompt_optimization',integrationId:input.integration_id||undefined,allowMissing:true});
  if(!integration)throw fail('Configure an active LLM integration before optimizing a prompt.',422);
  const safe=require('../src/security/aiTextPolicy').sanitizeAiText(JSON.stringify({feature:{id,label:definition(id).label,domain:definition(id).group},configuration:{role:config.role,domain:config.domain,task:config.task,prompt:config.prompt,guardrails:config.guardrails,instruction_blocks:config.instruction_blocks,output_schema:config.output_schema}})).text;
  const base=String(integration.base_url||'https://api.openai.com/v1').replace(/\/+$/,'');
  const response=await require('../src/utils/llmTraceContext').run({actor_id:actor.actorId,project_id:null},()=>require('../src/utils/llmHttpClient').fetchLlmWithRetry(/\/chat\/completions$/.test(base)?base:`${base}/chat/completions`,{
    method:'POST',headers:{'Content-Type':'application/json',...(integration.api_key?{Authorization:`Bearer ${integration.api_key}`}:{})},body:JSON.stringify({model:integration.model,response_format:{type:'json_object'},messages:[{role:'user',content:safe}]})
  },{integration,operation:'admin.prompt.optimize',timeoutMs:45000,maxAttempts:1,contextFallback:false,maxOutputTokens:4096}));
  if(!response.ok)throw require('../src/utils/upstreamLlmError').createLlmProviderError({status:response.status,detail:await response.text()});
  let value;try{value=JSON.parse(require('../src/utils/llmResponse').getCompletionContent(await response.json()).trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,''));}catch{throw fail('The optimizer returned invalid JSON. No configuration was changed.',502);}
  const fields=['role','task','domain','prompt','guardrails'];
  if(!value?.proposal || Object.keys(value.proposal).some(key=>!fields.includes(key)&&key!=='instruction_blocks') || fields.some(key=>typeof value.proposal[key]!=='string') || typeof value.summary!=='string' || value.summary.length>2000 || !Array.isArray(value.changes) || value.changes.length>20 || value.changes.some(item=>typeof item!=='string'||item.length>1000))throw fail('The optimizer returned an unsupported proposal. No configuration was changed.',502);
  const edits=value.proposal.instruction_blocks;
  if(edits!=null && (typeof edits!=='object'||Array.isArray(edits)||Object.keys(edits).some(key=>!Object.hasOwn(config.instruction_blocks,key))))throw fail('The optimizer cannot introduce instruction templates.',502);
  const proposal=validate({...config,...value.proposal,instruction_blocks:{...config.instruction_blocks,...edits}},id);
  await require('./adminPortal.service').recordAudit({...actor,action:'ai_configuration.optimize',targetType:'ai_feature',targetId:id,summary:`Prepared optimization suggestions for ${definition(id).label}.`,metadata:{fingerprint:hash(config)}});
  return {proposal,summary:value.summary,changes:value.changes,trace_id:response.headers.get('x-hellotest-llm-trace-id'),published:false};
};
