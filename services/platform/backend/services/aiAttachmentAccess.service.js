const { createHmac, timingSafeEqual } = require('node:crypto');
const { Readable } = require('node:stream');
const db = require('../src/db');
const attachments = require('./attachment.service');
const permissions = require('./permission.service');
const { resolveSessionSecret, INSECURE_DEFAULTS } = require('../src/security/runtimeSecrets');
const traceContext = require('../src/utils/llmTraceContext');
const { normalizeReferenceImages } = require('../src/utils/aiReferenceImages');

const TTL_SECONDS = 10 * 60;
const fail = (message, statusCode = 403) => Object.assign(new Error(message), { statusCode, code: 'AI_ATTACHMENT_ACCESS_DENIED' });
// Domain separation prevents a file capability from being accepted as a login
// credential, or an ordinary session token from being accepted here.
const signature = encoded => {
  const secret = resolveSessionSecret();
  if (secret.length < 32 || INSECURE_DEFAULTS.has(secret.toLowerCase())) throw fail('Configure a persistent SESSION_SECRET of at least 32 characters before using public AI file links.', 503);
  return createHmac('sha256', secret).update(`hellotest.ai-file.v1:${encoded}`).digest('base64url');
};

function publicApiUrl() {
  const configured = process.env.HELLOTEST_API_PUBLIC_URL || (process.env.HELLOTEST_PUBLIC_URL ? `${process.env.HELLOTEST_PUBLIC_URL.replace(/\/+$/, '')}/api` : '');
  if (!configured) return null;
  let url; try { url = new URL(configured); } catch { throw fail('Configure a valid public API URL for AI file access.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/+$/, '');
}

async function actor(userId) {
  const user = await db.prepare('SELECT id, status, is_workspace_admin FROM users WHERE id = ?').get(userId);
  if (!user || user.status !== 'active') throw fail('AI file access is unavailable for this account.');
  return user;
}

async function authorize({ user, id, projectId }) {
  const { row, stream } = await attachments.download({ user, id });
  stream.destroy();
  if (row.project_id !== projectId) throw fail('The AI reference file belongs to another project.');
  return row;
}

async function createAccess({ user, id, projectId }) {
  const base = publicApiUrl();
  if (!base) throw fail('Configure HELLOTEST_API_PUBLIC_URL with the externally reachable HTTPS API URL before sharing files with a model.', 503);
  const verifiedUser = await actor(user.id);
  const row = await authorize({ user: verifiedUser, id, projectId });
  if (!/^[a-f0-9]{64}$/i.test(row.checksum_sha256 || '')) throw fail('Re-upload this reference file to establish a verified checksum before sharing it with a model.', 409);
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const encoded = Buffer.from(JSON.stringify({ purpose: 'ai-file', sub: verifiedUser.id, id: row.id, project: row.project_id, checksum: row.checksum_sha256, exp })).toString('base64url');
  const token = `${encoded}.${signature(encoded)}`;
  return { id: row.id, url: `${base}/attachments/${encodeURIComponent(row.id)}/ai-content?token=${encodeURIComponent(token)}`, expires_at: new Date(exp * 1000).toISOString() };
}

async function download({ id, token }) {
  if (typeof token !== 'string' || token.length > 2048) throw fail('Invalid or expired AI file link.');
  const [encoded, supplied, extra] = token.split('.');
  if (!encoded || !supplied || extra) throw fail('Invalid or expired AI file link.');
  const expected = Buffer.from(signature(encoded)), provided = Buffer.from(supplied);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw fail('Invalid or expired AI file link.');
  let claims; try { claims = JSON.parse(Buffer.from(encoded, 'base64url').toString()); } catch { throw fail('Invalid or expired AI file link.'); }
  const now = Math.floor(Date.now() / 1000);
  if (claims.purpose !== 'ai-file' || claims.id !== id || !/^[a-f0-9]{64}$/i.test(claims.checksum || '') || !Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.exp > now + TTL_SECONDS) throw fail('Invalid or expired AI file link.');
  const user = await actor(claims.sub);
  const result = await attachments.download({ user, id });
  if (result.row.project_id !== claims.project || result.row.checksum_sha256 !== claims.checksum) {
    result.stream.destroy(); throw fail('The AI reference file has changed. Request a new link.');
  }
  return result;
}

// Persist references as private project evidence before dispatch. The same
// verified IDs are returned with the draft and can later be copied to a case.
async function prepareImages(init, options = {}) {
  if (!options.persistReferenceImages) return init;
  const payload = JSON.parse(init.body);
  const parts = (payload.messages || []).flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part?.type === 'image_url');
  if (!parts.length) return init;
  const scope = traceContext.current(options.integration);
  if (!scope.actor_id || !scope.project_id) throw fail('A signed-in user and project are required to retain AI reference evidence.');
  const user = await actor(scope.actor_id);
  for (const code of ['attachment.create', 'attachment.view']) {
    if (!await permissions.hasPermission(user, code, scope.project_id)) throw fail(`Permission required to retain AI reference evidence: ${code}`);
  }
  const images = normalizeReferenceImages(parts.map((part, index) => ({ url: part.image_url.url, name: options.referenceImageNames?.[index] })));
  const stored = [];
  const replacements = new Map();
  for (const image of images) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(image.url);
    const receipt = await attachments.upload({ user, projectId: scope.project_id, entityType: 'project', entityId: scope.project_id,
      fileName: image.name, mimeType: match[1], stream: Readable.from([Buffer.from(match[2], 'base64')]), expectedSha256: image.content_hash });
    stored.push({ id: receipt.id, filename: receipt.filename, checksum: receipt.checksum });
    if (publicApiUrl()) replacements.set(image.url, (await createAccess({ user, id: receipt.id, projectId: scope.project_id })).url);
  }
  options.onReferenceAttachments?.(stored);
  if (!replacements.size) return init; // Inline image bytes remain valid for local/private deployments.
  payload.messages = payload.messages.map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(part => part?.type === 'image_url' ? { ...part, image_url: { ...part.image_url, url: replacements.get(part.image_url.url) || part.image_url.url } } : part) : message.content }));
  return { ...init, body: JSON.stringify(payload) };
}

