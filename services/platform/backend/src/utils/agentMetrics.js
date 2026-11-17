// Bounded labels: no project, principal, run, tool arguments or model text.
const SYSTEMS=new Set(['workflow','repository','quality','automation','authoring']);
const KINDS=new Set(['stage','model_call','tool_call','budget_exhausted','failure']);
const counts=new Map(),latencies=new Map();
function observe({system,kind='stage',code='none',duration_ms=0}){
  if(!SYSTEMS.has(system)||!KINDS.has(kind))return;
  const label=/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'none';
  const key=system+'|'+kind+'|'+label;
  if(!counts.has(key)&&counts.size>=160)return;
  counts.set(key,(counts.get(key)||0)+1);
  if(Number.isFinite(duration_ms)&&duration_ms>=0){const id=system+'|'+kind,current=latencies.get(id)||{count:0,sum:0};current.count++;current.sum+=duration_ms/1000;latencies.set(id,current);}
}
function snapshot(){return {counts:[...counts].map(([key,value])=>({key,value})),latencies:[...latencies].map(([key,value])=>({key,...value}))};}
function format(){const rows=['# HELP hellotest_agent_activity_total Observed agent lifecycle, provider and tool events.','# TYPE hellotest_agent_activity_total counter'];for(const[key,value]of counts){const[system,kind,code]=key.split('|');rows.push(`hellotest_agent_activity_total{system="${system}",kind="${kind}",code="${code}"} ${value}`);}rows.push('# HELP hellotest_agent_stage_latency_seconds Agent stage latency from recorded execution receipts.','# TYPE hellotest_agent_stage_latency_seconds summary');for(const[key,value]of latencies){const[system,kind]=key.split('|');rows.push(`hellotest_agent_stage_latency_seconds_sum{system="${system}",kind="${kind}"} ${value.sum}`,`hellotest_agent_stage_latency_seconds_count{system="${system}",kind="${kind}"} ${value.count}`);}return rows.join('\n');}
function family(scope={}){
  if(SYSTEMS.has(scope.agent_system))return scope.agent_system;
  const feature=String(scope.feature||'');
  if(/^ai\.agentic\.repository\./.test(feature))return 'repository';
  if(/^ai\.agentic\.(?:browser\.|quality_)/.test(feature))return 'quality';
  if(scope.automation_case_generation===true||/automation[-_.]/.test(feature)||/^ai\.automation/.test(feature))return 'automation';
  if(/^ai\.agentic\./.test(feature))return 'workflow';
  if(/^ai\.(?:requirement\.|test_case\.|case_authoring\.|bug\.draft)/.test(feature))return 'authoring';
  return null;
}
function provider(scope,record={}){
  const system=family(scope);
  if(!system||!record.status||record.status==='running')return;
  const code=record.error_code||'none';
  if(record.stage!=='provider_dispatch'||record.dispatched!==true){if(/budget|deadline/i.test(code))observe({system,kind:'budget_exhausted',code});return;}
  observe({system,kind:'model_call',code,duration_ms:Number(record.duration_ms)||0});
  if(record.status!=='succeeded')observe({system,kind:/budget|limit|deadline/i.test(code)?'budget_exhausted':'failure',code});
}
function event(system,entry={}){
  const details=entry.details||entry.data||{},phase=String(entry.phase||entry.type||'stage');
  const code=details.code||details.error_code||'none';
  // Actual provider POSTs are counted once by the shared trace boundary.
  if(phase==='model.call'||phase==='model_done'||/tool[._](?:started|start)$/.test(phase))return;
  const terminalTool=/tool[._](?:completed|failed|result)$/.test(phase);
  const kind=/budget|limit|deadline/i.test(code)?'budget_exhausted':terminalTool?'tool_call':entry.level==='error'||entry.type==='error'?'failure':'stage';
  observe({system,kind,code,duration_ms:Number(details.duration_ms??details.latency_ms??entry.duration_ms)||0});
  if(terminalTool&&/failed/.test(phase)&&code!=='none')observe({system,kind:/budget|limit|deadline/i.test(code)?'budget_exhausted':'failure',code});
}
module.exports={observe,event,provider,family,snapshot,format};
