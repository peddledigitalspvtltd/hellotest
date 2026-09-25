const dashboards = require("./qualityDashboard.service");
const emailService = require("@hellotest/platform/backend/src/services/email.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");

const normalizeRecipients = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
const MAX_RENDERED_SNAPSHOT_BYTES = 6 * 1024 * 1024;
const MAX_RENDERED_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_RENDERED_REPORT_PAGES = 60;
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

const pdfFromObjects = (objects) => {
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n"));
  });
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
};

const readJpegDimensions = (jpeg) => {
  if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Dashboard snapshot must be a valid JPEG image.");
  }
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < jpeg.length) {
    if (jpeg[offset] !== 0xff) { offset += 1; continue; }
    while (offset < jpeg.length && jpeg[offset] === 0xff) offset += 1;
    const marker = jpeg[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= jpeg.length) break;
    const segmentLength = jpeg.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > jpeg.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      const height = jpeg.readUInt16BE(offset + 3);
      const width = jpeg.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error("Dashboard snapshot dimensions could not be read.");
};

const decodeRenderedSnapshot = (payload = {}) => {
  const dataUrl = String(payload.rendered_snapshot_data_url || "");
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("Dashboard snapshot must use JPEG data URL encoding.");
  const jpeg = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  if (!jpeg.length || jpeg.length > MAX_RENDERED_SNAPSHOT_BYTES) {
    throw new Error(`Dashboard snapshot must be no larger than ${Math.floor(MAX_RENDERED_SNAPSHOT_BYTES / 1024 / 1024)} MB.`);
  }
  return { jpeg, ...readJpegDimensions(jpeg) };
};

const decodeRenderedSnapshotPages = (payload = {}) => {
  const pageDataUrls = Array.isArray(payload.rendered_snapshot_pages_data_urls)
    ? payload.rendered_snapshot_pages_data_urls.filter((value) => typeof value === "string" && value.trim())
    : [];
  if (!pageDataUrls.length) return [];
  if (pageDataUrls.length > MAX_RENDERED_REPORT_PAGES) {
    throw new Error(`Dashboard report supports no more than ${MAX_RENDERED_REPORT_PAGES} rendered sections.`);
  }
  const pages = pageDataUrls.map((dataUrl) => decodeRenderedSnapshot({ rendered_snapshot_data_url: dataUrl }));
  const totalBytes = pages.reduce((total, page) => total + page.jpeg.length, 0);
  if (totalBytes > MAX_RENDERED_REPORT_BYTES) {
    throw new Error(`Dashboard report images must total no more than ${Math.floor(MAX_RENDERED_REPORT_BYTES / 1024 / 1024)} MB.`);
  }
  return pages;
};

const renderedSnapshotPagesPdf = (snapshots) => {
  if (!snapshots.length) return null;
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 30;
  const gap = 12;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const renderedSnapshots = snapshots.map((snapshot, index) => {
    const scale = Math.min(contentWidth / snapshot.width, contentHeight / snapshot.height);
    return {
      ...snapshot,
      imageName: `Im${index}`,
      imageObjectId: 3 + index,
      renderedWidth: snapshot.width * scale,
      renderedHeight: snapshot.height * scale
    };
  });
  const packedPages = [];
  let currentPage = [];
  let usedHeight = 0;
  renderedSnapshots.forEach((snapshot) => {
    const nextHeight = (currentPage.length ? gap : 0) + snapshot.renderedHeight;
    if (currentPage.length && usedHeight + nextHeight > contentHeight) {
      packedPages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }
    currentPage.push(snapshot);
    usedHeight += (currentPage.length > 1 ? gap : 0) + snapshot.renderedHeight;
  });
  if (currentPage.length) packedPages.push(currentPage);

  const firstPageObjectId = 3 + renderedSnapshots.length;
  const pageObjectIds = packedPages.map((_page, index) => firstPageObjectId + index * 2);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${packedPages.length} >>`)
  ];
  renderedSnapshots.forEach((snapshot) => {
    objects.push(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${snapshot.width} /Height ${snapshot.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${snapshot.jpeg.length} >>\nstream\n`),
      snapshot.jpeg,
      Buffer.from("\nendstream")
    ]));
  });
  packedPages.forEach((page, pageIndex) => {
    const pageObjectId = pageObjectIds[pageIndex];
    const contentObjectId = pageObjectId + 1;
    const resources = page.map((snapshot) => `/${snapshot.imageName} ${snapshot.imageObjectId} 0 R`).join(" ");
    let y = pageHeight - margin;
    const commands = [];
    page.forEach((snapshot, index) => {
      if (index) y -= gap;
      y -= snapshot.renderedHeight;
      const x = margin + (contentWidth - snapshot.renderedWidth) / 2;
      commands.push(`q\n${snapshot.renderedWidth.toFixed(3)} 0 0 ${snapshot.renderedHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/${snapshot.imageName} Do\nQ`);
    });
    const stream = commands.join("\n");
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << ${resources} >> >> /Contents ${contentObjectId} 0 R >>`));
    objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`));
  });
  return pdfFromObjects(objects);
};

