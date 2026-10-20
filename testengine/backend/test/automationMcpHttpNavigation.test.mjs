import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerAutomationMcp } from '../dist/lib/automationMcp.js';

test('MCP main-document HTTP failures retain safe status without page URLs, secrets or automatic replay', async t => {
  const prior = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  const target = 'http://127.0.0.1:1234/private-route?token=fixture-private-token';
  let status = 502, navigations = 0, captures = 0;
  const page = { isClosed: () => false, url: () => target, on() {}, setDefaultTimeout() {},
    goto: async () => { navigations++; return { status: () => status }; },
    evaluate: async () => { captures++; throw new Error('HTTP error pages cannot become usable evidence'); } };
  const context = { route: async () => {}, newPage: async () => page, on() {} };
  const browser = { newContext: async () => context, isConnected: () => true, close: async () => {} };
  const app = Fastify();
  await registerAutomationMcp(app, async () => {}, { launchBrowser: async () => browser, createProxy: async () => ({ server: 'http://proxy.test', close: async () => {} }) });
  t.after(async () => { await app.close(); if (prior === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = prior; });
  let session;
  const rpc = (method, params = {}) => app.inject({ method: 'POST', url: '/api/v1/automation/mcp', headers: session ? { 'mcp-session-id': session } : {}, payload: { jsonrpc: '2.0', id: 1, method, params } });
  const initialized = await rpc('initialize', { _meta: { hellotest: { start_url: target } } });
  session = initialized.headers['mcp-session-id']; assert.ok(session);
  for (status of [400, 401, 403, 404, 410, 429, 500, 502, 503, 504, 599]) {
    const previousCount = navigations;
    const response = (await rpc('tools/call', { name: 'browser_navigate', arguments: { url: target } })).json().result;
    assert.equal(response.isError, true);
    const receipt = JSON.parse(response.content[0].text);
    assert.equal(receipt.code, 'BROWSER_NAVIGATION_FAILED'); assert.equal(receipt.http_status, status);
    assert.equal(receipt.action_outcome, 'completed'); assert.equal(receipt.retry_safe, false);
    assert.equal(receipt.url, undefined); assert.match(receipt.message, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(JSON.stringify(response), /https?:|private-route|fixture-private-token|page.goto/);
    assert.equal(navigations, previousCount + 1, 'an HTTP error cannot repeat navigation');
  }
  assert.equal(captures, 0, 'HTTP error pages never enter readiness or snapshot capture');
  const snapshot = (await rpc('tools/call', { name: 'browser_snapshot', arguments: {} })).json().result;
  assert.equal(snapshot.isError, true); assert.equal(JSON.parse(snapshot.content[0].text).code, 'BROWSER_PAGE_NOT_READY');
  assert.equal(captures, 0);
});
