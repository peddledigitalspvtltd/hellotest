const { createHash } = require('node:crypto');
const { object, testCaseAiSnapshot } = require('@hellotest/platform/backend/src/utils/aiArtifactContext');
const { normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { collectCaseParameterNames, tokenFor } = require('@hellotest/platform/backend/src/utils/parameterNames');

const MAX_STEPS = 30;
const MAX_CONTEXT_CHARS = 40000;
const PRIVATE_NAME = /password|passwd|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;
const PRIVATE_LITERAL = /\b(?:Bearer|Basic)\s+\S+|-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\bsk-[A-Za-z0-9_-]{16,}|\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*(?!@[tsr]\.)(?!\[private)[^\s,;]+/i;
const fail = (message, code = 'AGENT_CASE_INTENT_INCOMPLETE', statusCode = 422) => Object.assign(new Error(message), { publicMessage:message, code, statusCode });
const selected = ({agentId,featureId,inputs}={}) => Boolean(inputs?.test_case_id && (agentId==='test-improvement'||featureId==='F06'));
const exactText = (value, limit, field, {empty=true}={}) => {
  if(value==null&&empty)return '';
  if(typeof value!=='string'||value.length>limit||(!empty&&!value.trim())||value.includes('\u0000'))throw fail(`The selected case's ${field} cannot be retained completely within the supported authoring contract.`);
  return value;
};
function containsPrivateValue(body, privateValues) {
  const refs=[...body.matchAll(/(?<![A-Za-z0-9_])@(?:(?:t|s|r)\.)?(?:\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi)].map(match=>({start:match.index,end:match.index+match[0].length}));
  for(const raw of privateValues) {
    const variants=new Set([raw,JSON.stringify(raw).slice(1,-1)]);try{variants.add(encodeURIComponent(raw));}catch{/* The original literal still requires protection. */}
    for(const value of variants)for(let offset=body.indexOf(value);offset>=0;offset=body.indexOf(value,offset+1))if(!refs.some(ref=>ref.start<=offset&&ref.end>=offset+value.length))return true;
  }
  return false;
}

function projectCaseIntent(testCase, rawSteps, {includeStoryLinks=false}={}) {
  if(!testCase||typeof testCase.id!=='string'||!Number.isSafeInteger(Number(testCase.revision))||Number(testCase.revision)<1||!Array.isArray(rawSteps))throw fail('The selected case did not return a complete versioned source.');
  if(testCase.automated==='yes'||rawSteps.some(step=>typeof step.automation_code==='string'&&step.automation_code.trim()||Object.keys(object(step.api_request)).length))throw fail('This improvement contract covers manual clauses. The selected case contains executable automation or API payloads that require their dedicated review workflow.','AGENT_CASE_INTENT_UNSUPPORTED');
  const mode=testCase.authoring_mode==='gherkin'?'gherkin':'structured';
  if(mode==='structured'&&rawSteps.length>MAX_STEPS)throw fail('The selected case has more than 30 steps. Split or narrow it before requesting a complete improvement.','AGENT_CASE_INTENT_LIMIT');
  const metadata=testCaseAiSnapshot({...testCase,steps:[],parameter_values:{},test_data_options:{},test_data_set_ids:[]});
  const record={id:testCase.id,display_id:typeof testCase.display_id==='string'?testCase.display_id:testCase.id,
    revision:Number(testCase.revision),title:exactText(testCase.title,255,'title',{empty:false}),
    description:exactText(testCase.description,12000,'description'),priority:metadata.priority,status:metadata.status,
    test_case_type:metadata.test_case_type,authoring_mode:mode,steps:[],gherkin_document:'',parameter_values:{},
    private_parameter_references:[],parameter_references:[],test_data_set_ids:Array.isArray(testCase.test_data_set_ids)?testCase.test_data_set_ids.filter(id=>typeof id==='string'):[]};
  const storyIds=[...new Set(Array.isArray(testCase.requirement_ids)?testCase.requirement_ids:testCase.requirement_id?[testCase.requirement_id]:[])];
  if(includeStoryLinks) {
    if(storyIds.length>16||storyIds.some(id=>typeof id!=='string'||!id.trim()||id.length>255))throw fail('The selected case has Story links outside the complete proposal contract.','AGENT_CASE_INTENT_LIMIT');
    record.requirement_ids=storyIds;
  }
  if(mode==='gherkin') {
    record.gherkin_document=exactText(testCase.gherkin_document,16000,'Gherkin document',{empty:false});
    let delimiter='';
    const structural=record.gherkin_document.split(/\r?\n/).filter(line=>{const marker=line.trim().match(/^("""|```)/)?.[1];if(marker){delimiter=delimiter?delimiter===marker?'':delimiter:marker;return false;}return !delimiter;}).join('\n');
    const count=(structural.match(/^\s*(?:Given|When|Then|And|But|\*)[ \t]+\S/gim)||[]).length;
    if(delimiter||!/^\s*Feature\s*:\s*\S/im.test(structural)||!/^\s*Scenario(?: Outline| Template)?\s*:\s*\S/im.test(structural)||!/^\s*(?:Given|When)\s+\S/im.test(structural)||!/^\s*Then\s+\S/im.test(structural))throw fail('The selected Gherkin document is incomplete or outside the supported authoring format.');
    if(count>MAX_STEPS)throw fail('The selected Gherkin document has more than 30 clauses. Split or narrow it before requesting a complete improvement.','AGENT_CASE_INTENT_LIMIT');
  } else {
    const orders=new Set();
    record.steps=rawSteps.map(step=>{
      if(!step||step.test_case_id!==testCase.id||typeof step.id!=='string'||!Number.isSafeInteger(step.step_order)||step.step_order<1||orders.has(step.step_order))throw fail('The selected case returned an incomplete or ambiguously ordered step list.');
      orders.add(step.step_order);
      return {id:step.id,step_order:step.step_order,step_type:typeof step.step_type==='string'?step.step_type:'manual',
        action:exactText(step.action,4000,'step action'),expected_result:exactText(step.expected_result,4000,'step expected result'),
        ...(typeof step.reusable_group_id==='string'?{reusable_group_id:step.reusable_group_id}:{})};
    }).sort((left,right)=>left.step_order-right.step_order);
  }
  const values=object(testCase.parameter_values),privateNames=new Set();
  const options=object(testCase.test_data_options);
  for(const name of options.private_parameter_names||[])if(typeof name==='string')privateNames.add(normalizeParameterKey(name,'t'));
  const entries=Object.entries(values);
  if(entries.length>40)throw fail('The selected case has more than 40 parameter bindings, exceeding the complete proposal contract.','AGENT_CASE_INTENT_LIMIT');
  for(const [name] of entries)if(PRIVATE_NAME.test(name))privateNames.add(normalizeParameterKey(name,'t'));
  const privateValues=new Set(entries.filter(([name])=>privateNames.has(normalizeParameterKey(name,'t'))||privateNames.has(normalizeParameterKey(name))).map(([,value])=>value).filter(value=>typeof value==='string'&&value));
  for(const [name,value] of entries) {
    const key=normalizeParameterKey(name,'t');
    if(!key||key.length>130||/[\u0000-\u001f\u007f]/.test(key)||Object.hasOwn(record.parameter_values,key))throw fail('The selected case contains ambiguous or unsupported parameter names.');
    if(typeof value!=='string'||value.length>4000)throw fail('The selected case contains parameter values outside the complete proposal contract.');
    if(privateNames.has(key)||privateNames.has(normalizeParameterKey(name))||privateValues.has(value)||PRIVATE_LITERAL.test(value)) {privateNames.add(key);if(value)privateValues.add(value);}
    else Object.defineProperty(record.parameter_values,key,{value,enumerable:true,configurable:true});
  }
  // An alias of a private value is private even when encountered before its source.
  for(const [name,value]of Object.entries(record.parameter_values))if(privateValues.has(value)){delete record.parameter_values[name];privateNames.add(name);}
  record.private_parameter_references=[...privateNames].filter(Boolean).sort().map(tokenFor);
  record.parameter_references=collectCaseParameterNames({title:record.title,authoring_mode:mode,gherkin_document:record.gherkin_document,parameter_values:values},record.steps).sort().map(tokenFor);
  const body=[record.title,record.description,record.gherkin_document,...record.steps.flatMap(step=>[step.action,step.expected_result])].join('\n');
  if(PRIVATE_LITERAL.test(body)||containsPrivateValue(body,privateValues))throw fail('A private value appears literally in the selected case. Replace it with its parameter reference before requesting an improvement.','AGENT_CASE_INTENT_PRIVATE_LITERAL');
  const sourceFingerprint=createHash('sha256').update(JSON.stringify(record)).digest('hex');
  const projection={evidence_type:'authoritative_full_test_case_intent',evidence_permissions:['testcase.view',...(includeStoryLinks?['requirement.view']:[])],source_revision:record.revision,source_fingerprint:sourceFingerprint,
    completeness:{manual_clauses_complete:true,source_step_count:mode==='gherkin'?null:rawSteps.length,omitted_manual_clauses:0,private_values_included:false,dataset_rows_included:false,story_traceability_included:includeStoryLinks,omitted_story_link_count:includeStoryLinks?0:storyIds.length},records:[record],
    limitations:['Private values remain bound in the source case and are supplied only as parameter references. Linked dataset rows and external setup were not read; missing context cannot establish whole-flow or runtime verification.',
      ...(includeStoryLinks?['Story IDs retain the selected case\'s current links; their product content was not read by this case-intent loader.']:['Current Story links are outside this selected evidence scope and are omitted. Their omission does not mean the source case is unlinked; do not claim complete Story traceability or propose removing unseen source links.'])]};
  if(JSON.stringify(projection).length>MAX_CONTEXT_CHARS)throw fail('The complete selected case exceeds the bounded intent context. Narrow or split the case; no partial replacement was prepared.','AGENT_CASE_INTENT_LIMIT');
  return projection;
}

function createAgentCaseIntentEvidenceLoader({db,requireEntityPermission,getTestCase,getTestSteps,hasPermission=async()=>false}) {
  return async input=>{
    if(!selected(input))return null;
    const {inputs,user,projectId,appTypeId}=input;
    return db.transaction(async()=>{
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const scope=await requireEntityPermission({user,permissionCode:'testcase.view',entityType:'test_case',entityId:inputs.test_case_id,projectId,appTypeId,allowDisplayId:true});
      const testCase=await getTestCase(scope.entityId);
      if(testCase.id!==scope.entityId||appTypeId&&testCase.app_type_id!==appTypeId)throw fail('The selected case changed application scope.', 'AGENT_CASE_INTENT_SCOPE',403);
      const steps=await getTestSteps({test_case_id:scope.entityId});
      const includeStoryLinks=input.includeStoryLinks===true&&await hasPermission(user,'requirement.view',projectId);
      const projection=projectCaseIntent(testCase,steps,{includeStoryLinks}),id=`K-case-intent-${createHash('sha256').update(`${projectId}:${testCase.id}`).digest('hex').slice(0,16)}`;
      return {contextItem:{id,title:'Complete selected manual Test Case intent',source_kind:'live_project',content:JSON.stringify(projection),citation:{id,label:'Complete selected manual Test Case intent',source_kind:'live_project'}},evidence_permissions:projection.evidence_permissions};
    })();
  };
}
async function loadAgentCaseIntentEvidence(input) {
  if(!selected(input))return null;
  return createAgentCaseIntentEvidenceLoader({db:require('@hellotest/platform/backend/src/db'),requireEntityPermission:require('@hellotest/platform/backend/services/entityScope.service').requireEntityPermission,
    getTestCase:require('@hellotest/testing/backend/services/testCase.service').getTestCase,getTestSteps:require('@hellotest/testing/backend/services/testStep.service').getTestSteps,hasPermission:require('@hellotest/platform/backend/services/permission.service').hasPermission})(input);
}
module.exports={loadAgentCaseIntentEvidence,createAgentCaseIntentEvidenceLoader,projectCaseIntent,MAX_STEPS,MAX_CONTEXT_CHARS};
