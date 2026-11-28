const { createHmac, createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { resolveSessionSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');
const db = require('@hellotest/platform/backend/src/db');
const projectService = require('@hellotest/platform/backend/public/projectAccess');
const permissionService = require('@hellotest/platform/backend/services/permission.service');
const attribution = require('./contextAttribution');
const { manualCredentialIssuanceEnabled } = require('./externalCredentialPolicy');
const toolSets = require('./toolSets');
const memo = require('./requestMemo');
const fail = (message, statusCode = 403, code = 'MCP_ACCESS_DENIED') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const MCP_AUDIENCE = 'hellotest:mcp';
const EXACT_TOOL_AUDIENCE = 'hellotest:mcp:manual-tools';
const DEFAULT_LIFETIME = 3600;
const MANUAL_CREDENTIAL_LIFETIMES = Object.freeze([DEFAULT_LIFETIME, 86400, 604800, 2592000, 7776000]);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const TOOL_NAME = /^hellotest_[a-z0-9_]{1,118}$/;
const MAX_TOOL_NAMES = 512;
const key = () => process.env.HELLOTEST_MCP_SIGNING_KEY || createHmac('sha256', resolveSessionSecret()).update('hellotest-mcp-resource-v1').digest('base64');
const sign = encoded => createHmac('sha256', key()).update(encoded).digest('base64url');
const clientKeyFor = (userId,projectId,label) => createHash('sha256').update(`${userId}\u0000${projectId}\u0000${String(label).trim().toLowerCase()}`).digest('hex');

function canonicalToolNames(names) {
 if(!Array.isArray(names)||!names.length||names.length>MAX_TOOL_NAMES||names.some(name=>typeof name!=='string'||!TOOL_NAME.test(name))||new Set(names).size!==names.length)return null;
 return [...names].sort();
}
const toolScopeHash = names => createHash('sha256').update(JSON.stringify(names)).digest('hex');

function exactCredentialOptions({ toolNames, expiresIn, internal, scopes }) {
 if(toolNames===undefined){
  if(expiresIn!==undefined)throw fail('Select individual tools to choose a credential expiry.',400,'MCP_INVALID_SCOPE');
  return null;
 }
 if(internal||scopes!==undefined)throw fail('Use individual tools or legacy tool sets for a credential.',400,'MCP_INVALID_SCOPE');
 if(!manualCredentialIssuanceEnabled())throw fail('Manual host credentials are limited to local development.',403,'MCP_MANUAL_CREDENTIAL_DISABLED');
 const names=canonicalToolNames(toolNames);
 if(!names)throw fail('Select one or more distinct MCP tools.',400,'MCP_INVALID_SCOPE');
 const lifetime=expiresIn===undefined?DEFAULT_LIFETIME:expiresIn;
 if(!MANUAL_CREDENTIAL_LIFETIMES.includes(lifetime))throw fail('Choose a credential expiry of 1 hour, 1 day, 1 week, 1 month or 90 days.',400,'MCP_INVALID_EXPIRY');
 const {tools}=require('./mcpServer');
 const sets=new Set();
 for(const name of names){
  const tool=Object.hasOwn(tools,name)&&tools[name];
  if(!tool||!toolSets.permits(toolSets.SET_IDS,name,tool)||tool.available&&!tool.available()){
   throw fail('One or more selected MCP tools are unavailable. Refresh the tool list and try again.',400,'MCP_INVALID_SCOPE');
  }
  sets.add(toolSets.setOf(name));
 }
 return {names,lifetime,scopes:toolSets.normalizeScopes([...sets])};
}
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
// Internal remote calls also create rows. Trim expired ones off the request path.
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
 * the default hour for OAuth, legacy and internal callers. Manual credentials
 * with exact `toolNames` can opt into a longer lifetime from the fixed presets.
 */
async function issue(user, projectId, clientId = 'external-host', { contextAttribution, scopes, internal = false, ttlSeconds = DEFAULT_LIFETIME, clientKey, toolNames, expiresIn } = {}) {
 const exact=exactCredentialOptions({toolNames,expiresIn,internal,scopes});
 const granted=exact?.scopes??toolSets.normalizeScopes(scopes);
 const lifetime=exact?.lifetime??Math.min(DEFAULT_LIFETIME,Math.max(30,Math.floor(Number(ttlSeconds))||DEFAULT_LIFETIME));
 return memo.open(async () => {
  const actor = await loadPrincipal(user.id, projectId, clientId);
  await permit(actor, 'project.view');
  const now = Math.floor(Date.now()/1000), id = randomUUID();
  const stableClientKey=clientKey||clientKeyFor(user.id,projectId,clientId);
  if(typeof stableClientKey!=='string'||!SHA256_HEX.test(stableClientKey))throw fail('Invalid MCP client identity.',400,'MCP_INVALID_SCOPE');
  const payload = { sub: user.id, project_id: projectId, client_id: clientId, client_key:stableClientKey, aud:exact?EXACT_TOOL_AUDIENCE:MCP_AUDIENCE, iss: 'hellotest', jti: id, iat: now, exp: now + lifetime, scp: granted };
  if (internal) payload.int = true;
  if (exact) payload.tool_scope_hash=toolScopeHash(exact.names);
  const context = attribution.select(contextAttribution);
  if(Object.keys(context).length)payload.context_attribution=context;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const expiresAt=new Date(payload.exp*1000).toISOString();
  await db.prepare('INSERT INTO mcp_credentials(id,user_id,project_id,client_id,expires_at,scopes,internal,tool_names) VALUES (?,?,?,?,?,?::jsonb,?,?::jsonb)').run(id,user.id,projectId,clientId,expiresAt,JSON.stringify(granted),Boolean(internal),exact?JSON.stringify(exact.names):null);
  pruneExpired();
  return { id, token: `mcp1.${encoded}.${sign(encoded)}`, expires_at: expiresAt, audience: payload.aud, scopes: granted, tool_names: exact?.names??null,
   ...(exact?{issued_at:new Date(now*1000).toISOString()}:{}) };
 });
}
function decode(token) {
 if (typeof token !== 'string' || token.length > 8192) throw fail('Use a HelloTest MCP host credential created in Connect & inspect.',401,'MCP_UNAUTHORIZED');
 const [prefix,encoded,signature,extra] = token.split('.');
 const expected = encoded ? sign(encoded) : '';
 if(prefix !== 'mcp1' || extra || !signature || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');
 let p;try {p=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');}
 const now=Math.floor(Date.now()/1000);
 if(!p||![MCP_AUDIENCE,EXACT_TOOL_AUDIENCE].includes(p.aud)||p.iss!=='hellotest'||typeof p.sub!=='string'||!p.sub||typeof p.project_id!=='string'||!p.project_id||typeof p.client_id!=='string'||!p.client_id||typeof p.jti!=='string'||!p.jti||!Number.isSafeInteger(p.exp)||!Number.isSafeInteger(p.iat)||p.exp<=now||p.iat>now+30||p.exp<=p.iat) throw fail('MCP credential expired or invalid.',401,'MCP_UNAUTHORIZED');
 const lifetime=p.exp-p.iat;
 // Older API replicas reject this audience and cannot accidentally treat a
 // valid signature for an exact credential as broader legacy tool sets.
 if(p.aud===EXACT_TOOL_AUDIENCE?
    typeof p.tool_scope_hash!=='string'||!SHA256_HEX.test(p.tool_scope_hash)||p.int!==undefined||p.scp===undefined||!MANUAL_CREDENTIAL_LIFETIMES.includes(lifetime):
    p.tool_scope_hash!==undefined||lifetime>DEFAULT_LIFETIME){
  throw fail('MCP credential tool scope or expiry is invalid.',401,'MCP_UNAUTHORIZED');
 }
 if(p.context_attribution!==undefined&&!attribution.isValid(p.context_attribution))throw fail('MCP context attribution is invalid.',401,'MCP_UNAUTHORIZED');
 if(p.client_key!==undefined&&(typeof p.client_key!=='string'||!SHA256_HEX.test(p.client_key)))throw fail('MCP client identity is invalid.',401,'MCP_UNAUTHORIZED');
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
 if(p.tool_scope_hash!==undefined&&!manualCredentialIssuanceEnabled())throw fail('Use HelloTest OAuth to connect in this deployment.',401,'MCP_OAUTH_REQUIRED');
 const row=await db.prepare('SELECT id,tool_names FROM mcp_credentials WHERE id=? AND user_id=? AND project_id=? AND client_id=? AND revoked_at IS NULL AND expires_at>NOW()').get(p.jti,p.sub,p.project_id,p.client_id);
 if(!row)throw fail('MCP credential revoked or expired.',401,'MCP_UNAUTHORIZED');
 const names=p.tool_scope_hash===undefined?null:canonicalToolNames(row.tool_names);
 if(p.tool_scope_hash!==undefined?(!names||toolScopeHash(names)!==p.tool_scope_hash):row.tool_names!=null){
  throw fail('MCP credential tool scope is invalid.',401,'MCP_UNAUTHORIZED');
 }
 const actor=await loadPrincipal(p.sub,p.project_id,p.client_id);
 return {...actor,scopes:scopesOf(p),credentialId:p.jti,clientKey:p.client_key||clientKeyFor(p.sub,p.project_id,p.client_id),...(names?{toolNames:Object.freeze(names)}:{}),...(p.int===true?{internal:true}:{}),...(p.context_attribution?{contextAttribution:p.context_attribution}:{})};
}
module.exports = { principal, permit, issue, decode, authenticate, scopesOf, clientKeyFor, fail, MANUAL_CREDENTIAL_LIFETIMES };
