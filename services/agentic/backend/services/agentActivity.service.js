const {createHash}=require('node:crypto');
const db=require('@hellotest/platform/backend/src/db');
const obs=require('@hellotest/platform/backend/src/obsDb');
const permissions=require('@hellotest/platform/backend/services/permission.service');
const flags=require('@hellotest/platform/backend/services/featureFlag.service');
const projects=require('@hellotest/platform/backend/public/projectAccess');
const {sanitizeAiText}=require('@hellotest/platform/backend/src/security/aiTextPolicy');
const contract=require('@hellotest/contracts/agents');
const descriptors=require('../agents/agentDescriptors.service');
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value||{};}catch{return {};}};
const text=value=>sanitizeAiText(String(value||'')).text.slice(0,500);
const id=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const permissionFor=system=>system==='automation'?'automation.view':'agentic_workflow.view';
const systemFor=row=>row.related_kind==='quality_agent_run'?'quality':row.category==='automation_build'||row.action==='automation_agent'?'automation':row.related_kind==='agentic_assistant_session'?'workflow':null;
const metricNumber = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function adapted(system,row){
  const metadata=parse(row.metadata),snapshot=parse(row.workflow_snapshot),native=metadata.cancelled===true?'cancelled':metadata.run_status||row.status||'unknown';
  const agentId=system==='repository'?row.agent_type:system==='quality'?metadata.request?.kind||metadata.kind||'web':system==='automation'?'browser':metadata.agent_id||'quality-orchestrator';
  const savedDescriptor=metadata.agent_descriptor||parse(row.input).agent_descriptor;
  const descriptor=savedDescriptor?.schema_version===contract.VERSION&&savedDescriptor.system===system?savedDescriptor:system==='repository'?descriptors.repository(agentId):system==='quality'?descriptors.quality(agentId):system==='automation'?descriptors.automation():descriptors.workflow(agentId in require('@hellotest/contracts/agents/workflowSpecialists.json')?agentId:'quality-orchestrator');
  const stages=Array.isArray(row.stages)?row.stages:Array.isArray(row.node_results)?row.node_results:metadata.stages||[];
  const failureCode = metadata.error_code || metadata.error_details?.code || row.error_code;
  return {id:system+':'+row.id,system,source_run_id:row.id,project_id:row.project_id,app_type_id:row.app_type_id||null,actor_id:row.created_by||null,agent_id:agentId,descriptor,
    descriptor_hash:metadata.agent_descriptor_hash||descriptor.descriptor_hash||descriptors.hash(descriptor),status:contract.status(native),native_status:native,
    progress:Math.max(0,Math.min(100,Number(row.progress??metadata.progress??(native==='completed'?100:0))||0)),
    title:system==='workflow'&&snapshot.name?text(snapshot.name):descriptor.name,
    payload:{source_kind:row.related_kind||system,requires_human_review:true,
      ...(metadata.system_message_hash?{system_message_hash:metadata.system_message_hash}:{}),...(metadata.prompt_hash?{prompt_hash:metadata.prompt_hash}:{}),...(metadata.prompt_template_version?{prompt_template_version:metadata.prompt_template_version}:{}),
      metrics: { tokens: metricNumber(metadata.result?.model_execution?.usage?.total_tokens ?? metadata.model_usage?.total_tokens),
        drafts: Array.isArray(metadata.result?.artifacts) ? metadata.result.artifacts.length : null,
        failure_code: typeof failureCode === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(failureCode) ? failureCode : null },
      ...(metadata.agent_version?{agent_version:metadata.agent_version}:{}),stage_count:stages.length,
      native_run_id:metadata.id||row.id,transaction_id:row.metadata?row.id:null},
    created_at:row.created_at,updated_at:row.synchronization_updated_at||row.updated_at||row.completed_at||row.created_at,started_at:row.started_at||metadata.started_at||null,completed_at:row.completed_at||metadata.completed_at||null,
    stages};
}
function createStore(database=obs){
  return {
    async upsert(run){
      const value=await database.prepare(`INSERT INTO agent_runs(id,system,source_run_id,project_id,app_type_id,actor_id,agent_id,descriptor,descriptor_hash,status,native_status,progress,title,payload,started_at,completed_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(system,source_run_id) DO UPDATE SET
        status=EXCLUDED.status,native_status=EXCLUDED.native_status,progress=EXCLUDED.progress,title=EXCLUDED.title,payload=agent_runs.payload||EXCLUDED.payload,project_id=EXCLUDED.project_id,app_type_id=EXCLUDED.app_type_id,actor_id=EXCLUDED.actor_id,
        started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at,synchronized_at=CURRENT_TIMESTAMP
        WHERE agent_runs.updated_at<=EXCLUDED.updated_at RETURNING *`).get(...['id','system','source_run_id','project_id','app_type_id','actor_id','agent_id','descriptor','descriptor_hash','status','native_status','progress','title','payload','started_at','completed_at','created_at','updated_at'].map(key=>run[key]));
      return value||run;
    },
    async event(run,event){
      const sourceId=String(event.id||id(event.phase,event.status,event.at,event.index)),phase=String(event.phase||event.id||'stage').slice(0,100),payload={status:contract.status(event.status||event.level==='error'&&'failed'||'running'),...(event.duration_ms>=0?{duration_ms:event.duration_ms}:{}),...(event.code?{code:text(event.code)}:{})};
      await database.prepare(`INSERT INTO agent_run_events(id,run_id,source_event_id,phase,level,message,payload,occurred_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(run_id,source_event_id) DO NOTHING RETURNING id`).get(id(run.id,sourceId),run.id,sourceId,phase,event.level||'info',text(phase+' · '+contract.STATUS_LABELS[payload.status]),payload,event.created_at||event.at||run.updated_at);

    }
  };
}
const store=createStore();
async function synchronize(system,row,events=[]){
  if(!row?.id||!row.project_id||row.action==='trial')return null;
  const run=adapted(system,row);await store.upsert(run);
  await store.event(run,{id:`state:${run.native_status}:${new Date(run.updated_at).toISOString()}`,phase:'run.'+run.status,status:run.status,message:`${run.descriptor.name} · ${contract.STATUS_LABELS[run.status]}`,created_at:run.updated_at});
  for(const[index,event]of [...run.stages,...events].slice(-500).entries())await store.event(run,{...event,index,id:event.id||`stage:${index}:${event.status||event.phase||'observed'}`,phase:event.phase||event.node_id||event.id||'stage',message:event.message||event.label||event.name||'Runtime stage observed',status:event.status});
  return run;
}
async function authorize(projectId,appTypeId,user){
  if(!projectId||!user?.id)throw Object.assign(new Error('Select a project for agent activity.'),{statusCode:400});
  await projects.getProject(projectId,user.id);
  if(appTypeId){const app=await db.prepare('SELECT project_id FROM app_types WHERE id=?').get(appTypeId);if(app?.project_id!==projectId)throw Object.assign(new Error('Application unavailable in this project.'),{statusCode:404});}
  return (await Promise.all(contract.SYSTEMS.map(async system=>{
    const permission=permissionFor(system);
    return await permissions.hasPermission(user,permission,projectId)&&await flags.areEnabled(flags.getFeatureKeysForPermission(permission),{user})?system:null;
  }))).filter(Boolean);
}
async function processPending({projectId,limit=100}={}){
  const pending=await db.prepare(`SELECT *,updated_at::text AS delivery_version FROM agent_activity_outbox ${projectId?'WHERE project_id=?':''} ORDER BY updated_at,source_run_id LIMIT ?`).all(...(projectId?[projectId]:[]),Math.max(1,Math.min(500,limit)));
  for(const item of pending){
    const row=await db.prepare(`SELECT *,updated_at::text AS synchronization_updated_at FROM ${item.system==='repository'?'repository_agent_runs':'agentic_workflow_runs'} WHERE id=? AND project_id=?`).get(item.source_run_id,item.project_id);
    if(row)await synchronize(item.system,row);
    else await obs.prepare('DELETE FROM agent_runs WHERE system=? AND source_run_id=? AND project_id=?').run(item.system,item.source_run_id,item.project_id);
    await db.prepare('DELETE FROM agent_activity_outbox WHERE system=? AND source_run_id=? AND updated_at::text=?').run(item.system,item.source_run_id,item.delivery_version);
  }
  return {synchronized:pending.length,more_available:pending.length>=limit};
}
async function reconcile({project_id,app_type_id,systems}){
  const filter=app_type_id?'project_id=? AND app_type_id=?':'project_id=?',args=app_type_id?[project_id,app_type_id]:[project_id],coverage=[];
  for(const system of systems){
    let rows,workflowCount=0,workflowMore=false;
    if(system==='repository')rows=await db.prepare(`SELECT *,updated_at::text AS synchronization_updated_at FROM repository_agent_runs WHERE ${filter} ORDER BY updated_at DESC LIMIT 201`).all(...args);
    else if(system==='workflow'){
      rows=await db.prepare(`SELECT *,updated_at::text AS synchronization_updated_at FROM agentic_workflow_runs WHERE ${filter} ORDER BY updated_at DESC LIMIT 201`).all(...args);
      workflowCount=Math.min(rows.length,200);workflowMore=rows.length>200;
      for(const row of rows.slice(0,200))await synchronize(system,row);
      const sessions=await obs.prepare(`SELECT * FROM workspace_transactions WHERE ${filter} AND related_kind='agentic_assistant_session' AND action<>'trial' ORDER BY updated_at DESC LIMIT 201`).all(...args);
      rows=sessions;
    }else rows=await obs.prepare(`SELECT * FROM workspace_transactions WHERE ${filter} AND ${system==='quality'?"related_kind='quality_agent_run'":"category='automation_build'"} ORDER BY updated_at DESC LIMIT 201`).all(...args);
    for(const row of rows.slice(0,200)){
      const events=row.metadata?await obs.prepare('SELECT id,phase,level,message,created_at,details FROM workspace_transaction_events WHERE transaction_id=? ORDER BY created_at,id LIMIT 500').all(row.id):[];
      await synchronize(system,row,events.map(event=>({...event,...parse(event.details),id:event.id,phase:event.phase,message:event.message})));
    }
    coverage.push({system,synchronized:workflowCount+Math.min(rows.length,200),more_available:workflowMore||rows.length>200});
  }
  return coverage;
}
async function availableSources(items){
  const visible=new Set();
  for(const [table,database,group]of [
    ['repository_agent_runs',db,items.filter(row=>row.system==='repository')],
    ['agentic_workflow_runs',db,items.filter(row=>row.system==='workflow'&&!parse(row.payload).transaction_id)],
    ['workspace_transactions',obs,items.filter(row=>row.system!=='repository'&&(row.system!=='workflow'||parse(row.payload).transaction_id))]
  ]){
    if(!group.length)continue;
    const rows=await database.prepare(`SELECT id,project_id,app_type_id FROM ${table} WHERE id IN (${group.map(()=>'?').join(',')})`).all(...group.map(row=>row.source_run_id));
    const current=new Map(rows.map(row=>[row.id,row]));
    for(const row of group){const source=current.get(row.source_run_id);if(source&&source.project_id===row.project_id&&(source.app_type_id||null)===(row.app_type_id||null))visible.add(row.id);}
  }
  return items.filter(row=>visible.has(row.id));
}
async function list(input,user){
  const systems=await authorize(input.project_id,input.app_type_id,user);
  if(!systems.length)throw Object.assign(new Error('Agent activity is unavailable under current permissions.'),{statusCode:403});
  const selected=input.system?systems.filter(system=>system===input.system):systems;
  if(input.system&&!selected.length)throw Object.assign(new Error('Agent system unavailable.'),{statusCode:403});
  const pending=await processPending({projectId:input.project_id});
  const coverage=await reconcile({...input,systems:selected});
  const args=[input.project_id],where=['project_id=?'];
  if(input.app_type_id){where.push('app_type_id=?');args.push(input.app_type_id);}
  where.push(`system IN (${selected.map(()=>'?').join(',')})`);args.push(...selected);
  if(input.status){if(!contract.STATUSES.includes(input.status))throw Object.assign(new Error('Unsupported agent status.'),{statusCode:400});where.push('status=?');args.push(input.status);}
  if(input.cursor){
    let cursor;try{if(typeof input.cursor!=='string'||input.cursor.length>2000)throw Error();cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));if(!Array.isArray(cursor)||cursor.length!==2||!Number.isFinite(Date.parse(cursor[0]))||typeof cursor[1]!=='string'||cursor[1].length>255)throw Error();}catch{throw Object.assign(new Error('Invalid agent history cursor.'),{statusCode:400});}
    where.push('(updated_at<?::timestamptz OR (updated_at=?::timestamptz AND id>?))');args.push(cursor[0],cursor[0],cursor[1]);
  }
  const limit=Math.max(1,Math.min(100,Number(input.limit)||30));
  const items=await obs.prepare(`SELECT *,updated_at::text AS cursor_updated_at FROM agent_runs WHERE ${where.join(' AND ')} ORDER BY updated_at DESC,id LIMIT ?`).all(...args,limit+1);
  const selectedItems=items.slice(0,limit),last=selectedItems.at(-1);
  return {contract_version:contract.RUN_VERSION,items:await availableSources(selectedItems),has_more:items.length>limit,next_cursor:items.length>limit?Buffer.from(JSON.stringify([last.cursor_updated_at||new Date(last.updated_at).toISOString(),last.id])).toString('base64url'):null,coverage,pending};
}
async function detail(runId,user){
  const run=await obs.prepare('SELECT * FROM agent_runs WHERE id=?').get(runId);
  if(!run)throw Object.assign(new Error('Agent run not found.'),{statusCode:404});
  const systems=await authorize(run.project_id,run.app_type_id,user);
  if(!systems.includes(run.system))throw Object.assign(new Error('Agent run unavailable.'),{statusCode:404});
  const payload=parse(run.payload);
  // The canonical record preserves lifecycle metadata, not source access grants.
  const source=run.system==='repository'?await db.prepare('SELECT * FROM repository_agent_runs WHERE id=? AND project_id=?').get(run.source_run_id,run.project_id)
    :await (payload.transaction_id?obs:db).prepare(`SELECT * FROM ${payload.transaction_id?'workspace_transactions':'agentic_workflow_runs'} WHERE id=? AND project_id=?`).get(run.source_run_id,run.project_id);
  if(!source||(source.app_type_id||null)!==(run.app_type_id||null))throw Object.assign(new Error('The original agent run is no longer available.'),{statusCode:404});
  await synchronize(run.system,source);
  const events=await obs.prepare('SELECT * FROM agent_run_events WHERE run_id=? ORDER BY occurred_at,id LIMIT 500').all(run.id);
  return {run:await obs.prepare('SELECT * FROM agent_runs WHERE id=?').get(run.id),events,events_limited:events.length===500};
}

