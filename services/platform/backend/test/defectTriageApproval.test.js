const assert = require('node:assert/strict');
const test = require('node:test');
const Fastify = require('fastify');
const db = require('../src/db');
const project = require('../services/project.service');
const comments = require('../services/comment.service');
const flags = require('../services/featureFlag.service');
const issues = require('../../../testing/backend/services/issues.service');
const decisions = require('../../../testing/backend/services/issueTriageDecision.service');
const triage = require('../../../ai/backend/services/aiBugTriage.service');
const { readIssueContext, summarizeFailure } = require('../../../ai/backend/services/bugTriageEvidence');

const user = { id: 'reviewer', role: 'member' };
const issue = {
  id: 'issue', display_id: 'BUG-10', title: 'Saving payment fails', project_id: 'project',
  priority: 'Medium', severity: 'high', status: 'open', linked_test_run_id: 'run', linked_execution_result_id: 'result',
  linked_step_id: 'step', linked_test_case_ids: ['related-case'], expected_result: '<p>Payment rejected</p>', actual_result: '<p>Payment confirmed</p>'
};
const step = {
  id: 'step', order: 3, action: 'Submit payment', expected_result: 'Payment confirmed', observed_status: 'failed',
  api_observation: { assertions: [{ passed: false, expected: 'Payment confirmed', actual: 'Payment rejected' }] }
};
const packet = { result_id: 'result', execution_id: 'run', test_case_id: 'failed-case', status: 'failed', title: 'Checkout payment', steps: [step] };
const makePreview = (record, context) => ({
  issue_id: record.id, display_id: record.display_id, category: 'Integration / API', current_priority: 'Medium',
  recommended_priority: 'High', explanation: 'The payment assertion failed.', failure_context: context,
  record_fingerprint: triage.issueFingerprint(record), context_fingerprint: triage.contextFingerprint(context),
  review_actions: ['Verify the failure in checkout.'], corrections: context.corrections
});

test('triage uses only the authorized exact result, identifies its failed step and keeps other case links', async () => {
  const calls = [];
  const database = { prepare: (sql) => ({
    all: async (...values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT result.id FROM execution_results')) return [{ id: 'result' }];
      if (sql.includes('WITH latest AS')) return [{ id: 'result', execution_id: 'run', test_case_id: 'failed-case', title: packet.title, status: 'failed', error: 'token=private-token', total_failed_cases: 1,
        logs: JSON.stringify({ stepStatuses: { step: 'failed' }, stepApiDetails: { step: step.api_observation } }) }];
      if (sql.includes('FROM execution_step_snapshots')) return [{ snapshot_step_id: 'step', step_order: 3, action: step.action, expected_result: step.expected_result, total_steps: 3 }];
      assert.fail(`Unexpected evidence query: ${sql}`);
    },
    get: async (...values) => {
      assert.match(sql, /app\.project_id = \?/);
      assert.deepEqual(values, ['failed-case', 'project']);
      return { id: 'failed-case' };
    }
  }) };
  const context = await readIssueContext(issue, user, { database, canView: async () => true });
  assert.equal(context.attempt.test_case_title, 'Checkout payment');
  assert.deepEqual(calls[0].values, ['project', 'run', 'result']);
  assert.deepEqual(context.corrections.map(({ field, after }) => [field, after]), [
    ['expected_result', issue.actual_result], ['actual_result', issue.expected_result], ['linked_test_case_ids', ['related-case', 'failed-case']]
  ]);
  assert.doesNotMatch(JSON.stringify(context.sources), /private-token/);

  calls.length = 0;
  const byRecordedReference = await readIssueContext({ ...issue, linked_execution_result_id: null }, user, { database, canView: async () => true });
  assert.equal(byRecordedReference.attempt.result_id, 'result');
  assert.match(calls[0].sql, /run\.project_id = \? AND run\.id = \?/);
  assert.deepEqual(calls[0].values, ['project', 'run', 'issue', 'BUG-10', 'issue', 'BUG-10']);
  assert.deepEqual(calls[1].values, ['project', 'run', 'result']);

  calls.length = 0;
  const restricted = await readIssueContext(issue, user, { database, canView: async () => false });
  assert.equal(restricted.attempt, undefined);
  assert.deepEqual(restricted.corrections, []);
  assert.equal(calls.length, 0);
  const uncertain = summarizeFailure({ ...issue, linked_execution_result_id: null, linked_test_case_ids: [] }, [packet, { ...packet, result_id: 'other' }]);
  assert.equal(uncertain.state, 'ambiguous');
  assert.deepEqual(uncertain.corrections, []);
  assert.deepEqual(summarizeFailure({ ...issue, actual_result: 'Different evidence' }, [packet]).corrections, []);
});

