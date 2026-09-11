import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
// Reuse the established authenticated, isolated run catalog fixture and production CSS.
const catalog = await readFile(new URL('./runCatalogDetails.test.mjs', import.meta.url), 'utf8');
const base = catalog.match(/const fixtureSource = `([\s\S]*?)`;\n/)[1];
const customization = `
app.type = 'web';
runs.splice(0, runs.length, makeRun('active', 'Case lifecycle regression', 'running', ['suite']));
const run = runs[0];
run.case_snapshots = run.case_snapshots.slice(0,1);
run.test_case_ids = ['case-1']; run.direct_test_case_ids = [];
// Explicit test scope overrides @t.email; an unqualified column now targets run scope.
run.test_data_set.snapshot = { ...data, mode: 'table', columns: ['t.email'], rows: [{ 't.email': 'first-row@example.test' }, { 't.email': 'second-row@example.test' }] };
run.case_snapshots[0].parameter_values = { 't.email': 'case-default@example.test' };
run.case_snapshots[0].suite_parameter_values = { 't.email': 'suite-default@example.test' };
run.case_snapshots[0].test_data_set_id = 'data';
run.case_snapshots[0].test_data_set_name = 'Run customer data';
run.case_snapshots[0].test_data_set_snapshot = run.test_data_set.snapshot;
run.case_snapshots[0].data_set_source = 'run';
run.step_snapshots = [
  { execution_id: 'active', test_case_id: 'case-1', snapshot_step_id: 'precondition', step_order: 1, group_name: 'Preconditions', action: 'Given a customer account exists', expected_result: '' },
  { execution_id: 'active', test_case_id: 'case-1', snapshot_step_id: 'step-main', step_order: 2, action: 'When the customer signs in with @t.email', expected_result: 'Then the dashboard opens' }
];
results = [];
window.lifecycleCalls = [];
window.attachmentCalls = [];
let sequence = 0;
const identify = identity => results.filter(result => result.execution_id === identity.execution_id && result.test_case_id === identity.test_case_id && result.data_set_iteration_index === (identity.data_set_iteration_index ?? 0)).at(-1);
const makeResult = identity => {
  const result = { id: 'attempt-' + ++sequence, execution_id: 'active', test_case_id: 'case-1', app_type_id: 'app', revision: 1, status: 'pending', duration_ms: 0, timer_started_at: null, logs: '{}', error: null, lifecycle_history: [], created_at: new Date(Date.now() + sequence).toISOString(), executed_by: 'qa', data_set_iteration_index: identity.data_set_iteration_index ?? 0, data_set_iteration_key: 'data:' + ((identity.data_set_iteration_index ?? 0) + 1), data_set_row_snapshot: run.test_data_set.snapshot.rows[identity.data_set_iteration_index ?? 0] };
  results.push(result); return result;
};
api.executions.list = async () => structuredClone(runs);
api.executions.get = async () => structuredClone(run);
api.executionResults.list = async query => structuredClone(query?.execution_id ? results.filter(result => result.execution_id === query.execution_id) : results);
api.executionResults.ensure = async identity => { const result = identify(identity) || makeResult(identity); persistMockServer(); return structuredClone(result); };
api.executionResults.transition = async identity => {
  window.lifecycleCalls.push(identity);
  let result = identify(identity) || makeResult(identity);
  if (identity.action === 'reset' || (identity.action === 'start' && ['passed','failed','blocked','skipped','aborted'].includes(result.status))) result = makeResult(identity);
  const before = result.status;
  if (result.timer_started_at) result.duration_ms += Date.now() - Date.parse(result.timer_started_at);
  result.status = ({ start: 'running', resume: 'running', pause: 'paused', abort: 'aborted', block: 'blocked', skip: 'skipped', reset: 'pending', pass: 'passed', fail: 'failed' })[identity.action];
  result.timer_started_at = result.status === 'running' ? new Date(Date.now() - 1000).toISOString() : null;
  result.started_at ||= result.timer_started_at;
  result.revision += 1;
  result.lifecycle_history.push({ action: identity.action, from_status: before, to_status: result.status, actor_name: 'QA Reviewer', at: new Date().toISOString(), duration_ms: result.duration_ms });
  persistMockServer();
  return structuredClone(result);
};
api.executionResults.update = async (id, input) => {
  const result = results.find(item => item.id === id); Object.assign(result, input); result.revision += 1;
  if (result.status !== 'running' && result.timer_started_at) { result.duration_ms += Date.now() - Date.parse(result.timer_started_at); result.timer_started_at = null; }
  persistMockServer();
  return structuredClone(result);
};
const files = [];
// Persist only mock-server metadata so a real page reload can verify readback.
// Production uploads continue through File/multipart and backend object storage.
const fixtureStorageKey = location.pathname + ':mock-attachment-server';
function persistMockServer() { localStorage.setItem(fixtureStorageKey, JSON.stringify({ results, files, sequence, lifecycleCalls: window.lifecycleCalls, attachmentCalls: window.attachmentCalls })); }
const previousState = JSON.parse(localStorage.getItem(fixtureStorageKey) || 'null');
if (previousState) { results.push(...previousState.results); files.push(...previousState.files); sequence = previousState.sequence; window.lifecycleCalls = previousState.lifecycleCalls; window.attachmentCalls = previousState.attachmentCalls; }
api.executionResultAttachments.list = async resultId => files.filter(file => file.resultId === resultId);
api.executionResultAttachments.upload = async (resultId, file, options = {}) => {
  window.attachmentCalls.push({ resultId, name: file.name, size: file.size, type: file.type, options });
  const attachment = { id: 'attachment-' + (files.length + 1), resultId, entity_id: resultId, entity_type: 'execution_result', project_id: 'project', filename: file.name, mimeType: file.type, size: file.size, created: new Date().toISOString(), author: { displayName: 'QA Reviewer' } };
  files.push(attachment);
  const result = results.find(item => item.id === resultId); result.revision += 1;
  const evidence = { attachmentId: attachment.id, fileName: file.name, mimeType: file.type, size: file.size };
  if (options.stepId) { const logs = JSON.parse(result.logs); logs.stepEvidence = { ...logs.stepEvidence, [options.stepId]: evidence }; result.logs = JSON.stringify(logs); }
  persistMockServer();
  return { attachment, revision: result.revision, evidence };
};
api.attachments.meta = async () => ({ enabled: true, uploadLimit: 25 * 1024 * 1024 });
api.attachments.list = async () => [];
window.fixtureResults = () => structuredClone(results);
`;
const source = base.replace('createRoot(document.getElementById("root"))', customization + '\ncreateRoot(document.getElementById("root"))');

