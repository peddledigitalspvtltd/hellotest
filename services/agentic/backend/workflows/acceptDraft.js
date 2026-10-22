const db = require('@hellotest/platform/backend/src/db');
const { createToken } = require('@hellotest/platform/backend/src/utils/token');
const tasks = require('./artifactTasks');
const { fail } = require('./connections');

async function accept(app, req, run) {
  if (req.apiKey) throw fail('Use your signed-in session to accept workflow drafts.', 403);
  if (!['completed', 'needs_review'].includes(run.status) || run.execution_mode !== 'review') throw fail('Wait for a completed native workflow before accepting its drafts.', 409);
  const { node_id: nodeId, story_index: storyIndex, case_index: caseIndex, kind = 'manual' } = req.body || {};
  if (!['manual', 'automation'].includes(kind) || !Number.isInteger(storyIndex) || storyIndex < 0 || !Number.isInteger(caseIndex) || caseIndex < 0) throw fail('Choose a recorded Story, Test Case and draft kind.');
  const node = run.node_results.find(row => row.node_id === nodeId && row.node_type === 'artifactTask' && row.status === 'completed');
  const packet = node?.output?.data?.[storyIndex];
  const draft = packet?.cases?.[caseIndex];
  if (!draft || !packet.case_assurance?.[caseIndex] || packet.case_assurance[caseIndex].verification?.status !== 'passed' || packet.case_assurance[caseIndex].case_fingerprint !== tasks.fingerprint(draft)) throw fail('Choose a recorded, assessed Test Case draft.', 409);
  await tasks.access(req.user, run.project_id, ['agentic_workflow.view', 'testcase.create']);
  if (kind === 'automation') await tasks.access(req.user, run.project_id, ['automation.view', 'automation.code.view', 'automation.build']);
  const automated = packet.automation?.[caseIndex];
  if (kind === 'automation' && (!automated || automated.case_fingerprint !== tasks.fingerprint(draft) || !Array.isArray(automated.steps) || !automated.steps.length || automated.validation?.status !== 'passed')) throw fail('The automation draft has not passed its native contract checks. Review its output before acceptance.', 409);
  const appType = await require('@hellotest/platform/backend/public/applicationAccess').getAppType(run.app_type_id);
  if (appType.project_id !== run.project_id) throw fail('The workflow application is unavailable in this project.', 403);
  const digest = tasks.fingerprint({ draft, automated: kind === 'automation' ? automated : null, app_type_id: run.app_type_id });
  return db.transaction(async () => {
    const key = `${run.id}:${packet.story_id}:${caseIndex}:${kind}`;
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`workflow-draft:${key}`);
    const previous = await db.prepare('SELECT request_hash,receipt FROM workflow_draft_acceptances WHERE run_id=? AND story_id=? AND case_index=? AND kind=? AND project_id=?').get(run.id, packet.story_id, caseIndex, kind, run.project_id);
    if (previous) {
      if (previous.request_hash !== digest) throw fail('This saved draft has changed. Open its library record to make further edits.', 409);
      return { ...previous.receipt, reused: true };
    }
    await db.prepare('SELECT id FROM requirements WHERE id=? AND project_id=? FOR SHARE').get(packet.story_id, run.project_id);
    const story = await tasks.loadStory(run, req.user, packet);
    const payload = { app_type_id: run.app_type_id, title: draft.title, description: draft.description, priority: draft.priority, test_case_type: draft.test_case_type, status: 'draft', requirement_ids: [story.id], authoring_mode: draft.authoring_mode, gherkin_document: draft.gherkin_document, parameter_values: draft.parameter_values || {}, steps: draft.steps, ai_generation_source: 'interactive', ai_generation_review_status: 'pending', review_status: 'pending', reviewer_id: req.user.id,
      ...(kind === 'automation' ? { automated: 'yes', automation_status: 'incomplete', automation_start_url: automated.automation_start_url || automated.start_url || undefined, steps: automated.steps, parameter_values: automated.parameter_values || draft.parameter_values || {} } : {}) };
    const response = await app.inject({ method: 'POST', url: '/test-cases', headers: { authorization: `Bearer ${createToken(req.user)}` }, payload });
    let body; try { body = response.json(); } catch { throw fail('The Test Case service returned an invalid receipt.', 502); }
    if (response.statusCode >= 400) throw fail(body.publicMessage || body.error || body.message || 'The Test Case could not be accepted.', response.statusCode);
    if (typeof body.id !== 'string' || !body.id) throw fail('The Test Case service did not return its saved identity.', 502);
    const receipt = { id: body.id, story_id: story.id, title: draft.title, kind, saved: true, verification_status: kind === 'automation' ? 'unverified' : 'pending_review', requires_test_run: kind === 'automation' };
    await db.prepare('INSERT INTO workflow_draft_acceptances(run_id,node_id,story_id,case_index,kind,project_id,actor_id,request_hash,receipt) VALUES(?,?,?,?,?,?,?,?,?)').run(run.id, nodeId, story.id, caseIndex, kind, run.project_id, req.user.id, digest, receipt);
    return receipt;
  })();
}
module.exports = { accept };