function referenceIds(ids) {
  if (ids == null) return [];
  if (!Array.isArray(ids) || ids.length > 12 || ids.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(id))) throw fail('Select at most twelve valid reference files.', 400);
  return [...new Set(ids)];
}

function contextReferenceIds(value) {
  const { reviewed_context } = require('../src/utils/aiGenerationContext').splitGenerationContext(value);
  const ids = reviewed_context.flatMap(text => {
    let packet; try { packet=JSON.parse(text); } catch { return []; }
    return Array.isArray(packet?.files) ? packet.files.map(file => file?.id).filter(Boolean) : [];
  });
  return referenceIds([...new Set(ids)]);
}

async function verifyReferences({ userId, projectId, ids }) {
  const selected = referenceIds(ids);
  if (!selected.length) return { ids: selected };
  const user = await actor(userId);
  if (!await permissions.hasPermission(user, 'attachment.create', projectId)) throw fail('Permission required to retain reference evidence: attachment.create');
  for (const id of selected) await authorize({ user, id, projectId });
  return { user, ids: selected };
}

async function retainReferences({ userId, projectId, entityId, ids }) {
  const verified = await verifyReferences({ userId, projectId, ids });
  const stored = [];
  for (const id of verified.ids) stored.push(await attachments.copyToEntity({ user: verified.user, id, projectId, entityType:'test_case', entityId }));
  return stored;
}

module.exports = { createAccess, download, prepareImages, authorize, publicApiUrl, referenceIds, contextReferenceIds, verifyReferences, retainReferences };
