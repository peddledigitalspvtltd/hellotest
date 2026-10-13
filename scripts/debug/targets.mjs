import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const capabilityOwners = Object.keys(JSON.parse(readFileSync(new URL('../../services/capabilities.json', import.meta.url), 'utf8')).dependencies);
export const workerOwners = ['testengine-api-worker', 'testengine-web-worker', 'testengine-android-worker', 'mobile-engine', 'testengine-quality-worker'];
export const debugOwners = [...capabilityOwners, 'mcp', ...workerOwners];
export const debugRoot = fileURLToPath(new URL('../../', import.meta.url));
export function resolveDebugTarget(owner, replica = 1) {
  if (!debugOwners.includes(owner)) throw new Error(`Unknown debug service: ${owner || '(missing)'}. Choose ${debugOwners.join(', ')}.`);
  if (!Number.isSafeInteger(Number(replica)) || Number(replica) < 1) throw new Error('Replica number must be a positive integer.');
  const combined = capabilityOwners.includes(owner) || owner === 'mcp';
  return { owner, service: combined ? 'api' : owner, replica: Number(replica), port: combined ? 9240 : 9241 + workerOwners.indexOf(owner), entry: owner.startsWith('testengine-') ? 'dist/server.js' : 'src/server.js' };
}