test('approved triage writes its corrections and formatted comment together, protects scope and safely retries', async (t) => {
  let record = { ...issue };
  let context = summarizeFailure(record, [packet], 'result', true);
  let commentsById = new Map();
  let failPosting = false;
  let canComment = false;
  const app = Fastify();
  t.after(() => app.close());
  t.mock.method(flags, 'isEnabled', async () => true);
  t.mock.method(project, 'getProject', async (id) => ({ id }));
  t.mock.method(issues, 'getIssueItem', async () => record);
  t.mock.method(issues, 'updateIssue', async (_id, patch) => { record = { ...record, ...patch }; return { updated: true }; });
  t.mock.method(triage, 'preview', async () => ({ triage: [makePreview(record, context)] }));
  t.mock.method(triage, 'readIssueContext', async () => context);
  t.mock.method(db, 'transaction', (callback) => async () => {
    const initial = { record, commentsById: new Map(commentsById) };
    try { return await callback(); } catch (error) {
      ({ record, commentsById } = initial);
      throw error;
    }
  });
  t.mock.method(db, 'prepare', (sql) => ({ get: async (...params) => {
    if (sql.includes('FOR UPDATE')) return { id: issue.id };
    if (sql.includes('FOR SHARE OF result')) return { id: 'result' };
    if (sql.includes('FROM entity_comments')) return commentsById.get(params[0]);
    assert.fail(`Unexpected approval query: ${sql}`);
  } }));
  t.mock.method(comments, 'create', async ({ commentId, body }) => {
    if (failPosting) throw new Error('Write interrupted');
    const comment = { id: commentId, body };
    commentsById.set(commentId, comment);
    return comment;
  });
  app.decorate('authenticate', async (req) => {
    req.user = user;
    if (req.headers['x-test-api-key']) req.apiKey = {};
  });
  app.decorate('requirePermission', (permission) => async () => {
    if (permission === 'comment.create' && !canComment) throw Object.assign(new Error('Comment permission required'), { statusCode: 403 });
  });
  await app.register(require('../src/plugins/validator'));
  await app.register(require('../../../testing/backend/routes/issues.routes'));
  const analyze = (headers) => app.inject({ method: 'POST', url: '/feedback/ai-triage-preview', headers, payload: { project_id: issue.project_id, issue_ids: [issue.id] } });
  assert.equal((await analyze()).json().triage[0].approval, undefined);
  canComment = true;
  assert.equal((await analyze({ 'x-test-api-key': '1' })).json().triage[0].approval, undefined);
  const preview = (await analyze()).json().triage[0];
  assert.equal(preview.record_fingerprint, undefined);
  const { approval } = preview;
  assert.match(approval.comment, /Defect triage · BUG-10/);
  const apply = (token = approval.token, apply_corrections = true, issueId = issue.id, headers) => app.inject({
    method: 'POST', url: `/feedback/${issueId}/ai-triage-apply`, headers, payload: { project_id: issue.project_id, token, apply_corrections }
  });

  canComment = false;
  assert.equal((await apply()).statusCode, 403);
  canComment = true;
  assert.equal((await apply(approval.token, true, issue.id, { 'x-test-api-key': '1' })).statusCode, 403);
  assert.equal((await apply(`${approval.token}tampered`)).statusCode, 403);
  assert.equal((await apply(approval.token, true, 'different-issue')).statusCode, 403);
  record = { ...record, title: 'Changed by another reviewer' };
  assert.equal((await apply()).statusCode, 409);
  record = issue;
  const originalContext = context;
  context = { ...context, detail: 'Changed failure evidence' };
  assert.equal((await apply()).statusCode, 409);
  context = originalContext;
  failPosting = true;
  assert.equal((await apply()).statusCode, 500);
  assert.equal(record.expected_result, issue.expected_result);
  assert.equal(commentsById.size, 0);

  failPosting = false;
  const response = await apply();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().corrections_applied, true);
  assert.equal(record.expected_result, issue.actual_result);
  assert.deepEqual(record.linked_test_case_ids, ['related-case', 'failed-case']);
  assert.equal(record.priority, issue.priority);
  const comment = commentsById.get(response.json().comment_id);
  assert.match(comment.body, /Defect triage · BUG-10\n\nAssessment\n/);
  assert.match(comment.body, /Failure evidence\nCheckout payment · failed · Step 3/);
  assert.match(comment.body, /Field changes\nCorrected reversed Expected and Actual results/);
  assert.deepEqual((await apply(approval.token, false)).json(), response.json());
  assert.equal(commentsById.size, 1);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 31 * 60 * 1000);
  assert.throws(() => decisions.verify(approval.token, { issueId: issue.id, projectId: issue.project_id, userId: user.id }), { statusCode: 409 });
});
