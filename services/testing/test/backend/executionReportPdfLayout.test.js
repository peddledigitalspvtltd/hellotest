const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const servicePath = path.resolve(__dirname, '../../backend/services/executionReport.service.js');
const serviceRequire = createRequire(servicePath);
const poppler = process.env.PDFTOTEXT_BIN || 'pdftotext';
const hasPoppler = !spawnSync(poppler, ['-v']).error;
function renderService(execution, results) {
  let modelCalls = 0;
  const dependencies = {
    'execution.service': { getExecution: async () => execution },
    'executionResult.service': { getExecutionResults: async () => results },
    'email.service': {}, 'aiLlmSelection.service': {}, 'workspaceTransaction.service': {},
    aiInstructionBlocks: { aiInstructionBlock: () => '' }, upstreamLlmError: {}, llmResponse: {},
    llmHttpClient: { fetchLlmWithRetry: async () => { modelCalls++; throw new Error('A recorded report must not call a model'); } }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(servicePath, 'utf8'), {
    module, exports: module.exports, Buffer, Date, setTimeout, clearTimeout, process,
    require: key => dependencies[key.split('/').pop()] || serviceRequire(key)
  }, { filename: servicePath });
  return { service: module.exports, modelCalls: () => modelCalls };
}
function fixture({ oversized = false } = {}) {
  const name = oversized
    ? `RUN_TITLE_BEGIN ${'Wide WWWWWW frozen title '.repeat(140)} RUN_TITLE_END`
    : 'Codex sanity manual — intentional failure review';
  const suite = oversized ? `SUITE_BEGIN ${'Preserved suite title '.repeat(250)} SUITE_END` : 'sanity';
  const caseTitle = oversized ? `CASE_BEGIN ${'Recorded case title '.repeat(160)} CASE_END` : 'Login — incorrect password is rejected without a session';
  const note = oversized
    ? `NOTE_BEGIN ${'All recorded paragraph words remain visible. '.repeat(600)} NOTE_END\npassword=LAYOUT_SECRET_MUST_REMAIN_PRIVATE`
    : 'Recorded failure exercise. The application rejected the input as expected; this is not a confirmed product defect.';
  return {
    execution: { id: 'pdf-run', display_id: 'RUN-42', name, run_mode: 'manual', execution_mode: 'remote', trigger: 'manual', status: 'failed',
      started_at: '2026-11-17T07:35:10Z', ended_at: '2026-11-17T07:44:02Z',
      case_snapshots: [{ test_case_id: 'TC-801', test_case_title: caseTitle, suite_id: 'SUITE-1', suite_name: suite }],
      step_snapshots: [{ test_case_id: 'TC-801', snapshot_step_id: 'step-1', step_order: 1, step_type: 'web',
        action: oversized ? `ACTION_BEGIN ${'UnbrokenRecordedAction'.repeat(160)} ACTION_END` : 'Open the recorded login page in a clean browser session.',
        expected_result: oversized ? `EXPECTED_BEGIN ${'The recorded outcome remains readable. '.repeat(150)} EXPECTED_END` : 'The sign-in page is visible.' }]
    },
    results: [{ id: 'result-1', execution_id: 'pdf-run', test_case_id: 'TC-801', status: 'failed', duration_ms: 107000,
      error: oversized ? `ERROR_BEGIN ${'Preserved error text '.repeat(220)} ERROR_END` : 'Step failed during run',
      logs: JSON.stringify({ stepStatuses: { 'step-1': 'failed' }, stepNotes: { 'step-1': note } }) }]
  };
}
function pdfTextAndBounds(pdf) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hellotest-pdf-layout-'));
  const file = path.join(directory, 'report.pdf'), bounds = path.join(directory, 'bounds.html');
  try {
    fs.writeFileSync(file, pdf);
    const result = spawnSync(poppler, ['-bbox-layout', file, bounds], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const inspect = spawnSync('python3', ['-c', `
import json, sys, xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
pages=[]
for page in root.iter():
 if page.tag.split('}')[-1]!='page': continue
 words=[{'text':w.text or '', **{k:float(w.attrib[k]) for k in ['xMin','xMax','yMin','yMax']}} for w in page.iter() if w.tag.split('}')[-1]=='word']
 pages.append({'width':float(page.attrib['width']),'height':float(page.attrib['height']),'words':words})
print(json.dumps(pages))
`, bounds], { encoding: 'utf8' });
    assert.equal(inspect.status, 0, inspect.stderr);
    const pages = JSON.parse(inspect.stdout);
    for (const [index, page] of pages.entries()) {
      for (const word of page.words) {
        assert.ok(word.xMin >= 35.5 && word.xMax <= page.width - 35.5, `page${index + 1} horizontal bounds: ${JSON.stringify(word)}`);
        assert.ok(word.yMin >= 35 && word.yMax <= page.height - 30, `page${index + 1} vertical bounds: ${JSON.stringify(word)}`);
      }
      // Equal-baseline words in separate cells/columns must never intersect.
      for (let left = 0; left < page.words.length; left++) for (let right = left + 1; right < page.words.length; right++) {
        const a = page.words[left], b = page.words[right];
        if (Math.abs(a.yMin - b.yMin) < .25 && Math.abs(a.yMax - b.yMax) < .25) {
          assert.ok(Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin) < .25,
            `page${index + 1} overlapping words: ${JSON.stringify({ a, b })}`);
        }
      }
      if (index) {
        const header = page.words.filter(word => word.yMin < 90).map(word => word.text).join(' ');
        assert.match(header, /HelloTest Run Report - continued/);
        assert.match(header, /Run: RUN-42/);
      }
    }
    const plain = spawnSync(poppler, ['-layout', file, '-'], { encoding: 'utf8' });
    assert.equal(plain.status, 0, plain.stderr);
    if (process.env.PDF_LAYOUT_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.PDF_LAYOUT_ARTIFACT_DIR, { recursive: true });
      fs.copyFileSync(file, path.join(process.env.PDF_LAYOUT_ARTIFACT_DIR, pages.length > 5 ? 'oversized-layout.pdf' : 'manual-layout.pdf'));
    }
    return { pages, text: plain.stdout, compact: plain.stdout.replace(/\s+/g, '') };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('PDF wraps the actual manual-run title inside outcome cells and separates intent from transport', { skip: !hasPoppler }, async () => {
  const { execution, results } = fixture();
  const before = JSON.stringify({ execution, results });
  const { service, modelCalls } = renderService(execution, results);
  const result = pdfTextAndBounds(await service.renderReportPdf(execution.id));
  assert.match(result.text, /Run intent: Manual\s*\| Execution transport: Remote/);
  assert.ok(result.compact.includes(execution.name.replace(/\s+/g, '')));
  assert.match(result.text, /2026-11-17 07:35:10 UTC/);
  assert.match(result.text, /2026-11-17 07:44:02 UTC/);
  assert.equal(modelCalls(), 0);
  assert.equal(JSON.stringify({ execution, results }), before, 'rendering never changes frozen records');
});

