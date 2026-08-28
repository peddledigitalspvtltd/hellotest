import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Test Case author is selectable and defaults to the signed-in user", async () => {
  const [page, api] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/lib/api.ts")
  ]);

  assert.match(page, /author_id: currentUserId/);
  assert.match(page, /author_id: caseDraft\.author_id/);
  assert.match(page, /selectedTestCase\.author_id \|\| selectedTestCase\.author\?\.id \|\| selectedTestCase\.created_by/);
  assert.match(page, /resolveAuditUserLabel\(testCase\.created_by, userById\)/);
  assert.match(page, /aria-label="Test case author"/);
  assert.match(page, /assigneeOptions\.map/);
  assert.match(api, /author_id\?: string/);
});

test("Test Data creation uses compact name-sized columns and grouped utilities", async () => {
  const [page, styles] = await Promise.all([
    readSource("../src/pages/TestEnvironmentPage.tsx"),
    readSource("../src/styles.css")
  ]);

  assert.match(page, /getTestDataColumnWidth/);
  assert.match(page, /clamp\(8rem,/);
  assert.doesNotMatch(page, /className="resource-column-letter"/);
  assert.match(page, /aria-label="Available data utilities"/);
  assert.match(page, /Built-in utilities/);
  assert.match(page, /Saved templates/);
  assert.match(page, /aria-label=\{`Value for \$\{modalContextLabel/);
  assert.match(page, /resource-remove-icon/);
  assert.match(page, /<span aria-hidden="true">X<\/span>/);
  assert.match(styles, /--test-data-column-width/);
  assert.match(styles, /\.test-data-form \.resource-remove-icon/);
});

test("Test Case tiles keep every detail while progress bars lead modern metric cards", async () => {
  const [page, modalStyles] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/modal-system.css")
  ]);
  const cardStart = page.indexOf('"record-card tile-card test-case-card test-case-catalog-card"');
  const cardEnd = page.indexOf("isLastCaseInModule", cardStart);
  const card = page.slice(cardStart, cardEnd);

  assert.ok(cardStart >= 0 && cardEnd > cardStart);
  for (const detail of ["Story", "Steps", "Type", "Test Quality", "Failed", "Automation readiness", "Stability", "test-case-ai-note"]) {
    assert.match(card, new RegExp(detail));
  }
  assert.ok(card.indexOf("test-case-readiness-grid") < card.indexOf("test-case-tile-metrics"));
  assert.ok(card.indexOf("test-case-tile-metrics") < card.indexOf("test-case-ai-note"));
  assert.equal((card.match(/<TileCardMetric/g) || []).length, 4);
  assert.match(card, /role="progressbar"/);
  assert.match(card, /aria-valuemax=\{100\}/);
  assert.match(card, /aria-valuenow=\{automationReadiness \?\? undefined\}/);
  assert.match(modalStyles, /\.test-case-catalog-card \.test-case-tile-metrics[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(modalStyles, /@media \(max-width: 560px\)[\s\S]*\.test-case-catalog-card \.test-case-tile-metrics[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("Test Cases reuse full Test Data authoring and link only one mature selection", async () => {
  const [testCases, testData, modalStyles] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/pages/TestEnvironmentPage.tsx"),
    readSource("../src/modal-system.css")
  ]);
  const pickerStart = testCases.indexOf("function TestDataSetPickerDialog");
  const pickerEnd = testCases.indexOf("function StepGroupModal", pickerStart);
  const picker = testCases.slice(pickerStart, pickerEnd);

  assert.match(testCases, /No Data Sets Defined/);
  assert.match(testCases, /Create Data Set/);
  assert.match(testCases, /Link Existing Data Set/);
  assert.match(testCases, /<DataSetForm/);
  assert.match(testCases, /setLinkedDataSetDraftIds\(\[created\.id\]\)/);
  assert.match(testCases, /setLinkedDataSetDraftIds\(\[dataSetLinkDraftId\]\)/);
  assert.match(testCases, /linkedDataSetDraftIds\.slice\(0, 1\)/);
  assert.match(picker, /role="radiogroup"/);
  assert.match(picker, /type="radio"/);
  assert.doesNotMatch(picker, /type="checkbox"/);
  assert.match(picker, /Search by name, description, format, or column/);
  assert.match(testData, /export function DataSetForm/);
  assert.match(testData, /Data file import/);
  assert.match(testData, /Built-in utilities/);
  assert.match(testData, /Saved templates/);
  assert.match(modalStyles, /\.test-case-data-set-inline-empty/);
  assert.match(modalStyles, /\.test-data-set-picker-option\.is-selected/);
});