function scorecardRows(rows, acceptances = new Map()) {
  const groups = new Map();
  const median = samples => {
    const ordered = [...samples].sort((a, b) => a - b);
    if (!ordered.length) return null;
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
  };
  for (const row of rows) {
    const payload = parse(row.payload);
    if (row.system === 'workflow' && payload.source_kind !== 'agentic_assistant_session') continue;
    const key = `${row.system}:${row.agent_id}`;
    const item = groups.get(key) || { key, runs: 0, completed: 0, drafts: 0, accepted: 0, durations: [], tokens: [], failure_codes: {} };
    const metrics = payload.metrics || {};
    const duration = Date.parse(row.completed_at) - Date.parse(row.started_at);
    item.runs += 1;
    if (row.status === 'succeeded') item.completed += 1;
    if (Number.isFinite(duration) && duration >= 0) item.durations.push(duration);
    if (metricNumber(metrics.tokens) !== null) item.tokens.push(metrics.tokens);
    if (row.status === 'failed') {
      const code = /^[A-Z][A-Z0-9_]{0,100}$/.test(metrics.failure_code || '') ? metrics.failure_code : 'UNRECORDED';
      item.failure_codes[code] = (item.failure_codes[code] || 0) + 1;
    }
    if (metricNumber(metrics.drafts) !== null && payload.source_kind === 'agentic_assistant_session') {
      item.drafts += metrics.drafts;
      item.accepted += Math.min(metrics.drafts, acceptances.get(row.source_run_id) || 0);
    }
    groups.set(key, item);
  }
  return [...groups.values()].map(({ durations, tokens, ...item }) => ({
    ...item, median_duration_ms: median(durations), duration_samples: durations.length,
    median_tokens: median(tokens), token_samples: tokens.length
  }));
}

