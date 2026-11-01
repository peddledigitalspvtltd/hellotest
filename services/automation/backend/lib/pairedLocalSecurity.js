const crypto = require('node:crypto');
const { resolveTestEngineSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');
const fail = (message, statusCode = 400, code = 'PAIRED_LOCAL_INVALID') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
const key = () => crypto.createHash('sha256').update(`hellotest-paired-local-v1\0${resolveTestEngineSecret()}`).digest();
const derive = (purpose, ...parts) => crypto.createHmac('sha256', key()).update(JSON.stringify([purpose, ...parts])).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length<=1024 && b.length<=1024 && Buffer.byteLength(a) === Buffer.byteLength(b)
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const id = (value, label = 'identity') => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw fail(`Use a valid paired local ${label}.`);
  return value;
};
function origin(value) {
  let parsed;try{parsed = new URL(value);}catch{throw fail('Use the current HelloTest application origin.');}
  if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw fail('Use an HTTP(S) application origin without a path or credentials.');
  return parsed.origin;
}
function publicApiBase(applicationOrigin) {
  const configured = process.env.HELLOTEST_PUBLIC_API_BASE_URL;
  const url = new URL(configured || `${origin(applicationOrigin)}/api`);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('The public API address is invalid.', 503, 'PAIRED_LOCAL_CONFIGURATION');
  const base = url.pathname.replace(/\/+$/, '');
  url.pathname = base.endsWith('/api') ? base : `${base}/api`;
  return url.href.replace(/\/+$/, '');
}
function seal(value, aad) {
  const content = Buffer.from(JSON.stringify(value));
  if (content.length > 8 * 1024 * 1024) throw fail('Select fewer cases or data rows for one local dispatch.', 413, 'PAIRED_LOCAL_BUDGET');
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const bytes = Buffer.concat([cipher.update(content),cipher.final()]);
  return {version:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:bytes.toString('base64')};
}
function open(value, aad) {
  try {
    if (value?.version !== 1 || typeof value.data !== 'string' || value.data.length > 12 * 1024 * 1024 || !/^[a-f0-9]{24}$/.test(value.iv) || !/^[a-f0-9]{32}$/.test(value.tag)) throw Error('Invalid cipher.');
    const decipher = crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(value.iv,'hex'));
    decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(value.tag,'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString());
  } catch { throw fail('The saved local dispatch cannot be opened with this installation configuration.',503,'PAIRED_LOCAL_CONFIGURATION'); }
}
module.exports = {fail,canonical,digest,derive,equal,id,origin,publicApiBase,seal,open};
