const { randomUUID } = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const db = require('@hellotest/platform/backend/src/db');
const security = require('../lib/pairedLocalSecurity');

const tokenFor = row => security.derive('browser-bridge', row.id, row.nonce, row.agent_id);
const error = (message, status = 409, code = 'PAIRED_BROWSER_UNAVAILABLE') => security.fail(message, status, code);
const methods = new Set(['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'session/delete', 'verification/run']);
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const find = bridgeId => db.prepare('SELECT * FROM automation_paired_browser_bridges WHERE id=?').get(security.id(bridgeId, 'browser bridge'));
function assertOpen(row, { requireStarted = false } = {}) {
  if (!row || row.status !== 'open' || new Date(row.expires_at).getTime() <= Date.now()) throw error('The paired browser connection expired or closed. Reconnect the browser before building automation.', 410);
  if (!row.started_at && new Date(row.created_at).getTime() + 10 * 60_000 <= Date.now()) throw error('The paired browser was not connected in time. Reconnect it before building automation.', 410);
  if (requireStarted && !row.started_at) throw error('Start the paired browser connection on this machine before building automation.');
  return row;
}
async function assertCurrentAccess(row) {
  const actor = await db.prepare('SELECT id,status,is_workspace_admin FROM users WHERE id=?').get(row.created_by);
  if (!actor || actor.status !== 'active') throw error('The build actor is unavailable.',403,'PAIRED_BROWSER_ACCESS');
  await require('@hellotest/platform/backend/public/projectAccess').getProject(row.project_id,actor.id);
  const permissions = await require('@hellotest/platform/backend/services/optionalEvidenceAccess.service').getOptionalEvidenceAccess(actor,row.project_id,['automation.build','automation.ai']);
  if (!permissions['automation.build'] || !permissions['automation.ai']) throw error('Automation build access changed. Reconnect after access is restored.',403,'PAIRED_BROWSER_ACCESS');
}

async function create({ caseIds, projectId, appTypeId, userId, agentId, pairedOrigin }) {
  const ids = [...new Set((caseIds || []).map(value => security.id(value, 'test case')))];
  if (!ids.length || ids.length > 2000) throw error('Select between 1 and 2,000 cases for a paired browser build.', 400);
  const row = { id: randomUUID(), project_id: projectId, app_type_id: appTypeId, created_by: userId,
    agent_id: security.id(agentId, 'agent identity'), paired_origin: security.origin(pairedOrigin),
    allowed_case_ids: ids, nonce: randomUUID(), status: 'open', expires_at: new Date(Date.now() + 60 * 60_000).toISOString() };
  await db.prepare(`INSERT INTO automation_paired_browser_bridges
    (id,project_id,app_type_id,created_by,agent_id,paired_origin,allowed_case_ids,nonce,status,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(row.id,row.project_id,row.app_type_id,row.created_by,row.agent_id,row.paired_origin,ids,row.nonce,row.status,row.expires_at);
  const base = security.publicApiBase(row.paired_origin);
  return { id: row.id, token: tokenFor(row), poll_url: `${base}/local-browser-bridges/${row.id}/poll`, result_url: `${base}/local-browser-bridges/${row.id}/result`, expires_at: row.expires_at };
}

async function authorize({ bridgeId, projectId, appTypeId, userId, caseId, jobId }, { requireStarted = false } = {}) {
  const row = assertOpen(await find(bridgeId), { requireStarted });
  if (row.project_id !== projectId || row.app_type_id !== appTypeId || row.created_by !== userId || !decode(row.allowed_case_ids).includes(caseId)) {
    throw error('This paired browser connection does not belong to the selected build.', 403, 'PAIRED_BROWSER_SCOPE');
  }
  await assertCurrentAccess(row);
  if (jobId) {
    const bound = await db.prepare(`UPDATE automation_paired_browser_bridges SET bound_job_id=COALESCE(bound_job_id,?)
      WHERE id=? AND (bound_job_id IS NULL OR bound_job_id=?) RETURNING id`).get(jobId,row.id,jobId);
    if (!bound) throw error('This paired browser connection is already assigned to another build. Reconnect before starting a new build.',409,'PAIRED_BROWSER_SCOPE');
  }
  return row;
}

async function authenticate({ bridgeId, agentId, token }) {
  const row = await find(bridgeId);
  if (!row || !security.equal(row.agent_id, agentId) || !security.equal(tokenFor(row), token)) throw error('The paired browser grant is invalid.', 401, 'PAIRED_BROWSER_AUTH');
  return row;
}

const pollTransaction = db.transaction(async auth => {
  await db.prepare('SELECT id FROM automation_paired_browser_bridges WHERE id=? FOR UPDATE').get(security.id(auth.bridgeId,'browser bridge'));
  const row = await authenticate(auth);
  if (row.status === 'closed' || new Date(row.expires_at).getTime() <= Date.now()) return { state: 'closed', command: null };
  assertOpen(row);
  await assertCurrentAccess(row);
  await db.prepare('UPDATE automation_paired_browser_bridges SET started_at=COALESCE(started_at,CURRENT_TIMESTAMP) WHERE id=?').run(row.id);
  // A delivered browser action is never leased twice. A lost result is resolved
  // by retrying the same receipt, not repeating the action on another poll.
  const command = await db.prepare(`UPDATE automation_paired_browser_commands SET status='delivered',delivered_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM automation_paired_browser_commands WHERE bridge_id=? AND status='queued'
      AND NOT EXISTS(SELECT 1 FROM automation_paired_browser_commands active WHERE active.bridge_id=? AND active.status='delivered')
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`).get(row.id,row.id);
  return { state: 'open', command: command ? { id: command.id, ...security.open(decode(command.request_ciphertext), `browser-request:${row.id}:${command.id}`) } : null };
});

const resultTransaction = db.transaction(async ({ commandId, response, ...auth }) => {
  const row = await authenticate(auth);
  if (new Date(row.expires_at).getTime() <= Date.now()) throw error('The paired browser grant expired.', 410);
  const command = await db.prepare('SELECT * FROM automation_paired_browser_commands WHERE id=? AND bridge_id=? FOR UPDATE').get(security.id(commandId, 'browser command'),row.id);
  if (!command || !['delivered','completed','unknown'].includes(command.status)) throw error('This browser command is unavailable or was not dispatched.');
  if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || typeof response.session_id !== 'undefined' && (typeof response.session_id !== 'string' || response.session_id.length > 200)
    || Buffer.byteLength(JSON.stringify(response)) > 4 * 1024 * 1024) throw error('The browser response is invalid or exceeds the evidence budget.', 413);
  const request = security.open(decode(command.request_ciphertext),`browser-request:${row.id}:${command.id}`);
  if (['initialize','tools/list','tools/call'].includes(request.method) && response.status >= 200 && response.status < 300
    && (!response.body || response.body.jsonrpc !== '2.0' || response.body.id !== command.id)) throw error('The paired browser returned a mismatched MCP receipt.',409,'PAIRED_BROWSER_RECEIPT');
  const aad = `browser-response:${row.id}:${command.id}`;
  if (command.status === 'completed') {
    if (security.digest(security.open(decode(command.response_ciphertext),aad)) !== security.digest(response)) throw error('A different result is already recorded for this browser action.');
    return { accepted: true, replayed: true };
  }
  await db.prepare("UPDATE automation_paired_browser_commands SET status='completed',response_ciphertext=?,completed_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(security.seal(response,aad),command.id);
  return { accepted: true };
});

async function exchange({ scope, method, params, sessionId, signal, timeoutMs = 30_000 }) {
  await authorize(scope);
  if (!methods.has(method)) throw error('This browser MCP method is not supported.',400);
  const id = randomUUID(), request = { method, params, ...(sessionId ? { session_id: sessionId } : {}) };
  if (Buffer.byteLength(JSON.stringify(request)) > 512 * 1024) throw error('The browser command exceeds the request budget.',413);
  await db.prepare('INSERT INTO automation_paired_browser_commands(id,bridge_id,request_ciphertext) VALUES(?,?,?)')
    .run(id,scope.bridgeId,security.seal(request,`browser-request:${scope.bridgeId}:${id}`));
  const deadline = Date.now() + Math.min(75_000,Math.max(1,timeoutMs));
  try {
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const command = await db.prepare('SELECT status,response_ciphertext FROM automation_paired_browser_commands WHERE id=? AND bridge_id=?').get(id,scope.bridgeId);
      if (command?.status === 'completed') return security.open(decode(command.response_ciphertext),`browser-response:${scope.bridgeId}:${id}`);
      assertOpen(await find(scope.bridgeId));
      await pause(Math.min(150,Math.max(1,deadline-Date.now())),undefined,{signal});
    }
    throw error('The paired browser did not acknowledge its action. Reconnect and review the browser before starting a new build; the action will not be repeated automatically.',504,'PAIRED_BROWSER_ACKNOWLEDGEMENT_UNKNOWN');
  } catch (failure) {
    await db.prepare("UPDATE automation_paired_browser_commands SET status='unknown' WHERE id=? AND status IN('queued','delivered')").run(id);
    await db.prepare("UPDATE automation_paired_browser_bridges SET status='closed' WHERE id=?").run(scope.bridgeId);
    failure.nonRetryable = true;
    throw failure;
  }
}

async function createTransport(scope) {
  await authorize(scope);
  return async (_endpoint, init) => {
    const message = init.method === 'DELETE' ? { method: 'session/delete' } : JSON.parse(init.body);
    const response = await exchange({ scope, method: message.method, params: message.params, sessionId: init.headers?.['mcp-session-id'], signal: init.signal });
    const body = response.body == null ? null : { ...response.body, ...(Object.hasOwn(message,'id') ? { id: message.id } : {}) };
    return new Response([204,205,304].includes(response.status) ? null : body == null ? null : JSON.stringify(body), { status: response.status,
      headers: { 'content-type':'application/json', ...(response.session_id ? { 'mcp-session-id':response.session_id } : {}) } });
  };
}

module.exports = { create, authorize, poll: pollTransaction, result: resultTransaction, exchange, createTransport };
