const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpstreamTabTracker, canonicalAutomationTabUrl, TAB_IDENTITY_SCHEMA } = require('../../backend/lib/automationUpstreamTabs');
const { buildWithUpstreamPlaywright, validateRequest, preserveNativeActions } = require('../../backend/lib/automationUpstreamEngineer');
const { inspectExecutablePlan } = require('../../backend/services/automationReadiness.service');
const tools = require('../../../platform/backend/test/fixtures/upstreamPlaywrightMcpTools.v0.0.84.json');
const origin = 'https://shop.test', startUrl = origin + '/search';
const headers = current => `- 0:${current === 0 ? ' (current)' : ''} [Search](${startUrl})\n- 1:${current === 1 ? ' (current)' : ''} [Product](${origin}/product?tracking=live)`;
const result = value => ({ content: [{ type: 'text', text: value }] });
const native = (code, after = '') => result(`### Ran Playwright code\n\`\`\`js\n${code}\n\`\`\`\n${after}`);

test('existing tab selection requires native index and reviewed origin, including in read-only mode', () => {
  const tabs = createUpstreamTabTracker(startUrl), catalog = new Map(tools.map(tool => [tool.name, tool]));
  const request = { name: 'browser_tabs', arguments: { action: 'select', index: 1 } };
  assert.throws(() => validateRequest(request, catalog, { interactive: true, startUrl, tabs }), /native tab listing/);
  tabs.observe(result('### Open tabs\n' + headers(0)), 'browser_click');
  assert.throws(() => validateRequest(request, catalog, { interactive: false, startUrl, tabs }), /Portable runtime/);
  assert.deepEqual(validateRequest(request, catalog, { interactive: true, startUrl, tabs }), request.arguments);
  for (const action of ['new', 'close']) assert.throws(() => validateRequest({ name: 'browser_tabs', arguments: { action, index: 1 } }, catalog, { interactive: true, startUrl, tabs }), /Portable runtime/);
  assert.throws(() => tabs.assert({ index: 2 }), /native tab listing/);
  tabs.observe(result('### Result\n- 0: (current) [Search](' + startUrl + ')\n- 1: [Foreign](https://foreign.test/product)'), 'browser_tabs');
  assert.throws(() => tabs.assert({ index: 1 }), /reviewed application origin/);
});

test('confirmed selection retains an exact portable receipt and cannot be removed or retargeted in source', () => {
  const tabs = createUpstreamTabTracker(startUrl);
  tabs.observe(result('### Open tabs\n' + headers(0)), 'browser_click');
  const selection = tabs.receipt({ index: 1 }, result('### Result\n' + headers(1)));
  assert.equal(selection.receipt.provider, 'hellotest.native_tab_selection');
  assert.equal(selection.receipt.url, origin + '/product?tracking=live');
  assert.deepEqual(selection.receipt.identity, { schema: TAB_IDENTITY_SCHEMA, url: selection.receipt.url });
  const click = 'await page.getByRole("link",{name:"Product"}).click();', assertion = 'await expect(page.getByRole("heading")).toHaveText("Product");';
  const emitted = click + '\n' + selection.code;
  const bindings = { parameterValues: {}, secretBindings: {}, parameterExpressions: true };
  preserveNativeActions(emitted + '\n' + assertion, emitted, bindings, true);
  assert.throws(() => preserveNativeActions(click + '\n' + assertion, emitted, bindings, true), { code: 'AUTOMATION_UPSTREAM_SOURCE_CHANGED' });
  assert.throws(() => preserveNativeActions(emitted.replace('"index":1', '"index":0') + '\n' + assertion, emitted, bindings, true), { code: 'AUTOMATION_UPSTREAM_SOURCE_CHANGED' });
  assert.throws(() => preserveNativeActions(emitted.replace('tracking=live', 'tracking=other') + '\n' + assertion, emitted, bindings, true), { code: 'AUTOMATION_UPSTREAM_SOURCE_CHANGED' });
});

