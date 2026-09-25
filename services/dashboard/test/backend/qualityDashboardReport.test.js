const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const reports = require("../../backend/services/qualityDashboardReport.service");

const jpegDataUrl = ({ width, height }) => {
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
};

test("dashboard report PDF embeds the rendered dashboard snapshot", () => {
  const pdf = reports.renderedSnapshotPdf({
    rendered_snapshot_data_url: jpegDataUrl({ width: 1200, height: 800 })
  });

  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  assert.ok(pdf.includes(Buffer.from("/Subtype /Image")));
  assert.ok(pdf.includes(Buffer.from("/DCTDecode")));
  assert.ok(pdf.includes(Buffer.from("/Count 1")));
});

test("tall dashboard snapshots flow across multiple PDF pages", () => {
  const pdf = reports.renderedSnapshotPdf({
    rendered_snapshot_data_url: jpegDataUrl({ width: 1200, height: 3000 })
  });

  assert.ok(pdf.includes(Buffer.from("/Count 4")));
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 4);
});

test("logical report sections are packed into one complete multi-page PDF", () => {
  const pdf = reports.renderedSnapshotPdf({
    rendered_snapshot_pages_data_urls: [
      jpegDataUrl({ width: 1200, height: 180 }),
      jpegDataUrl({ width: 1200, height: 420 }),
      jpegDataUrl({ width: 1200, height: 900 }),
      jpegDataUrl({ width: 1200, height: 900 })
    ]
  });

  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  assert.ok(pdf.includes(Buffer.from("/Count 3")));
  assert.equal((pdf.toString("latin1").match(/\/Subtype \/Image/g) || []).length, 4);
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 3);
});

test("continuous snapshot exports preserve a tall rendered view on one PDF page", () => {
  const pdf = reports.renderedSnapshotPdf({
    rendered_snapshot_data_url: jpegDataUrl({ width: 1200, height: 3000 })
  }, { pageMode: "continuous" });

  assert.ok(pdf.includes(Buffer.from("/Count 1")));
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 842 \d+\.\d{3}\]/);
});

test("dashboard snapshot export rejects unsupported image payloads", () => {
  assert.throws(
    () => reports.renderedSnapshotPdf({ rendered_snapshot_data_url: "data:image/png;base64,AAAA" }),
    /JPEG data URL/
  );
});

test("dashboard PDF and email routes pass the rendered snapshot to the report service", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../../backend/routes/qualityAnalytics.routes.js"), "utf8");
  assert.match(routes, /reports\.renderPdf\(dashboard, req\.body \|\| \{\}\)/);
  assert.match(routes, /snapshotPayload: req\.body \|\| \{\}/);
});
