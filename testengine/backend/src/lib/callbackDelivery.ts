import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineCallbackPayload, EngineRunEnvelope, EngineRunRecord } from '../contracts/hellotest.js';
import { EngineHttpError, requestEngineService } from './engineHttpClient.js';
import { getRunEnvelope, updateRun } from './runStore.js';
import { resolveTestEngineSharedSecret } from './testEngineSecurity.js';

type Delivery = NonNullable<EngineRunRecord['callback_delivery']>;
type Pending = { url: string; secret_hash: string; payload: EngineCallbackPayload; delivery: Delivery };
const terminal = new Set(['run.completed', 'run.failed', 'run.incident']);
const root = path.resolve(process.env.ARTIFACT_ROOT || path.join(process.cwd(), 'artifacts'), '.callbacks');
const filename = (id: string) => path.join(root, `${createHash('sha256').update(id).digest('hex')}.json`);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const active = new Map<string, Promise<Delivery>>();
async function persist(record: Pending) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = filename(record.payload.engine_run_id);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, destination);
}
function compact(payload: EngineCallbackPayload): EngineCallbackPayload {
  // Images already present in the structured logs need not cross the network twice.
  const evidence = payload.case_result?.logs?.stepEvidence || {};
  const uploaded = new Map((payload.artifact_bundle?.artifact_refs || []).filter(ref=>ref.kind==='screenshot'&&ref.attachment_id).map(ref=>[ref.file_name,ref]));
  const compactEvidence = Object.fromEntries(Object.entries(evidence).map(([id,item])=>{
    const ref = item.fileName ? uploaded.get(item.fileName) : undefined;
    return [id,ref ? {attachmentId:ref.attachment_id,fileName:ref.file_name||undefined,mimeType:ref.content_type||undefined,size:ref.size_bytes||undefined,checksum:ref.checksum_sha256} : item];
  }));
  return { ...payload,
    case_result:payload.case_result?.logs?{...payload.case_result,logs:{...payload.case_result.logs,stepEvidence:compactEvidence}}:payload.case_result,
    step_outcomes: payload.step_outcomes?.map(outcome => evidence[outcome.step_id] ? { ...outcome, evidence_image: null } : outcome) };
}
async function send(record: Pending, secret: string, retain: boolean): Promise<Delivery> {
  const serialized = JSON.stringify(record.payload);
  const signature = createHmac('sha256', secret).update(serialized).digest('hex');
  const update = () => updateRun(record.payload.engine_run_id, run => ({ ...run, callback_delivery: record.delivery }));
  record.delivery = { status: 'pending', attempts: 0, event: record.payload.event, updated_at: new Date().toISOString() };
  update();
  if (retain) await persist(record).catch(() => undefined);
  for (let attempt = 1; attempt <= (retain ? 3 : 1); attempt++) {
    record.delivery.attempts = attempt;
    try {
      await requestEngineService({ url: record.url, service: 'HelloTest execution callback', timeoutMs: 15000, responseType: 'none', init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-testengine-signature': signature }, body: serialized } });
      record.delivery = { status: 'delivered', attempts: attempt, event: record.payload.event, updated_at: new Date().toISOString() };
      update();
      if (retain) await persist(record).catch(() => undefined);
      return record.delivery;
    } catch (error) {
      const code = error instanceof EngineHttpError ? error.code : 'DELIVERY_FAILED';
      const status = error instanceof EngineHttpError ? error.status : undefined;
      record.delivery = { ...record.delivery, status: 'failed', error_code: code, http_status: status, updated_at: new Date().toISOString() };
      update();
      const transient = ['REQUEST_FAILED', 'REQUEST_TIMEOUT'].includes(code) || code === 'HTTP_ERROR' && [408, 429, 500, 502, 503, 504].includes(status || 0);
      if (!transient || !retain || attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
  }
  if (retain) await persist(record).catch(() => undefined);
  console.error(JSON.stringify({ ...record.delivery, callback_event: record.payload.event, event: 'callback.delivery.failed', engine_run_id: record.payload.engine_run_id }));
  return record.delivery;
}
export async function deliverRunCallback(envelope: EngineRunEnvelope, payload: EngineCallbackPayload): Promise<Delivery> {
  if (!envelope.callback?.url || !envelope.callback.signing_secret) throw new Error('This run does not include a HelloTest callback target.');
  const retain = terminal.has(payload.event);
  const record: Pending = { url: envelope.callback.url, secret_hash: hash(envelope.callback.signing_secret), payload: compact(payload), delivery: { status: 'pending', attempts: 0, event: payload.event, updated_at: new Date().toISOString() } };
  // A reporting outage must not change a passed browser execution into a failed test.
  const operation = send(record, envelope.callback.signing_secret, retain).catch(() => {
    const delivery: Delivery = { status: 'failed', attempts: record.delivery.attempts, event: payload.event, error_code: 'DELIVERY_FAILED', updated_at: new Date().toISOString() };
    updateRun(payload.engine_run_id, run => ({ ...run, callback_delivery: delivery })); return delivery;
  });
  if (retain) active.set(payload.engine_run_id, operation);
  try { return await operation; } finally { if (retain && active.get(payload.engine_run_id) === operation) active.delete(payload.engine_run_id); }
}
export async function retryRunCallbacks(id: string): Promise<Delivery> {
  if (active.has(id)) return active.get(id)!;
  const operation = (async () => {
    const record = JSON.parse(await readFile(filename(id), 'utf8')) as Pending;
    if (record.payload.engine_run_id !== id || !terminal.has(record.payload.event)) throw new Error('No retained final result exists for this run.');
    if (record.delivery.status === 'delivered') return record.delivery;
    const secret = getRunEnvelope(id)?.callback?.signing_secret || process.env.TESTENGINE_CALLBACK_SECRET || resolveTestEngineSharedSecret(process.env).secret;
    if (!secret || hash(secret) !== record.secret_hash) throw new Error('The original callback credential is unavailable.');
    return send(record, secret, true);
  })();
  active.set(id, operation);
  try { return await operation; } finally { active.delete(id); }
}