async function scorecards(input, user) {
  const systems = await authorize(input.project_id, input.app_type_id, user);
  if (!systems.length) throw Object.assign(new Error('Agent activity is unavailable under current permissions.'), { statusCode: 403 });
  const args = [input.project_id, ...systems];
  const scope = input.app_type_id ? ' AND app_type_id=?' : '';
  if (scope) args.push(input.app_type_id);
  const sampled = await obs.prepare(`SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY system ORDER BY updated_at DESC,id) AS sample_rank FROM agent_runs
    WHERE project_id=? AND system IN (${systems.map(() => '?').join(',')})${scope}
      AND (system<>'workflow' OR payload->>'source_kind'='agentic_assistant_session')
      AND status IN ('succeeded','partial','failed','cancelled','unknown')
  ) AS recent WHERE sample_rank<=200`).all(...args);
  const permittedRows = await availableSources(sampled);
  const legacy = systems.includes('workflow') ? await obs.prepare(`SELECT * FROM workspace_transactions
    WHERE project_id=?${scope} AND related_kind='agentic_assistant_session' AND action<>'trial'
      AND status IN ('completed','failed','cancelled') ORDER BY updated_at DESC,id LIMIT 200`)
    .all(input.project_id, ...(input.app_type_id ? [input.app_type_id] : [])) : [];
  const rows = [...permittedRows.filter(row => row.system !== 'workflow'), ...legacy.map(row => adapted('workflow', row))];
  const sessions = rows.filter(row => parse(row.payload).source_kind === 'agentic_assistant_session' && parse(row.payload).metrics?.drafts > 0).map(row => row.source_run_id);
  const receipts = sessions.length ? await db.prepare(`SELECT session_id, COUNT(*)::int AS accepted FROM agent_proposal_acceptances
    WHERE project_id=? AND session_id IN (${sessions.map(() => '?').join(',')}) GROUP BY session_id`).all(input.project_id, ...sessions) : [];
  return { items: scorecardRows(rows, new Map(receipts.map(row => [row.session_id, row.accepted]))), limit_per_system: 200 };
}
module.exports={list,detail,scorecards,scorecardRows,synchronize,reconcile,adapted,createStore,systemFor,authorize,processPending,availableSources};
