const normalizeText = value => typeof value === "string" ? value.trim() : "";

const pdfNumber = (value) => {
  const normalized = Number(value || 0);
  return Number.isFinite(normalized) ? normalized.toFixed(2).replace(/\.?0+$/, "") : "0";
};

const hexToRgb = (hex) => {
  const normalized = String(hex || "#000000").replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((entry) => `${entry}${entry}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255
  ].map(pdfNumber);
};

const pdfColor = (hex, operator = "rg") => `${hexToRgb(hex).join(" ")} ${operator}`;

const parseJpegEvidence = (evidence) => {
  const dataUrl = normalizeText(evidence?.dataUrl || evidence?.data_url);

  if (!dataUrl) {
    return null;
  }

  const match = dataUrl.match(/^data:image\/(?:jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i);

  if (!match) {
    return null;
  }

  const data = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  const size = readJpegSize(data);

  if (!size) {
    return null;
  }

  return {
    data,
    width: size.width,
    height: size.height,
    fileName: normalizeText(evidence?.fileName || evidence?.file_name) || "evidence.jpg"
  };
};

const readJpegSize = (data) => {
  if (!Buffer.isBuffer(data) || data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = data[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > data.length) {
      break;
    }

    const length = data.readUInt16BE(offset);

    if (length < 2 || offset + length > data.length) {
      break;
    }

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame && offset + 7 < data.length) {
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5)
      };
    }

    offset += length;
  }

  return null;
};

/** Render only the recorded model; formatting ports are shared with report email. */
const renderExecutionReportPdf = (report, { formatDate, formatDuration, reportCaseTitle, getStatusMeta, buildAiAnalysisLines }) => {
  const font = require("./reportPdfFont").createReportPdfFont();
  const redact = require("./executionReportHtml").redact;
  const clean = value => String(redact(String(value ?? ""))).replace(/\r\n?/g, "\n");
  const encoded = value => font.encode(clean(value));
  const pageWidth = 612, pageHeight = 842, margin = 36;
  const usableWidth = pageWidth - margin * 2, bottomLimit = pageHeight - margin - 22;
  const pages = [], images = [];
  let ops = [], cursorY = margin, activeCase = null, activeSuite = null;
  const toPdfY = (top, height = 0) => pageHeight - top - height;
  const text = (value, x, y, size = 10, options = {}) => {
    ops.push(`BT ${pdfColor(options.color || "#111827")} /${options.bold ? "F2" : "F1"} ${pdfNumber(size)} Tf ${pdfNumber(x)} ${pdfNumber(pageHeight - y)} Td ${encoded(value)} Tj ET`);
  };
  const rect = (x, y, width, height, fill, stroke) => {
    if (!fill && !stroke) return;
    const commands = ["q"];
    if (fill) commands.push(pdfColor(fill));
    if (stroke) commands.push(pdfColor(stroke, "RG"));
    commands.push(`${pdfNumber(x)} ${pdfNumber(toPdfY(y, height))} ${pdfNumber(width)} ${pdfNumber(height)} re`, fill && stroke ? "B" : fill ? "f" : "S", "Q");
    ops.push(commands.join("\n"));
  };
  // The same embedded glyph advances drive wrapping and the PDF's width table.
  // Break a single overlong token too, so URLs/IDs cannot escape their cell.
  const wrap = (value, width, size) => clean(value).split("\n").flatMap(paragraph => {
    const lines = [];
    let current = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (font.measureText(word, size) > width) {
        if (current) { lines.push(current); current = ""; }
        for (const char of word) {
          if (current && font.measureText(current + char, size) > width) { lines.push(current); current = ""; }
          current += char;
        }
      } else if (current && font.measureText(`${current} ${word}`, size) > width) {
        lines.push(current); current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    if (current || !lines.length) lines.push(current);
    return lines;
  });
  const lineSpecs = (value, width, size = 9, options = {}) => wrap(value, width, size).map(value => ({ value, size, leading: options.leading || size + 4, ...options }));
  const addPage = () => {
    ops = []; pages.push(ops); cursorY = margin;
    if (pages.length === 1) return;
    const identity = [
      `Run: ${report.execution.display_id || report.execution.id || "recorded run"}`,
      activeSuite ? `Suite: ${activeSuite.id || "direct cases"}` : null,
      activeCase ? `Case: ${activeCase.display_id || activeCase.id || activeCase.instance_id}` : null
    ].filter(Boolean).join(" | ");
    const lines = lineSpecs(identity, usableWidth - 20, 7, { leading: 10, color: "#5b6472" });
    const height = 31 + lines.length * 10;
    rect(margin, margin, usableWidth, height, "#edf3f8", "#edf3f8");
    text("HelloTest Run Report - continued", margin + 10, margin + 16, 9, { bold: true, color: "#122033" });
    lines.forEach((line, index) => text(line.value, margin + 10, margin + 29 + index * 10, line.size, line));
    cursorY = margin + height + 12;
  };
  const ensure = height => { if (cursorY + height > bottomLimit) addPage(); };
  const statusPill = (status, x, y) => {
    const meta = getStatusMeta(status), label = meta.label.toUpperCase();
    const width = Math.max(48, font.measureText(label, 7) + 16);
    rect(x, y - 10, width, 17, meta.bg, meta.border);
    text(label, x + 8, y + 2, 7, { bold: true, color: meta.fg });
  };
  // A block can span any number of pages. Small blocks move intact; oversized
  // blocks split only between lines and always make bounded forward progress.
  const flowBox = (lines, options = {}) => {
    const { x = margin, width = usableWidth, textX = x + 10, padding = 10, gap = 8,
      minimum = 0, fill = "#ffffff", stroke = "#dfe7f1", onChunk } = options;
    let offset = 0;
    const fullHeight = Math.max(minimum, lines.reduce((sum, line) => sum + line.leading, 0) + padding * 2);
    if (fullHeight <= bottomLimit - 110 && cursorY + fullHeight > bottomLimit) addPage();
    while (offset < lines.length) {
      if (bottomLimit - cursorY < Math.max(minimum, padding * 2 + lines[offset].leading)) addPage();
      let count = 0, height = padding * 2;
      while (offset + count < lines.length && height + lines[offset + count].leading <= bottomLimit - cursorY) {
        height += lines[offset + count].leading; count++;
      }
      height = Math.max(minimum, height);
      rect(x, cursorY, width, height, fill, stroke);
      onChunk?.({ top: cursorY, height, continued: offset > 0 });
      let y = cursorY + padding;
      for (const line of lines.slice(offset, offset + count)) {
        text(line.value, line.x ?? textX, y + line.size, line.size, line);
        y += line.leading;
      }
      offset += count; cursorY += height + gap;
      if (offset < lines.length) addPage();
    }
  };
  const paragraph = (value, size = 9, options = {}) => flowBox(lineSpecs(value, usableWidth - 4, size, options), {
    x: margin, width: usableWidth, textX: margin, padding: 0, gap: options.gap ?? 6, fill: null, stroke: null
  });
  const sectionTitle = value => {
    ensure(48);
    paragraph(value, 14, { bold: true, color: "#122033", leading: 19, gap: 9 });
  };
  const addImageResource = evidence => {
    const parsed = parseJpegEvidence(evidence);
    if (!parsed) return null;
    const existing = images.find(image => image.fileName === parsed.fileName && image.data.equals(parsed.data));
    if (existing) return existing;
    const image = { ...parsed, name: `Im${images.length + 1}` }; images.push(image); return image;
  };
  const signalLabel = step => [step.has_evidence ? "image" : null, step.console_count ? `${step.console_count} console` : null,
    step.network_count ? `${step.network_count} network` : null].filter(Boolean).join(" | ") || "no artifacts";

  addPage();
  const runIntent = clean(report.execution.run_mode || "not recorded");
  const transport = clean(report.execution.execution_mode || "not recorded");
  const titleCase = value => value.charAt(0).toUpperCase() + value.slice(1);
  flowBox([
    ...lineSpecs("HelloTest Run Report", usableWidth - 36, 11, { bold: true, color: "#9fb5cf", leading: 19 }),
    ...lineSpecs(report.execution.name || "Execution run report", usableWidth - 36, 20, { bold: true, color: "#ffffff", leading: 29 }),
    ...lineSpecs(`Generated ${formatDate(report.generated_at)}`, usableWidth - 36, 8, { color: "#d7e2ef", leading: 13 }),
    ...lineSpecs(`Started ${formatDate(report.execution.started_at)} | Ended ${formatDate(report.execution.ended_at)}`, usableWidth - 36, 8, { color: "#d7e2ef", leading: 13 }),
    ...lineSpecs(`Run intent: ${titleCase(runIntent)} | Execution transport: ${titleCase(transport)}`, usableWidth - 36, 8, { color: "#d7e2ef", leading: 13 })
  ], { textX: margin + 18, padding: 18, fill: "#122033", stroke: "#122033", gap: 18 });

  const cardGap = 8, cardWidth = (usableWidth - cardGap * 4) / 5;
  ensure(70);
  [["Pass rate", `${report.summary.pass_rate}%`, "#28a66d"], ["Total cases", report.summary.total, "#5271d8"],
    ["Passed", report.summary.passed, "#28a66d"], ["Failed", report.summary.failed, "#d94b6a"],
    ["Duration", formatDuration(report.summary.duration_ms), "#5b6472"]].forEach(([label, value, color], index) => {
    const x = margin + index * (cardWidth + cardGap);
    rect(x, cursorY, cardWidth, 54, "#ffffff", "#dfe7f1"); rect(x, cursorY, 4, 54, color, color);
    // Values may grow past the normal short counts; fit this fixed metric card.
    let size = 17;
    while (font.measureText(clean(value), size) > cardWidth - 20 && size > 6) size--;
    text(value, x + 10, cursorY + 23, size, { bold: true });
    text(label, x + 10, cursorY + 41, 8, { color: "#647084" });
  });
  cursorY += 73;
  if (report.ai_analysis) {
    sectionTitle("AI execution analysis");
    buildAiAnalysisLines(report.ai_analysis).filter(Boolean).slice(1).forEach((line, index) => paragraph(line, index === 0 ? 10 : 8, {
      bold: index === 0 || line.endsWith(":"), color: "#334155"
    }));
    cursorY += 8;
  }
  sectionTitle(`Linked defects (${report.summary.defect_count === null ? "unavailable" : report.summary.defect_count || 0})`);
  for (const defect of report.execution.linked_defects || []) paragraph(`${defect.display_id || defect.id}: ${defect.title} [${defect.status}]`);
  cursorY += 8;
  sectionTitle("Run and suite outcomes");
  const columns = [["Scope", 42], ["Name", 196], ["Cases", 42], ["Passed", 46], ["Failed", 44], ["Blocked", 50], ["Running", 50], ["Duration", 70]];
  const tableHeader = () => {
    ensure(50); rect(margin, cursorY, usableWidth, 24, "#f6f9fc", "#dfe7f1");
    let x = margin;
    for (const [label, width] of columns) { text(label, x + 6, cursorY + 15, 8, { bold: true, color: "#647084" }); x += width; }
    cursorY += 24;
  };
  tableHeader();
  const tableRows = [
    ["Run", report.execution.name || report.execution.id, report.summary.total, report.summary.passed, report.summary.failed, report.summary.blocked, report.summary.running, formatDuration(report.summary.duration_ms)],
    ...report.suites.map(suite => ["Suite", suite.name, suite.total, suite.passed, suite.failed, suite.blocked, suite.running, formatDuration(suite.duration_ms)])
  ];
  tableRows.forEach((row, rowIndex) => {
    const cells = row.map((value, index) => wrap(value, columns[index][1] - 12, 8));
    const totalLines = Math.max(...cells.map(cell => cell.length));
    let offset = 0;
    if (totalLines * 11 + 12 <= bottomLimit - 140 && cursorY + totalLines * 11 + 12 > bottomLimit) { addPage(); tableHeader(); }
    while (offset < totalLines) {
      if (bottomLimit - cursorY < 23) { addPage(); tableHeader(); }
      const count = Math.min(totalLines - offset, Math.floor((bottomLimit - cursorY - 12) / 11));
      const height = count * 11 + 12;
      rect(margin, cursorY, usableWidth, height, rowIndex % 2 ? "#ffffff" : "#fbfdff", "#edf2f7");
      let x = margin;
      cells.forEach((cell, index) => {
        cell.slice(offset, offset + count).forEach((value, line) => text(value, x + 6, cursorY + 14 + line * 11, 8, {
          bold: rowIndex === 0 || index === 1, color: index === 3 ? "#126c48" : index === 4 ? "#a32647" : "#111827"
        }));
        x += columns[index][1];
      });
      offset += count; cursorY += height;
      if (offset < totalLines) { addPage(); tableHeader(); }
    }
  });
  cursorY += 18;

  for (const suite of report.suites) {
    activeSuite = suite;
    sectionTitle(`${suite.name} | ${formatDuration(suite.duration_ms)} | ${suite.total} case${suite.total === 1 ? "" : "s"}`);
    for (const testCase of suite.cases) {
      activeCase = testCase;
      const title = lineSpecs(reportCaseTitle(testCase), usableWidth - 130, 11, { bold: true, color: "#111827", leading: 15 });
      const duration = lineSpecs(formatDuration(testCase.duration_ms), usableWidth - 130, 8, { color: "#647084", leading: 12 });
      if ((title.length * 15 + 32) < bottomLimit - 110) ensure(title.length * 15 + 72);
      flowBox([...title, ...duration], { textX: margin + 12, padding: 12, minimum: 44,
        onChunk: ({ top }) => statusPill(testCase.status, pageWidth - margin - 76, top + 19) });
      if (testCase.error) flowBox(lineSpecs(`Error: ${testCase.error}`, usableWidth - 36, 8, { color: "#a32647", leading: 12 }), {
        x: margin + 8, width: usableWidth - 16, textX: margin + 18, padding: 10, fill: "#fff5f7", stroke: "#ffd4de"
      });
      for (const step of testCase.steps) {
        const detailWidth = usableWidth - 120, detailX = margin + 92;
        const lines = [
          ...lineSpecs(step.action || "No action recorded", detailWidth, 9, { bold: true, leading: 12 }),
          ...(step.expected_result ? lineSpecs(`Expected: ${step.expected_result}`, detailWidth, 8, { color: "#647084", leading: 11 }) : []),
          ...(step.note ? lineSpecs(step.note, detailWidth, 8, { color: "#475569", leading: 11 }) : []),
          ...(step.page_url ? lineSpecs(`URL: ${step.page_url}`, detailWidth, 7, { color: "#647084", leading: 10 }) : []),
          ...lineSpecs(signalLabel(step), detailWidth, 7, { color: "#647084", leading: 11 })
        ];
        flowBox(lines, { x: margin + 8, width: usableWidth - 16, textX: detailX, padding: 9, minimum: 48, fill: "#fbfdff", stroke: "#e7edf5",
          onChunk: ({ top, continued }) => { text(`Step ${step.order}${continued ? " (cont.)" : ""}`, margin + 18, top + 15, 8, { bold: true, color: "#647084" }); statusPill(step.status, margin + 18, top + 33); }
        });
        const image = addImageResource(step.evidence);
        if (image) {
          const width = Math.min(220, detailWidth, image.width), height = Math.min(140, width / image.width * image.height);
          ensure(height + 44);
          rect(margin + 8, cursorY, usableWidth - 16, height + 36, "#fbfdff", "#e7edf5");
          text(`Step ${step.order}`, margin + 18, cursorY + 15, 8, { color: "#647084" });
          text("Evidence image", detailX, cursorY + 14, 7, { color: "#647084" });
          ops.push(`q ${pdfNumber(width)} 0 0 ${pdfNumber(height)} ${detailX} ${pdfNumber(toPdfY(cursorY + 22, height))} cm /${image.name} Do Q`);
          cursorY += height + 44;
        }
      }
      cursorY += 6;
    }
    activeCase = null;
  }
  // Footers are written before font registration so their glyphs enter ToUnicode.
  for (let index = 0; index < pages.length; index++) {
    ops = pages[index];
    text(`HelloTest | Page ${index + 1} of ${pages.length}`, margin, pageHeight - margin, 7, { color: "#647084" });
  }
  const unicodeFont = font;
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };
  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const regularFontId = unicodeFont.register(addObject);
  const boldFontId = regularFontId;
  const imageObjectRefs = images.map((image) => {
    const header = Buffer.from(
      [
        `<< /Type /XObject`,
        `/Subtype /Image`,
        `/Width ${image.width}`,
        `/Height ${image.height}`,
        `/ColorSpace /DeviceRGB`,
        `/BitsPerComponent 8`,
        `/Filter /DCTDecode`,
        `/Length ${image.data.length}`,
        `>>`,
        `stream\n`
      ].join(" "),
      "binary"
    );
    const footer = Buffer.from("\nendstream", "binary");

    return {
      name: image.name,
      id: addObject(Buffer.concat([header, image.data, footer]))
    };
  });
  const xObjectResources = imageObjectRefs.length
    ? `/XObject << ${imageObjectRefs.map((image) => `/${image.name} ${image.id} 0 R`).join(" ")} >>`
    : "";
  const pageIds = [];

  pages.forEach((pageOps) => {
    const stream = Buffer.from(pageOps.join("\n"),"latin1");
    const contentId = addObject(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`,"ascii"),stream,Buffer.from("\nendstream","ascii")]));
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> ${xObjectResources} >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = [Buffer.from("%PDF-1.4\n", "binary")];
  const offsets = [0];
  const lengthSoFar = () => chunks.reduce((total, chunk) => total + chunk.length, 0);
  const pushChunk = (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "binary"));
  };

  objects.forEach((object, index) => {
    offsets.push(lengthSoFar());
    pushChunk(`${index + 1} 0 obj\n`);
    pushChunk(object);
    pushChunk("\nendobj\n");
  });

  const xrefOffset = lengthSoFar();
  pushChunk(`xref\n0 ${objects.length + 1}\n`);
  pushChunk("0000000000 65535 f \n");
  offsets.slice(1).forEach((offset) => {
    pushChunk(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  pushChunk(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
};


module.exports = { renderExecutionReportPdf };
