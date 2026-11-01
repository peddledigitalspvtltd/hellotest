const db = require('@hellotest/platform/backend/src/db');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
const attachments = require('@hellotest/platform/backend/services/attachment.service');
const { config } = require('@hellotest/platform/backend/src/config');
const { createHmac, timingSafeEqual } = require('node:crypto');
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function authorize({ engineRunId, headers }) {
  const encoded = headers['x-testengine-artifact-context'];
  const signature = headers['x-testengine-artifact-signature'];
  if (typeof encoded !== 'string' || encoded.length > 4096 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw failure('Invalid engine evidence grant.', 401);
  let grant;
  try { grant = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw failure('Invalid engine evidence grant.', 401); }
  if (!grant || typeof grant !== 'object' || Array.isArray(grant) || grant.purpose !== 'execution-artifact' || grant.engine_run_id !== engineRunId || !Number.isFinite(grant.issued_at)
    || Math.abs(Date.now() - grant.issued_at) > 15 * 60 * 1000) throw failure('The engine evidence grant expired or does not match this run.', 401);
  const transaction = await obsDb.prepare(`SELECT project_id,created_by,metadata FROM workspace_transactions WHERE action='testengine_run'
    AND related_kind='testengine_run' AND related_id=? ORDER BY created_at DESC LIMIT 1`).get(engineRunId);
  if (!transaction) throw failure('This engine run was not dispatched by HelloTest.', 403);
  const integration = transaction.metadata?.source === 'hellotest.local-run' ? { config: {} }
    : await require('@hellotest/integration/backend/services/integration.service').getActiveIntegrationByTypeForProject('testengine', transaction.project_id);
  if (!integration) throw failure('The dispatched TestEngine integration is unavailable.', 403);
  const paired=transaction.metadata?.queue_mode==='paired-local';
  const secret = paired
    ? await require('./pairedLocalExecution.service').callbackSecretFor({
      execution:await require('@hellotest/testing/backend/services/execution.service').getExecution(transaction.metadata.execution_id),
      payload:{engine_run_id:engineRunId,hellotest_test_case_id:transaction.metadata.test_case_id,
        data_set_iteration:transaction.metadata.data_set_iteration_index==null?null:{index:transaction.metadata.data_set_iteration_index}},
      transaction})
    : require('@hellotest/platform/backend/src/security/runtimeSecrets').resolveTestEngineSecret(integration.config?.callback_secret, process.env.TESTENGINE_CALLBACK_SECRET);
  const expected = createHmac('sha256', secret).update(encoded).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw failure('Invalid engine evidence signature.', 401);
  return grant;
}

async function upload({ engineRunId, kind, outcome, checksum, fileName, mimeType, stream }) {
  const transaction = await obsDb.prepare(`SELECT * FROM workspace_transactions
    WHERE action='testengine_run' AND related_kind='testengine_run' AND related_id=?
    ORDER BY created_at DESC LIMIT 1`).get(engineRunId);
  const job = await obsDb.prepare('SELECT transaction_id,payload FROM test_engine_jobs WHERE engine_run_id=?').get(engineRunId);
  if (!transaction || !transaction.metadata?.execution_result_id || job && job.transaction_id !== transaction.id) {
    throw failure('Start this dispatched execution before uploading its evidence.', 409);
  }
  const policy = job?.payload?.artifact_policy || transaction.metadata.artifact_policy || {};
  const failed = outcome === 'failed' || outcome === 'blocked';
  const allowedTypes = { video: ['video/webm'], trace: ['application/zip'], screenshot: ['image/jpeg', 'image/png'] };
  if (!Object.hasOwn(allowedTypes,kind) || !allowedTypes[kind].includes(mimeType)) throw failure('The evidence kind and media type do not match.');
  if (!['passed','failed','blocked','skipped'].includes(outcome)) throw failure('A final capture outcome is required.');
  const mode = kind === 'video' ? policy.video_mode : policy.trace_mode;
  const sectionFailureCapture = kind === 'screenshot' && failed && (transaction.metadata.capture_failure_override === true
    || (job?.payload?.steps || []).some(step => /^\s*\/\/\s*@hellotest-options\s+[^\r\n]*\bscreenshotOnFailure\b/i.test(step.automation_code || '')));
  const enabled = kind === 'screenshot'
    ? failed ? policy.screenshot_on_failure !== false || sectionFailureCapture : policy.screenshot_on_success === true
    : mode && mode !== 'off' && (mode !== 'retain-on-failure' || failed);
  if (!enabled) throw failure('Evidence capture is disabled by the dispatched run policy.', 403);
  const limit = kind === 'video' ? Math.max(1, Math.min(250, Number(policy.max_video_attachment_mb) || 25)) * 1024 * 1024
    : kind === 'trace' ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
  const resultId = transaction.metadata.execution_result_id;
  const attachment = await attachments.uploadManagedExecutionObject({ resultId, transactionId: transaction.id, engineRunId,
    fileName, mimeType, stream, maxBytes: Math.min(limit, config.objectStorage.maxAttachmentBytes), expectedSha256: checksum });
  return { attachment_id: attachment.id, execution_result_id: resultId, file_name: attachment.filename, content_type: attachment.mimeType,
    size_bytes: attachment.size, checksum_sha256: attachment.checksum, compression: attachment.compression, stored_size_bytes: attachment.storedSize };
}

async function validateBundle(bundle, resultId) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return {};
  const refs = Array.isArray(bundle.artifact_refs) ? bundle.artifact_refs : [];
  const ids = [...new Set(refs.map(ref => ref?.attachment_id).filter(id => typeof id === 'string'))];
  const stored = ids.length ? await db.prepare(`SELECT id FROM attachments WHERE entity_type='execution_result' AND entity_id=?
    AND id IN(SELECT jsonb_array_elements_text(?::jsonb))`).all(resultId, JSON.stringify(ids)) : [];
  const valid = new Set(stored.map(row => row.id));
  return { ...bundle, artifact_refs: refs.map(ref => {
    if (!ref?.attachment_id || valid.has(ref.attachment_id)) return ref;
    const { attachment_id, ...unverified } = ref;
    return { ...unverified, attachment_status: 'unavailable', attachment_error: 'The uploaded evidence receipt does not belong to this result.' };
  }) };
}

async function validateEvidence(evidence, resultId) {
  const entries=Object.entries(evidence||{}),ids=entries.map(([,item])=>item?.attachmentId).filter(id=>typeof id==='string');
  if(!ids.length)return evidence;
  const rows=resultId?await db.prepare(`SELECT id,file_name,mime_type,size_bytes,checksum_sha256 FROM attachments
    WHERE entity_type='execution_result' AND entity_id=? AND id IN(SELECT jsonb_array_elements_text(?::jsonb))`).all(resultId,JSON.stringify(ids)):[];
  const stored=new Map(rows.map(row=>[row.id,row]));
  return Object.fromEntries(entries.flatMap(([id,item])=>{
    if(!item?.attachmentId)return [[id,item]];
    const row=stored.get(item.attachmentId);
    if(row)return [[id,{attachmentId:row.id,fileName:row.file_name,mimeType:row.mime_type,size:Number(row.size_bytes),checksum:row.checksum_sha256}]];
    const {attachmentId,...inline}=item;return inline.dataUrl?[[id,inline]]:[];
  }));
}

module.exports = { upload, validateBundle, authorize, validateEvidence };
