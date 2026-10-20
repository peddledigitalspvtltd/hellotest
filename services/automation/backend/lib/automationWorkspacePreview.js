const {parse}=require('acorn');
const PREVIEW_MIME='application/vnd.hellotest.automation-section-preview+json';
const EVIDENCE_MIME='application/vnd.hellotest.automation-browser-evidence+json';
const MAX_ARTIFACT_BYTES=256*1024;
const {collectCaseParameterNames,tokenFor}=require('@hellotest/platform/backend/src/utils/parameterNames');
const {normalizeParameterKey}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {createGenerationManifest}=require('./automationGenerationManifest');
const {recordedLocatorSource}=require('./automationRecordedProgram');
const text=(value,max=2000)=>typeof value==='string'?value.slice(0,max):'';
function publicUrl(value){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return undefined;return url.origin+url.pathname;}catch{return undefined;}}
const ast=source=>parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});
const root=node=>node?.type==='Identifier'?node.name:node?.type==='CallExpression'?root(node.callee):node?.type==='MemberExpression'?root(node.object):null;
function bounded(value,depth=0){if(typeof value==='string')return value.slice(0,2000);if(value==null||typeof value==='boolean'||typeof value==='number')return value;if(depth>=4)return undefined;if(Array.isArray(value))return value.slice(0,20).map(item=>bounded(item,depth+1));if(typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,30).map(([key,item])=>[key,bounded(item,depth+1)]));return undefined;}
function safeElement(row){
 const clean={};for(const key of ['role','name','label','text','tag','type','placeholder','test_id','locator','locator_candidates','visible','displayed','in_viewport','disabled','checked','options','locators_validated','truncated_attributes','label_truncated','text_truncated','options_truncated'])if(row?.[key]!==undefined)clean[key]=bounded(row[key]);
 if(row?.attributes&&typeof row.attributes==='object')clean.attributes=Object.fromEntries(Object.entries(row.attributes).filter(([key])=>['id','name','role','aria-label','aria-labelledby','aria-describedby','aria-errormessage','aria-invalid','placeholder','data-testid','type','title','alt','autocomplete'].includes(key)).map(([key,value])=>[key,text(value,1000)]));
 return clean;
}
function signature(node){
 if(!node||typeof node!=='object')return node;
 if(node.type==='MemberExpression'&&!node.computed&&['page','playwrightPage'].includes(node.object?.name))return {type:'Identifier',name:node.property.name};
 if(node.type==='Literal')return {type:'Literal',value:node.value,regex:node.regex};
 const result={};for(const key of Object.keys(node).sort())if(!['start','end','raw'].includes(key)){const value=node[key];result[key]=Array.isArray(value)?value.map(signature):value&&typeof value==='object'?signature(value):value;}
 if(node.type==='ObjectExpression')result.properties.sort((a,b)=>JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));
 return result;
}
function sourceReferences(source){
 const literals=new Set(),calls=new Set(),parameters=new Set();
 try{const visit=node=>{if(!node||typeof node!=='object')return;
  if(node.type==='CallExpression'){
   if(['page','playwrightPage'].includes(root(node)))calls.add(JSON.stringify(signature(node)));
   const owner=node.callee?.object?.name,method=node.callee?.property?.name;
   if(['page','playwrightPage','web','android','ios','mobile'].includes(owner)&&/^(?:locator|click|dblclick|fill|type|tap|hover|check|uncheck|press|selectOption|waitForSelector|waitFor|assert\w*|capture\w*)$/.test(method||'')&&typeof node.arguments[0]?.value==='string')literals.add(node.arguments[0].value);
  }
  if(node.type==='MemberExpression'&&node.object?.name==='params'&&node.computed&&typeof node.property?.value==='string'&&/^@?[tsr]\./i.test(node.property.value))parameters.add(normalizeParameterKey(node.property.value));for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);};visit(ast(source));}catch{}
 return {literals,calls,parameters};
}
/** Only grounded, actually referenced repository objects are included. Never broaden by a field name alone. */
function sectionPreview({testCaseId,step,update,attempt,manualCoverage=[],manualSpecification=[],generationProvenance,recordedContract,repositoryRows=[],confirmedRepositoryIds=[],evidence,modelCallIds=[],modelCallScope='case_attempt',createdAt=new Date().toISOString()}){
 const source=update.automation_code||'',request=update.api_request||null,{literals,calls,parameters}=sourceReferences(source);
 const references=[],folded=new Set([...literals].map(value=>value.toLowerCase())),confirmedIds=new Set(confirmedRepositoryIds),routeScopedKeys=new Set();
 const names=row=>{const screen=text(row.metadata?.screen_name||row.page_key),raw=text(row.metadata?.object_name||row.locator_intent),field=raw.toLowerCase().startsWith(screen.toLowerCase()+'.')?raw.slice(screen.length+1):raw;return screen&&field?`${screen}.${field}`:'';};
 const canonicalOwners=new Map(repositoryRows.filter(row=>!row.metadata?.merged_into_entry_id&&row.locator_intent!=='__screen__'&&row.metadata?.record_kind!=='screen').map(row=>[names(row).toLowerCase(),row.id]));
 for(const row of repositoryRows){
  const meta=row.metadata||{};if(meta.merged_into_entry_id||meta.record_kind==='screen'||row.locator_intent==='__screen__')continue;
  const reference=names(row);
  const aliases=[reference,...(Array.isArray(meta.reference_aliases)?meta.reference_aliases:[])];
  const locator=text(row.locator,10000);
  let semanticMatch=false,locatorKey=locator;
  try{const expression=ast(recordedLocatorSource(locator)||locator).body[0]?.expression;if(expression?.type==='CallExpression'&&(['page','playwrightPage'].includes(root(expression))||/^getBy(?:Role|Label|Text|TestId|Placeholder|Title|AltText)$/.test(root(expression)||''))){locatorKey=JSON.stringify(signature(expression));semanticMatch=calls.has(locatorKey);}}catch{}
  if(/^[a-f0-9]{64}$/.test(meta.observed_route_sha256||''))routeScopedKeys.add(locatorKey);
  const explicit=aliases.some(value=>typeof value==='string'&&folded.has(value.toLowerCase())&&(!canonicalOwners.has(value.toLowerCase())||canonicalOwners.get(value.toLowerCase())===row.id));
  if(reference&&(explicit||locator&&(literals.has(locator)||semanticMatch)))references.push({reference,entry_id:row.id,...(locator?{locator}:{}),_explicit:explicit,_confirmed:confirmedIds.has(row.id),_locatorKey:locatorKey});
 }
 const grounded=references.filter(row=>row._explicit||row._confirmed||!routeScopedKeys.has(row._locatorKey)&&!references.some(other=>other._locatorKey===row._locatorKey&&other._confirmed)&&references.filter(other=>other._locatorKey===row._locatorKey).length===1).map(({_explicit,_confirmed,_locatorKey,...row})=>row);
 for(const value of collectCaseParameterNames({},[{automation_code:source,api_request:request}]))parameters.add(value);
 const callIds=[...new Set((Array.isArray(modelCallIds)?modelCallIds:[]).filter(value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value)))].slice(0,20);
 const generationManifest=createGenerationManifest({testCaseId,step,update,manualCoverage,manualSpecification,generationProvenance,recordedContract});
 return {schema_version:1,kind:'section_preview',test_case_id:testCaseId,step_id:step.id,step_order:step.step_order,step_type:update.step_type||step.step_type||'web',action:step.action||'',expected_result:step.expected_result||'',automation_code:source||null,api_request:request,generation_manifest:generationManifest,object_references:grounded.slice(0,200),parameter_references:[...parameters].filter(Boolean).map(tokenFor).slice(0,200),manual_coverage:manualCoverage.filter(row=>row.section_step_id===step.id).map(row=>({...row})),...(evidence?{evidence:{...evidence,association:'generation_phase'}}:{}),...(callIds.length?{model_call_ids:callIds,model_call_scope:modelCallScope==='section_attempt'?'section_attempt':'case_attempt'}:{}),created_at:createdAt,attempt,validation_status:'validated',save_status:'draft',verification_status:'unverified'};
}
function browserEvidence({observation,testCaseId,attempt,active_step_id,active_manual_step_ids=[],interactionMode,observedAt=new Date().toISOString()}){
 if(observation.result?.isError)return null;
 const blocks=(observation.result?.content||[]).filter(item=>item.type==='text'&&typeof item.text==='string');
 let payload={};for(const block of blocks)try{const value=JSON.parse(block.text);if(value&&typeof value==='object'&&!Array.isArray(value))payload={...payload,...value};}catch{if(observation.tool==='browser_snapshot')payload.accessibility=text(block.text,96000);}
 const image=(observation.result?.content||[]).find(item=>item.type==='image'&&['image/jpeg','image/png'].includes(item.mimeType)&&typeof item.data==='string'&&item.data.length<=196608);
 const hasSnapshot=observation.tool==='browser_snapshot'&&(typeof payload.accessibility==='string'||Array.isArray(payload.elements));
 if(!hasSnapshot&&!image)return null;
 const evidence={schema_version:1,kind:'browser_evidence',test_case_id:testCaseId,attempt,tool:observation.tool,source:'playwright',observation_id:text(payload.observation_id,200)||undefined,observed_at:typeof payload.captured_at==='string'&&Number.isFinite(Date.parse(payload.captured_at))?payload.captured_at:observation.observed_at||observedAt,url:publicUrl(payload.url),title:text(payload.title,500)||undefined,interaction_mode:interactionMode,verification_status:'unverified',...(hasSnapshot?{scope:bounded(payload.scope),accessibility:text(payload.accessibility,96000),elements:Array.isArray(payload.elements)?payload.elements.slice(0,120).map(safeElement):[],partial:payload.partial===true,truncated:payload.truncated===true||String(payload.accessibility||'').length>96000||(payload.elements?.length||0)>120,accessibility_truncated:payload.accessibility_truncated===true||String(payload.accessibility||'').length>96000,elements_truncated:payload.elements_truncated===true||(payload.elements?.length||0)>120,fields_truncated:payload.fields_truncated===true,warnings:Array.isArray(payload.warnings)?payload.warnings.slice(0,20).map(value=>text(value,500)):[],limits:payload.limits&&typeof payload.limits==='object'?bounded(payload.limits):undefined}:{})};
 if(typeof active_step_id==='string'&&active_step_id.length<=200)evidence.active_step_id=active_step_id;
 const activeManualIds=[...new Set((Array.isArray(active_manual_step_ids)?active_manual_step_ids:[]).filter(id=>typeof id==='string'&&id.length>0&&id.length<=200))].slice(0,500);
 if(activeManualIds.length)evidence.active_manual_step_ids=activeManualIds;
 return {evidence,hasSnapshot,image};
}
function artifactJson(payload){const content=JSON.stringify(payload);if(Buffer.byteLength(content,'utf8')>MAX_ARTIFACT_BYTES)throw new Error('Automation workspace artifact exceeded its bounded size.');return content;}
function readArtifact(artifact,transaction,mime,kind){
 const invalid=()=>Object.assign(new Error('Automation workspace evidence is unavailable for this activity.'),{statusCode:404});
 if(!artifact||artifact.transaction_id!==transaction.id||artifact.mime_type!==mime||typeof artifact.content!=='string'||Buffer.byteLength(artifact.content,'utf8')>MAX_ARTIFACT_BYTES)throw invalid();
 let value;try{value=JSON.parse(artifact.content);}catch{throw invalid();}
 const caseIds=[...(transaction.metadata?.input_test_case_ids||[]),...(transaction.metadata?.output_test_case_ids||[]),transaction.metadata?.test_case_id,...(transaction.metadata?.step_progress||[]).map(row=>row.test_case_id)];
 if(value?.schema_version!==1||value.kind!==kind||typeof value.test_case_id!=='string'||!caseIds.includes(value.test_case_id)||value.verification_status!=='unverified'||kind==='section_preview'&&(typeof value.step_id!=='string'||!(transaction.metadata?.step_progress||[]).some(row=>row.test_case_id===value.test_case_id&&row.step_id===value.step_id&&row.preview_artifact_id===artifact.id)||value.validation_status!=='validated'||value.save_status!=='draft'))throw invalid();
 return value;
}
module.exports={PREVIEW_MIME,EVIDENCE_MIME,MAX_ARTIFACT_BYTES,publicUrl,sectionPreview,browserEvidence,artifactJson,readArtifact};