test('case workspace keeps rows, lifecycle, Gherkin, context and attachments independent', { timeout: 180000 }, async () => {
  const name = `case-workspace-${randomUUID()}`;
  const html = new URL(`${name}.html`, root); const tsx = new URL(`${name}.tsx`, root);
  let browser; let page;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, source);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5178'}/${name}.html?route=${encodeURIComponent('/executions?execution=active&testCase=case-1')}`);
    await page.getByRole('heading', { name: 'Checkout scenario 1', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.lifecycleCalls.length), 0, 'Opening a case does not start it');
    assert.equal(await page.getByRole('button', { name: 'Mark step 2 passed' }).isDisabled(), true);
    assert.match(await page.locator('.execution-behavior-step').last().innerText(), /first-row@example.test/);
    const controlsBeforeContext = await page.evaluate(() => document.querySelector('.execution-case-lifecycle').getBoundingClientRect().bottom <= document.querySelector('.execution-case-context').getBoundingClientRect().top);
    assert.equal(controlsBeforeContext, true, 'Case controls are visible before supporting context');
    const more = page.locator('.execution-case-more-actions > summary');
    await more.focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Case PDF', exact: true }).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Case PDF', exact: true }).evaluate(element => element === document.activeElement), true, 'Keyboard enters the first available report action');
    await page.keyboard.press('Escape');
    assert.equal(await more.evaluate(element => element === document.activeElement && !element.parentElement.open), true, 'Escape closes More actions and restores focus');
    const parameters = page.getByRole('button', { name: /^Test parameters/ });
    assert.equal(await parameters.getAttribute('aria-expanded'), 'false');
    await parameters.focus(); await page.keyboard.press('Enter');
    assert.match(await page.locator('.case-run-parameter-entries').innerText(), /first-row@example.test/);
    await parameters.click();
    const order = await page.locator('.execution-case-run-primary').evaluate(element => ({ pre: element.querySelector('.execution-case-run-preconditions').getBoundingClientRect().top, steps: element.querySelector('.execution-case-run-step-workspace').getBoundingClientRect().top }));
    assert.ok(order.pre < order.steps, 'Preconditions precede test steps');
    const tabs = page.getByRole('tablist', { name: 'Case run sections' });
    assert.deepEqual(await tabs.getByRole('tab').allTextContents(), ['Overview','History','Logs','Attachments']);
    await page.getByRole('button', { name: 'Start case', exact: true }).click();
    await page.getByRole('button', { name: 'Pause case', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Mark step 2 passed' }).isEnabled(), true);
    await page.getByRole('button', { name: 'Pause case', exact: true }).click();
    await page.getByRole('button', { name: 'Resume case', exact: true }).waitFor();
    const pausedClock = await page.locator('.execution-case-clock > strong').innerText();
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('.execution-case-clock > strong').innerText(), pausedClock, 'Paused clock is frozen');
    await page.getByRole('combobox', { name: 'Active data row', exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Start case', exact: true }).waitFor();
    assert.match(await page.locator('.execution-behavior-step').last().innerText(), /second-row@example.test/);
    assert.equal(await page.evaluate(() => window.lifecycleCalls.length), 2, 'Switching row does not start it');
    await page.getByRole('combobox', { name: 'Set case outcome' }).selectOption('skip');
    await page.getByRole('button', { name: 'Start new attempt' }).waitFor();
    assert.match(await page.locator('.execution-case-clock').innerText(), /N\/A/);
    await page.getByRole('combobox', { name: 'Active data row', exact: true }).selectOption({ index: 0 });
    await page.getByRole('button', { name: 'Resume case', exact: true }).waitFor();
    await tabs.getByRole('tab', { name: 'History', exact: true }).click();
    assert.match(await page.getByRole('list', { name: 'Case activity' }).innerText(), /QA Reviewer[\s\S]*Paused/);
    await tabs.getByRole('tab', { name: 'Overview', exact: true }).click();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.workspace-main').evaluate(element => element.scrollTop = 0);
      const resumeBounds = await page.getByRole('button', { name: 'Resume case', exact: true }).boundingBox();
      assert.ok(resumeBounds.y + resumeBounds.height < 420, `Primary case action is visible without scrolling at ${width}`);
      const actionBounds = await page.locator('.execution-case-run-header-actions > *').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
      assert.ok(actionBounds.every(bounds => bounds.left >= 0 && bounds.right <= width + 1), `Header actions fit at ${width}`);
      await more.click();
      const menuBounds = await page.locator('.execution-case-more-menu').boundingBox();
      assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width + 1, `More actions menu fits at ${width}`);
      await page.keyboard.press('Escape');
      const layout = await tabs.getByRole('tab').evaluateAll(elements => elements.map(el => ({ top: el.getBoundingClientRect().top, width: el.getBoundingClientRect().width })));
      assert.ok(Math.max(...layout.map(item => item.top)) - Math.min(...layout.map(item => item.top)) < 2, `Tabs remain horizontal at ${width}: ${JSON.stringify(layout)}`);
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, case: document.querySelector('.execution-case-run-workspace').getBoundingClientRect().toJSON() }));
      assert.ok(overflow.scroll <= width + 1 && overflow.case.right <= width + 1 && overflow.case.width > 220, JSON.stringify(overflow));
      await mkdir('/tmp/qaira-case-workspace', { recursive: true });
      await page.screenshot({ path: `/tmp/qaira-case-workspace/case-${width}.png`, fullPage: true });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    const beforeEvidence = await page.evaluate(() => window.fixtureResults().filter(result => result.data_set_iteration_index === 0).at(-1));
    const showStep = page.getByRole('button', { name: 'Show step 2 details', exact: true });
    if (await showStep.count()) await showStep.click();
    const step = page.locator('.execution-step-card').filter({ has: page.getByRole('button', { name: 'Hide step 2 details', exact: true }) });
    const comment = step.getByPlaceholder('Add an observation…');
    await comment.fill('Paused observation retained with the saved attempt.');
    await comment.blur();
    await page.waitForFunction(() => {
      const result = window.fixtureResults().filter(item => item.data_set_iteration_index === 0).at(-1);
      return JSON.parse(result.logs).stepNotes?.['step-main'] === 'Paused observation retained with the saved attempt.';
    });
    await step.locator('input[type="file"]').setInputFiles({ name: 'paused-step.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO9sAAAAASUVORK5CYII=', 'base64') });
    await page.waitForFunction(() => {
      const result = window.fixtureResults().filter(item => item.data_set_iteration_index === 0).at(-1);
      return JSON.parse(result.logs).stepEvidence?.['step-main']?.attachmentId === 'attachment-1';
    });
    await step.getByRole('button', { name: 'paused-step.png', exact: true }).waitFor();
    await tabs.getByRole('tab', { name: 'Attachments', exact: true }).click();
    const caseFiles = page.getByRole('region', { name: 'Case attachments', exact: true });
    await caseFiles.getByLabel('Choose case attachments').setInputFiles({ name: 'paused-case.txt', mimeType: 'text/plain', buffer: Buffer.from('Case evidence saved while paused.') });
    await caseFiles.getByRole('status').filter({ hasText: '1 attachment saved' }).waitFor();
    await caseFiles.getByRole('button', { name: 'Download paused-case.txt', exact: true }).waitFor();
    const afterEvidence = await page.evaluate(() => window.fixtureResults().filter(result => result.data_set_iteration_index === 0).at(-1));
    assert.equal(afterEvidence.id, beforeEvidence.id);
    assert.equal(afterEvidence.status, 'paused');
    assert.equal(afterEvidence.timer_started_at, null);
    assert.equal(afterEvidence.duration_ms, beforeEvidence.duration_ms, 'Comments and files do not restart paused timing');
    assert.equal(await page.evaluate(() => window.attachmentCalls.every(call => call.resultId === 'attempt-1')), true);
    await page.getByRole('combobox', { name: 'Set case outcome', exact: true }).selectOption('reset');
    await page.getByRole('button', { name: 'Start case', exact: true }).waitFor();
    await page.waitForFunction(() => window.fixtureResults().filter(result => result.data_set_iteration_index === 0).at(-1).id !== 'attempt-1');
    await page.reload();
    await page.getByRole('heading', { name: 'Checkout scenario 1', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Start case', exact: true }).waitFor();
    await tabs.getByRole('tab', { name: 'Attachments', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: /Download paused-(case|step)/ }).count(), 0, 'Fresh attempt has no files from the saved attempt after reload');
    await page.getByRole('combobox', { name: 'Active data row', exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Start new attempt', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Download paused-(case|step)/ }).count(), 0, 'A different data row has no attachment leakage');
    await page.getByRole('combobox', { name: 'Active data row', exact: true }).selectOption({ index: 0 });
    await page.getByRole('button', { name: 'Start case', exact: true }).waitFor();
    await tabs.getByRole('tab', { name: 'History', exact: true }).click();
    await page.locator('.execution-history-row').filter({ hasText: /Row 1/ }).filter({ hasText: /paused/i }).click();
    const history = page.getByRole('dialog', { name: 'Case attempt', exact: true });
    await history.waitFor();
    assert.match(await history.innerText(), /Paused observation retained with the saved attempt/);
    await history.getByRole('button', { name: 'Download paused-step.png', exact: true }).waitFor();
    await history.getByRole('button', { name: 'Download paused-case.txt', exact: true }).waitFor();
    assert.equal(await history.getByRole('button', { name: 'Browse files', exact: true }).count(), 0, 'Saved attempt files are read-only');
    await page.keyboard.press('Escape');
    await history.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page?.screenshot({ path: "/tmp/case-workspace-failure.png", fullPage: true });
    throw error;
  } finally {
    await browser?.close(); await Promise.all([unlink(html).catch(() => {}), unlink(tsx).catch(() => {})]);
  }
});

