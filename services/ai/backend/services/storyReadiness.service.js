const db = require('@hellotest/platform/backend/src/db');
const { assertExpectedRevision } = require('@hellotest/platform/backend/src/utils/revision');
const { FIELD, KEYS, contentHash, object } = require('@hellotest/platform/backend/src/utils/storyReadiness');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

exports.update = async (id, { expected_revision, checks, updated_by } = {}) => {
  if (!Number.isSafeInteger(expected_revision) || expected_revision < 1) throw fail('expected_revision is required for a readiness review.');
  if (!updated_by) throw fail('A signed-in reviewer is required.', 401);
  if (!checks || Array.isArray(checks) || typeof checks !== 'object' || !Object.keys(checks).length || Object.keys(checks).length > KEYS.size) throw fail('Provide one or more readiness checks.');
  for (const [key, check] of Object.entries(checks)) {
    if (!KEYS.has(key) || !check || !['met', 'not_met', 'unverified'].includes(check.status)) throw fail('Invalid readiness check.');
    if (typeof check.evidence !== 'string' || check.evidence.length > 2000 || (check.status !== 'unverified' && !check.evidence.trim())) throw fail('Reviewed checks require an evidence note of at most 2000 characters.');
    if (key === 'wireframe' && check.status === 'met' && !String(check.attachment_id || '').trim()) throw fail('Select the Story attachment containing the wireframe.');
  }
  return db.transaction(async () => {
    const story = await db.prepare('SELECT * FROM requirements WHERE id = ? FOR UPDATE').get(id);
    if (!story) throw fail('Story not found.', 404);
    const revision = assertExpectedRevision(story.revision, expected_revision, 'Story');
    const wireframe = checks.wireframe;
    if (wireframe?.status === 'met') {
      const attachment = await db.prepare(`SELECT id FROM attachments WHERE id = ? AND project_id = ? AND entity_type = 'requirement' AND entity_id = ?`).get(wireframe.attachment_id, story.project_id, id);
      if (!attachment) throw fail('The selected wireframe must be attached to this Story.');
    }
    const fields = object(story.additional_fields);
    const saved = object(fields[FIELD]);
    const merged = { ...object(saved.checks) };
    const timestamp = new Date().toISOString();
    for (const [key, check] of Object.entries(checks)) merged[key] = {
      status:check.status, evidence:check.evidence.trim(),
      ...(key === 'wireframe' && check.attachment_id ? { attachment_id:String(check.attachment_id) } : {}),
      verified_by:updated_by, verified_at:timestamp, content_hash:contentHash(story)
    };
    await db.prepare(`UPDATE requirements SET additional_fields = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, revision = ? WHERE id = ?`).run(
      { ...fields, [FIELD]:{ version:1, checks:merged } }, updated_by, revision + 1, id
    );
    return { updated:true, revision:revision + 1 };
  })();
};
