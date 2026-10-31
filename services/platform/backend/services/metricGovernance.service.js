const db=require('../src/db');
const {createHash}=require('node:crypto');
const catalog=require('../../shared/metricCatalog.json');
const {normalizeFormulaValues}=require('../../shared/metricFormulaValues');
const byId=new Map(catalog.map(item=>[item.key,item]));
const KEY='metric_governance:',VERSIONS='metric_governance_version:';
const GROUPS={project:'Project portfolio',story:'Stories',test:'Test design',execution:'Execution',release:'Release readiness',automation:'Automation',defect:'Defects',assurance:'Assurance',smart_run:'Smart runs',analytics:'Quality analytics',dashboard:'Dashboards',jira:'Issue delivery',ai:'AI quality',quality:'Verified quality evidence',knowledge:'Knowledge evidence'};
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,code:'METRIC_GOVERNANCE_INVALID'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const definition=id=>{const item=byId.get(id);if(!item)throw fail('Unknown metric.',404);return item;};
const defaults=item=>({criteria:item.criteria,parameters:Object.fromEntries((item.parameters||[]).map(p=>[p.key,p.defaultValue]))});
function validate(input,id){
 const item=definition(id);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['criteria','parameters'].includes(key)))throw fail('Only review criteria and registered formula values can be configured.');
 if(typeof input.criteria!=='string'||!input.criteria.trim()||input.criteria.length>8000)throw fail('Review criteria must contain 1–8,000 characters.');
 if(!input.parameters||typeof input.parameters!=='object'||Array.isArray(input.parameters))throw fail('Provide a formula parameter object.');
 const parameters=item.parameters||[];
 if(Object.keys(input.parameters).length!==parameters.length||Object.keys(input.parameters).some(key=>!parameters.some(p=>p.key===key)))throw fail('Preserve the registered formula parameter keys.');
 const values={};
 for(const p of parameters){const value=input.parameters[p.key],step=p.step||1;if(typeof value!=='number'||!Number.isFinite(value)||value<p.min||value>p.max||Math.abs((value-p.min)/step-Math.round((value-p.min)/step))>1e-7)throw fail(`${p.label} must be between ${p.min} and ${p.max} in increments of ${step}.`);values[p.key]=value;}
 if(id==='metric.project.portfolio_health'&&Math.abs(Object.values(values).reduce((sum,value)=>sum+value,0)-100)>1e-7)throw fail('Portfolio weights must total exactly 100%.');
 return {criteria:input.criteria.trim(),parameters:values};
}
async function legacy(){
 const rows=await db.prepare('SELECT key,value FROM app_settings WHERE key IN (?,?,?)').all('workspace_governed_preference:ai_metric_criteria_overrides','workspace_governed_preference:ai_metric_formula_values','workspace_metric_formula_values');
 const values=Object.fromEntries(rows.map(row=>[row.key,row.value||{}]));
 const previous=values.workspace_metric_formula_values||{},governed=values['workspace_governed_preference:ai_metric_formula_values']||{};
 return {criteria:values['workspace_governed_preference:ai_metric_criteria_overrides']||{},parameters:Object.fromEntries([...new Set([...Object.keys(previous),...Object.keys(governed)])].map(id=>[id,{...previous[id],...governed[id]}]))};
}
function effective(item,record,old){
 const base=defaults(item);if(typeof old.criteria?.[item.key]==='string'&&old.criteria[item.key].trim())base.criteria=old.criteria[item.key];
 if(item.parameters?.length)base.parameters=normalizeFormulaValues(old.parameters)[item.key];
 const config=record?.published?.config||base;
 return {...item,id:item.key,group:GROUPS[item.key.split('.')[1]]||'Other',defaults:defaults(item),config,revision:record?.revision||0,published_version:record?.published?.version||0,published_at:record?.published?.at||null,draft:record?.draft||null,history:record?.history||[],fingerprint:hash(config),source:record?.published?'published':Object.hasOwn(old.criteria||{},item.key)||Object.hasOwn(old.parameters||{},item.key)?'legacy':'default'};
}
async function list(){const[rows,old]=await Promise.all([db.prepare('SELECT key,value FROM app_settings WHERE key LIKE ?').all(KEY+'%'),legacy()]);const records=new Map(rows.map(row=>[row.key.slice(KEY.length),row.value]));const metrics=catalog.map(item=>effective(item,records.get(item.key),old));return {metrics,groups:[...new Set(metrics.map(item=>item.group))]};}
async function detail(id){const item=definition(id);const[row,old]=await Promise.all([db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY+id),legacy()]);return effective(item,row?.value,old);}
async function mutate(id,body,actor,mode){
 const item=definition(id);if(item.runtime_status==='reference')throw fail('This historical or operational reference has no active editable review consumer. Its existing configuration is retained for inspection.',422);if(!body||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)throw fail('An expected revision is required.');
 if(!['draft','publish','rollback'].includes(mode))throw fail('Unsupported metric action.');
 const config=mode==='rollback'?null:validate(body.config,id);
 return db.transaction(async()=>{
  await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(KEY+id);
  const row=await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY+id),current=row?.value||{revision:0,history:[]};
  if(current.revision!==body.expected_revision)throw fail('This metric changed. Reload the latest version before saving.',409);
  const next={...current,revision:current.revision+1},at=new Date().toISOString();
  if(mode==='draft')next.draft={config,at,actor_id:actor.actorId};
  else{
   let selected=config;
   if(mode==='rollback'){if(!Number.isSafeInteger(body.version)||body.version<1)throw fail('Choose an available version.');const old=await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`${VERSIONS}${id}:${body.version}`);if(!old?.value?.config)throw fail('The selected version is unavailable.',404);selected=validate(old.value.config,id);}
   const published={config:selected,version:(current.published?.version||0)+1,at,actor_id:actor.actorId};
   await db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING').run(`${VERSIONS}${id}:${published.version}`,published);
   next.published=published;next.draft=null;next.history=[{version:published.version,at,actor_id:actor.actorId},...(current.history||[])].slice(0,30);
   if(published.version>30)await db.prepare('DELETE FROM app_settings WHERE key = ?').run(`${VERSIONS}${id}:${published.version-30}`);
  }
  await db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP').run(KEY+id,next);
  await require('./adminPortal.service').recordAudit({...actor,action:`metric_governance.${mode}`,targetType:'metric',targetId:id,summary:`${mode==='draft'?'Saved a draft for':mode==='rollback'?'Restored':'Published'} ${item.label}.`,metadata:{revision:next.revision,version:next.published?.version||0,fingerprint:hash(config||next.published.config)}});
  return effective(item,next,await legacy());
 })();
}
async function publishedOverrides(){const rows=await db.prepare("SELECT key,value->'published' AS published FROM app_settings WHERE key LIKE ?").all(KEY+'%'),criteria={},parameters={};for(const row of rows){const id=row.key.slice(KEY.length),config=row.published?.config;if(byId.has(id)&&config){criteria[id]=config.criteria;parameters[id]=config.parameters;}}return {criteria,parameters};}
// Criteria are resolved at the model boundary, rather than depending on a
// browser to copy the current workspace settings into a user request. Agent
// and native-task callers choose their own rubric and do not call this helper.
async function resolveForFeature(featureId){
 const relevant=catalog.filter(item=>item.runtime_status!=='reference'&&item.feature_ids?.includes(featureId));
 if(!relevant.length)return {instruction:'',metrics:[]};
 const [rows,old]=await Promise.all([
  db.prepare(`SELECT key,value FROM app_settings WHERE key IN (${relevant.map(()=>'?').join(',')})`).all(...relevant.map(item=>KEY+item.key)),
  legacy()
 ]);
 const records=new Map(rows.map(row=>[row.key.slice(KEY.length),row.value]));
 const resolved=relevant.map(item=>effective(item,records.get(item.key),old));
 const boundary='Metric review criteria apply only to the measurements relevant to this request. Arithmetic, recorded evidence, denominators, scope, gate decisions and permissions remain application-owned. Explain supported results and gaps; do not invent scores, probabilities, execution evidence or release approval. A missing optional label, link, run history or unrelated coverage category is not by itself a defect in the requested artifact.';
 const perMetricBudget=Math.floor((12000-boundary.length)/resolved.length)-150;
 const review=item=>{const criteria=String(item.config.criteria||'');return `${item.key}: ${criteria.length<=perMetricBudget?criteria:criteria.slice(0,perMetricBudget)+' [Criteria excerpt: remaining organization guidance omitted to fit the review budget.]'}`;};
 return {instruction:[boundary,...resolved.map(review)].join('\n'),metrics:resolved.map(item=>({id:item.id,version:item.published_version,fingerprint:item.fingerprint,source:item.source}))};
}
module.exports={catalog,validate,defaults,list,detail,mutate,publishedOverrides,resolveForFeature};
