const db = require("@hellotest/platform/backend/src/db");
const attachmentService = require("@hellotest/platform/backend/services/attachment.service");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const { assertExpectedRevision } = require("@hellotest/platform/backend/src/utils/revision");

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const MIME_BY_EXTENSION = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", avif: "image/avif",
  heic: "image/heic", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo",
  mpeg: "video/mpeg", mpg: "video/mpeg", ogv: "video/ogg", pdf: "application/pdf", json: "application/json",
  xml: "application/xml", txt: "text/plain", log: "text/plain", csv: "text/csv", zip: "application/zip"
};
const ALLOWED_MIME_TYPES = new Set([...Object.values(MIME_BY_EXTENSION), "text/xml", "application/x-zip-compressed"]);
const attachmentError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const normalizeEvidenceMimeType = (fileName, mimeType) => {
  const normalized = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
  const resolved = !normalized || normalized === "application/octet-stream"
    ? MIME_BY_EXTENSION[String(fileName || "").split(".").pop().toLowerCase()] : normalized;
  if (!ALLOWED_MIME_TYPES.has(resolved)) throw attachmentError("Use an image, video, PDF, text, JSON, XML, CSV, or ZIP evidence file.");
  return resolved;
};
const parseLogs = (value) => {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* Keep existing unstructured logs when adding an evidence pointer. */ }
  return { legacyLogs: value };
};
const getResultScope = async (resultId) => {
  const result = await db.prepare(`
    SELECT execution_results.*, executions.project_id
    FROM execution_results JOIN executions ON executions.id = execution_results.execution_id
    WHERE execution_results.id = ?
  `).get(resultId);
  if (!result) throw attachmentError("Execution result not found.", 404);
  return result;
};
const requireResultPermission = async (user, result, operation) => {
  const permission = operation === "view" ? "result.view" : "result.manage";
  if (!await permissionService.hasPermission(user, permission, result.project_id)) {
    throw attachmentError(`Permission required: ${permission}`, 403);
  }
};
const validateStep = async (result, stepId) => {
  const step = await db.prepare(`
    SELECT snapshot_step_id FROM execution_step_snapshots
    WHERE execution_id = ? AND test_case_id = ? AND snapshot_step_id = ?
  `).get(result.execution_id, result.test_case_id, stepId);
  if (step) return;
  // Old runs may predate frozen step snapshots. Only their own authored steps
  // are eligible; the existence of any frozen steps disables this fallback.
  const snapshot = await db.prepare(`
    SELECT snapshot_step_id FROM execution_step_snapshots WHERE execution_id = ? AND test_case_id = ? LIMIT 1
  `).get(result.execution_id, result.test_case_id);
  if (!snapshot) {
    const legacyStep = await db.prepare("SELECT id FROM test_steps WHERE id = ? AND test_case_id = ?").get(stepId, result.test_case_id);
    if (legacyStep) return;
  }
  throw attachmentError("The step does not belong to this case run.", 400);
};
const evidenceFromAttachment = (attachment) => ({
  attachmentId: attachment.id,
  fileName: attachment.filename,
  mimeType: attachment.mimeType,
  size: attachment.size,
  checksum: attachment.checksum ? `sha256:${attachment.checksum}` : undefined,
  createdAt: attachment.created
});

const list = async ({ user, resultId }) => {
  const result = await getResultScope(resultId);
  await requireResultPermission(user, result, "view");
  const files = await attachmentService.list({ user, entityType: "execution_result", entityId: resultId, projectId: result.project_id });
  const evidence = parseLogs(result.logs).stepEvidence || {};
  return files.map((attachment) => ({ ...attachment, step_id: Object.entries(evidence).find(([, item]) => item?.attachmentId === attachment.id)?.[0] || null }));
};

const upload = async ({ user, resultId, stepId, expectedRevision, fileName, mimeType, stream }) => {
  const result = await getResultScope(resultId);
  await requireResultPermission(user, result, "manage");
  const normalizedStepId = String(stepId || "").trim();
  const normalizedMimeType = normalizeEvidenceMimeType(fileName, mimeType);
  let revision = Number(result.revision || 1);
  let previousEvidence;
  if (normalizedStepId) {
    await validateStep(result, normalizedStepId);
    assertExpectedRevision(result.revision, expectedRevision, "Execution result");
    previousEvidence = parseLogs(result.logs).stepEvidence?.[normalizedStepId];
    if (previousEvidence && !await permissionService.hasPermission(user, "attachment.delete", result.project_id)) {
      throw attachmentError("Replacing step evidence requires attachment.delete.", 403);
    }
  }
  const attachment = await attachmentService.upload({
    user, entityType: "execution_result", entityId: resultId, projectId: result.project_id,
    fileName, mimeType: normalizedMimeType, stream, maxBytes: MAX_EVIDENCE_BYTES,
    onStored: normalizedStepId ? async (saved) => {
      const current = await db.prepare("SELECT * FROM execution_results WHERE id = ? FOR UPDATE").get(resultId);
      if (!current) throw attachmentError("Execution result not found.", 404);
      // A competing write must not replace an attachment the uploader never saw.
      assertExpectedRevision(current.revision, expectedRevision ?? result.revision, "Execution result");
      const logs = parseLogs(current.logs);
      const stepEvidence = logs.stepEvidence && typeof logs.stepEvidence === "object" && !Array.isArray(logs.stepEvidence) ? logs.stepEvidence : {};
      logs.stepEvidence = { ...stepEvidence, [normalizedStepId]: evidenceFromAttachment(saved) };
      revision = Number(current.revision || 1) + 1;
      await db.prepare("UPDATE execution_results SET logs = ?, revision = ? WHERE id = ?").run(JSON.stringify(logs), revision, resultId);
    } : undefined
  });
  // Keep a replaced object as a case attachment. Older saved evidence may still
  // reference it, and replacing a step must not destroy that historical file.
  return { attachment: { ...attachment, step_id: normalizedStepId || null }, revision, evidence: normalizedStepId ? evidenceFromAttachment(attachment) : undefined };
};

const remove = async ({ user, resultId, attachmentId }) => {
  const result = await getResultScope(resultId);
  await requireResultPermission(user, result, "manage");
  const deleted = await attachmentService.remove({
    user, id: attachmentId, expectedEntityType: "execution_result", expectedEntityId: resultId
  });
  return { ...deleted, revision: deleted.revision ?? Number(result.revision || 1) };
};

module.exports = { list, upload, remove, getResultScope, normalizeEvidenceMimeType, MAX_EVIDENCE_BYTES };