test('long case steps and comments wrap, remain reachable, and scroll with the page', { timeout: 90000 }, async () => {
  const name = `case-long-content-${randomUUID()}`;
  const html = new URL(`${name}.html`, root); const tsx = new URL(`${name}.tsx`, root);
  const parameter = `customer-with-a-long-parameter-${'x'.repeat(180)}@example.test`;
  const observation = 'Paused review: verify the account identifier and the complete dashboard confirmation message. '.repeat(7) + `Trace ${'a'.repeat(180)}`;
  const longContent = `
run.test_data_set.snapshot.rows[0]['t.email'] = ${JSON.stringify(parameter)};
run.step_snapshots[0].action = 'Given the customer account is active and has completed the required registration and approval checks for @t.missing_visual_value';
run.step_snapshots[1].action = 'When the customer signs in with @t.email and confirms the account details shown on the dashboard before proceeding to checkout';
const longResult = makeResult({ data_set_iteration_index: 0 });
longResult.status = 'paused'; longResult.duration_ms = 1200;
longResult.logs = JSON.stringify({ stepNotes: { 'step-main': ${JSON.stringify(observation)} } });
`;
  let browser; let page;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, base.replace('createRoot(document.getElementById("root"))', customization + longContent + '\ncreateRoot(document.getElementById("root"))'));
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    for (const fallbackSizing of [false, true]) {
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(12000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      if (fallbackSizing) await page.addInitScript(() => {
        const supports = CSS.supports.bind(CSS);
        CSS.supports = (...args) => args[0] === 'field-sizing' ? false : supports(...args);
      });
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5178'}/${name}.html?route=${encodeURIComponent('/executions?execution=active&testCase=case-1')}`);
      await page.getByRole('heading', { name: 'Checkout scenario 1', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^Test parameters/ }).getAttribute('aria-expanded'), 'false');
      await page.locator('.case-run-parameter-gap').waitFor();
      assert.match(await page.locator('.case-run-parameter-gap').innerText(), /needs a value/, 'Unresolved values stay visible while parameter rows are collapsed');
      if (fallbackSizing) await page.addStyleTag({ content: '.execution-case-run-workspace .execution-step-note-input { field-sizing: fixed; }' });
      await page.getByRole('button', { name: 'Show step 2 details', exact: true }).click();
      const step = page.locator('.execution-step-card').filter({ has: page.getByRole('button', { name: 'Hide step 2 details', exact: true }) });
      const comment = step.getByPlaceholder('Add an observation…');
      assert.equal(await step.locator('.step-parameter-token.is-resolved').innerText(), parameter, 'The complete resolved value replaces the parameter');
      assert.equal(await comment.inputValue(), observation, 'All saved comments are retained');
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(100);
        const geometry = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          return { pre: rect('.execution-case-run-preconditions'), steps: rect('.execution-case-run-step-workspace'), primary: rect('.execution-case-run-primary'), inspector: rect('.execution-case-run-inspector'), documentWidth: document.documentElement.scrollWidth };
        });
        assert.ok(geometry.steps.top >= geometry.pre.bottom, 'Preconditions do not overlap the main steps');
        assert.ok(geometry.pre.height < 400, 'Preconditions fit their content without a blank full-height panel');
        if (width === 390) assert.ok(geometry.inspector.top >= geometry.primary.bottom, 'The mobile inspector follows the complete primary content');
        assert.ok(geometry.documentWidth <= width + 1, 'The page has no horizontal overflow');
        const overflowing = await page.locator('.execution-behavior-line').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ width: element.clientWidth, scroll: element.scrollWidth })));
        assert.deepEqual(overflowing, [], `Complete actions and parameters wrap at ${width}`);
        for (const stepNumber of [1, 2]) {
          for (const name of [`Mark step ${stepNumber} passed`, `Mark step ${stepNumber} failed`, `Evidence and comments for step ${stepNumber}`]) {
            const control = page.getByRole('button', { name, exact: true });
            await control.scrollIntoViewIfNeeded();
            await control.hover();
            const bounds = await control.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${name} stays inside the viewport`);
          }
        }
        await comment.scrollIntoViewIfNeeded();
        await comment.hover();
        assert.equal(await comment.evaluate(element => element.scrollHeight <= element.clientHeight + 1), true, `Saved comments grow at ${width}`);
        const before = await page.evaluate(() => window.scrollY + document.querySelector('.workspace-main').scrollTop);
        await page.mouse.wheel(0, -180);
        await page.waitForFunction(previous => window.scrollY + document.querySelector('.workspace-main').scrollTop < previous - 50, before);
        assert.equal(await comment.evaluate(element => element.scrollTop), 0, 'Wheel over comments scrolls the page, not a nested textarea');
        if (!fallbackSizing) {
          await page.locator('.execution-case-run-preconditions').scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/case-preconditions-corrected-${width}.png` });
          await step.getByRole('button', { name: 'Hide step 2 details', exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/case-step-corrected-${width}.png` });
          await comment.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/case-comment-corrected-${width}.png` });
        }
      }
      await comment.fill(observation + '\nAdditional observation. '.repeat(8));
      assert.equal(await comment.evaluate(element => element.scrollHeight <= element.clientHeight + 1), true, 'Typing also expands comments without an internal scroll area');
      await comment.blur();
      await page.waitForFunction(() => JSON.parse(window.fixtureResults()[0].logs).stepNotes['step-main'].includes('Additional observation.'));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } catch (error) {
    await page?.screenshot({ path: '/tmp/case-long-content-failure.png', fullPage: true });
    throw error;
  } finally {
    await browser?.close(); await Promise.all([unlink(html).catch(() => {}), unlink(tsx).catch(() => {})]);
  }
});
