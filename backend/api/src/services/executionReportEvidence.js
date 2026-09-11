const db = require("../db");
const attachmentService = require("./attachment.service");
const permissionService = require("./permission.service");
const { raster } = require("./executionReportHtml");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 60;
const MAX_METADATA = 200;
const TIME_BUDGET_MS = 10_000;
const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const textMimes = new Set(["text/plain", "application/json", "application/xml", "text/xml", "text/csv"]);

// Read only authenticated object storage attachments belonging to this exact run.
// Never fetch URLs or follow attachment IDs supplied in structured logs.
async function attachReportEvidence(report, { user }) {
  const projectId = report.execution.project_id;
  report.attachments = [];
  if (!await permissionService.hasPermission(user, "attachment.view", projectId)
    || !await permissionService.hasPermission(user, "result.view", projectId)) {
    report.evidence_notice = "Stored attachments were not embedded because attachment and result access is required.";
    return;
  }
  const rows = await db.prepare(`
    SELECT attachments.id, attachments.project_id, attachments.entity_type, attachments.entity_id,
      attachments.file_name, attachments.mime_type, attachments.size_bytes
    FROM attachments
    WHERE attachments.project_id = ? AND (
      (attachments.entity_type = 'execution' AND attachments.entity_id = ?)
      OR (attachments.entity_type = 'execution_result' AND attachments.entity_id IN (
        SELECT id FROM execution_results WHERE execution_id = ?
      ))
    ) ORDER BY attachments.created_at DESC, attachments.id DESC LIMIT ?
  `).all(projectId, report.execution.id, report.execution.id, MAX_METADATA + 1);
  const attempts = new Map(report.cases.flatMap(item => item.attempts).map(attempt => [attempt.id, attempt]));
  const targets = [];
  for (const row of rows.slice(0, MAX_METADATA)) {
    const attempt = row.entity_type === "execution_result" ? attempts.get(row.entity_id) : null;
    if (row.project_id !== projectId || (!attempt && !(row.entity_type === "execution" && row.entity_id === report.execution.id))) continue;
    const item = { attachmentId: row.id, filename: row.file_name, fileName: row.file_name, mimeType: row.mime_type, size: Number(row.size_bytes || 0), omitted_reason: "File type or size is outside the portable preview limits." };
    (attempt ? attempt.attachments : report.attachments).push(item);
    targets.push({ row, item, attempt });
  }
  const deadline = Date.now() + TIME_BUDGET_MS;
  let usedBytes = 0, readFiles = 0, omissions = 0;
  for (const { row, item, attempt } of targets) {
    const mime = String(row.mime_type || "").split(";", 1)[0].toLowerCase();
    const limit = imageMimes.has(mime) ? MAX_FILE_BYTES : textMimes.has(mime) ? 128 * 1024 : 0;
    if (!limit || item.size > limit || Date.now() >= deadline || readFiles >= MAX_FILES || usedBytes + item.size > MAX_TOTAL_BYTES) { omissions++; continue; }
    readFiles++;
    let stream, timer, expired = false;
    try {
      const job = (async () => {
        const downloaded = await attachmentService.download({ user, id: row.id });
        stream = downloaded.stream;
        if (expired) { stream.destroy(); throw new Error("Export deadline"); }
        if (downloaded.row.project_id !== projectId || downloaded.row.entity_type !== row.entity_type || downloaded.row.entity_id !== row.entity_id) throw new Error("Attachment scope changed");
        const chunks = []; let size = 0;
        for await (const chunk of stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > limit || usedBytes + size > MAX_TOTAL_BYTES) throw new Error("Export byte limit");
          chunks.push(bytes);
        }
        return Buffer.concat(chunks);
      })();
      const bytes = await Promise.race([job, new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; stream?.destroy(); reject(new Error("Export deadline")); }, Math.min(2500, Math.max(1, deadline - Date.now())));
      })]);
      usedBytes += bytes.length;
      if (imageMimes.has(mime)) {
        const uri = `data:${mime};base64,${bytes.toString("base64")}`;
        if (!raster(uri)) throw new Error("Unsupported image bytes");
        item.dataUrl = uri;
      } else item.text_content = bytes.toString("utf8");
      delete item.omitted_reason;
      for (const step of attempt?.steps || []) if (step.evidence?.attachmentId === row.id) step.evidence = { ...item };
    } catch {
      omissions++;
      item.omitted_reason = "Preview unavailable; the file may be inaccessible, unavailable or exceed export limits.";
    } finally {
      clearTimeout(timer);
      stream?.destroy();
    }
  }
  if (omissions || rows.length > MAX_METADATA) report.evidence_notice = `Some stored files were not embedded. Portable previews allow ${MAX_FILES} files, 2 MB per image and 12 MB total, within a 10-second storage budget.${rows.length > MAX_METADATA ? ` The first ${MAX_METADATA} attachment records are listed.` : ""} See named attachments for details.`;
}
module.exports = { attachReportEvidence };
