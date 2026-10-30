const { resolveAutomationCaseType } = require('@hellotest/platform/backend/src/utils/automationCaseType');
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
  const packet = (node?.execution_context || node?.output)?.data?.[storyIndex];
  const draft = packet?.cases?.[caseIndex];
  if (!draft || !packet.case_assurance?.[caseIndex] || packet.case_assurance[caseIndex].verification?.status !== 'passed' || packet.case_assurance[caseIndex].case_fingerprint !== tasks.fingerprint(draft)) throw fail('Choose a recorded, assessed Test Case draft.', 409);
  if (!packet.story_revision || !Array.isArray(draft.requirement_ids) || draft.requirement_ids.length !== 1 || draft.requirement_ids[0] !== packet.story_id) throw fail('The recorded draft is missing its selected Story revision or traceability. Run the native workflow again.', 409);
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
    // If the reviewed manual version was accepted first, keep the native
    // manual-to-automation relationship rather than creating an unrelated case.
    const manualReceipt = kind === 'automation' ? await db.prepare('SELECT request_hash,receipt FROM workflow_draft_acceptances WHERE run_id=? AND story_id=? AND case_index=? AND kind=? AND project_id=?').get(run.id, packet.story_id, caseIndex, 'manual', run.project_id) : null;
    const payload = { app_type_id: run.app_type_id, title: draft.title, description: draft.description, priority: draft.priority, test_case_type: draft.test_case_type, status: 'draft', requirement_ids: [story.id], authoring_mode: draft.authoring_mode, gherkin_document: draft.gherkin_document, parameter_values: draft.parameter_values || {}, steps: draft.steps, ai_generation_source: 'interactive', ai_generation_review_status: 'pending', review_status: 'pending', reviewer_id: req.user.id,
      ...(kind === 'automation' ? { automated: 'yes', automation_status: 'incomplete', automation_case_type: resolveAutomationCaseType(automated,{steps:automated.steps}), automation_start_url: automated.automation_start_url || automated.start_url || undefined, steps: automated.steps, parameter_values: automated.parameter_values || draft.parameter_values || {}, ...(manualReceipt?.receipt?.id ? { manual_test_case_ids: [manualReceipt.receipt.id] } : {}) } : {}) };
    const response = await app.inject({ method: 'POST', url: '/test-cases', headers: { authorization: `Bearer ${createToken(req.user)}` }, payload });
    let body; try { body = response.json(); } catch { throw fail('The Test Case service returned an invalid receipt.', 502); }
    if (response.statusCode >= 400) throw fail(body.publicMessage || body.error || body.message || 'The Test Case could not be accepted.', response.statusCode);
    if (typeof body.id !== 'string' || !body.id) throw fail('The Test Case service did not return its saved identity.', 502);
    const receipt = { id: body.id, story_id: story.id, title: draft.title, kind, saved: true, verification_status: kind === 'automation' ? 'unverified' : 'pending_review', requires_test_run: kind === 'automation' };
    await db.prepare('INSERT INTO workflow_draft_acceptances(run_id,node_id,story_id,case_index,kind,project_id,actor_id,request_hash,receipt) VALUES(?,?,?,?,?,?,?,?,?)').run(run.id, nodeId, story.id, caseIndex, kind, run.project_id, req.user.id, digest, receipt);
    return receipt;
  })();
}
const automaticPublication = run => run?.workflow_snapshot?.settings?.template_id === 'sprint-automator'
  && run.workflow_snapshot.settings.library_publication_mode === 'automatic';
const publicationCancelled = () => Object.assign(new Error('Automatic Library publication stopped. Saved cases remain in the Library with review pending.'), {
  name: 'AbortError', code: 'WORKFLOW_CANCELLED', statusCode: 499, retryable: false, nonRetryable: true,
  publicMessage: 'Automatic Library publication stopped. Saved cases remain in the Library with review pending.'
});
const assertPublicationActive = signal => { if (signal?.aborted) throw publicationCancelled(); };

async function currentActor(user, run) {
  if (!user?.id || run.created_by !== user.id) throw fail('Automatic publication must use the original workflow actor.', 403);
  const actor = await db.prepare('SELECT id,status,is_workspace_admin FROM users WHERE id=?').get(user.id);
  if (!actor || actor.status !== 'active') throw fail('The workflow actor is no longer active.', 403);
  return { id: actor.id, role: actor.is_workspace_admin ? 'admin' : 'member' };
}

