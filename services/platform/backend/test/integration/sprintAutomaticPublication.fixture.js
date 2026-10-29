const assert = require('node:assert/strict');

module.exports = async ({ db, saveRun, casesNamed, receiptsFor, user, roleId, projectId, userId }) => {
  const publication = require('../../../../agentic/backend/workflows/acceptDraft');
  const automaticRun = async (title, caseCount = 1) => {
    const id = await saveRun(title);
    const row = await db.prepare('SELECT * FROM agentic_workflow_runs WHERE id=?').get(id);
    const packet = row.node_results[0].output.data[0];
    if (caseCount === 2) packet.cases.push({ ...structuredClone(packet.cases[0]), client_id: 'draft-2', title: `${title} second` });
    packet.test_case_generation = { cases: structuredClone(packet.cases), verification: { status: 'passed' } };
    const snapshot = { ...row.workflow_snapshot, settings: { template_id: 'sprint-automator', library_publication_mode: 'automatic' },
      nodes: [{ id: 'generated', data: { kind: 'artifactTask', artifactTask: 'test-case-generation' } }] };
    const results = [{ node_id: 'generated', node_type: 'artifactTask', status: 'completed', output: {
      artifact_task: 'test-case-generation', generation_mode: 'native', verification: { status: 'passed' }, data: [packet] } }];
    await db.prepare('UPDATE agentic_workflow_runs SET workflow_snapshot=?,node_results=? WHERE id=?').run(snapshot, results, id);
    return { ...row, workflow_snapshot: snapshot, node_results: results };
  };
  const publish = (run, signal) => publication.publishNodeArtifacts({ run, node: { id: 'generated' }, user, signal });
  const concurrent = await automaticRun('Automatic concurrent draft');
  const results = await Promise.all(Array.from({ length: 4 }, () => publish(concurrent)));
  assert.equal(new Set(results.map(result => result.receipts[0].id)).size, 1);
  assert.equal(results.filter(result => result.receipts[0].reused).length, 3);
  assert.equal(await casesNamed('Automatic concurrent draft'), 1);
  assert.equal(await receiptsFor(concurrent.id), 1);
  const receipt = results[0].receipts[0];
  const saved = await db.prepare('SELECT ai_generation_source,ai_generation_review_status,review_status,status,created_by,reviewer_id FROM test_cases WHERE id=?').get(receipt.id);
  assert.deepEqual(saved, { ai_generation_source: 'interactive', ai_generation_review_status: 'pending', review_status: 'pending', status: 'draft', created_by: user.id, reviewer_id: user.id });
  // The native case and receipt are one transaction even with a real failing
  // receipt trigger. No retry can strand duplicate cases without provenance.
  const rollback = await automaticRun('Automatic rollback draft');
  await db.query("CREATE FUNCTION sprint_auto_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Automatic fixture receipt failure'; END $$");
  await db.query('CREATE TRIGGER sprint_auto_reject_receipt BEFORE INSERT ON workflow_draft_acceptances FOR EACH ROW EXECUTE FUNCTION sprint_auto_reject_receipt()');
  try {
    await assert.rejects(publish(rollback), /Automatic fixture receipt failure/);
    assert.equal(await casesNamed('Automatic rollback draft'), 0);
    assert.equal(await receiptsFor(rollback.id), 0);
  } finally {
    await db.query('DROP TRIGGER sprint_auto_reject_receipt ON workflow_draft_acceptances');
    await db.query('DROP FUNCTION sprint_auto_reject_receipt()');
  }
  assert.equal((await publish(rollback)).manual_cases_saved, 1);
  // A fresh actor lookup must not retain the admin status or permission grants
  // captured when model generation began.
  const denied = await automaticRun('Automatic revoked permission');
  await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code IN ('agentic_workflow.view','requirement.view','testcase.create') ON CONFLICT DO NOTHING").run(roleId);
  await db.prepare('UPDATE users SET is_workspace_admin=FALSE WHERE id=?').run(userId);
  try {
    await db.prepare("DELETE FROM role_permissions WHERE role_id=? AND permission_id=(SELECT id FROM permissions WHERE code='testcase.create')").run(roleId);
    await assert.rejects(publish(denied), { statusCode: 403 });
    assert.equal(await casesNamed('Automatic revoked permission'), 0);
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code='testcase.create'").run(roleId);
    await db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(userId);
    await assert.rejects(publish(denied), { statusCode: 403 });
    assert.equal(await receiptsFor(denied.id), 0);
  } finally {
    await db.prepare("UPDATE users SET status='active',is_workspace_admin=TRUE WHERE id=?").run(userId);
  }
  const changed = await automaticRun('Automatic changed lineage');
  changed.node_results[0].output.data[0].cases[0].title = 'Tampered draft';
  await db.prepare('UPDATE agentic_workflow_runs SET node_results=? WHERE id=?').run(changed.node_results, changed.id);
  await assert.rejects(publish(changed), { statusCode: 409 });
  assert.equal(await casesNamed('Tampered draft'), 0);
  const foreignActor = { ...user, id: 'another-actor' };
  await assert.rejects(publication.publishNodeArtifacts({ run: denied, node: { id: 'generated' }, user: foreignActor }), { statusCode: 403 });
  const alreadyAborted = await automaticRun('Automatic already aborted');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(publish(alreadyAborted, controller.signal), { code: 'WORKFLOW_CANCELLED', name: 'AbortError' });
  assert.equal(await casesNamed('Automatic already aborted'), 0);
  assert.equal(await receiptsFor(alreadyAborted.id), 0);
  // Simulate cancellation persisted by another worker immediately after the
  // first durable receipt. The Temporal path may have no local AbortSignal.
  const cancelling = await automaticRun('Automatic cancellation draft', 2);
  cancelling.node_results.push({ node_id: 'untouched', node_type: 'output', status: 'completed', output: { marker: 'retain other recorded output' } });
  await db.prepare('UPDATE agentic_workflow_runs SET node_results=? WHERE id=?').run(cancelling.node_results, cancelling.id);
  await db.query(`CREATE FUNCTION sprint_auto_cancel_after_first() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.receipt->>'title'='Automatic cancellation draft' THEN
        UPDATE agentic_workflow_runs SET status='cancelled',completed_at=CURRENT_TIMESTAMP WHERE id=NEW.run_id;
      END IF;
      RETURN NEW;
    END $$`);
  await db.query('CREATE TRIGGER sprint_auto_cancel_after_first AFTER INSERT ON workflow_draft_acceptances FOR EACH ROW EXECUTE FUNCTION sprint_auto_cancel_after_first()');
  try {
    let partial;
    await assert.rejects(publish(cancelling), error => { partial = error.library_publication; return error.code === 'WORKFLOW_CANCELLED'; });
    assert.equal(partial.status, 'partial'); assert.equal(partial.manual_cases_saved, 1); assert.equal(partial.receipts.length, 1);
    assert.equal(await casesNamed('Automatic cancellation draft'), 1);
    assert.equal(await casesNamed('Automatic cancellation draft second'), 0);
    assert.equal(await receiptsFor(cancelling.id), 1);
    const beforeMerge = await db.prepare('SELECT status,completed_at FROM agentic_workflow_runs WHERE id=?').get(cancelling.id);
    assert.equal(beforeMerge.status, 'cancelled');
    await require('../../../../agentic/backend/services/agenticWorkflowExecution.service')._internals.store.mergePublication(cancelling.id, 'generated', 'partial');
    const merged = await db.prepare('SELECT status,completed_at,node_results,output_payload FROM agentic_workflow_runs WHERE id=?').get(cancelling.id);
    assert.equal(merged.status, 'cancelled');
    assert.equal(new Date(merged.completed_at).getTime(), new Date(beforeMerge.completed_at).getTime());
    assert.equal(merged.output_payload.project_changes_applied, true);
    assert.equal(merged.node_results.find(row=>row.node_id==='generated').output.library_publication.receipts[0].id, partial.receipts[0].id);
    assert.deepEqual(merged.node_results.find(row=>row.node_id==='untouched').output, { marker: 'retain other recorded output' });
    await require('../../../../agentic/backend/services/agenticWorkflowExecution.service')._internals.store.mergePublication(cancelling.id);
    const recovered = await db.prepare('SELECT status,node_results FROM agentic_workflow_runs WHERE id=?').get(cancelling.id);
    const recoveredPublication = recovered.node_results.find(row=>row.node_id==='generated').output.library_publication;
    assert.equal(recovered.status, 'cancelled');
    assert.equal(recoveredPublication.status, 'partial');
    assert.equal(recoveredPublication.manual_cases_saved, 1);
    assert.equal(recoveredPublication.receipts.length, 1, 'Recovery merges the durable receipt without duplicating it');
    await assert.rejects(publish(cancelling), { statusCode: 409 });
    assert.equal(await receiptsFor(cancelling.id), 1, 'Cancellation never automatically retries the remaining case');
  } finally {
    await db.query('DROP TRIGGER sprint_auto_cancel_after_first ON workflow_draft_acceptances');
    await db.query('DROP FUNCTION sprint_auto_cancel_after_first()');
  }
  assert.equal(publication.isAutomaticPublication({ workflow_snapshot: { settings: { template_id: 'another-template', library_publication_mode: 'automatic' } } }), false);
  return { automatic_concurrent_replay_one_case: true, pending_ai_review_preserved: true,
    automatic_native_case_receipt_atomic: true, current_actor_revocation_enforced: true, immutable_generation_lineage: true,
    cancellation_before_publication_zero_writes: true, persisted_cancellation_stops_remaining_cases: true,
    cancelled_publication_metadata_recovered_idempotently: true, project_id: projectId };
};
