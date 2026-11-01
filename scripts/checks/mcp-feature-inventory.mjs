#!/usr/bin/env node
import ts from 'typescript';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const registry=require('../../services/mcp/backend/registry');
const features=require('../../services/mcp/backend/featureOperations');
const projectionDefinitions=require('../../services/mcp/backend/projections').entities;
const {ROUTE_PERMISSIONS}=require('../../services/platform/backend/src/security/permissions.catalog');
const featureOwners=JSON.parse(readFileSync(resolve(root,'services/capabilities.json'),'utf8')).feature_owners;
const {FEATURE_DEFINITIONS,PERMISSION_FEATURES,getFeatureKeysForRoute}=require('../../services/platform/backend/services/featureFlag.service');
const sources=new Map(),unresolved=[];let scanned=0;
function literals(node,origin=node,depth=0){
 if(!node||depth>12)return [];
 if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return [node.text];
 if(ts.isArrayLiteralExpression(node))return node.elements.flatMap(item=>literals(item,origin,depth+1));
 if(ts.isTemplateExpression(node)){
  let result=[node.head.text];
  for(const span of node.templateSpans){const values=literals(span.expression,origin,depth+1);if(!values.length)return [];result=result.flatMap(prefix=>values.map(value=>prefix+value+span.literal.text));}
  return result;
 }
 if(ts.isIdentifier(node)){
  // Shared native route helpers bind this literal at both call sites.
  if(node.text==='basePath')return ['/issues','/feedback'];
  for(let ancestor=origin.parent;ancestor;ancestor=ancestor.parent)if(ts.isForOfStatement(ancestor)&&ts.isVariableDeclarationList(ancestor.initializer)){
   const binding=ancestor.initializer.declarations[0]?.name;
   if(binding&&ts.isIdentifier(binding)&&binding.text===node.text)return literals(ancestor.expression,ancestor,depth+1);
   if(binding&&ts.isArrayBindingPattern(binding)){
    const index=binding.elements.findIndex(item=>ts.isBindingElement(item)&&ts.isIdentifier(item.name)&&item.name.text===node.text);
    if(index>=0&&ts.isArrayLiteralExpression(ancestor.expression))return ancestor.expression.elements.flatMap(item=>ts.isArrayLiteralExpression(item)?literals(item.elements[index],ancestor,depth+1):[]);
   }
  }
  for(let ancestor=origin.parent;ancestor;ancestor=ancestor.parent)if(ts.isBlock(ancestor)||ts.isSourceFile(ancestor)){
   for(const statement of ancestor.statements){
    if(statement.pos>origin.pos)break;
    if(!ts.isVariableStatement(statement))continue;
    const declaration=statement.declarationList.declarations.find(item=>ts.isIdentifier(item.name)&&item.name.text===node.text);
    if(declaration?.initializer)return literals(declaration.initializer,declaration,depth+1);
   }
  }
 }
 return [];
}
function scan(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  if(['node_modules','test','tests','dist','vendor','runtime'].includes(entry.name))continue;
  const file=join(directory,entry.name);
  if(entry.isDirectory()){scan(file);continue;}
  if(!/\.(?:js|cjs|mjs)$/.test(file))continue;
  scanned++;const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  function record(method,path,node){
   const key=method+' '+path;if(!sources.has(key))sources.set(key,[]);
   sources.get(key).push({file:relative(root,file),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1});
   registry.register({method,url:path});
  }
  function walk(node){
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['get','post','put','patch','delete','route'].includes(node.expression.name.text)){
    const receiver=node.expression.expression;
    if(ts.isIdentifier(receiver)&&['fastify','app','server'].includes(receiver.text)){
     let urls=[],methods=[node.expression.name.text.toUpperCase()];
     if(node.expression.name.text==='route'&&ts.isObjectLiteralExpression(node.arguments[0])){
      const property=name=>node.arguments[0].properties.find(item=>ts.isPropertyAssignment(item)&&item.name.getText(source).replaceAll(/['"]/g,'')===name)?.initializer;
      urls=literals(property('url'),node).filter(value=>value.startsWith('/'));methods=literals(property('method'),node).map(value=>value.toUpperCase());
     }else urls=literals(node.arguments[0],node).filter(value=>value.startsWith('/'));
     if(!urls.length)unresolved.push({file:relative(root,file),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,expression:node.arguments[0]?.getText(source).slice(0,240)||'',method:node.expression.name.text});
     for(const method of methods)for(const path of urls)record(method,path,node);
    }
   }
   ts.forEachChild(node,walk);
  }
  walk(source);
 }
}
for(const service of readdirSync(resolve(root,'services'),{withFileTypes:true}).filter(item=>item.isDirectory())){
 const directory=resolve(root,'services',service.name,'backend');try{scan(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
}
for(const key of ROUTE_PERMISSIONS.keys()){const i=key.indexOf(' ');registry.register({method:key.slice(0,i),url:key.slice(i+1)});}
const operations=registry.all().map(operation=>({operation_id:operation.id,route:operation.method+' '+operation.path,family:operation.family,label:operation.label,
 permission:operation.permission||null,feature_flags:[...new Set([...(PERMISSION_FEATURES[operation.permission]||[]),...getFeatureKeysForRoute(operation.method,operation.path),...(/^POST \/(?:feedback|issues)\/ai-/.test(operation.method+' '+operation.path)?['hellotest.ai.bug_triage']:[])])],callable:operation.callable,canonical:!operation.policy?.alias_of,alias_of:operation.policy?.alias_of||null,
 exposure:operation.exposure,reason:operation.reason?features.unavailableReason(operation.method,operation.path)||operation.reason:null,has_input_schema:Boolean(operation.input_schema),effect:operation.policy?.effect||null,
 verification:operation.policy?.verification||null,sources:sources.get(operation.method+' '+operation.path)||[]}));
const families=[...new Set(operations.map(operation=>operation.family))].sort().map(family=>{
 const rows=operations.filter(operation=>operation.family===family),callable=rows.filter(operation=>operation.callable&&operation.canonical);
 return {family,canonical_callable:callable.length,reads:callable.filter(operation=>operation.effect==='read').length,
  reviewed_actions:callable.filter(operation=>operation.effect!=='read').length,aliases:rows.filter(operation=>operation.alias_of).length,
  excluded:rows.filter(operation=>!operation.callable).length,permissions:[...new Set(rows.map(operation=>operation.permission).filter(Boolean))].sort()};
});
const failures=[];
const dedicatedTools=[
 {tool:'hellotest_context_build',family:'knowledge',native_operations:['POST /v1/context/retrieve','POST /knowledge/search'],purpose:'Bounded project evidence retrieval with fresh source ACL, source versions, delivery budgets and citations.'},
 {tool:'hellotest_knowledge_fetch',family:'knowledge',native_operations:['GET /knowledge/sources/:id'],purpose:'Fetch an exact immutable indexed fragment and pin its document/version hash.'},
 {tool:'hellotest_graph_schema',family:'knowledge_graph',native_operations:['GET /projects/:project_id/knowledge/graph'],purpose:'Describe supported graph kinds, provenance and traversal limits.'},
 {tool:'hellotest_graph_resolve',family:'knowledge_graph',native_operations:['POST /projects/:project_id/knowledge/graph/resolve'],purpose:'Resolve exact typed current entities, titles and curated aliases without automatic fuzzy merging.'},
 {tool:'hellotest_graph_context',family:'knowledge_graph',native_operations:['POST /projects/:project_id/knowledge/graph/expand'],purpose:'Retrieve bounded relationship witnesses and exact authorized evidence passages.'},
 {tool:'hellotest_graph_trace',family:'knowledge_graph',native_operations:['POST /projects/:project_id/knowledge/graph/expand'],purpose:'Trace witnessed paths between two exact project entities with bounded traversal.'},
 {tool:'hellotest_context_graph_list',family:'context_graph',native_operations:['GET /projects/:project_id/knowledge/context-graph'],purpose:'List owner-private persisted context receipts by trusted application, feature and recording time.'},
 {tool:'hellotest_context_graph_explore',family:'context_graph',native_operations:['POST /projects/:project_id/knowledge/context-graph/explore'],purpose:'Read the recorded task/evidence/decision overlay with fresh source authorization and exact version checks.'}
];
const serverSource=readFileSync(resolve(root,'services/mcp/backend/mcpServer.js'),'utf8');
for(const entry of dedicatedTools){
 if(!serverSource.includes(entry.tool+':'))failures.push(`${entry.tool}: dedicated feature wrapper is missing from the MCP server.`);
 for(const operation of entry.native_operations)if(!sources.has(operation))failures.push(`${entry.tool}: native feature source ${operation} is missing.`);
}
const projections=Object.entries(projectionDefinitions).map(([entity,definition])=>({entity,table:definition.table,database_source:definition.database||'application',permission:definition.permission,fields:definition.fields,fixed_project_scope:true,derived_fields:Object.keys(definition.expressions||{})}));
for(const operation of operations){
 if(operation.callable&&(!operation.permission||!operation.effect))failures.push(`${operation.route}: a callable feature is missing native authority or effect metadata.`);
 if(operation.callable&&operation.effect!=='read'&&!operation.verification)failures.push(`${operation.route}: a callable write is missing an audited result.`);
 if(!operation.callable&&features.policyFor(operation.route.slice(0,operation.route.indexOf(' ')),operation.route.slice(operation.route.indexOf(' ')+1)))failures.push(`${operation.route}: audited adapter is not callable: ${operation.reason}`);
 if(operation.alias_of&&!operations.some(candidate=>candidate.route===operation.alias_of))failures.push(`${operation.route}: canonical alias target is missing.`);
 if(operation.alias_of){const canonical=operations.find(candidate=>candidate.route===operation.alias_of);if(canonical&&(canonical.family!==operation.family||canonical.effect!==operation.effect))failures.push(`${operation.route}: compatibility alias changes its canonical feature or effect.`);}
}
for(const definition of features.policies()){
 if(!sources.has(definition.route))failures.push(`${definition.route}: audited adapter has no matching native source declaration.`);
 if(!ROUTE_PERMISSIONS.has(definition.route))failures.push(`${definition.route}: audited adapter has no native permission.`);
 if(definition.verification?.path&&!operations.some(item=>item.route===`${definition.verification.method||'GET'} ${definition.verification.path}`&&item.callable))failures.push(`${definition.route}: result read-back is unavailable.`);
 for(const related of definition.verification?.relatedReads||[])if(!operations.some(item=>item.route==='GET '+related.path&&item.callable))failures.push(`${definition.route}: child read-back is unavailable.`);
}
for(const projection of projections)if(projection.fields.some(field=>/^(?:password|api_key|token|secret|config|variables|headers|cookies|rows|metadata)$/i.test(field)))failures.push(`${projection.entity}: metadata projection includes a credential, configuration or data-value field.`);
const featureCoverage=FEATURE_DEFINITIONS.map(feature=>{
 const selected=operations.filter(operation=>operation.feature_flags.includes(feature.key));
 const callable=selected.filter(operation=>operation.callable&&operation.canonical);
 const availableProjections=projections.filter(projection=>(PERMISSION_FEATURES[projection.permission]||[]).includes(feature.key)).map(projection=>projection.entity);
 return {key:feature.key,label:feature.label,description:feature.description,owner:featureOwners[feature.key],canonical_callable:callable.length,
  native_operations:selected.length,database_projections:availableProjections,status:callable.length?'callable':availableProjections.length?'metadata_projection':selected.length?'not_delegable':'runtime_or_ui',
  reason:callable.length?null:availableProjections.length?'Scoped metadata is available; native configuration or value-bearing operations remain separately restricted.':selected.length?[...new Set(selected.map(item=>item.reason).filter(Boolean))].join(' '):'This runtime/UI capability has no separately delegable native API.',
  operations:callable.map(operation=>operation.operation_id)};
});
const report={schema_version:1,source:'Native source declarations and the application permission registry; registered runtime availability and current authorization remain authoritative.',
 scanned_backend_sources:scanned,unresolved_route_declarations:unresolved,feature_catalog:featureCoverage,dedicated_tools:dedicatedTools,projections,counts:{native_features:featureCoverage.length,native_operations:operations.length,unresolved_route_declarations:unresolved.length,dedicated_evidence_tools:dedicatedTools.length,metadata_projections:projections.length,canonical_callable:operations.filter(operation=>operation.callable&&operation.canonical).length,
  reads:operations.filter(operation=>operation.callable&&operation.canonical&&operation.effect==='read').length,
  reviewed_actions:operations.filter(operation=>operation.callable&&operation.canonical&&operation.effect!=='read').length,
  aliases:operations.filter(operation=>operation.alias_of).length,unavailable:operations.filter(operation=>!operation.callable).length,families:families.length},families,operations,failures};
{
 const rows=['# HelloTest MCP feature coverage','','This source inventory is generated by `node scripts/checks/mcp-feature-inventory.mjs --markdown`. It describes audited adapters, not deployment status or a grant of authority. Runtime discovery advertises callable operations only; diagnostic inventory retains unavailable routes with exact reasons.','',
 `The audit scans ${scanned} backend source files and reconciles ${operations.length} native operations. It identifies ${report.counts.canonical_callable} canonical callable operations (${report.counts.reads} reads and ${report.counts.reviewed_actions} reviewed actions), plus ${report.counts.aliases} native compatibility aliases.`,
 '', '## Feature families','','| Feature family | Callable reads | Reviewed actions | Compatibility aliases | Unavailable native routes |','| --- | ---: | ---: | ---: | ---: |',
 ...families.map(item=>`| ${item.family} | ${item.reads} | ${item.reviewed_actions} | ${item.aliases} | ${item.excluded} |`),
 '', '## Cross-check against application features','','| Application feature | Owner | Callable operations | Classification |','| --- | --- | ---: | --- |',
 ...featureCoverage.map(item=>`| ${item.label || item.key} (\`${item.key}\`) | ${item.owner} | ${item.canonical_callable}${item.database_projections.length?' + '+item.database_projections.map(name=>'`'+name+'`').join(', ')+' projections':''} | ${item.status}${item.reason?' — '+item.reason.replaceAll('|','/') :''} |`),
 '', '## Bounded database metadata projections','','These fixed projections expose selected authorized columns and project predicates. External clients cannot select arbitrary tables, joins, SQL or credentials. Application and observability records use their authoritative database. Active shared/project integration selectors expose connection identity and model metadata only.','',
 '| Projection | Source | Native permission | Selected fields |','| --- | --- | --- | --- |',...projections.map(item=>`| ${item.entity} | ${item.database_source} | \`${item.permission}\` | ${item.fields.map(field=>'`'+field+'`').join(', ')} |`),
 '', '## Dedicated evidence tools','','These tools wrap native domain services with narrower contracts. They are separate from the generic route catalog and do not turn native graph administration or extraction routes into delegated capabilities.','',
 '| MCP tool | Feature | Contract |','| --- | --- | --- |',...dedicatedTools.map(item=>`| \`${item.tool}\` | ${item.family} | ${item.purpose} |`),
 '', '## Audited callable operations','','| Native operation | Feature | Effect | Authority |','| --- | --- | --- | --- |',
 ...operations.filter(item=>item.callable&&item.canonical).map(item=>`| \`${item.route}\` | ${item.family} | ${item.effect} | \`${item.permission}\` |`),
 ...(unresolved.length?['','## Dynamic declarations requiring runtime resolution','','Source expressions that cannot be expanded from local literal values are recorded explicitly. Runtime registration remains authoritative; these declarations are not silently classified as callable.','','| Source | Method | Expression |','| --- | --- | --- |',...unresolved.map(item=>`| ${item.file}:${item.line} | ${item.method} | \`${item.expression.replaceAll('|','/').replaceAll('`','')}\` |`)]:[]),
 '', '## Explicit exclusions and wrapper gaps','','Authentication, credentials, private transports, unrestricted host access, streaming/binary content and instance-wide management are not automatically delegated by a project-bound MCP credential. A missing typed scope, schema or verified result remains unavailable; adding a route does not create a tool. These are implementation gaps or nondelegable workflows, not successful feature coverage.','',
 '| Native operation | Status | Reason |','| --- | --- | --- |',...operations.filter(item=>!item.callable).map(item=>`| \`${item.route}\` | ${item.exposure} | ${(item.reason||'').replaceAll('|','/')} |`),
 '', '## Verification limits','','Canonical operation IDs, aliases, scope metadata and write verification are checked by the inventory. Fixed project queries and child-reference checks have unit coverage, and the PostgreSQL suite checks real native schemas and representative delegation flows. Static availability does not prove that every provider integration is configured, every generated answer is correct, or every runner/browser is reachable.',''];
 const document=rows.join('\n'),target=resolve(root,'docs/development/mcp-feature-coverage.md');
 if(process.argv.includes('--markdown'))writeFileSync(target,document);
 else if(process.argv.includes('--check')){
  let existing;try{existing=readFileSync(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing!==document)failures.push('Generated MCP feature matrix is stale. Run node scripts/checks/mcp-feature-inventory.mjs --markdown.');
 }
}
console.log(JSON.stringify(process.argv.includes('--check')?{ok:failures.length===0,counts:report.counts,failures}:report,null,2));
if(failures.length)process.exitCode=1;
