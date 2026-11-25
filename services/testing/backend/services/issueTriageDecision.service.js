const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const db = require('@hellotest/platform/backend/src/db');
const { resolveSessionSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { sanitizeInternalErrorText } = require('@hellotest/platform/backend/src/utils/serviceErrors');
const comments = require('@hellotest/platform/backend/services/comment.service');
const triage = require('@hellotest/ai/services/aiBugTriage');
const issues = require('./issues.service');

const TTL_MS = 30 * 60 * 1000;
const MAX_TOKEN_LENGTH = 20_000;
const COMMENT_ONLY = 'No field changes applied.';
const sign = (value) => createHmac('sha256', resolveSessionSecret()).update(`hellotest.defect-triage.v1:${value}`).digest();
const safe = (value, max = 400) => sanitizeAiText(sanitizeInternalErrorText(String(value ?? '').replace(/\s+/g, ' ').trim())).text.slice(0, max);
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function formatComment(item) {
  const failure = item.failure_context?.attempt;
  return [
    `Defect triage · ${safe(item.display_id, 100)}`,
    `Assessment\n${safe(item.category)} · Priority ${item.current_priority} → ${item.recommended_priority}\n${safe(item.explanation, 1_200)}`,
    [
      'Failure evidence',
      failure ? `${safe(failure.test_case_title)} · ${failure.status}${failure.step_order ? ` · Step ${failure.step_order}` : ''}` : safe(item.failure_context?.detail),
      failure?.step_action ? `Executed action: ${safe(failure.step_action)}` : ''
    ].filter(Boolean).join('\n'),
    `Next steps\n${item.review_actions.slice(0, 7).map((action) => `• ${safe(action, 200)}`).join('\n')}`
  ].join('\n\n');
}

function prepare(item, { projectId, userId }) {
  const comment = formatComment(item);
  const claims = {
    projectId, userId, issueId: item.issue_id, recordFingerprint: item.record_fingerprint,
    correctionCount: item.corrections?.length || 0, contextFingerprint: item.context_fingerprint,
    resultId: item.failure_context?.attempt?.result_id,
    comment, commentId: randomUUID(), expiresAt: Date.now() + TTL_MS
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `${payload}.${sign(payload).toString('base64url')}`, comment };
}

function verify(token, scope) {
  const invalid = () => fail('Run the Defect triage again to get a valid approval.', 403);
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw invalid();
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra) throw invalid();
  const signature = Buffer.from(supplied, 'base64url');
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw invalid();
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (claims.issueId !== scope.issueId || claims.projectId !== scope.projectId || claims.userId !== scope.userId) throw invalid();
  if (claims.expiresAt < Date.now()) throw fail('The Defect triage approval expired. Analyze the current record again.', 409);
  return claims;
}

async function apply({ token, issueId, projectId, user, applyCorrections, canViewEvidence }) {
  const claims = verify(token, { issueId, projectId, userId: user.id });
  return db.transaction(async () => {
    // Serialize with regular edits and with duplicate approvals of this Defect.
    const locked = await db.prepare('SELECT id FROM feedback WHERE id = ? AND project_id = ? FOR UPDATE').get(issueId, projectId);
    if (!locked) throw fail('Defect not found.', 404);
    const existingComment = await db.prepare('SELECT id, body FROM entity_comments WHERE id = ? AND project_id = ? AND entity_type = ? AND entity_id = ?').get(claims.commentId, projectId, 'issue', issueId);
    if (existingComment) return { posted: true, comment_id: claims.commentId, corrections_applied: !existingComment.body.endsWith(COMMENT_ONLY) };
    const issue = await issues.getIssueItem(issueId, { project_id: projectId });
    const stale = () => fail('The Defect or its failure evidence changed. Analyze the current record again.', 409);
    if (triage.issueFingerprint(issue) !== claims.recordFingerprint) throw stale();

    let appliedFields = [];
    if (claims.resultId || applyCorrections) {
      if (claims.resultId && !await db.prepare(`SELECT result.id FROM execution_results result
        JOIN executions run ON run.id = result.execution_id WHERE result.id = ? AND run.project_id = ? FOR SHARE OF result`).get(claims.resultId, projectId)) throw stale();
      const context = await triage.readIssueContext(issue, user, { canView: canViewEvidence });
      if (context.attempt?.result_id !== claims.resultId || triage.contextFingerprint(context) !== claims.contextFingerprint) throw stale();
      if (applyCorrections) {
        if (!claims.correctionCount || context.corrections.length !== claims.correctionCount) throw stale();
        await issues.updateIssue(issueId, Object.fromEntries(context.corrections.map(item => [item.field, item.after])), { actorId: user.id });
        appliedFields = context.corrections.map(item => item.field);
      }
    }

    const comment = await comments.create({
      user, projectId, entityType: 'issue', entityId: issueId, commentId: claims.commentId,
      body: `${claims.comment}\n\nField changes\n${[
        appliedFields.includes('expected_result') && 'Corrected reversed Expected and Actual results using the linked failed step.',
        appliedFields.includes('linked_test_case_ids') && 'Linked the Test Case identified by the recorded failed result.'
      ].filter(Boolean).join('\n') || COMMENT_ONLY}`
    });
    return { posted: true, comment_id: comment.id, corrections_applied: appliedFields.length > 0 };
  })();
}

module.exports = { apply, prepare, verify, formatComment, MAX_TOKEN_LENGTH };