const renderedSnapshotPdf = (payload = {}, options = {}) => {
  const snapshotPages = decodeRenderedSnapshotPages(payload);
  if (snapshotPages.length) return renderedSnapshotPagesPdf(snapshotPages);
  const snapshot = decodeRenderedSnapshot(payload);
  if (!snapshot) return null;

  const pageWidth = 842;
  const margin = 30;
  const contentWidth = pageWidth - margin * 2;
  const imageObjectId = 3;

  if (options.pageMode === "continuous") {
    const maximumPageHeight = 14_400;
    const scale = Math.min(
      contentWidth / snapshot.width,
      (maximumPageHeight - margin * 2) / snapshot.height
    );
    const renderedWidth = snapshot.width * scale;
    const renderedHeight = snapshot.height * scale;
    const pageHeight = Math.max(595, renderedHeight + margin * 2);
    const imageX = (pageWidth - renderedWidth) / 2;
    const imageY = (pageHeight - renderedHeight) / 2;
    const stream = `q\n${renderedWidth.toFixed(3)} 0 0 ${renderedHeight.toFixed(3)} ${imageX.toFixed(3)} ${imageY.toFixed(3)} cm\n/Im0 Do\nQ`;
    return pdfFromObjects([
      Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
      Buffer.from("<< /Type /Pages /Kids [4 0 R] /Count 1 >>"),
      Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${snapshot.width} /Height ${snapshot.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${snapshot.jpeg.length} >>\nstream\n`),
        snapshot.jpeg,
        Buffer.from("\nendstream")
      ]),
      Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents 5 0 R >>`),
      Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
    ]);
  }

  const pageHeight = 595;
  const contentHeight = pageHeight - margin * 2;
  const renderedHeight = snapshot.height * (contentWidth / snapshot.width);
  const pageCount = Math.max(1, Math.ceil(renderedHeight / contentHeight));
  const pageObjectIds = Array.from({ length: pageCount }, (_value, index) => 4 + index * 2);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${snapshot.width} /Height ${snapshot.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${snapshot.jpeg.length} >>\nstream\n`),
      snapshot.jpeg,
      Buffer.from("\nendstream")
    ])
  ];

  pageObjectIds.forEach((pageObjectId, pageIndex) => {
    const contentObjectId = pageObjectId + 1;
    const imageY = pageHeight - margin + pageIndex * contentHeight - renderedHeight;
    const stream = `q\n${margin} ${margin} ${contentWidth} ${contentHeight} re W n\n${contentWidth} 0 0 ${renderedHeight.toFixed(3)} ${margin} ${imageY.toFixed(3)} cm\n/Im0 Do\nQ`;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`));
    objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`));
  });

  return pdfFromObjects(objects);
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

exports.renderPdf = async (dashboard, snapshotPayload = {}) => {
  const styledPdf = renderedSnapshotPdf(snapshotPayload);
  if (styledPdf) return { pdf: styledPdf, report: null, source: "rendered-dashboard" };
  const report = await collect(dashboard);
  return { pdf: simplePdf(`HelloTest Quality Report - ${dashboard.name}`, report.lines), report, source: "server-summary" };
};

exports.share = async ({ dashboard, recipients, requestedBy, snapshotPayload = {} }) => {
  const normalized = normalizeRecipients(recipients);
  if (!normalized.length) throw new Error("At least one report recipient is required");
  const { lines } = await collect(dashboard);
  const styledPdf = renderedSnapshotPdf(snapshotPayload);
  const pdf = styledPdf || simplePdf(`HelloTest Quality Report - ${dashboard.name}`, lines);
  const text = [`HelloTest Quality Report - ${dashboard.name}`, "", ...lines].join("\n");
  const html = `<main style="font-family:Inter,Arial,sans-serif;color:#172b4d"><h1>${dashboard.name.replace(/[<>&]/g, "")}</h1>${lines.map((line) => `<p>${String(line).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("")}</main>`;
  await emailService.sendMail({
    to: normalized,
    subject: `HelloTest quality report: ${dashboard.name}`,
    text,
    html,
    attachments: [{ filename: `${String(dashboard.name || "HelloTest-quality-report").replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`, content: pdf, contentType: "application/pdf" }]
  });
  try {
    await workspaceTransactionService.createTransaction({ project_id: dashboard.project_id, category: "reporting", action: "quality_dashboard_share", status: "completed", title: `Shared quality dashboard ${dashboard.name}`, description: `Sent quality report to ${normalized.length} recipient${normalized.length === 1 ? "" : "s"}.`, metadata: { dashboard_id: dashboard.id, recipient_count: normalized.length, channel: "email" }, related_kind: "quality_dashboard", related_id: dashboard.id, created_by: requestedBy, started_at: new Date().toISOString(), completed_at: new Date().toISOString() });
  } catch {
    // Delivery success is authoritative even if best-effort audit writing fails.
  }
  return { sent: true, recipients: normalized.length };
};

exports.renderedSnapshotPdf = renderedSnapshotPdf;
