const db = require('@hellotest/platform/backend/src/db');
const { createToken } = require('@hellotest/platform/backend/src/utils/token');
const { createHash } = require('node:crypto');
const { normalizeArtifacts } = require('./agentArtifacts');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { publicMessage: message, statusCode });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function proposalOperation(original, edited, review, appTypeId, userId) {
  if (!original || edited?.kind !== original.kind || edited?.target_id !== original.target_id) throw fail('The proposal kind and target must match the recorded review.');
  const targets = original.target_id ? [{ id: original.target_id, revision: original.target_revision, citation_id: original.citation_ids[0] }] : [];
  if (original.target_id && (!Number.isInteger(original.target_revision) || original.target_revision < 1)) throw fail('This Story proposal has no recorded revision. Generate a fresh review.', 409);
  let artifact;
  try { [artifact] = normalizeArtifacts([edited], review.citations, targets); } catch { throw fail("The proposal contains invalid fields or unverified citations."); }
  const projectId = review.transaction.project_id;
  const common = { title: artifact.title, description: artifact.description, priority: Number(artifact.priority.slice(1)) };
  if (artifact.kind === 'story') return { artifact, permission: original.target_id ? 'requirement.update' : 'requirement.create', method: original.target_id ? 'PUT' : 'POST', url: original.target_id ? `/requirements/${encodeURIComponent(original.target_id)}` : '/requirements', payload: { ...common, project_id: projectId, acceptance_criteria: artifact.acceptance_criteria, ...(original.target_id ? { expected_revision: original.target_revision } : {}) } };
  if (artifact.kind === 'test_case') {
    if (!appTypeId) throw fail('Select an application before accepting a Test Case.');
    return { artifact, permission: 'testcase.create', method: 'POST', url: '/test-cases', payload: { ...common, app_type_id: appTypeId, description: [artifact.description, artifact.prerequisites?.length ? `Prerequisites:\n${artifact.prerequisites.join('\n')}` : ''].filter(Boolean).join('\n\n'), ai_generation_source: 'interactive', steps: artifact.steps.map((step, index) => ({ ...step, step_order: index + 1, step_type: 'manual' })) } };
  }
  return { artifact, permission: 'feedback.create', method: 'POST', url: '/feedback', payload: { project_id: projectId, user_id: userId, title: artifact.title, message: artifact.description, priority: artifact.priority, severity: artifact.severity, steps_to_reproduce: artifact.reproduction_steps.join('\n'), expected_result: artifact.expected_result, actual_result: artifact.actual_result } };
}

async function accept(app, req, review) {
  const index = req.body?.index;
  if (!Number.isInteger(index) || index < 0 || index >= (review.result?.artifacts?.length || 0)) throw fail('Select a recorded proposal.');
  const original = review.result.artifacts[index];
  const appTypeId = review.transaction.app_type_id || req.body.app_type_id;
  if (appTypeId) {
    const scope = await require('@hellotest/platform/backend/public/applicationAccess').getAppType(appTypeId);
    if (scope.project_id !== review.transaction.project_id) throw fail('The application must belong to the review project.', 403);
  }
  const operation = proposalOperation(original, req.body.artifact, review, appTypeId, req.user.id);
  await app.requirePermission(operation.permission, { projectId: review.transaction.project_id })(req);
  const hash = digest({ artifact: operation.artifact, appTypeId });
  return db.transaction(async () => {
    // Serialize each proposal before checking its receipt. Domain writes and the
    // receipt share this transaction, including nested native domain transactions.
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`agent-proposal:${review.transaction.id}:${index}`);
    const previous = await db.prepare('SELECT * FROM agent_proposal_acceptances WHERE session_id=? AND proposal_index=? AND project_id=?').get(review.transaction.id, index, review.transaction.project_id);
    if (previous) {
      if (previous.request_hash !== hash) throw fail('This proposal was already saved. Open the saved record to make further changes.', 409);
      return { ...previous.receipt, reused: true };
    }
    if (original.target_id) {
      const current = await app.inject({ method: 'GET', url: `/requirements/${encodeURIComponent(original.target_id)}`, headers: { authorization: `Bearer ${createToken(req.user)}` } });
      if (current.statusCode !== 200 || current.json().project_id !== review.transaction.project_id) throw fail('The target Story is unavailable in this review project.', 409);
    }
    const response = await app.inject({ method: operation.method, url: operation.url, headers: { authorization: `Bearer ${createToken(req.user)}` }, payload: operation.payload });
    let body; try { body = response.json(); } catch { throw fail('The destination returned an invalid response.', 502); }
    if (response.statusCode >= 400) throw fail(body.publicMessage || body.error || body.message || 'Unable to save this proposal.', response.statusCode);
    const id = original.target_id || body.id;
    if (typeof id !== 'string' || !id) throw fail('The destination did not return the saved record identity.', 502);
    const receipt = { id, kind: original.kind, updated: Boolean(original.target_id), proposal_index: index, saved: true };
    await db.prepare('INSERT INTO agent_proposal_acceptances(session_id,proposal_index,project_id,actor_id,request_hash,receipt) VALUES(?,?,?,?,?,?)').run(review.transaction.id, index, review.transaction.project_id, req.user.id, hash, receipt);
    return receipt;
  })();
}
module.exports = { accept, proposalOperation };