async function publishCase({ run, nodeId, packet, draft, caseIndex, kind, automated, user, signal }) {
  assertPublicationActive(signal);
  const digest = tasks.fingerprint({ draft, automated: kind === 'automation' ? automated : null, app_type_id: run.app_type_id });
  return db.transaction(async () => {
    // A cancellation may arrive between generated cases or from another
    // worker. Hold the run only for this atomic case+receipt, then recheck for
    // the next case. Cancellation never waits for the complete Sprint batch.
    const current = await db.prepare('SELECT status FROM agentic_workflow_runs WHERE id=? FOR SHARE').get(run.id);
    assertPublicationActive(signal);
    if (current?.status === 'cancelled') throw publicationCancelled();
    if (!current || !['running', 'completed', 'needs_review'].includes(current.status)) throw fail('This workflow is no longer eligible to publish generated cases.', 409);
    const actor = await currentActor(user, run);
    await tasks.access(actor, run.project_id, ['agentic_workflow.view', 'testcase.create', 'requirement.view']);
    if (kind === 'automation') await tasks.access(actor, run.project_id, ['automation.view', 'automation.code.view', 'automation.build']);
    await require('@hellotest/platform/backend/public/projectAccess').getProject(run.project_id, actor.id);
    const appType = await require('@hellotest/platform/backend/public/applicationAccess').getAppType(run.app_type_id);
    if (appType.project_id !== run.project_id) throw fail('The workflow application is unavailable in this project.', 403);
    const { isMobileAppType, containsMobileStepPayload } = require('@hellotest/platform/backend/src/utils/mobileFeature');
    if (isMobileAppType(appType.type) || containsMobileStepPayload(kind === 'automation' ? automated.steps : draft.steps)) {
      await tasks.access(actor, run.project_id, ['mobile.manage']);
    }
    const key = `${run.id}:${packet.story_id}:${caseIndex}:${kind}`;
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`workflow-draft:${key}`);
    const previous = await db.prepare('SELECT request_hash,receipt FROM workflow_draft_acceptances WHERE run_id=? AND story_id=? AND case_index=? AND kind=? AND project_id=?')
      .get(run.id, packet.story_id, caseIndex, kind, run.project_id);
    if (previous) {
      if (previous.request_hash !== digest) throw fail('This published draft has changed. Its existing Library case was retained.', 409);
      return { ...previous.receipt, reused: true };
    }
    await db.prepare('SELECT id FROM requirements WHERE id=? AND project_id=? FOR SHARE').get(packet.story_id, run.project_id);
    const story = await tasks.loadStory(run, actor, packet);
    const manual = kind === 'automation' ? await db.prepare("SELECT receipt FROM workflow_draft_acceptances WHERE run_id=? AND story_id=? AND case_index=? AND kind='manual' AND project_id=?")
      .get(run.id, story.id, caseIndex, run.project_id) : null;
    if (kind === 'automation' && !manual?.receipt?.id) throw fail('Publish the generated manual case before its automation.', 409);
    // Automatic publication saves authored data for later review. It never
    // records a reviewer decision or claims the generated automation was run.
    const payload = { app_type_id: run.app_type_id, title: draft.title, description: draft.description,
      priority: draft.priority, test_case_type: draft.test_case_type, status: 'draft', requirement_ids: [story.id],
      authoring_mode: draft.authoring_mode, gherkin_document: draft.gherkin_document, parameter_values: draft.parameter_values || {},
      steps: draft.steps, ai_generation_source: 'interactive', ai_generation_review_status: 'pending',
      review_status: 'pending', reviewer_id: actor.id, author_id: actor.id, created_by: actor.id, updated_by: actor.id,
      source_idempotency_key: `workflow-draft:${key}`,
      ...(kind === 'automation' ? { automated: 'yes', automation_status: 'incomplete', automation_case_type: resolveAutomationCaseType(automated,{steps:automated.steps}),
        automation_start_url: automated.automation_start_url || automated.start_url || undefined,
        steps: automated.steps, parameter_values: automated.parameter_values || draft.parameter_values || {},
        manual_test_case_ids: [manual.receipt.id] } : {}) };
    assertPublicationActive(signal);
    const saved = await require('@hellotest/testing/backend/services/testCase.service').createTestCase(payload);
    if (typeof saved?.id !== 'string' || !saved.id) throw fail('The Test Case service did not return its saved identity.', 502);
    const receipt = { id: saved.id, story_id: story.id, case_index: caseIndex, client_id: draft.client_id,
      workflow_run_id: run.id, workflow_node_id: nodeId,
      title: draft.title, kind, saved: true, publication_mode: 'automatic', ai_generation_source: 'interactive',
      ai_generation_review_status: 'pending', review_status: 'pending', requires_review: true,
      verification_status: kind === 'automation' ? 'unverified' : 'pending_review', requires_test_run: kind === 'automation' };
    await db.prepare('INSERT INTO workflow_draft_acceptances(run_id,node_id,story_id,case_index,kind,project_id,actor_id,request_hash,receipt) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(run.id, nodeId, story.id, caseIndex, kind, run.project_id, actor.id, digest, receipt);
    return receipt;
  })();
}

