const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { resolveSessionSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');
const db = require('@hellotest/platform/backend/src/db');
const projectService = require('@hellotest/platform/backend/public/projectAccess');
const permissionService = require('@hellotest/platform/backend/services/permission.service');
const fail = (message, statusCode = 403, code = 'MCP_ACCESS_DENIED') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const key = () => process.env.HELLOTEST_MCP_SIGNING_KEY || createHmac('sha256', resolveSessionSecret()).update('hellotest-mcp-resource-v1').digest('base64');
const sign = encoded => createHmac('sha256', key()).update(encoded).digest('base64url');
async function principal(userId, projectId, clientId = 'hellotest-internal') {
 if(typeof userId!=='string'||!userId||typeof projectId!=='string'||!projectId||typeof clientId!=='string'||!clientId)throw fail('Verified user and project scope are required.',400,'MCP_INVALID_SCOPE');
 const user = await require('@hellotest/platform/backend/services/user.service').getUser(userId);
 if (!user || !['active', 'enabled'].includes(user.status || 'active')) throw fail('This account is unavailable.');
 await projectService.getProject(projectId, user.id);
 return { user, projectId, clientId };
}
async function permit(actor, permission) {
 // Internal callers also need fresh account state; a cached actor is not authority.
 const current = await principal(actor.user.id, actor.projectId, actor.clientId);
 actor.user = current.user;
 const flags=require('@hellotest/platform/backend/services/featureFlag.service');
 const required=flags.getFeatureKeysForPermission(permission);
 if(required.length && !await flags.areEnabled(required,{user:actor.user}))throw fail('This feature is disabled.',403,'FEATURE_DISABLED');
 if (!(await permissionService.hasPermission(actor.user, permission, actor.projectId))) throw fail(`Permission required: ${permission}`);
}
async function issue(user, projectId, clientId = 'external-host') {
 const actor = await principal(user.id, projectId, clientId);
 await permit(actor, 'project.view');
 const now = Math.floor(Date.now()/1000), id = randomUUID();
 const payload = { sub: user.id, project_id: projectId, client_id: clientId, aud: 'hellotest:mcp', iss: 'hellotest', jti: id, iat: now, exp: now + 3600 };
 const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
 await db.prepare('INSERT INTO mcp_credentials(id,user_id,project_id,client_id,expires_at) VALUES (?,?,?,?,?)').run(id,user.id,projectId,clientId,new Date(payload.exp*1000).toISOString());
 return { id, token: `mcp1.${encoded}.${sign(encoded)}`, expires_at: new Date(payload.exp*1000).toISOString(), audience: payload.aud };
}
function decode(token) {
 if (typeof token !== 'string' || token.length > 8192) throw fail('Use a HelloTest MCP host credential created in Connect & inspect.',401,'MCP_UNAUTHORIZED');
 const [prefix,encoded,signature,extra] = token.split('.');
 const expected = encoded ? sign(encoded) : '';
 if(prefix !== 'mcp1' || extra || !signature || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');
 let p;try {p=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');}
 const now=Math.floor(Date.now()/1000);
 if(p.aud!=='hellotest:mcp'||p.iss!=='hellotest'||typeof p.sub!=='string'||!p.sub||typeof p.project_id!=='string'||!p.project_id||typeof p.client_id!=='string'||!p.client_id||typeof p.jti!=='string'||!p.jti||!Number.isInteger(p.exp)||!Number.isInteger(p.iat)||p.exp<=now||p.iat>now+30||p.exp-p.iat>3600) throw fail('MCP credential expired or invalid.',401,'MCP_UNAUTHORIZED');
 return p;
}
async function authenticate(token) {
 const p=decode(token);
 const row=await db.prepare('SELECT id FROM mcp_credentials WHERE id=? AND user_id=? AND project_id=? AND client_id=? AND revoked_at IS NULL AND expires_at>NOW()').get(p.jti,p.sub,p.project_id,p.client_id);
 if(!row)throw fail('MCP credential revoked or expired.',401,'MCP_UNAUTHORIZED');
 return principal(p.sub,p.project_id,p.client_id);
}
module.exports = { principal, permit, issue, decode, authenticate, fail };
