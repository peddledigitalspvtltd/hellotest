import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { registerAutomationMcp, captureAutomationBrowserSnapshot } from '../../dist/lib/automationMcp.js';
import { AutomationObservedSubjects } from '../../dist/lib/automationObservedSubjects.js';
import { resolveRepositoryLocator } from '../../dist/lib/repositoryLocator.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { recordedLocatorSource, compileRecordedProgram } = require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const { createBrowserParameterResolver } = require('../../../../services/automation/backend/lib/automationBrowserParameters.js');
const { projectModelSnapshot, resolveModelToolRequest } = require('../../../../services/automation/backend/lib/automationBrowserModelTargets.js');
const payload = result => JSON.parse(result.content.find(block => block.type === 'text').text);
const privateValue = 'OWNED_SUBJECT_PRIVATE_VALUE';
const record = (name = 'Record A', id = 'record-a') => `<!doctype html><title>Observed records</title><main>
  <input type="password" value="${privateValue}" aria-label="Private token">
  <table><tbody><tr data-row-id="${id}"><td id="record-name">${name} ${privateValue}</td>
  <td><button id="delete" type="button" onclick="window.events.push(this.closest('tr').dataset.rowId)">Delete</button></td></tr></tbody></table>
  </main><script>window.events=[];</script>`;

