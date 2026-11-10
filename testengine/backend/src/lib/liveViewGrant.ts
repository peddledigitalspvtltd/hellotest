import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EngineWebEngineProvider } from '../contracts/hellotest.js';

export function createLiveViewGrant({ engineRunId, provider, secret, now = Date.now() }: { engineRunId: string; provider: EngineWebEngineProvider; secret: string; now?: number }) {
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose: 'testengine-live-view', run_id: engineRunId,
    provider, exp: Math.floor(now / 1000) + 300 })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

/** Returns the verified signing key only to the host, for active-frame renewal. */
export function verifyLiveViewGrant({ token, engineRunId, provider, secrets, now = Date.now() }: {
  token: unknown; engineRunId: string; provider: EngineWebEngineProvider; secrets: (string | null | undefined)[]; now?: number;
}): string | null {
  if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [encoded, signature] = token.split('.');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
  const timestamp = Math.floor(now / 1000);
  if (!payload || Array.isArray(payload) || Object.keys(payload).length !== 5 || payload.v !== 1 || payload.purpose !== 'testengine-live-view'
    || payload.run_id !== engineRunId || payload.provider !== provider || !Number.isSafeInteger(payload.exp)
    || payload.exp <= timestamp || payload.exp > timestamp + 600) return null;
  const supplied = Buffer.from(signature, 'base64url');
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHmac('sha256', secret).update(encoded).digest();
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return secret;
  }
  return null;
}
