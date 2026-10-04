const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const WAIVABLE=['blocking-defects','execution-outcomes'];
const fail=message=>Object.assign(new Error(message),{statusCode:400});
function normalize(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Provide release policy requirements.');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)throw fail('Name the release policy (up to 120 characters).');
  for(const [key,min,max] of [['max_evidence_age_hours',1,720],['minimum_completed_attempts',1,100000]])if(!Number.isInteger(input[key])||input[key]<min||input[key]>max)throw fail(`${key.replaceAll('_',' ')} must be an integer from ${min} to ${max}.`);
  if(!Array.isArray(input.waivable_gates)||input.waivable_gates.some(id=>!WAIVABLE.includes(id)))throw fail('Only recorded Defect and execution failures can have explicitly approved exceptions. Unknown evidence cannot be waived.');
  return {name:input.name.trim(),max_evidence_age_hours:input.max_evidence_age_hours,minimum_completed_attempts:input.minimum_completed_attempts,waivable_gates:[...new Set(input.waivable_gates)].sort(),verifier:'release-policy/1'};
}
function apply(snapshot,gates) {
  const record=snapshot.release_policy;
  if(!record?.approved_by)return {gates,policy_version:null,decision_authority:'baseline_review'};
  const policy=record.policy,scope=snapshot.scope;
  const policyGate=gates.find(item=>item.id==='approved-policy');
  Object.assign(policyGate,{status:'pass',detail:`${policy.name}, approved version ${record.version}.`,evidence:[`release-policy:${record.version}`]});
  const completed=snapshot.attempts.filter(row=>['passed','failed','blocked'].includes(row.status));
  gates.push({id:'execution-sample',label:'Minimum recorded execution evidence',status:completed.length>=policy.minimum_completed_attempts?'pass':'unknown',evidence:completed.map(row=>`attempt:${row.id}`),detail:`${completed.length} completed attempts; approved minimum ${policy.minimum_completed_attempts}.`});
  const timestamps=completed.map(row=>Date.parse(row.created_at));
  const oldest=timestamps.every(value=>Number.isFinite(value)&&value<=Date.parse(snapshot.as_of)+60000)?Math.min(...timestamps):NaN;
  const age=Number.isFinite(oldest)?Math.max(0,Date.parse(snapshot.as_of)-oldest)/3600000:null;
  gates.push({id:'evidence-age',label:'Execution evidence freshness',status:age==null?'unknown':age>policy.max_evidence_age_hours?'fail':'pass',evidence:completed.map(row=>`attempt:${row.id}`),detail:age==null?'Timestamped execution evidence is missing.':`Oldest selected completed attempt: ${Math.round(age*10)/10} hours; approved maximum ${policy.max_evidence_age_hours} hours.`});
  for(const gate of gates) {
    gate.evidence_hash=hash([record.version,scope,gate.id,gate.status,gate.evidence,gate.detail,
      snapshot.defects.map(row=>[row.id,row.updated_at,row.status,row.severity]),snapshot.attempts.map(row=>[row.id,row.revision,row.status])]);
    const latest=(snapshot.release_waivers||[]).filter(row=>row.gate_id===gate.id&&row.release_id===scope.release_id&&row.build===scope.build&&row.environment_id===scope.environment_id&&row.policy_version===record.version)
      .sort((a,b)=>Date.parse(b.approved_at)-Date.parse(a.approved_at)||b.id.localeCompare(a.id))[0];
    if(gate.status==='fail'&&policy.waivable_gates.includes(gate.id)&&latest?.decision==='approved'&&latest.approved_by&&latest.evidence_hash===gate.evidence_hash&&Date.parse(latest.expires_at)>Date.parse(snapshot.as_of)) {
      gate.observed_status='fail';gate.status='waived';gate.waiver_id=latest.id;
      gate.detail+=` Exception approved until ${new Date(latest.expires_at).toISOString()}: ${latest.rationale}`;
    }
  }
  return {gates,policy_version:record.version,decision_authority:'approved_project_policy',approved_policy:{name:policy.name,version:record.version,hash:record.policy_hash,approved_by:record.approved_by,approved_at:record.approved_at,waivable_gates:policy.waivable_gates}};
}
module.exports={normalize,apply,hash,WAIVABLE};
