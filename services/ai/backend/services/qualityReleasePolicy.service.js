const db=require('@hellotest/platform/backend/src/db');
const {randomUUID}=require('node:crypto');
const rules=require('./qualityReleasePolicyRules');
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
async function current(projectId){return await db.prepare('SELECT * FROM quality_release_policies WHERE project_id=? ORDER BY version DESC LIMIT 1').get(projectId)||null;}
function rationale(input){if(typeof input.rationale!=='string'||input.rationale.trim().length<20||input.rationale.length>2000)throw fail('Provide an approval rationale of 20–2000 characters.');return input.rationale.trim();}
async function approve(projectId,user,input) {
  const policy=rules.normalize(input.policy),reason=rationale(input);
  if(!Number.isInteger(input.expected_version)||input.expected_version<0)throw fail('Reload the current policy version before approving.');
  return db.transaction(async()=>{
    await db.query("SET LOCAL statement_timeout='5s'");
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`release-policy:${projectId}`);
    const previous=await current(projectId);
    if((previous?.version||0)!==input.expected_version)throw fail('Another approval changed this policy. Reload before approving a new version.',409);
    return db.prepare(`INSERT INTO quality_release_policies(project_id,version,policy,policy_hash,approved_by,rationale) VALUES(?,?,?,?,?,?) RETURNING *`)
      .get(projectId,input.expected_version+1,policy,rules.hash(policy),user.id,reason);
  })();
}
async function waive(projectId,user,input) {
  const reason=rationale(input);
  for(const key of ['release_id','build','environment_id','gate_id','evidence_hash','reference'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>255)throw fail(`Provide a valid ${key.replaceAll('_',' ')}.`);
  if(!['approved','revoked'].includes(input.decision))throw fail('Choose approval or withdrawal.');
  const expires=new Date(input.expires_at);
  if(!Number.isFinite(expires.getTime())||expires<=new Date()||expires.getTime()>Date.now()+30*86400000)throw fail('Choose an expiry within the next 30 days.');
  return db.transaction(async()=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query("SET LOCAL statement_timeout='8s'");
    const policy=await current(projectId);
    if(!policy?.approved_by||policy.version!==input.policy_version||!policy.policy.waivable_gates.includes(input.gate_id))throw fail('The current approved policy does not allow this exception.',409);
    const snapshot=await require('./qualityEvidence.service').collect({projectId,user,existingTransaction:true,input:{release_id:input.release_id,build:input.build,environment_id:input.environment_id}});
    const report=require('./qualityEvidenceRules').assess(snapshot,'F11');
    const gate=report.data.gates.find(item=>item.id===input.gate_id);
    if(!gate||!['fail','waived'].includes(gate.status)||gate.evidence_hash!==input.evidence_hash)throw fail('The gate evidence changed or is unknown. Run a fresh assessment before approving an exception.',409);
    return db.prepare(`INSERT INTO quality_release_waivers(id,project_id,policy_version,release_id,build,environment_id,gate_id,evidence_hash,decision,rationale,reference,expires_at,approved_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).get(randomUUID(),projectId,policy.version,input.release_id,input.build,input.environment_id,input.gate_id,input.evidence_hash,input.decision,reason,input.reference.trim(),expires.toISOString(),user.id);
  })();
}
module.exports={current,approve,waive};