async function publishNodeArtifacts({ run, node, user, signal }) {
  if (!automaticPublication(run)) return null;
  assertPublicationActive(signal);
  // Reload the recorded checkpoint. Caller-provided output, policy or actor
  // fields cannot substitute for the immutable run and its native lineage.
  const stored = await db.prepare('SELECT * FROM agentic_workflow_runs WHERE id=?').get(run.id);
  if (!stored || !automaticPublication(stored) || stored.workflow_snapshot.execution_mode !== 'review'
    || !['running', 'completed', 'needs_review'].includes(stored.status)) throw fail('Automatic publication needs a recorded native Sprint workflow.', 409);
  const nodeId = node?.id || node?.node_id;
  const definition = stored.workflow_snapshot.nodes.find(item => item.id === nodeId);
  const result = stored.node_results.find(item => item.node_id === nodeId && item.node_type === 'artifactTask' && item.status === 'completed');
  const task = definition?.data?.artifactTask;
  if (definition?.data?.kind !== 'artifactTask' || !['test-case-generation', 'automation-engineer'].includes(task)) return null;
  if (!result || result.output?.artifact_task !== task || result.output.generation_mode !== 'native'
    || !['passed', 'needs_input', 'not_required'].includes(result.output.verification?.status)) throw fail('Publish only completed native artifact task output.', 409);
  const packets = (result.execution_context || result.output).data;
  if (!Array.isArray(packets) || packets.length > tasks.MAX_STORIES) throw fail('The native publication checkpoint is invalid.', 409);
  const receipts = [], seen = new Set();
  const summary = status => ({ mode: 'automatic', status, receipts,
    manual_cases_saved: receipts.filter(item => item.kind === 'manual').length,
    automation_cases_saved: receipts.filter(item => item.kind === 'automation').length,
    requires_review: true, approved: false });
  try {
  for (const packet of packets) {
    if (!packet?.story_revision || seen.has(packet.story_id)) throw fail('Publish each revision-pinned Story once.', 409);
    seen.add(packet.story_id);
    tasks._internals.assertDrafts(packet.cases, packet.story_id, require('./generationNodeOptions').pinnedGenerationOptions(stored).maxCases);
    if (packet.test_case_generation?.verification?.status !== 'passed'
      || tasks.fingerprint(packet.test_case_generation.cases) !== tasks.fingerprint(packet.cases)) throw fail('The generated cases changed after native validation.', 409);
    for (const [caseIndex, draft] of packet.cases.entries()) {
      const automated = packet.automation?.[caseIndex];
      if (task === 'automation-engineer') {
        if (automated == null) continue;
        const assessed = packet.case_assurance?.[caseIndex];
        if (assessed?.verification?.status !== 'passed' || assessed.case_fingerprint !== tasks.fingerprint(draft)
          || (definition.data.readinessPolicy === 'require-ready' && assessed.assurance_review?.automation_readiness?.status !== 'ready')
          || automated.case_fingerprint !== tasks.fingerprint(draft) || automated.validation?.status !== 'passed'
          || automated.verification_status !== 'unverified' || !Array.isArray(automated.steps) || !automated.steps.length) {
          throw fail('Automatic automation publication requires an assessed, validated and unverified native draft.', 409);
        }
      }
      receipts.push(await publishCase({ run: stored, nodeId, packet, draft, caseIndex,
        kind: task === 'test-case-generation' ? 'manual' : 'automation', automated, user, signal }));
    }
  }
  } catch (error) {
    error.library_publication = summary('partial');
    if (error.transactionOutcomeUnknown) {
      Object.assign(error, { code: 'AGENT_LIBRARY_PUBLICATION_OUTCOME_UNKNOWN', outcome_unknown: true,
        retryable: false, nonRetryable: true,
        publicMessage: 'The Library publication acknowledgement was lost. Check the recorded case and receipt before retrying; the write may have completed.' });
    }
    error.publicMessage ||= receipts.length
      ? 'Library publication stopped. The recorded saved cases remain in the Library with review pending.'
      : 'Generated cases could not be saved to the Library. Review the publication error before retrying.';
    error.code ||= 'WORKFLOW_PUBLICATION_FAILED';
    throw error;
  }
  return summary('saved');
}
module.exports = { accept, publishNodeArtifacts, isAutomaticPublication: automaticPublication };
