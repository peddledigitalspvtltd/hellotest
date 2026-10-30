const {parse}=require('acorn');
const {normalizeParameterKey,normalizeParameterLayer,resolveParameterLayers}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {materializeParameterValues,materializeDataSetSnapshot,materializeVariableSnapshot,freezeReferencedParameterGenerators,referencedParameterGeneratorTemplates,hasGeneratorTemplate}=require('@hellotest/platform/backend/src/utils/testDataGenerators');
const {composeScopedTestData,normalizeDataOptions}=require('@hellotest/platform/backend/src/utils/scopedTestData');
const {getOptionalEvidenceAccess}=require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const db=require('@hellotest/platform/backend/src/db');
const {canonicalNavigationUrl,navigationParameterNames}=require('./automationNavigationParameters');
const {parameterTemplateParts,hasInvalidParameterTemplate}=require('./automationParameterTemplates');
const TEXT_PARAMETER=/(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const CODE_PARAMETER=/\bparams\s*\[\s*(["'])(?:\\.|[^\\\r\n])*?\1\s*\]/g;
const MASK_PLACEHOLDERS=new Set(['[private parameter reference]','[private parameter value]','[redacted]','[redacted_secret]','[redacted_token]']);
const compositeAssertion=(name,args)=>name==='browser_assert'&&['text','text_contains','text_content','text_content_contains','title','title_normalized'].includes(args?.assertion);
function parameterReference(key){
 const match=/^([tsr])\.(.+)$/i.exec(key);
 if(!match)return null;
 return /^[a-z][a-z0-9_-]*$/i.test(match[2])?`@${key}`:`@${match[1]}.[${match[2].replace(/\\/g,'\\\\').replace(/\]/g,'\\]')}]`;
}
function referenceKey(value){
 if(typeof value!=='string')return null;
 if(/^@(?:(?:t|s|r)\.)?(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i.test(value))return normalizeParameterKey(value,'r');
 if(/^params\s*\[/.test(value))try{const expression=parse(value,{ecmaVersion:'latest'}).body;if(expression.length===1){const node=expression[0].expression;if(node?.type==='MemberExpression'&&node.object?.name==='params'&&node.computed&&node.property?.type==='Literal'&&typeof node.property.value==='string'&&/^@?[tsr]\./i.test(node.property.value))return normalizeParameterKey(node.property.value,'t');}}catch{}
 return null;
}
function referencedParameterNames(steps=[],keyForReference=referenceKey){
 const names=new Set(),pattern=new RegExp(`${CODE_PARAMETER.source}|${TEXT_PARAMETER.source}`,'gi');
 for(const step of steps)for(const source of [step.action,step.expected_result,step.automation_code,JSON.stringify(step.api_request||{})]){
  const text=String(source||'');
  for(const match of text.matchAll(pattern)){
   if(/^@[tsr]$/i.test(match[0])&&text[match.index+match[0].length]==='.')continue;
   const key=keyForReference(match[0]);if(key)names.add(key);
  }
 }
 return [...names].sort();
}
// Mask only authored reference lexemes, using the same grammar as resolution.
// A key may contain natural-language words; those words are data, not clauses.
// Values are neither read nor substituted, and inserted values are never scanned.
function maskParameterReferences(input){
 if(typeof input!=='string')return input;
 const pattern=new RegExp(`${CODE_PARAMETER.source}|${TEXT_PARAMETER.source}`,'gi');
 let output='',offset=0;
 for(const match of input.matchAll(pattern)){
  if(/^@[tsr]$/i.test(match[0])&&input[match.index+match[0].length]==='.')continue;
  if(!referenceKey(match[0]))continue;
  output+=input.slice(offset,match.index)+' '.repeat(match[0].length);offset=match.index+match[0].length;
 }
 return output+input.slice(offset);
}
function createBrowserParameterResolver({caseValues={},suiteValues={},suiteDataSet=null,suiteOptions={},suitePrivateParameterNames=[],suiteSourceSnapshot=null,testSuiteId=null,environment=null,configuration=null,dataSet=null,caseOptions={},testCase={},steps=[],materialize=true,buildParameterValues={},defaultMissingInputs=false,privateParameterNames=[]}={}){
 const now=new Date();
 const caseTemplates=normalizeParameterLayer(caseValues,'t');
 const suiteTemplates=normalizeParameterLayer(suiteValues,'s');
 const reviewedTemplates=normalizeParameterLayer(buildParameterValues,'t');
 const reviewedCaseValues=materialize?materializeParameterValues(reviewedTemplates,now):reviewedTemplates;
 const canonical=value=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
 // Internal optimistic receipt only. Keep template/source values independent
 // of generator materialization, reviewed overrides and synthesized empties.
 const hasSuiteContext=Boolean(testSuiteId||suiteSourceSnapshot||suiteDataSet||Object.keys(suiteTemplates).length||Object.keys(suiteOptions).length);
 const inputSourceKey=JSON.stringify(canonical({caseValues:caseTemplates,caseOptions,environment,configuration,dataSet,...(hasSuiteContext?{suite:{id:testSuiteId,values:suiteTemplates,dataSet:suiteDataSet,options:suiteOptions,source:suiteSourceSnapshot}}:{})}));
 const generatorSource={parameter_values:caseTemplates,test_case_title:testCase.title};
 const frozen=materialize?freezeReferencedParameterGenerators(generatorSource,steps,now):{parameter_values:{...caseTemplates,...referencedParameterGeneratorTemplates(generatorSource,steps)}};
 const caseSnapshot=materialize?materializeParameterValues(frozen.parameter_values,now):frozen.parameter_values;
 const options=normalizeDataOptions(caseOptions,'sections');
 const suiteParameterSnapshot=materialize?materializeParameterValues(suiteTemplates,now):suiteTemplates;
 const composed=composeScopedTestData({hierarchical:true,caseData:dataSet?(materialize?materializeDataSetSnapshot(dataSet,now):dataSet):null,suiteData:suiteDataSet?(materialize?materializeDataSetSnapshot(suiteDataSet,now):suiteDataSet):null,caseOptions:options,suiteOptions});
 const environmentSnapshot=materialize?materializeVariableSnapshot(environment,now):environment,configurationSnapshot=materialize?materializeVariableSnapshot(configuration,now):configuration;
 const values=resolveParameterLayers({caseValues:caseSnapshot,suiteValues:suiteParameterSnapshot,environmentVariables:environmentSnapshot?.variables||[],configurationVariables:configurationSnapshot?.variables||[],dataSet:composed.snapshot,dataPolicy:composed.snapshot?.data_scope_policy||{version:2,case:options,suite:normalizeDataOptions(suiteOptions)}});
 Object.assign(values,reviewedCaseValues);
 const defaultedCaseValues={},unscopedBindings=new Map();
 const bindingKey=input=>{
  const key=referenceKey(input);
  if(!key||!String(input).startsWith('@')||/^@[tsr]\./i.test(input))return key;
  // Legacy @name means the existing run binding when present, otherwise the
  // inherited case input. Explicit scopes never fall through to another scope.
  // Pin the choice before empty defaults can introduce another namespace.
  if(!unscopedBindings.has(key))unscopedBindings.set(key,Object.hasOwn(values,key)?key:Object.hasOwn(values,`t.${key.slice(2)}`)?`t.${key.slice(2)}`:key);
  return unscopedBindings.get(key);
 };
 const parameterNames=source=>referencedParameterNames(source,bindingKey);
 const fillMissing=source=>{
  if(!defaultMissingInputs)return;
  const authored=source.map(step=>({action:step.action,expected_result:step.expected_result,api_request:step.api_request}));
  for(const key of parameterNames(authored))if(!Object.hasOwn(values,key)){values[key]='';defaultedCaseValues[key]='';}
 };
 fillMissing(steps);
 const sensitiveNames=new Set(Object.keys(values).filter(key=>/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i.test(key)));
 for(const name of [...(options.private_parameter_names||[]),...privateParameterNames,...suitePrivateParameterNames]){const key=normalizeParameterKey(name,'t');if(key)sensitiveNames.add(key);}
 for(const row of [...(environmentSnapshot?.variables||[]),...(configurationSnapshot?.variables||[])])if(row.is_secret)sensitiveNames.add(normalizeParameterKey(row.key));
 for(const key of composed.snapshot?.sensitive_names||[])sensitiveNames.add(normalizeParameterKey(key));
 const privateValues=new Set([...sensitiveNames].map(key=>values[key]).filter(value=>value!==undefined&&value!==''));
 // An edited secret must not declassify the source value in linked prose or
 // optional context. Redact all known private source values, including layers
 // shadowed by a reviewed override, without copying them into browser inputs.
 const sourceLayers=[caseTemplates,caseSnapshot,reviewedCaseValues,suiteTemplates,suiteParameterSnapshot,...(suiteSourceSnapshot?.ancestors||[]).map(row=>normalizeParameterLayer(row.parameter_values,'s'))];
 for(const resource of [environment,configuration,environmentSnapshot,configurationSnapshot])sourceLayers.push(normalizeParameterLayer(Object.fromEntries((resource?.variables||[]).map(row=>[row.key,row.value]))));
 for(const layer of Object.values(composed.snapshot?.parameter_data_layers||{}))for(const row of layer?.rows||[])sourceLayers.push(normalizeParameterLayer(row));
 for(const layer of sourceLayers)for(const [key,value]of Object.entries(layer))if(sensitiveNames.has(key)&&value!=='')privateValues.add(value);
 for(const [key,value]of Object.entries(values))if(privateValues.has(value))sensitiveNames.add(key);
 const deferredNames=new Set(Object.keys(values).filter(key=>!materialize&&hasGeneratorTemplate(values[key])));
 // A private value is usable by the model only through its exact scoped
 // binding. A prose mask can otherwise be mistaken for the value to type.
 const promptValues=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,sensitiveNames.has(key)?parameterReference(key):deferredNames.has(key)?'[generated for each build]':value]));
 const privatePatterns=[...privateValues].map(String).filter(Boolean).sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const privateText=(value,{preserveReferences=false}={},sourceReferenceRanges)=>{
  if(!privatePatterns.length)return value;
  const references=sourceReferenceRanges||(preserveReferences?[...value.matchAll(new RegExp(`${CODE_PARAMETER.source}|${TEXT_PARAMETER.source}`,'gi'))]
   .filter(match=>{const key=bindingKey(match[0]);return key&&Object.hasOwn(values,key);})
   .map(match=>({start:match.index,end:match.index+match[0].length})):[]);
  // Match the full literal before considering reference exemptions. Splitting
  // around @tokens would miss a private value spanning several such fragments.
  return value.replace(new RegExp(privatePatterns.join('|'),'g'),(match,offset)=>references.some(reference=>reference.start<=offset&&reference.end>=offset+match.length)?match:'[private parameter value]');
 };
 const projectText=input=>{
  if(input===null||input===undefined)return input;
  const substitute=(token,key)=>Object.hasOwn(values,key)&&!sensitiveNames.has(key)&&!deferredNames.has(key)?String(values[key]??''):token;
  // Resolve once against the frozen map. Inserted values are never scanned
  // again, so an email address or a value containing @text stays literal.
  const source=String(input),references=[];
  let output='',offset=0;
  for(const match of source.matchAll(new RegExp(`${CODE_PARAMETER.source}|${TEXT_PARAMETER.source}`,'gi'))){
   output+=source.slice(offset,match.index);
   const token=match[0],key=bindingKey(token),replacement=key?substitute(token,key):token;
   if(key&&Object.hasOwn(values,key)&&(sensitiveNames.has(key)||deferredNames.has(key)))references.push({start:output.length,end:output.length+token.length});
   output+=replacement;offset=match.index+token.length;
  }
  // Only references retained from the authored source are protected. Tokens
  // inside an inserted value stay literal and never gain binding authority.
  return privateText(output+source.slice(offset),{preserveReferences:true},references);
 };
 // Already projected task text and captured evidence need privacy filtering
 // without resolving any inserted @tokens a second time.
 const projectPrivateText=(input,options)=>input===null||input===undefined?input:privateText(String(input),options);
 const projectSteps=source=>source.map(step=>({...step,action:projectText(step.action),expected_result:projectText(step.expected_result)}));
 const projectManualCases=source=>source.map(item=>({...item,title:projectText(item.title),description:projectText(item.description),gherkin_document:projectText(item.gherkin_document),steps:projectSteps(item.steps||[])}));
 const projectCase=item=>({...item,title:projectText(item.title),description:projectText(item.description),gherkin_document:projectText(item.gherkin_document),preconditions:typeof item.preconditions==='string'?projectText(item.preconditions):item.preconditions,parameter_values:promptValues});
 const publicValues=Object.fromEntries(Object.entries(values).filter(([key])=>!sensitiveNames.has(key)&&!deferredNames.has(key)));
 const generatedCaseValues=materialize?Object.fromEntries(Object.entries(caseSnapshot).filter(([key,value])=>!sensitiveNames.has(key)&&values[key]===value&&(hasGeneratorTemplate(caseTemplates[key])||Object.hasOwn(frozen.parameter_template_values||{},key)))):{};
 const registerStepReferences=sourceSteps=>{
  if(!materialize)return;
  const discovered=freezeReferencedParameterGenerators({parameter_values:values},sourceSteps,now);
  for(const [key,value]of Object.entries(discovered.parameter_values||{})){
   if(Object.hasOwn(values,key)||!Object.hasOwn(discovered.parameter_template_values||{},key))continue;
   values[key]=value;caseSnapshot[key]=value;promptValues[key]=value;publicValues[key]=value;generatedCaseValues[key]=value;
  }
  fillMissing(sourceSteps);
  for(const [key,value]of Object.entries(defaultedCaseValues)){
   if(/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i.test(key))sensitiveNames.add(key);
   promptValues[key]=sensitiveNames.has(key)?parameterReference(key):value;
   if(!sensitiveNames.has(key))publicValues[key]=value;
  }
 };
 const projectBuildContext=context=>{
  const projected={...context,linked_manual_cases:projectManualCases(context.linked_manual_cases||[])};
  if(context.case_metadata)projected.case_metadata=projectCase(context.case_metadata);
  for(const [key,snapshot]of [['environment',environmentSnapshot],['configuration',configurationSnapshot]])if(context[key]&&snapshot)projected[key]={...context[key],variables:(snapshot.variables||[]).map(row=>({...row,value:sensitiveNames.has(normalizeParameterKey(row.key))?parameterReference(normalizeParameterKey(row.key)):String(row.value??'')}))};
  if(composed.snapshot){const rows=composed.snapshot.rows||[];projected.data_set={...(context.data_set||{}),id:composed.snapshot.id,name:composed.snapshot.name,mode:'table',columns:composed.snapshot.columns||[],rows:rows.slice(0,5).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,sensitiveNames.has(normalizeParameterKey(key))?parameterReference(normalizeParameterKey(key)):deferredNames.has(normalizeParameterKey(key))?'[generated for each build]':value]))),row_count:rows.length,sample_only:rows.length>5};}
  if(testSuiteId)projected.test_suite_id=testSuiteId;
  projected.parameter_data={generated_at:now.toISOString(),values:promptValues};
  return projected;
 };
 const resolvedValues=new Map([...privateValues].map(value=>[String(value),true]));
 const redactString=input=>{
  const patterns=new Set();for(const [raw,sensitive]of resolvedValues){let encoded=raw;try{encoded=encodeURIComponent(raw);}catch{}for(const value of new Set([raw,encoded,JSON.stringify(raw).slice(1,-1)])){if(sensitive||value.length>=3)patterns.add(value);else if(input===value)return '[private parameter value]';}}
  if(!patterns.size)return input;const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return input.replace(new RegExp([...patterns].sort((a,b)=>b.length-a.length).map(escape).join('|'),'g'),'[private parameter value]');
 };
 const protocol=new Set(['code','source','action_outcome','assertion_outcome','assertion','retry_safe','verification_status','observation_id','captured_at','mime_type','capture_scope']);
 const redact=value=>typeof value==='string'?redactString(value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,protocol.has(key)?item:redact(item)])):value;
 return {
  promptValues,projectText,projectPrivateText,projectSteps,projectManualCases,projectCase,projectBuildContext,publicParameterValues:publicValues,registerStepReferences,
  inputSourceKey,defaultedCaseValues,reviewedCaseValues,referencedParameterNames:parameterNames,test_suite_id:testSuiteId,
  canonicalArguments(name,args,{navigationActions=[]}={}){
   if(!['browser_fill','browser_select_option','browser_press_key','browser_assert','browser_navigate'].includes(name))return args;
   const field=name==='browser_navigate'?'url':name==='browser_press_key'?'key':'value',key=bindingKey(args?.[field]);
   if(name==='browser_navigate'&&!key){
    const url=canonicalNavigationUrl(args?.url);
    const matches=url?navigationParameterNames(navigationActions,parameterNames).filter(name=>!sensitiveNames.has(name)&&Object.hasOwn(values,name)&&canonicalNavigationUrl(values[name])===url):[];
    return matches.length===1?{...args,url:parameterReference(matches[0])}:args;
   }
   return key?{...args,[field]:parameterReference(key)}:args;
  },
  deferredParameterNames:[...deferredNames].sort(),privateParameterNames:[...sensitiveNames].sort(),
  buildData({testCaseId,steps:sourceSteps=[],manualCases=[]}){
   const referenced=parameterNames([...sourceSteps,...manualCases.flatMap(item=>item.steps||[])]);
   return {schema_version:1,kind:'automation_build_data',test_case_id:testCaseId,created_at:now.toISOString(),verification_status:'unverified',steps:projectSteps(sourceSteps).map(step=>({step_id:step.id,action:step.action||'',expected_result:step.expected_result||''})),manual_steps:projectManualCases(manualCases).flatMap(item=>(item.steps||[]).map(step=>({manual_test_case_id:item.id,manual_step_id:step.id,action:step.action||'',expected_result:step.expected_result||''}))),parameter_values:{...publicValues},parameter_references:[...new Set([...Object.keys(values),...referenced])].sort(),bound_parameter_references:Object.keys(values).sort(),unscoped_parameter_bindings:Object.fromEntries(unscopedBindings),missing_parameter_references:referenced.filter(key=>!Object.hasOwn(values,key)),defaulted_parameter_references:Object.keys(defaultedCaseValues).sort(),deferred_parameter_references:[...deferredNames].sort(),private_parameter_references:[...sensitiveNames].sort()};
  },
  // Public generated defaults can be saved atomically with a successful build.
  // Private values remain scoped to this resolver and never enter raw case data.
  generatedCaseValues,
  // Availability is derived after the same authorized precedence/generator
  // handling as browser input. It can be shared with the model without values.
  get availableParameterNames(){return Object.keys(values).sort();},
  get emptyParameterNames(){return Object.keys(values).filter(key=>values[key]==='').sort();},
  // An empty secret is safe to embed and must replay as the reviewed blank,
  // rather than become a missing external parameter in a standalone script.
  get exportParameterValues(){return {...publicValues,...Object.fromEntries(Object.entries(values).filter(([,value])=>value===''))};},
  requiresDataAccess(name,args){return ['browser_fill','browser_select_option','browser_press_key','browser_assert','browser_navigate'].includes(name)&&Boolean(bindingKey(args?.[name==='browser_navigate'?'url':name==='browser_press_key'?'key':'value'])||(compositeAssertion(name,args)&&parameterTemplateParts(args?.value)));},
  resolve(name,args){
   if(!['browser_fill','browser_select_option','browser_press_key','browser_assert','browser_navigate'].includes(name))return args;
   const field=name==='browser_navigate'?'url':name==='browser_press_key'?'key':'value',input=args?.[field],key=bindingKey(input);
   if(!key&&compositeAssertion(name,args)){
    if(hasInvalidParameterTemplate(input))throw Object.assign(new Error('The assertion contains an invalid scoped parameter reference.'),{code:'AUTOMATION_PARAMETER_INVALID',statusCode:422,nonRetryable:true});
    const parts=parameterTemplateParts(input);
    if(parts){
     let resolved='';
     for(const part of parts){
      if(!part.key){resolved+=part.literal;continue;}
      if(!Object.hasOwn(values,part.key))throw Object.assign(new Error(`The configured test parameter @${part.key} is unavailable. Supply its value before browser interaction.`),{code:'AUTOMATION_PARAMETER_MISSING',parameter_reference:part.key,statusCode:422,nonRetryable:true});
      const value=String(values[part.key]??'');resolved+=value;if(value)resolvedValues.set(value,resolvedValues.get(value)||sensitiveNames.has(part.key));
     }
     if(resolved.length>2000)throw Object.assign(new Error('The configured assertion template exceeds the browser input limit.'),{code:'AUTOMATION_PARAMETER_INVALID',statusCode:422,nonRetryable:true});
     return {...args,[field]:resolved};
    }
   }
   if(!key){
    const mask=typeof input==='string'&&MASK_PLACEHOLDERS.has(input.trim().toLowerCase());
    if(mask&&[...sensitiveNames].some(name=>Object.hasOwn(values,name))&&!Object.values(values).some(value=>String(value??'')===input)){
     throw Object.assign(new Error('The supplied value is a privacy mask, not configured test data. Use the exact private parameter reference from parameter_data.values; the host resolves it before browser interaction.'),{
      code:'AUTOMATION_PARAMETER_REFERENCE_REQUIRED',statusCode:422,nonRetryable:false,retryable:true,retry_safe:true,action_outcome:'not_attempted',
      parameter_references:[...sensitiveNames].filter(name=>Object.hasOwn(values,name)).slice(0,40).map(parameterReference)
     });
    }
    return args;
   }
   if(!Object.hasOwn(values,key))throw Object.assign(new Error(`The configured test parameter @${key} is unavailable. Supply its value before browser interaction.`),{code:'AUTOMATION_PARAMETER_MISSING',parameter_reference:key,statusCode:422,nonRetryable:true});
   const value=String(values[key]??'');if(value.length>2000)throw Object.assign(new Error(`The configured test parameter @${key} exceeds the browser input limit.`),{code:'AUTOMATION_PARAMETER_INVALID',statusCode:422,nonRetryable:true});
   if(name==='browser_navigate'&&!canonicalNavigationUrl(value))throw Object.assign(new Error(`The configured navigation parameter @${key} must contain an absolute HTTP(S) URL without credentials.`),{code:'AUTOMATION_PARAMETER_INVALID',statusCode:422,nonRetryable:true});
   if(value)resolvedValues.set(value,resolvedValues.get(value)||sensitiveNames.has(key));
   return {...args,[field]:value};
  },
  redactResult(result){return {...result,content:(result.content||[]).map(item=>{if(item.type!=='text'||typeof item.text!=='string')return item;try{
   const original=JSON.parse(item.text),projected=redact(original);
   if(Array.isArray(original?.elements)&&Array.isArray(projected?.elements))for(let index=0;index<original.elements.length;index++){
    const before=original.elements[index],after=projected.elements[index];
    if(after&&typeof before?.record_scoped_locator==='string'&&(after.record_scoped_locator!==before.record_scoped_locator
      ||!Array.isArray(after.locator_candidates)||!after.locator_candidates.includes(after.record_scoped_locator)))delete after.record_scoped_locator;
   }
   return {...item,text:JSON.stringify(projected)};
  }catch{return {...item,text:redactString(item.text)};}})};},
  redactError(error){const seen=new Set();let current=error;while(current&&typeof current==='object'&&!seen.has(current)){seen.add(current);current.message=redactString(String(current.message||'Browser tool failed'));if(typeof current.stack==='string')current.stack=redactString(current.stack);current=current.cause;}return error;}
 };
}
async function loadBrowserParameterResolver({testCase,projectId,userId,caseValues,steps=[],test_environment_id,test_configuration_id,test_data_set_id,test_suite_id,allowUnselectedSuite=false,materialize=true,buildParameterValues={},defaultMissingInputs=false,privateParameterNames=[],parameterOverrides=[],lock=false}){
 const selected=[['test_environments',test_environment_id,'environment.view'],['test_configurations',test_configuration_id,'configuration.view'],['test_data_sets',test_data_set_id,'data.view']];
 const permissions=['data.view','testcase.view','suite.view',...selected.filter(([,id])=>id).map(([, ,permission])=>permission)];
 const access=await getOptionalEvidenceAccess({id:userId},projectId,permissions);
 const requiredPermissions=[...new Set(selected.filter(([,id])=>id).map(([, ,permission])=>permission))];
 for(const permission of requiredPermissions)if(!access[permission])throw Object.assign(new Error('Selected browser test data is no longer accessible.'),{statusCode:403});
 if(!access['data.view']){
  if(test_suite_id)throw Object.assign(new Error('Test data access is required to use selected suite inputs.'),{statusCode:403,code:'AUTOMATION_BUILD_DATA_ACCESS_REQUIRED',nonRetryable:true,failure_stage:'context',automation_stage:'context',generation_provider_requests:0,browser_actions:0});
  if(Object.keys(buildParameterValues||{}).length)throw Object.assign(new Error('Test data access is required to set automation build inputs.'),{statusCode:403});
  return Object.assign(createBrowserParameterResolver({materialize:false}),{required_permissions:requiredPermissions});
 }
 const suite=await require('./automationBuildSuiteContext').loadAutomationBuildSuiteContext({testCase,projectId,testSuiteId:test_suite_id,hasSuiteAccess:access['suite.view']===true,allowUnselectedSuite,lock,database:db});
 if(suite.test_suite_id&&!requiredPermissions.includes('suite.view'))requiredPermissions.push('suite.view');
 if(!selected[2][1]&&testCase.automated==='yes'){
  const [linked]=await require('@hellotest/testing/backend/services/effectiveCaseDataSets.service').loadEffectiveCaseDataSets({
   testCaseIds:[testCase.id],projectId,appTypeId:testCase.app_type_id,includeLinkedManual:access['testcase.view']===true,lock,database:db
  });
  if(linked?.mapping_source==='linked_manual'&&!requiredPermissions.includes('testcase.view'))requiredPermissions.push('testcase.view');
  if(linked){selected[2][1]=linked.test_data_set_id;if(!requiredPermissions.includes('data.view'))requiredPermissions.push('data.view');}
 }
 const resources=[];
 for(const [table,id,permission]of selected){
  if(!id){resources.push(null);continue;}
  if(!access[permission])throw Object.assign(new Error('Selected browser test data is no longer accessible.'),{statusCode:403});
  const resource=await db.prepare(`SELECT * FROM ${table} WHERE id=? AND project_id=? AND (app_type_id IS NULL OR app_type_id=?)${lock?' FOR SHARE':''}`).get(id,projectId,testCase.app_type_id);
  if(!resource)throw Object.assign(new Error('Selected browser test data is unavailable in this application.'),{statusCode:404});
  resources.push(resource);
 }
 const caseOptions=normalizeDataOptions(testCase.test_data_options||{},'sections');
 caseOptions.parameter_overrides=[...new Set([...(caseOptions.parameter_overrides||[]),...parameterOverrides])];
 return Object.assign(createBrowserParameterResolver({caseValues,suiteValues:suite.parameters,suiteDataSet:suite.dataSet,suiteOptions:suite.dataOptions,suitePrivateParameterNames:suite.private_parameter_names,suiteSourceSnapshot:suite.source_snapshot,testSuiteId:suite.test_suite_id,environment:resources[0],configuration:resources[1],dataSet:resources[2],caseOptions,testCase,steps,materialize,buildParameterValues,defaultMissingInputs,privateParameterNames}),{required_permissions:requiredPermissions,suite_selection_required:suite.suite_selection_required});
}
module.exports={referenceKey,parameterReference,referencedParameterNames,maskParameterReferences,createBrowserParameterResolver,loadBrowserParameterResolver};
