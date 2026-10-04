const db = require('@hellotest/platform/backend/src/db');
const { randomUUID } = require('node:crypto');
const evidence = require('./qualityEvidence.service');
const rules = require('./qualityCoverageRules');
const { hash } = require('./qualityEvidenceRules');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function load({ projectId, user, input }) {
  if (!input.story_id) throw fail('Choose a Story to review its acceptance coverage.');
  const snapshot = await evidence.collect({ projectId,user,input:{story_id:input.story_id},scopes:['stories','test-cases','runs'] });
  const story = snapshot.stories.find(row=>row.id===input.story_id);
  if (!story) throw fail('Story is unavailable.',404);
  return {
    story_id:story.id,story_revision:rules.storyRevision(story),
    obligations:rules.criteria(story).map((criterion,index)=>({id:rules.obligationId(story,index),text:rules.criterionText(criterion)})),
    tests:snapshot.tests.map(test=>({id:test.id,title:test.title,revision:rules.testRevision(test),assertions:test.steps.filter(step=>step.expected_result?.trim()).map(step=>({id:step.id,action:step.action,expected_result:step.expected_result,hash:rules.assertionHash(step)}))})),
    reviews:snapshot.assertion_reviews,
    limitations:snapshot.coverage_complete ? [] : ['The test or obligation inventory is incomplete. Review a narrower scope before relying on a coverage percentage.']
  };
}
async function save({ projectId,user,input }) {
  for (const key of ['story_id','story_revision','test_case_id','test_revision','obligation_id','step_id']) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 255) throw fail(`A valid ${key.replaceAll('_',' ')} is required.`);
  }
  if (!['approved','rejected','revoked'].includes(input.decision)) throw fail('Choose an assertion review decision.');
  if (typeof input.rationale !== 'string' || input.rationale.trim().length < 12 || input.rationale.length > 2000) throw fail('Explain how the assertion verifies the criterion, including its oracle and limitations (12–2000 characters).');
  const id = input.request_id || randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw fail('A valid review request ID is required.');
  const requestHash = hash([projectId,user.id,input.story_id,input.obligation_id,input.story_revision,input.test_case_id,input.test_revision,input.step_id,input.decision,input.rationale]);
  return db.transaction(async()=>{
    await db.query("SET LOCAL statement_timeout = '5s'");
    const existing = await db.prepare('SELECT * FROM quality_assertion_reviews WHERE id=? AND project_id=?').get(id,projectId);
    if (existing) { if (existing.request_hash !== requestHash) throw fail('This request ID already represents a different review.',409); return existing; }
    const story = await db.prepare('SELECT id,updated_at,additional_fields FROM requirements WHERE id=? AND project_id=? FOR SHARE').get(input.story_id,projectId);
    const test = await db.prepare(`SELECT t.id,t.title,t.description,t.updated_at FROM test_cases t JOIN app_types a ON a.id=t.app_type_id
      WHERE t.id=? AND a.project_id=? AND (t.requirement_id=? OR EXISTS(SELECT 1 FROM requirement_test_cases l WHERE l.test_case_id=t.id AND l.requirement_id=?)) FOR SHARE OF t`)
      .get(input.test_case_id,projectId,input.story_id,input.story_id);
    if (!story || !test) throw fail('The Story and linked Test Case must belong to this project.',404);
    test.steps = await db.prepare('SELECT id,action,expected_result,step_type,automation_code,api_request FROM test_steps WHERE test_case_id=? ORDER BY step_order FOR SHARE').all(test.id);
    const step = test.steps.find(row=>row.id===input.step_id);
    if (!step?.expected_result?.trim()) throw fail('Select a step with an observable expected result.');
    if (input.story_revision !== rules.storyRevision(story) || input.test_revision !== rules.testRevision(test)
      || !rules.criteria(story).some((_,index)=>rules.obligationId(story,index)===input.obligation_id)) throw fail('The Story or assertion changed. Reload and review the current revision.',409);
    const row = await db.prepare(`INSERT INTO quality_assertion_reviews
      (id,project_id,story_id,obligation_id,story_revision,test_case_id,test_revision,step_id,assertion_hash,decision,rationale,reviewed_by,verifier_version,request_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING *`).get(id,projectId,story.id,input.obligation_id,input.story_revision,test.id,input.test_revision,step.id,rules.assertionHash(step),input.decision,input.rationale.trim(),user.id,'reviewed-assertion/1',requestHash);
    if (row) return row;
    const receipt = await db.prepare('SELECT * FROM quality_assertion_reviews WHERE id=? AND project_id=?').get(id,projectId);
    if (receipt?.request_hash !== requestHash) throw fail('This request ID already represents a different review.',409);
    return receipt;
  })();
}
module.exports = { load, save };