test('native click popup selection stays ordered and source retains the click without replay', async () => {
  const goto = `await page.goto(${JSON.stringify(startUrl)});`;
  const click = 'await page.getByRole("link",{name:"Product"}).click();';
  const select = `await web.switchTab(${JSON.stringify({ index: 1, identity: { schema: TAB_IDENTITY_SCHEMA, url: origin + '/product?tracking=live' } })});`;
  const verify = 'await expect(page.getByRole("heading",{name:"Product",exact:true})).toBeVisible();';
  const emitted = [goto, click, select, verify].join('\n'), calls = [];
  let actors = 0;
  const build = await buildWithUpstreamPlaywright({ startUrl, interactive: true,
    steps: [{ id: 'product', step_order: 1, step_type: 'web', action: 'Open the Product link and inspect its new tab', expected_result: 'Product heading is visible' }],
    browser: { tools, close: async () => {}, call: async (name, args) => {
      calls.push({ name, args });
      if (name === 'browser_navigate') return native(goto, `### Open tabs\n- 0: (current) [Search](${startUrl})\n### Snapshot\n- link "Product" [ref=e2]`);
      if (name === 'browser_click') return native(click, '### Open tabs\n' + headers(0));
      if (name === 'browser_tabs') return result('### Result\n' + headers(1));
      if (name === 'browser_snapshot') return result('### Snapshot\n- heading "Product" [ref=e3]');
      if (name === 'browser_verify_text_visible') return native(verify, '### Snapshot\n- heading "Product" [ref=e3]');
      throw new Error('Unexpected call ' + name);
    } },
    complete: async request => {
      if (request.phase === 'upstream_browser_actor') {
        actors++;
        if (actors === 1) return { tool: { name: 'browser_click', arguments: { target: 'e2' } } };
        if (actors === 2) return { tool: { name: 'browser_tabs', arguments: { action: 'select', index: 1 } } };
        if (actors === 3) { assert.equal(JSON.parse(request.prompt).current_page_snapshot, undefined); return { tool: { name: 'browser_snapshot', arguments: {} } }; }
        if (actors === 4) return { tool: { name: 'browser_verify_text_visible', arguments: { text: 'Product' } } };
        return { done: true };
      }
      if (request.phase === 'upstream_source') { assert.match(request.prompt, /hellotest.native_tab_selection/); return { automation_code: emitted }; }
      const packet = JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
      return { schema: 'hellotest.playwrightInstructionMapping.v1', steps: packet.steps.map(step => ({ step_id: step.step_id, source_sha256: step.source_sha256,
        instructions: step.operations.map(operation => ({ operation_id: operation.operation_id, kind: operation.kind, depth: operation.depth, label: 'Native operation', args: [] })) })) };
    }, validate: inspectExecutablePlan });
  assert.equal(build.updates.length, 1);
  assert.match(build.updates[0].automation_code, /web\.switchTab/);
  assert.equal(calls.filter(call => call.name === 'browser_click').length, 1);
  assert.deepEqual(calls.map(call => call.name), ['browser_navigate', 'browser_click', 'browser_tabs', 'browser_snapshot', 'browser_verify_text_visible']);
});

test('record queries and SPA routes retain identity while only recognized tracking is volatile', () => {
  assert.notEqual(canonicalAutomationTabUrl(origin + '/record?id=alice'), canonicalAutomationTabUrl(origin + '/record?id=bob'));
  assert.notEqual(canonicalAutomationTabUrl(origin + '/#/record/alice'), canonicalAutomationTabUrl(origin + '/#/record/bob'));
  assert.equal(canonicalAutomationTabUrl(origin + '/record?utm_source=one&id=alice'), origin + '/record?id=alice');
  assert.equal(canonicalAutomationTabUrl('https://www.amazon.in/dp/B012345678?qid=123&ref=one&th=1'), 'https://www.amazon.in/dp/B012345678?th=1');
  assert.notEqual(canonicalAutomationTabUrl(origin + '/record?qid=123'), canonicalAutomationTabUrl(origin + '/record?qid=456'), 'qid is meaningful data on an unknown application');
});

test('ambiguous native identities and a changed record cannot establish a selection receipt', () => {
  const tabs = createUpstreamTabTracker(startUrl);
  tabs.observe(result(`### Result\n- 0: (current) [A](${origin}/record?id=alice&utm_source=one)\n- 1: [A](${origin}/record?id=alice&utm_source=two)`), 'browser_tabs');
  assert.throws(() => tabs.assert({ index: 1 }), /unique semantic URL identity/);
  tabs.observe(result(`### Result\n- 0: (current) [Home](${startUrl})\n- 1: [A](${origin}/record?id=alice)`), 'browser_tabs');
  assert.throws(() => tabs.receipt({ index: 1 }, result(`### Result\n- 0: [Home](${startUrl})\n- 1: (current) [B](${origin}/record?id=bob)`)), /reviewed tab identity/);
  tabs.observe(result('### Result\nNo open tabs. Navigate to a URL to create one.'), 'browser_tabs');
  assert.throws(() => tabs.assert({ index: 1 }), /current native tab listing/);
});