test('PDF preserves oversized cells and paragraphs across pages with run/case continuation context', { skip: !hasPoppler }, async () => {
  const { execution, results } = fixture({ oversized: true });
  const { service } = renderService(execution, results);
  const result = pdfTextAndBounds(await service.renderReportPdf(execution.id));
  assert.ok(result.pages.length > 5, 'exercise table, title, error and step continuation across real pages');
  for (const marker of ['RUN_TITLE_BEGIN', 'RUN_TITLE_END', 'SUITE_BEGIN', 'SUITE_END', 'CASE_BEGIN', 'CASE_END',
    'ACTION_BEGIN', 'ACTION_END', 'EXPECTED_BEGIN', 'EXPECTED_END', 'ERROR_BEGIN', 'ERROR_END', 'NOTE_BEGIN', 'NOTE_END']) assert.ok(result.compact.includes(marker), marker);
  const detailText = result.pages.flatMap(page => page.words.filter(word => word.xMin >= 127 && word.yMin >= 90 && word.yMax < 790).map(word => word.text)).join('');
  assert.ok(detailText.includes('UnbrokenRecordedAction'.repeat(160)), 'the full oversized token survives line/page breaks in its own action column');
  assert.equal((detailText.match(/Allrecordedparagraphwordsremainvisible\./g) || []).length, 600, 'every recorded note sentence remains in the detail column');
  assert.ok(!result.text.includes('LAYOUT_SECRET_MUST_REMAIN_PRIVATE'), 'redact whole values before splitting them into lines');
  const caseContinuations = result.pages.filter(page => page.words.some(word => word.text === 'Case:'));
  assert.ok(caseContinuations.length > 2);
  for (const page of caseContinuations) assert.ok(page.words.some(word => word.text === 'TC-801'));
});
