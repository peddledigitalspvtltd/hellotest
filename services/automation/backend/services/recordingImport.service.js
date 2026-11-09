const { createHash } = require('node:crypto');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const conflict = () => Object.assign(new Error('This recording has already been saved with different input selections. The saved plan was retained. Start a new recording to import another version.'), {
  code: 'AUTOMATION_RECORDER_IMPORT_CONFLICT', statusCode: 409
});

function recordingImportIdentity(input) {
  const scope = [input.projectId, input.sourceCaseId, input.userId, input.sessionId, input.transactionId || null, input.recordingId || null];
  if (scope.slice(0, 4).some(value => typeof value !== 'string' || !value)) throw new Error('A recording import requires its project, case, author and session.');
  if (input.parameterBindings != null && !Array.isArray(input.parameterBindings)) throw Object.assign(new Error('Recording parameter bindings must be an array.'), { statusCode: 422 });
  return { id: hash(scope), input_sha256: hash({ targetStepId: input.targetStepId || null,
    bindings: [...(input.parameterBindings || [])].sort((a, b) => a.source_action_index - b.source_action_index),
    actions: Array.isArray(input.includedActionIndices) ? [...input.includedActionIndices].sort((a, b) => a - b) : null,
    context: input.additionalContext || null, capture: input.capture || null }) };
}

function createRecordingImportService(dependencies = {}) {
  const database = () => dependencies.db || require('@hellotest/platform/backend/src/db');
  const read = async identity => {
    const row = await database().prepare('SELECT input_sha256,result FROM automation_recording_imports WHERE id=?').get(identity.id);
    if (!row) return null;
    if (row.input_sha256 !== identity.input_sha256) throw conflict();
    return { ...(typeof row.result === 'string' ? JSON.parse(row.result) : row.result), idempotent_replay: true };
  };
  return {
    load: input => read(recordingImportIdentity(input)),
    // Serialize import/retry on case rows, then commit the receipt with every
    // replaced row. A replay never reapplies code to a subsequently edited plan.
    commit: (input, targetCaseId, save) => database().transaction(async () => {
      for (const id of [...new Set([input.sourceCaseId, targetCaseId])].sort()) {
        if (!await database().prepare('SELECT id FROM test_cases WHERE id=? FOR UPDATE').get(id)) throw Object.assign(new Error('The recording case no longer exists.'), { statusCode: 404 });
      }
      const identity = recordingImportIdentity(input), existing = await read(identity);
      if (existing) return existing;
      const result = await save();
      await database().prepare(`INSERT INTO automation_recording_imports(id,project_id,source_test_case_id,test_case_id,created_by,recorder_session_id,input_sha256,result)
        VALUES(?,?,?,?,?,?,?,?)`).run(identity.id, input.projectId, input.sourceCaseId, targetCaseId, input.userId, input.sessionId, identity.input_sha256, result);
      return result;
    })()
  };
}

const service = createRecordingImportService();
module.exports = { ...service, createRecordingImportService, recordingImportIdentity };
