const dashboards = require("./qualityDashboard.service");
const emailService = require("./email.service");
const workspaceTransactionService = require("./workspaceTransaction.service");

const normalizeRecipients = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
const escapePdf = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7e]/g, "?");
const wrap = (value, width = 88) => {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    if (`${current} ${word}`.trim().length > width && current) { lines.push(current); current = word; }
    else current = `${current} ${word}`.trim();
  });
  if (current) lines.push(current);
  return lines;
};

const simplePdf = (title, lines) => {
  const pageLines = [title, "", ...lines].flatMap((line) => wrap(line)).slice(0, 54);
  const stream = ["BT", "/F1 11 Tf", "50 790 Td", ...pageLines.flatMap((line, index) => index ? ["0 -14 Td", `(${escapePdf(line)}) Tj`] : [`(${escapePdf(line)}) Tj`]), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.concat(chunks).length); chunks.push(Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`)); });
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
};

const collect = async (dashboard) => {
  const evaluation = await dashboards.evaluateBatch({ projectId: dashboard.project_id, gadgets: dashboard.gadgets || [] });
  const lines = [dashboard.description || "HelloTest quality dashboard", `Project: ${evaluation.project?.name || evaluation.project?.key || dashboard.project_id}`, `Evaluated: ${evaluation.evaluated_at}`];
  for (const gadget of dashboard.gadgets || []) {
    const item = evaluation.results.find((candidate) => candidate.gadget_id === gadget.id);
    const value = item?.error ? `Unavailable: ${item.error.message}` : JSON.stringify(item?.result?.value ?? item?.result?.summary ?? item?.result ?? "No result").slice(0, 600);
    lines.push(`${gadget.title}: ${value}`);
  }
  return { evaluation, lines };
};

exports.renderPdf = async (dashboard) => {
  const report = await collect(dashboard);
  return { pdf: simplePdf(`HelloTest Quality Report - ${dashboard.name}`, report.lines), report };
};

exports.share = async ({ dashboard, recipients, requestedBy }) => {
  const normalized = normalizeRecipients(recipients);
  if (!normalized.length) throw new Error("At least one report recipient is required");
  const { lines } = await collect(dashboard);
  const text = [`HelloTest Quality Report - ${dashboard.name}`, "", ...lines].join("\n");
  const html = `<main style="font-family:Inter,Arial,sans-serif;color:#172b4d"><h1>${dashboard.name.replace(/[<>&]/g, "")}</h1>${lines.map((line) => `<p>${String(line).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("")}</main>`;
  await emailService.sendMail({ to: normalized, subject: `HelloTest quality report: ${dashboard.name}`, text, html });
  try {
    await workspaceTransactionService.createTransaction({ project_id: dashboard.project_id, category: "reporting", action: "quality_dashboard_share", status: "completed", title: `Shared quality dashboard ${dashboard.name}`, description: `Sent quality report to ${normalized.length} recipient${normalized.length === 1 ? "" : "s"}.`, metadata: { dashboard_id: dashboard.id, recipient_count: normalized.length, channel: "email" }, related_kind: "quality_dashboard", related_id: dashboard.id, created_by: requestedBy, started_at: new Date().toISOString(), completed_at: new Date().toISOString() });
  } catch {
    // Delivery success is authoritative even if best-effort audit writing fails.
  }
  return { sent: true, recipients: normalized.length };
};
