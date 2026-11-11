import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { installAutomationNavigationGuard } from '../dist/lib/automationNavigationGuard.js';

const until = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'the bounded policy operation completed');
};

async function fixture(t, { rawContext = 'owned-context', fetchDelay = 0 } = {}) {
  const commands = [], order = [];
  let peer, connected = true, closeCount = 0, liveTargets = [];
  const browser = Object.assign(new EventEmitter(), {
    newBrowserCDPSession: async () => ({ send: async () => ({ browserContextIds: ['owned-context'] }), detach: async () => {} }),
    isConnected: () => connected,
    close: async () => { if (connected) { order.push('browser-close'); closeCount++; connected = false; browser.emit('disconnected'); } }
  });
  const server = createServer((_request, reply) => {
    reply.setHeader('Content-Type', 'application/json');
    reply.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/browser/test-browser` }));
  });
  const websocket = new WebSocketServer({ server });
  websocket.on('connection', connection => {
    peer = connection;
    connection.on('close', () => order.push('socket-close'));
    connection.on('message', data => {
      const message = JSON.parse(data.toString()); commands.push(message);
      const result = message.method === 'Target.getBrowserContexts' ? { browserContextIds: [rawContext] }
        : message.method === 'Target.getTargets' ? { targetInfos: liveTargets } : {};
      const acknowledge = () => {
        order.push(message.method + '-ack');
        if (connection.readyState === 1) connection.send(JSON.stringify({ id: message.id, result, ...(message.sessionId ? { sessionId: message.sessionId } : {}) }));
      };
      if (message.method === 'Fetch.enable' && fetchDelay) setTimeout(acknowledge, fetchDelay); else acknowledge();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await browser.close(); for (const client of websocket.clients) client.terminate(); await new Promise(resolve => websocket.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  return { browser, port: server.address().port, commands, order, closed: () => closeCount,
    emit: message => peer.send(JSON.stringify(message)), targets: values => { liveTargets = values; } };
}

test('a reserved loopback endpoint must prove the exact Playwright-owned browser context before auto-attach', async t => {
  const f = await fixture(t, { rawContext: 'another-browser-context' });
  await assert.rejects(() => installAutomationNavigationGuard(f.browser, new Set(['https://app.test']), f.port), /document policy/);
  assert.equal(f.closed(), 1);
  assert.equal(f.commands.some(command => command.method === 'Target.setAutoAttach'), false);
  await until(() => f.order.includes('socket-close'));
  assert.ok(f.order.indexOf('browser-close') < f.order.indexOf('socket-close'));
});

test('owned popup documents are protected before resume; foreign sessions never receive document authority', async t => {
  const f = await fixture(t, { fetchDelay: 30 });
  const guard = await installAutomationNavigationGuard(f.browser, new Set(['https://app.test']), f.port);
  const attach = (sessionId, targetId, browserContextId = 'owned-context') => f.emit({ method: 'Target.attachedToTarget', params: { sessionId, targetInfo: { targetId, type: 'page', browserContextId } } });
  attach('owned-session', 'owned-popup');
  await until(() => f.commands.some(command => command.method === 'Runtime.runIfWaitingForDebugger'));
  assert.ok(f.order.indexOf('Fetch.enable-ack') < f.order.indexOf('Runtime.runIfWaitingForDebugger-ack'));
  assert.deepEqual(f.commands.find(command => command.method === 'Fetch.enable').params.patterns, [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }]);
  attach('foreign-session', 'foreign-popup', 'foreign-context');
  await until(() => f.commands.some(command => command.method === 'Target.detachFromTarget'));
  assert.equal(f.commands.some(command => command.sessionId === 'foreign-session'), false);
  f.emit({ method: 'Fetch.requestPaused', sessionId: 'foreign-session', params: { requestId: 'unknown', request: { url: 'https://app.test/' } } });
  f.emit({ method: 'Fetch.requestPaused', sessionId: 'owned-session', params: { requestId: 'allowed', request: { url: 'https://app.test/product' } } });
  f.emit({ method: 'Fetch.requestPaused', sessionId: 'owned-session', params: { requestId: 'redirect', request: { url: 'https://foreign.test/product' } } });
  await until(() => f.commands.some(command => command.method === 'Fetch.failRequest'));
  assert.equal(f.commands.find(command => command.method === 'Fetch.continueRequest').params.requestId, 'allowed');
  assert.equal(f.commands.find(command => command.method === 'Fetch.failRequest').params.requestId, 'redirect');
  assert.equal(f.commands.some(command => command.params?.requestId === 'unknown'), false);
  f.emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'owned-session' } });
  await until(() => f.commands.some(command => command.method === 'Target.getTargets'));
  assert.equal(guard.isActive(), true, 'a destroyed popup leaves its protected opener usable');
  assert.equal(f.closed(), 0);
  attach('live-session', 'live-popup');
  await until(() => f.commands.some(command => command.method === 'Runtime.runIfWaitingForDebugger' && command.sessionId === 'live-session'));
  f.targets([{ targetId: 'live-popup' }]);
  f.emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'live-session' } });
  await until(() => f.closed() === 1);
  assert.equal(guard.isActive(), false, 'policy loss disables frameless route admission immediately');
  await until(() => f.order.includes('socket-close'));
  assert.ok(f.order.indexOf('browser-close') < f.order.indexOf('socket-close'));
});