function blocked(result, code = 'BROWSER_OBSERVED_SUBJECT_CHANGED') {
  assert.equal(result.isError, true);
  const error = payload(result);
  assert.equal(error.code, code);
  assert.equal(error.action_outcome, 'not_attempted');
  assert.equal(error.retry_safe, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${privateValue}|record-a|record-b|ElementHandle|JSHandle|_guid|subject_handle|subject_identity`));
  return error;
}

test('real MCP mutations retain observed native node and enclosing record identity', { timeout: 90_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  let engineBrowser, client;
  app.get('/fixture', async (_request, reply) => reply.type('text/html').send(record()));
  app.get('/next', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>Next screen</title><h1>Next screen</h1>'));
  app.get('/nested/next', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>Nested screen</title><h1>Nested screen</h1>'));
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()), {
    launchBrowser: async options => { engineBrowser = await chromium.launch(options); return engineBrowser; }
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await client?.close(); await app.close(); });
  client = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/fixture', allowBrowserActions: true });
  const call = async (name, args = {}) => {
    const result = await client.call(name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    return payload(result);
  };
  await call('browser_navigate', { url: base + '/fixture' });
  const page = engineBrowser.contexts()[0].pages()[0];
  const snapshot = () => call('browser_snapshot');

  await t.test('recycled record blocks the same unique Delete button until a fresh snapshot establishes its new context', async () => {
    await page.setContent(record());
    const observed = await snapshot();
    const button = observed.elements.find(element => element.attributes.id === 'delete');
    assert.ok(button.locator_candidates.includes('#delete'));
    assert.match(button.context_text, /Record A/);
    assert.doesNotMatch(JSON.stringify(observed), new RegExp(`${privateValue}|ElementHandle|JSHandle|_guid|subject_handle|subject_identity`));
    await page.evaluate(() => {
      document.querySelector('tr').dataset.rowId = 'record-b';
      document.querySelector('#record-name').firstChild.textContent = 'Record B OWNED_SUBJECT_PRIVATE_VALUE';
    });
    assert.equal(await page.locator('#delete').count(), 1, 'ordinary uniqueness still holds after virtualization');
    blocked(await client.call('browser_click', { locator: '#delete' }));
    assert.deepEqual(await page.evaluate(() => window.events), []);
    await snapshot();
    assert.equal((await call('browser_click', { locator: '#delete' })).action_outcome, 'completed');
    assert.deepEqual(await page.evaluate(() => window.events), ['record-b']);
  });

  await t.test('a replaced node with the same name and unique selector receives no interaction', async () => {
    await page.setContent(record());
    await snapshot();
    await page.locator('#delete').evaluate(node => node.replaceWith(node.cloneNode(true)));
    blocked(await client.call('browser_click', { locator: '#delete' }));
    assert.deepEqual(await page.evaluate(() => window.events), []);
  });

  await t.test('a record test-ID change blocks a direct global alias even when the node and content stay identical', async () => {
    await page.setContent('<!doctype html><title>Record keys</title><ul><li data-testid="record-a">Identical record content<button id="delete" onclick="window.events.push(1)">Delete</button></li></ul><script>window.events=[];</script>');
    await snapshot();
    await page.locator('li').evaluate(node => { node.dataset.testid = 'record-b'; });
    assert.equal(await page.locator('#delete').count(), 1);
    blocked(await client.call('browser_click', { locator: '#delete' }));
    assert.deepEqual(await page.evaluate(() => window.events), []);
  });

  await t.test('a grounded record-scoped candidate preserves playback identity when the old global control is recycled', async () => {
    await page.setContent(record());
    const observed = await snapshot();
    const button = observed.elements.find(element => element.attributes.id === 'delete');
    const candidate = button.record_scoped_locator;
    assert.ok(candidate);
    assert.match(candidate, /^\[data-row-id="record-a"\] > /);
    assert.ok(button.locator_candidates.includes(candidate));
    assert.ok(button.locator_candidates.includes('#delete'), 'the existing structural fallback remains available');
    assert.ok(button.locator_candidates.length <= 4);
    await page.evaluate(() => {
      const original = document.querySelector('tr');
      original.dataset.rowId = 'record-b';
      original.querySelector('#record-name').textContent = 'Record B';
      const current = document.createElement('tr');
      current.dataset.rowId = 'record-a';
      current.innerHTML = '<td>Record A</td><td><button id="delete-current-a" type="button" onclick="window.events.push(this.closest(\'tr\').dataset.rowId)">Delete</button></td>';
      original.after(current);
    });
    assert.equal(await page.locator('#delete').evaluate(node => node.closest('tr').dataset.rowId), 'record-b');
    assert.equal(recordedLocatorSource(candidate), `page.locator(${JSON.stringify(candidate)})`);
    const compiled = compileRecordedProgram([{ name: 'browser_click', arguments: { locator: candidate } }]);
    assert.ok(compiled.source.includes(recordedLocatorSource(candidate)));
    const playback = page.locator(candidate);
    assert.equal(await playback.count(), 1);
    assert.equal(await playback.evaluate(node => node.closest('tr').dataset.rowId), 'record-a');
    await playback.click();
    assert.deepEqual(await page.evaluate(() => window.events), ['record-a'], 'the exported plain CSS itself retains record scope');
  });

  await t.test('keyless or duplicate-key records have no invented scoped-locator claim', async () => {
    for (const markup of [
      '<table><tr><td>Record A</td><td><button id="delete">Delete</button></td></tr></table>',
      '<ul><li data-row-id="duplicate"><button id="delete">Delete</button></li><li data-row-id="duplicate">Other item</li></ul>'
    ]) {
      await page.setContent('<!doctype html><title>Unkeyed records</title>' + markup);
      const observed = await snapshot();
      const button = observed.elements.find(element => element.attributes.id === 'delete');
      assert.equal(button.record_scoped_locator, undefined);
      assert.ok(button.locator_candidates.includes('#delete'));
      assert.ok(button.locator_candidates.every(candidate => !candidate.includes('Record A')));
    }
  });

  await t.test('known private record keys remove both the scoped candidate and its executable metadata', async () => {
    await page.setContent(record());
    await page.evaluate(value => { document.querySelector('tr').dataset.rowId = value; }, privateValue);
    const observed = await snapshot();
    const button = observed.elements.find(element => element.attributes.id === 'delete');
    assert.equal(button.record_scoped_locator, undefined);
    assert.ok(button.locator_candidates.includes('#delete'));
    assert.ok(button.locator_candidates.every(candidate => !candidate.includes('[redacted]')));
    assert.ok(!JSON.stringify(observed).includes(privateValue));
    for (const element of observed.elements) {
      assert.equal(element.snapshot_record_locator, undefined);
      if (element.record_scoped_locator) assert.ok(element.locator_candidates.includes(element.record_scoped_locator));
    }
  });

  await t.test('private parameter projection recognizes leading-digit record keys without a native password control', async () => {
    const secret = '9owned-record-private-key';
    await page.setContent('<!doctype html><title>Private record</title><ul><li><button id="delete">Delete</button></li></ul>');
    await page.locator('li').evaluate((node, value) => { node.dataset.rowId = value; }, secret);
    const raw = await client.call('browser_snapshot', {});
    assert.ok(!raw.isError, JSON.stringify(raw));
    assert.ok(payload(raw).elements.find(element => element.attributes.id === 'delete').record_scoped_locator.includes(secret));
    const privacy = createBrowserParameterResolver({ caseValues: { 't.record': secret }, privateParameterNames: ['t.record'] });
    const redacted = privacy.redactResult(raw);
    assert.ok(!JSON.stringify(redacted).includes(secret));
    const host = { tool: 'browser_snapshot', result: redacted };
    const target = projectModelSnapshot(host).targets.find(element => element.name === 'Delete');
    const resolved = resolveModelToolRequest({ name: 'browser_click', arguments: { locator: target.ref } }, host).arguments.locator;
    assert.doesNotMatch(resolved, /data-row-id|private parameter|redacted/);
    assert.equal(await resolveRepositoryLocator(page, resolved).getAttribute('id'), 'delete',
      'masked record metadata never becomes an executable scoped selector');
  });

  await t.test('an unrelated notification disappearing does not invalidate a stable record', async () => {
    await page.setContent(record());
    await page.evaluate(() => {
      const toast = document.createElement('div'); toast.id = 'toast'; toast.role = 'status'; toast.textContent = 'Background refresh completed';
      document.body.prepend(toast);
    });
    await snapshot();
    await page.locator('#toast').evaluate(node => node.remove());
    await call('browser_click', { locator: '#delete' });
    assert.deepEqual(await page.evaluate(() => window.events), ['record-a']);
  });

  await t.test('sequential input values in the same form do not require a fresh snapshot', async () => {
    await page.setContent('<!doctype html><title>Form</title><form><label>First<input id="first"></label><label>Second<input id="second" type="password"></label></form>');
    await snapshot();
    await call('browser_fill', { locator: '#first', value: 'first entered value' });
    await call('browser_fill', { locator: '#second', value: privateValue });
    assert.equal(await page.locator('#first').inputValue(), 'first entered value');
    assert.equal(await page.locator('#second').inputValue(), privateValue);
  });

  await t.test('native and ARIA-associated label changes block the same input before entering data', async () => {
    for (const markup of [
      '<label id="label" for="field">First name</label><input id="field">',
      '<span id="label">First name</span><input id="field" aria-labelledby="label">'
    ]) {
      await page.setContent('<!doctype html><title>Field labels</title>' + markup);
      const observed = await snapshot();
      const field = observed.elements.find(element => element.attributes.id === 'field');
      assert.equal(field.accessible_name, 'First name');
      assert.ok(field.locator_candidates.includes('#field'));
      await page.locator('#label').evaluate(node => { node.textContent = 'Different field'; });
      blocked(await client.call('browser_fill', { locator: '#field', value: privateValue }));
      assert.equal(await page.locator('#field').inputValue(), '');
    }
  });

  await t.test('equivalent locator formatting is accepted only for the same captured native node', async () => {
    await page.setContent(record());
    await snapshot();
    await call('browser_click', { locator: "page.getByRole('button', {exact:true, name:'Delete'})" });
    assert.deepEqual(await page.evaluate(() => window.events), ['record-a']);
  });

  await t.test('relative href and document base preserve the advertised link contract', async () => {
    for (const [markup, destination] of [
      ['<a id="next" href="/next">Next</a>', base + '/next'],
      ['<base href="/nested/"><a id="next" href="next">Next</a>', base + '/nested/next']
    ]) {
      await page.setContent('<!doctype html><title>Links</title><main>' + markup + '</main>');
      const observed = await snapshot();
      const link = observed.elements.find(element => element.attributes.id === 'next');
      assert.equal(link.attributes.href, destination);
      assert.ok(link.locator_candidates.includes('#next'));
      await call('browser_click', { locator: '#next' });
      assert.equal(page.url(), destination);
    }
  });

  await t.test('an incomplete long record never acquires an interaction grant from a matching excerpt', async () => {
    const prefix = 'A'.repeat(2_500), suffix = 'Z'.repeat(2_500);
    await page.setContent(record(prefix + 'FIRST' + suffix));
    const observed = await snapshot();
    assert.equal(observed.partial, true);
    assert.deepEqual(observed.elements.find(element => element.attributes.id === 'delete').locator_candidates, []);
    await page.locator('#record-name').evaluate((node, text) => { node.textContent = text; }, prefix + 'OTHER' + suffix + ' ' + privateValue);
    blocked(await client.call('browser_click', { locator: '#delete' }), 'BROWSER_OBSERVED_SUBJECT_REQUIRED');
    assert.deepEqual(await page.evaluate(() => window.events), []);
  });

  await t.test('record identity detects a same-length middle change beyond the model context excerpt', async () => {
    const prefix = 'A'.repeat(1_000), suffix = 'Z'.repeat(1_000);
    await page.setContent(record(prefix + 'FIRST' + suffix));
    const observed = await snapshot();
    const button = observed.elements.find(element => element.attributes.id === 'delete');
    assert.ok(button.locator_candidates.includes('#delete'));
    assert.equal(button.context_text_truncated, true);
    await page.locator('#record-name').evaluate((node, text) => { node.textContent = text; }, prefix + 'OTHER' + suffix + ' ' + privateValue);
    blocked(await client.call('browser_click', { locator: '#delete' }));
    assert.deepEqual(await page.evaluate(() => window.events), []);
  });

  await t.test('oversized identity attributes never authorize clipped subjects or disclose their hidden payload', async () => {
    await page.setContent('<!doctype html><title>Bounded attributes</title><input type="password"><button id="action" type="button" onclick="window.events.push(1)">Action</button><script>window.events=[];</script>');
    await page.evaluate(value => {
      document.querySelector('input').value = value;
      document.querySelector('#action').title = 'A'.repeat(2_500) + value + 'Z'.repeat(2_500);
    }, privateValue);
    const observed = await snapshot();
    assert.equal(observed.partial, true);
    assert.deepEqual(observed.elements.find(element => element.attributes.id === 'action').locator_candidates, []);
    assert.ok(Buffer.byteLength(JSON.stringify(observed)) <= observed.limits.response_bytes);
    assert.ok(!JSON.stringify(observed).includes(privateValue));
    await page.locator('#action').evaluate(node => { node.title = node.title.replace('OWNED_SUBJECT_PRIVATE_VALUE', 'OTHER_SUBJECT_PRIVATE_VALUE'); });
    blocked(await client.call('browser_click', { locator: '#action' }), 'BROWSER_OBSERVED_SUBJECT_REQUIRED');
    assert.deepEqual(await page.evaluate(() => window.events), []);
  });

  await t.test('oversized option values and aggregate choice pools have no mutation grant', async () => {
    const markup = '<!doctype html><title>Bounded choices</title><input type="password"><select id="choice" onchange="window.events.push(this.value)"><option value="small">Choice</option></select><script>window.events=[];</script>';
    await page.setContent(markup);
    await snapshot();
    await page.evaluate(value => {
      document.querySelector('input').value = value;
      document.querySelector('option').value = 'A'.repeat(2_500) + value + 'Z'.repeat(2_500);
    }, privateValue);
    blocked(await client.call('browser_select_option', { locator: '#choice', value: 'small' }));
    const observed = await snapshot();
    assert.equal(observed.partial, true);
    assert.deepEqual(observed.elements.find(element => element.attributes.id === 'choice').locator_candidates, []);
    assert.ok(Buffer.byteLength(JSON.stringify(observed)) <= observed.limits.response_bytes);
    assert.ok(!JSON.stringify(observed).includes(privateValue));
    blocked(await client.call('browser_select_option', { locator: '#choice', value: 'small' }), 'BROWSER_OBSERVED_SUBJECT_REQUIRED');
    assert.deepEqual(await page.evaluate(() => window.events), []);

    await page.setContent(markup);
    const firstValue = await page.locator('#choice').evaluate(node => {
      node.replaceChildren(...Array.from({ length: 20 }, (_, index) => new Option('Choice ' + index, String(index) + 'x'.repeat(1_000))));
      return node.options[0].value;
    });
    const aggregate = await snapshot();
    assert.equal(aggregate.partial, true);
    assert.deepEqual(aggregate.elements.find(element => element.attributes.id === 'choice').locator_candidates, []);
    blocked(await client.call('browser_select_option', { locator: '#choice', value: firstValue }), 'BROWSER_OBSERVED_SUBJECT_REQUIRED');
    assert.deepEqual(await page.evaluate(() => window.events), []);
  });

  await t.test('the real actor refreshes a changed record and reports the missing authored target without dispatching or saving', async () => {
    await page.setContent(record());
    const initial = await client.call('browser_snapshot', {});
    assert.ok(!initial.isError, JSON.stringify(initial));
    const originalCall = client.call;
    const calls = []; let actors = 0, saves = 0, recycled = false;
    const browser = { ...client, call: async (name, args) => {
      calls.push(name);
      if (name === 'browser_click' && !recycled) {
        recycled = true;
        await page.evaluate(() => {
          document.querySelector('tr').dataset.rowId = 'record-b';
          document.querySelector('#record-name').firstChild.textContent = 'Record B OWNED_SUBJECT_PRIVATE_VALUE';
        });
      }
      return originalCall(name, args);
    } };
    await assert.rejects(runAutomationBrowserAgent({ browser, actorMode: true, parse: JSON.parse, maxTurns: 4, maxCalls: 6,
      prompt: 'Delete Record A from the current record list.', execution: { required: true, semantic_review_required: true,
        step_id: 'delete-record-a', action: 'Delete Record A.', expected_result: 'Record A is removed from the list.' },
      initialObservations: [{ tool: 'browser_snapshot', result: initial }], onPartialBuild: async () => { saves++; return { generation_complete: true }; },
      complete: async prompt => {
        actors++;
        assert.ok(!prompt.includes(privateValue));
        const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
        const button = current.current_snapshot.targets.find(target => target.name === 'Delete');
        assert.ok(button);
        if (actors === 1) {
          assert.match(button.context_text, /Record A/);
          return JSON.stringify({ stage: 'act', step_id: 'delete-record-a', section_complete: false,
            tool_calls: [{ name: 'browser_click', arguments: { locator: button.ref } }] });
        }
        assert.equal(actors, 2);
        assert.match(button.context_text, /Record B/);
        assert.doesNotMatch(button.context_text, /Record A/);
        assert.match(prompt, /BROWSER_OBSERVED_SUBJECT_CHANGED/);
        return JSON.stringify({ stage: 'act', step_id: 'delete-record-a', section_issue: { kind: 'unexpected_application_state',
          reason: 'The requested Record A is absent; the observed action now belongs to Record B.', evidence_refs: [button.ref] } });
      }
    }), { code: 'AUTOMATION_BROWSER_SECTION_BLOCKED', nonRetryable: true });
    assert.equal(actors, 2); assert.equal(saves, 0);
    assert.deepEqual(calls, ['browser_click', 'browser_snapshot']);
    assert.deepEqual(await page.evaluate(() => window.events), []);
  });
});

test('native subject deadlines and lifecycle clear old handles without serializing identities', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><button id="action">Action</button>');
  const subjects = new AutomationObservedSubjects();
  t.after(() => subjects.clear());
  await subjects.beginSnapshot();
  const snapshot = await captureAutomationBrowserSnapshot(page, undefined, Date.now() + 10_000, subjects);
  const handle = await subjects.resolve(page, '#action', Date.now() + 2_000);
  assert.ok(handle);
  assert.doesNotMatch(JSON.stringify(snapshot), /ElementHandle|JSHandle|_guid|subject_handle|subject_identity/);
  await assert.rejects(subjects.resolve(page, '#action', Date.now() - 1), { code: 'BROWSER_OBSERVED_SUBJECT_CHANGED' });
  await subjects.clear();
  await assert.rejects(handle.evaluate(node => node.isConnected), /disposed|closed|destroyed/i);
  await assert.rejects(subjects.resolve(page, '#action', Date.now() + 2_000), { code: 'BROWSER_OBSERVED_SUBJECT_REQUIRED' });
  await subjects.beginSnapshot();
  await captureAutomationBrowserSnapshot(page, undefined, Date.now() + 10_000, subjects);
  assert.ok(await subjects.resolve(page, '#action', Date.now() + 2_000));
});
