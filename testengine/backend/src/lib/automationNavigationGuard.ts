import { createServer } from 'node:net';
import WebSocket from 'ws';
import type { createConnection } from '@playwright/mcp';

type NativeContext = Awaited<ReturnType<NonNullable<Parameters<typeof createConnection>[1]>>>;
type NativeBrowser = NonNullable<ReturnType<NativeContext['browser']>>;
type Pending = { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; sessionId?: string };
type Message = { id?: number; result?: any; error?: unknown; method?: string; sessionId?: string; params?: any };

/** Chromium's flattened target sessions require a sessionId in the CDP envelope,
 * which Playwright's public CDPSession.send cannot express. Keep this additional
 * native connection on an ephemeral loopback port, scoped to the owned browser. */
export async function reserveAutomationDebuggingPort() {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const address = reservation.address();
  if (!address || typeof address === 'string') { reservation.close(); throw new Error('Cannot reserve the owned browser document policy port.'); }
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Pause each owned Chromium page before its first document. Popup navigation
 * can precede Playwright's page/frame event, so page-level routing alone cannot
 * safely admit its first request or redirect chain. No app responses are changed. */
export async function installAutomationNavigationGuard(browser: NativeBrowser, allowedOrigins: ReadonlySet<string>, port: number) {
  let socket: WebSocket | undefined;
  const pending = new Map<number, Pending>(), ownedSessions = new Map<string, string>();
  const attachedTargets = new Set<string>();
  let nextId = 0, closed = false;
  const messageError = () => new Error('The owned browser document policy could not be established.');
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
    if (closed || socket?.readyState !== WebSocket.OPEN || pending.size >= 1000) { reject(messageError()); return; }
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(messageError()); }, 5000);
    pending.set(id, { resolve, reject, timer, sessionId });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }), error => {
      if (!error) return;
      const item = pending.get(id); if (!item) return;
      clearTimeout(item.timer); pending.delete(id); item.reject(messageError());
    });
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    // A socket detach can resume paused targets. Destroy the dedicated browser
    // before releasing the policy connection or any outstanding debugger hold.
    await browser.close().catch(() => undefined);
    if (browser.isConnected()) return;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(messageError()); }
    pending.clear(); ownedSessions.clear(); attachedTargets.clear();
    socket?.terminate();
  };
  const failClosed = () => { void close(); };
  const received = (data: WebSocket.RawData) => {
    let message: Message;
    try { message = JSON.parse(data.toString()); } catch { failClosed(); return; }
    if (message.id !== undefined) {
      const item = pending.get(message.id);
      if (!item || item.sessionId !== message.sessionId) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.error) item.reject(messageError()); else item.resolve(message.result);
      return;
    }
    if (message.method === 'Target.attachedToTarget') {
      void (async () => {
        const { sessionId, targetInfo } = message.params;
        if (closed) return;
        if (targetInfo.browserContextId !== contextId || targetInfo.type !== 'page') {
          await send('Target.detachFromTarget', { sessionId }); return;
        }
        if (attachedTargets.has(targetInfo.targetId) || attachedTargets.size >= 100) throw messageError();
        attachedTargets.add(targetInfo.targetId);
        ownedSessions.set(sessionId, targetInfo.targetId);
        await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] }, sessionId);
        await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
      })().catch(failClosed);
      return;
    }
    if (message.method === 'Target.detachedFromTarget') {
      const sessionId = message.params?.sessionId;
      for (const [id, item] of pending) if (item.sessionId === sessionId) {
        clearTimeout(item.timer); pending.delete(id); item.reject(messageError());
      }
      const targetId = ownedSessions.get(sessionId);
      ownedSessions.delete(sessionId);
      if (targetId) attachedTargets.delete(targetId);
      if (targetId && !closed) {
        // A destroyed popup is normal; detaching from a still-live page loses
        // its document policy and must close this browser before it can escape.
        void send('Target.getTargets').then(({ targetInfos }) => {
          if (targetInfos.some((target: { targetId: string }) => target.targetId === targetId)) failClosed();
        }).catch(failClosed);
      }
      return;
    }
    if (message.method !== 'Fetch.requestPaused' || !message.sessionId || !ownedSessions.has(message.sessionId)) return;
    const { requestId, request } = message.params;
    let allowed = false;
    try { allowed = allowedOrigins.has(new URL(request.url).origin); } catch {}
    void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed
      ? { requestId } : { requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(failClosed);
  };
  let contextId = '';
  browser.once('disconnected', () => { void close(); });
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw messageError();
    const publicCdp = await browser.newBrowserCDPSession();
    let browserContextIds: string[];
    try { ({ browserContextIds } = await publicCdp.send('Target.getBrowserContexts')); }
    finally { await publicCdp.detach().catch(() => undefined); }
    if (browserContextIds.length !== 1) throw messageError();
    contextId = browserContextIds[0];
    const endpoint = await fetch(`http://127.0.0.1:${port}/json/version`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!endpoint.ok || !endpoint.body) throw messageError();
    const reader = endpoint.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) { await reader.cancel(); throw messageError(); }
      chunks.push(chunk.value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(JSON.parse(body).webSocketDebuggerUrl);
    if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port || url.username || url.password || url.search || url.hash
      || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(url.pathname)) throw messageError();
    socket = new WebSocket(url, { maxPayload: 1024 * 1024, followRedirects: false, handshakeTimeout: 5000 });
    socket.on('message', received);
    socket.on('error', failClosed);
    socket.on('close', failClosed);
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', () => reject(messageError())); socket!.once('close', () => reject(messageError())); });
    const inventory = await send('Target.getBrowserContexts');
    // Port reservation cannot make the launch gap atomic. Prove this is the
    // exact browser owned through Playwright before granting target authority.
    if (inventory.browserContextIds.length !== 1 || inventory.browserContextIds[0] !== contextId) throw messageError();
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }] });
  } catch (error) { await close(); throw error; }
  return { close, isActive: () => !closed && socket?.readyState === WebSocket.OPEN };
}
