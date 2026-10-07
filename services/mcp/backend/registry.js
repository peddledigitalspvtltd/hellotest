const { createHash } = require('node:crypto');
const { ROUTE_PERMISSIONS } = require('@hellotest/platform/backend/src/security/permissions.catalog');
const routes = new Map();
const contracts=require('./contracts.json');
const roots = { '/projects':'project', '/app-types':'app_type', '/test-environments':'environment', '/test-configurations':'configuration', '/requirements':'requirement', '/test-cases':'test_case', '/test-suites':'test_suite', '/shared-step-groups':'shared_step_group', '/executions':'execution', '/execution-results':'execution_result', '/feedback':'issue', '/knowledge/sources':'knowledge_source' };
const managed = /^\/(projects|app-types|test-environments|test-configurations|requirements|test-cases|test-suites|shared-step-groups|executions|execution-results|feedback|knowledge\/sources)(?:\/|$)/;
const excluded = /(?:\/mcp|\/auth|\/users|\/roles|\/settings|\/integrations|\/admin|\/internal|\/api\/engine|\/api-keys|\/password|\/secret|\/download|\/export|\/live|\/stream|\/preview|\/ai[-/]|\/automation\/(?:build|generator|recorder)|\/versions\/)/;
function register(options) {
 for(const method of [].concat(options.method || [])) {
  if(['HEAD','OPTIONS'].includes(method))continue;
  const permission=ROUTE_PERMISSIONS.get(`${method} ${options.url}`);
  const id=createHash('sha256').update(`${method} ${options.url}`).digest('hex').slice(0,16);
  const read=['GET'].includes(method)&&managed.test(options.url)&&!excluded.test(options.url)&&!options.url.includes('*')&&Boolean(permission);
  const prepare=method==='POST'&&['/test-cases','/executions'].includes(options.url)&&Boolean(permission);
  routes.set(id,{id,method,path:options.url,permission,read,prepare,exposure:!permission||excluded.test(options.url)?'nondelegable':read?'read':prepare?'planned_action':'requires_domain_wrapper',reason:read||prepare?null:'Requires an audited domain wrapper, or is a privileged/internal/streaming operation.',input_schema:options.schema || contracts.schemas[`${method} ${options.url}`] || null,path_parameters:[...options.url.matchAll(/:([A-Za-z_][\w]*)/g)].map(m=>m[1])});
 }
}
const all=()=>[...routes.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const revision=()=>createHash('sha256').update(JSON.stringify(all())).digest('hex');
function get(id) {const op=routes.get(id);if(!op)throw Object.assign(new Error('Unknown application operation.'),{statusCode:404,code:'MCP_OPERATION_NOT_FOUND'});return op;}
const rootFor=path=>Object.entries(roots).sort((a,b)=>b[0].length-a[0].length).find(([root])=>path===root||path.startsWith(root+'/'));
module.exports={register,all,revision,get,rootFor};
