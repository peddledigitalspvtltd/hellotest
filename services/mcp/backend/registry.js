const { createHash } = require('node:crypto');
const { ROUTE_PERMISSIONS } = require('@hellotest/platform/backend/src/security/permissions.catalog');
const routes = new Map();
const contracts=require('./contracts.json');
const features=require('./featureOperations');
const {supportedFields}=require('./operationVerification');
const roots = { '/projects':'project', '/app-types':'app_type', '/test-environments':'environment', '/test-configurations':'configuration', '/requirements':'requirement', '/test-cases':'test_case', '/test-suites':'test_suite', '/shared-step-groups':'shared_step_group', '/executions':'execution', '/execution-results':'execution_result', '/feedback':'issue', '/knowledge/sources':'knowledge_source', '/agentic-quality/runs':'browser_mission', '/agentic-quality/baselines':'browser_baseline' };
const managed = /^\/(projects|app-types|test-environments|test-configurations|requirements|test-cases|test-suites|shared-step-groups|executions|execution-results|feedback|knowledge\/sources|agentic-quality\/(?:runs|baselines))(?:\/|$)/;
const excluded = /(?:\/mcp|\/auth|\/users|\/roles|\/settings|\/integrations|\/admin|\/internal|\/api\/engine|\/api-keys|\/password|\/secret|\/download|\/export|\/live|\/stream|\/preview|\/ai[-/]|\/automation\/(?:build|generator|recorder)|\/versions\/)/;
function register(options) {
 for(const method of [].concat(options.method || [])) {
  if(['HEAD','OPTIONS'].includes(method))continue;
  const permission=ROUTE_PERMISSIONS.get(`${method} ${options.url}`);
  const id=createHash('sha256').update(`${method} ${options.url}`).digest('hex').slice(0,16);
  // A GET route is not necessarily a bounded JSON read. Download/render routes
  // can allocate a whole report or attachment before invokeOperation can inspect
  // Content-Type. ALM reads also need a wrapper that pins the external project.
  const metadataArtifacts=options.url==='/workspace-transactions/:id/artifacts';
  const wrapperReason=!metadataArtifacts&&/\.(?:pdf|html|csv)(?:\/|$)|\/(?:file|artifact)(?:\/|$)|\/artifacts(?:\/|$)/i.test(options.url)?'Binary, report and artifact reads require a bounded typed evidence wrapper.':/\/alm(?:\/|$)/.test(options.url)?'External ALM reads require an integration and remote-project-scoped wrapper.':null;
  const policy=features.policyFor(method,options.url);
  const generated=contracts.schemas[`${method} ${options.url}`];
  const declared=generated||options.schema?{...generated,...options.schema,...(options.schema?.body||generated?.body?{body:options.schema?.body||generated.body}:{})}:null;
  const delegatedBody=policy?.body_schema&&declared?.body?{...policy.body_schema,...declared.body,properties:{...policy.body_schema.properties,...declared.body.properties},required:declared.body.required||[]}:declared?.body||policy?.body_schema;
  let input_schema=delegatedBody?{...declared,body:delegatedBody}:declared;
  const accepted=supportedFields({policy});
  const unsupportedRequired=accepted?(input_schema?.body?.required||[]).filter(key=>!accepted.has(key)):[];
  if(input_schema?.body?.properties&&policy){
   const properties=Object.fromEntries(Object.entries(input_schema.body.properties).filter(([key])=>(!accepted||accepted.has(key))&&!(options.url.startsWith('/executions')&&key==='engine_base_url')));
   if(options.url==='/executions/:id/start'&&properties.execution_mode)properties.execution_mode={...properties.execution_mode,enum:['manual','remote']};
   input_schema={...input_schema,body:{...input_schema.body,properties,...(accepted?{additionalProperties:false}:{})}};
  }
  const read=Boolean(permission && policy && method==='GET' && !wrapperReason && !options.url.includes('*'));
  const prepare=Boolean(permission && policy && method!=='GET' && policy.verification && input_schema?.body && !unsupportedRequired.length);
  const reason=read||prepare?null:!permission?'No project-delegable domain permission is registered.':features.unavailableReason?.(method,options.url)|| (unsupportedRequired.length?`Required fields have no verified native effect: ${unsupportedRequired.join(', ')}.`:wrapperReason || (excluded.test(options.url)&&!policy?'This operation handles instance administration, credentials, raw transport or a dedicated non-JSON workflow.':policy&&!input_schema?.body?'The native controller has no audited request body contract.':'No audited project scope and verifiable result wrapper is available.'));
  routes.set(id,{id,method,path:options.url,permission,read,prepare,callable:read||prepare,family:policy?.family || options.url.split('/').filter(Boolean)[0] || 'platform',label:policy?.label || `${method} ${options.url}`,summary:policy?.summary || reason,alias_of:policy?.alias_of || null,policy:policy || null,
    exposure:read?'read':prepare?'planned_action':!permission||excluded.test(options.url)&&!policy?'nondelegable':'requires_domain_wrapper',reason,input_schema,path_parameters:[...options.url.matchAll(/:([A-Za-z_][\w]*)/g)].map(m=>m[1])});
 }
}
const all=()=>[...routes.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const revision=()=>createHash('sha256').update(JSON.stringify(all())).digest('hex');
function get(id) {const op=routes.get(id);if(!op)throw Object.assign(new Error('Unknown application operation.'),{statusCode:404,code:'MCP_OPERATION_NOT_FOUND'});return op;}
const rootFor=path=>Object.entries(roots).sort((a,b)=>b[0].length-a[0].length).find(([root])=>path===root||path.startsWith(root+'/'));
module.exports={register,all,revision,get,rootFor};
