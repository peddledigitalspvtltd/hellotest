const { createHmac, createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { resolveSessionSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');
const db = require('@hellotest/platform/backend/src/db');
const projectService = require('@hellotest/platform/backend/public/projectAccess');
const permissionService = require('@hellotest/platform/backend/services/permission.service');
const attribution = require('./contextAttribution');
const toolSets = require('./toolSets');
const memo = require('./requestMemo');
const fail = (message, statusCode = 403, code = 'MCP_ACCESS_DENIED') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const key = () => process.env.HELLOTEST_MCP_SIGNING_KEY || createHmac('sha256', resolveSessionSecret()).update('hellotest-mcp-resource-v1').digest('base64');
const sign = encoded => createHmac('sha256', key()).update(encoded).digest('base64url');
const clientKeyFor = (userId,projectId,label) => createHash('sha256').update(`${userId}\u0000${projectId}\u0000${String(label).trim().toLowerCase()}`).digest('hex');
async function principal(userId, projectId, clientId = 'hellotest-internal') {
 if(typeof userId!=='string'||!userId||typeof projectId!=='string'||!projectId||typeof clientId!=='string'||!clientId)throw fail('Verified user and project scope are required.',400,'MCP_INVALID_SCOPE');
 const user = await require('@hellotest/platform/backend/services/user.service').getUser(userId);
 if (!user || !['active', 'enabled'].includes(user.status || 'active')) throw fail('This account is unavailable.');
 await projectService.getProject(projectId, user.id);
 return { user, projectId, clientId };
}
// The principal for this request: loaded once however many checks need it.
const loadPrincipal = (userId, projectId, clientId) => memo.remember(`principal:${userId}:${projectId}:${clientId}`, () => principal(userId, projectId, clientId));
async function permit(actor, permission) {
 // Account state is read fresh for every request; within one request the first
 // check loads it and the rest share it (see requestMemo). A cached actor from an
 // earlier request is never authority.
 const current = await loadPrincipal(actor.user.id, actor.projectId, actor.clientId);
 actor.user = current.user;
 const flags=require('@hellotest/platform/backend/services/featureFlag.service');
 const required=flags.getFeatureKeysForPermission(permission);
 if(required.length && !await memo.remember(`flags:${actor.user.id}:${[...required].sort().join(',')}`,()=>flags.areEnabled(required,{user:actor.user})))throw fail('This feature is disabled.',403,'FEATURE_DISABLED');
 if (!(await memo.remember(`permission:${actor.user.id}:${actor.projectId}:${permission}`,()=>permissionService.hasPermission(actor.user, permission, actor.projectId)))) {
  const error=fail(`Permission required: ${permission}`);
  error.permission=permission;
  throw error;
 }
}
// Expired rows are dead weight (a credential never outlives its hour), and every
// turn in remote mode adds one. Trim them occasionally, off the request path.
let lastPrune = 0;
function pruneExpired() {
 const now = Date.now();
 if (now - lastPrune < 10 * 60 * 1000) return;
 lastPrune = now;
 try { Promise.resolve(db.prepare("DELETE FROM mcp_credentials WHERE expires_at < NOW() - INTERVAL '1 day'").run()).catch(() => {}); } catch { /* best effort */ }
}
/**
 * Issue a signed, project-bound credential.
 *
 * `scopes` are the tool sets it may use and default to the read-only sets;
 * writing sets must be asked for. `internal` marks a credential minted by the
 * platform for its own calls (it draws on the capacity reserved for them); only
 * in-process callers can set it, the HTTP route cannot. `ttlSeconds` shortens
 * the default hour.
 */
async function issue(user, projectId, clientId = 'external-host', { contextAttribution, scopes, internal = false, ttlSeconds = 3600, clientKey } = {}) {
 const granted = toolSets.normalizeScopes(scopes);
 const lifetime = Math.min(3600, Math.max(30, Math.floor(Number(ttlSeconds)) || 3600));
 return memo.open(async () => {
  const actor = await loadPrincipal(user.id, projectId, clientId);
  await permit(actor, 'project.view');
  const now = Math.floor(Date.now()/1000), id = randomUUID();
  const stableClientKey=clientKey||clientKeyFor(user.id,projectId,clientId);
  if(typeof stableClientKey!=='string'||!/^[a-f0-9]{64}$/.test(stableClientKey))throw fail('Invalid MCP client identity.',400,'MCP_INVALID_SCOPE');
  const payload = { sub: user.id, project_id: projectId, client_id: clientId, client_key:stableClientKey, aud: 'hellotest:mcp', iss: 'hellotest', jti: id, iat: now, exp: now + lifetime, scp: granted };
  if (internal) payload.int = true;
  const context = attribution.select(contextAttribution);
  if(Object.keys(context).length)payload.context_attribution=context;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  await db.prepare('INSERT INTO mcp_credentials(id,user_id,project_id,client_id,expires_at,scopes,internal) VALUES (?,?,?,?,?,?::jsonb,?)').run(id,user.id,projectId,clientId,new Date(payload.exp*1000).toISOString(),JSON.stringify(granted),Boolean(internal));
  pruneExpired();
  return { id, token: `mcp1.${encoded}.${sign(encoded)}`, expires_at: new Date(payload.exp*1000).toISOString(), audience: payload.aud, scopes: granted };
 });
}
function decode(token) {
 if (typeof token !== 'string' || token.length > 8192) throw fail('Use a HelloTest MCP host credential created in Connect & inspect.',401,'MCP_UNAUTHORIZED');
 const [prefix,encoded,signature,extra] = token.split('.');
 const expected = encoded ? sign(encoded) : '';
 if(prefix !== 'mcp1' || extra || !signature || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');
 let p;try {p=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');}
 const now=Math.floor(Date.now()/1000);
 if(p.aud!=='hellotest:mcp'||p.iss!=='hellotest'||typeof p.sub!=='string'||!p.sub||typeof p.project_id!=='string'||!p.project_id||typeof p.client_id!=='string'||!p.client_id||typeof p.jti!=='string'||!p.jti||!Number.isInteger(p.exp)||!Number.isInteger(p.iat)||p.exp<=now||p.iat>now+30||p.exp-p.iat>3600) throw fail('MCP credential expired or invalid.',401,'MCP_UNAUTHORIZED');
 if(p.context_attribution!==undefined&&!attribution.isValid(p.context_attribution))throw fail('MCP context attribution is invalid.',401,'MCP_UNAUTHORIZED');
 if(p.client_key!==undefined&&(typeof p.client_key!=='string'||!/^[a-f0-9]{64}$/.test(p.client_key)))throw fail('MCP client identity is invalid.',401,'MCP_UNAUTHORIZED');
 // Tool sets and the internal marker are signed claims. A credential from before tool sets has
 // neither and is read-only; one whose claims are malformed is not a credential.
 if(p.scp!==undefined){try{if(!Array.isArray(p.scp))throw new Error('not a list');toolSets.normalizeScopes(p.scp);}catch{throw fail('MCP credential tool sets are invalid.',401,'MCP_UNAUTHORIZED');}}
 if(p.int!==undefined&&p.int!==true)throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');
 return p;
}
// The tool sets a decoded credential grants: its signed claim, or the read-only default.
const scopesOf = claims => claims.scp === undefined ? [...toolSets.DEFAULT_SCOPES] : toolSets.normalizeScopes(claims.scp);
async function authenticate(token) {
 const p=decode(token);
 const row=await db.prepare('SELECT id FROM mcp_credentials WHERE id=? AND user_id=? AND project_id=? AND client_id=? AND revoked_at IS NULL AND expires_at>NOW()').get(p.jti,p.sub,p.project_id,p.client_id);
 if(!row)throw fail('MCP credential revoked or expired.',401,'MCP_UNAUTHORIZED');
 const actor=await loadPrincipal(p.sub,p.project_id,p.client_id);
 return {...actor,scopes:scopesOf(p),credentialId:p.jti,clientKey:p.client_key||clientKeyFor(p.sub,p.project_id,p.client_id),...(p.int===true?{internal:true}:{}),...(p.context_attribution?{contextAttribution:p.context_attribution}:{})};
}
module.exports = { principal, permit, issue, decode, authenticate, scopesOf, clientKeyFor, fail };
