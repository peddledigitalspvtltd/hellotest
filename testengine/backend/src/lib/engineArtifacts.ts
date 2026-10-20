import { createHash, createHmac } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EngineArtifactRef, EngineRunEnvelope, EngineStepOutcomeStatus } from '../contracts/hellotest.js';
import { EngineHttpError, requestEngineService } from './engineHttpClient.js';
import { resolveTestEngineSharedSecret } from './testEngineSecurity.js';

const executeFile = promisify(execFile);
const root = path.resolve(process.env.ARTIFACT_ROOT || '/artifacts');
const INLINE_ARTIFACT_LIMIT = 2 * 1024 * 1024;
const INLINE_BUNDLE_LIMIT = 4 * 1024 * 1024;

export async function compressBrowserVideo(file: string, targetBytes = 8 * 1024 * 1024) {
  const before = await stat(file);
  if (before.size <= Math.min(8 * 1024 * 1024, targetBytes)) return file;
  const compressed = file.replace(/\.webm$/i, '.compact.webm');
  try {
    await executeFile(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-i', file, '-an', '-vf', "scale=w='trunc(min(960,iw)/2)*2':h=-2", '-r', '12',
      '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42', '-deadline', 'realtime', '-cpu-used', '6', '-threads', '2', compressed],
    { timeout: 60000, maxBuffer: 16384, windowsHide: true });
    const after = await stat(compressed);
    if (after.size > 0 && after.size < before.size) return compressed;
  } catch { /* Existing WebM remains valid when optional transcoding is unavailable. */ }
  await unlink(compressed).catch(() => undefined);
  return file;
}

function destination(envelope: EngineRunEnvelope) {
  if (envelope.callback?.url && envelope.callback.signing_secret) {
    const callback = new URL(envelope.callback.url);
    if (!/\/testengine\/callbacks\/runs\/?$/.test(callback.pathname)) return null;
    callback.pathname = callback.pathname.replace(/\/testengine\/callbacks\/runs\/?$/, `/testengine/internal/runs/${encodeURIComponent(envelope.engine_run_id)}/artifacts`);
    callback.search = ''; callback.hash = '';
    return { urls: [callback.toString()], secret: envelope.callback.signing_secret, signed: true };
  }
  const api = process.env.HELLOTEST_API_BASE_URL?.replace(/\/+$/, '');
  const secret = resolveTestEngineSharedSecret().secret;
  if (!api || !secret) return null;
  const prefix = (process.env.HELLOTEST_API_PATH_PREFIX || process.env.HELLOTEST_API_PREFIX || '').replace(/^\/+|\/+$/g, '');
  const route = `/testengine/internal/runs/${encodeURIComponent(envelope.engine_run_id)}/artifacts`;
  return { urls: [...new Set([`${api}${prefix ? `/${prefix}` : ''}${route}`, `${api}${route}`, ...(api.endsWith('/api') ? [] : [`${api}/api${route}`])])], secret, signed: false };
}

/** File-backed multipart uploads keep video/trace bytes out of result JSON. */
export async function deliverEngineArtifacts(envelope: EngineRunEnvelope, refs: EngineArtifactRef[], outcome?: EngineStepOutcomeStatus) {
  let inlineBytes = 0;
  const endpoint = destination(envelope);
  const delivered: EngineArtifactRef[] = [];
  for (const ref of refs) {
    if (!ref.path || !['video', 'trace', 'screenshot'].includes(ref.kind)) { delivered.push(ref); continue; }
    const file = path.resolve(root, ref.path);
    if (!file.startsWith(`${root}${path.sep}`)) { delivered.push({ ...ref, attachment_status: 'unavailable', attachment_error: 'Evidence path is outside the artifact directory.' }); continue; }
    try {
      const captureOutcome = ref.capture_outcome || outcome || 'blocked';
      const metadata = await stat(file);
      const policyLimit = ref.kind === 'video' ? Math.max(1, Math.min(250, Number(envelope.artifact_policy.max_video_attachment_mb) || 25)) * 1024 * 1024
        : ref.kind === 'trace' ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
      let uploadError = metadata.size > policyLimit ? 'Evidence exceeds the configured attachment limit.' : 'No HelloTest artifact upload endpoint is configured.';
      if (metadata.size > 0 && metadata.size <= policyLimit && endpoint) {
        try {
          const hash = createHash('sha256');
          for await (const bytes of createReadStream(file)) hash.update(bytes);
          const checksum = hash.digest('hex');
          const fileName = ref.file_name || path.basename(file), contentType = ref.content_type || 'application/octet-stream';
          const body = new FormData();
          body.set('kind', ref.kind); body.set('outcome', captureOutcome); body.set('checksum', checksum);
          body.set('file', await openAsBlob(file, { type: contentType }), fileName);
          const headers: Record<string, string> = {};
          if (endpoint.signed) {
            const context = Buffer.from(JSON.stringify({ purpose: 'execution-artifact', engine_run_id: envelope.engine_run_id, kind: ref.kind,
              outcome: captureOutcome, checksum, file_name: fileName, content_type: contentType, issued_at: Date.now() })).toString('base64url');
            headers['x-testengine-artifact-context'] = context;
            headers['x-testengine-artifact-signature'] = createHmac('sha256', endpoint.secret).update(context).digest('hex');
          } else headers.authorization = `Bearer ${endpoint.secret}`;
          let receipt: { attachment_id: string; checksum_sha256: string; compression: string } | undefined;
          for (const url of endpoint.urls) {
            try {
              receipt = await requestEngineService({ url, service: 'HelloTest evidence upload', timeoutMs: 120000, maxResponseBytes: 65536, init: { method: 'POST', headers, body } });
              break;
            } catch (error) {
              if (!(error instanceof EngineHttpError && error.code === 'HTTP_ERROR' && [404, 405].includes(error.status || 0))) throw error;
            }
          }
          if (!receipt) throw new Error('No artifact upload route is available.');
          if (!receipt.attachment_id || receipt.checksum_sha256 !== checksum) throw new Error('Invalid artifact storage receipt.');
          const { content_base64, ...compact } = ref;
          delivered.push({ ...compact, attachment_id: receipt.attachment_id, checksum_sha256: checksum, compression: receipt.compression, attachment_status: 'uploaded' });
          continue;
        } catch { uploadError = 'Evidence upload was unavailable; the original file remains on the engine.'; }
      }
      if (metadata.size <= policyLimit && metadata.size <= INLINE_ARTIFACT_LIMIT && inlineBytes + metadata.size <= INLINE_BUNDLE_LIMIT) {
        inlineBytes += metadata.size;
        delivered.push({ ...ref, content_base64: (await readFile(file)).toString('base64'), attachment_status: 'inline', attachment_error: uploadError });
      } else delivered.push({ ...ref, attachment_status: 'unavailable', attachment_error: uploadError });
    } catch { delivered.push({ ...ref, attachment_status: 'unavailable', attachment_error: 'The engine evidence file is unavailable.' }); }
  }
  return delivered;
}
