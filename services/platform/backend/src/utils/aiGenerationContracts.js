// These schemas describe code-owned application fields and allowed values.
// Behavioral guidance belongs to AI Controls; labels are serialized as data.
const string={type:'string'};
const parameters={type:'object',additionalProperties:string};
const step={type:'object',required:['action','expected_result'],properties:{step_order:{type:'integer',minimum:1},step_type:{enum:['web','api','android','ios']},action:{type:'string',minLength:1},expected_result:{type:'string',minLength:1}}};
function caseOutputSchema(mode='structured',{count,refs,testCaseTypes}={}) {
  const properties={title:{type:'string',minLength:1,maxLength:255},description:{type:'string',minLength:1},priority:{type:'integer',minimum:1,maximum:5},test_case_type:testCaseTypes?.length?{enum:testCaseTypes}:{type:'string',minLength:1},authoring_mode:{enum:[mode]},parameter_values:parameters,steps:{type:'array',minItems:mode==='gherkin'?0:1,maxItems:30,items:step},gherkin_document:mode==='gherkin'?{type:'string',minLength:1}:{type:['string','null']}};
  const required=['title','description','priority','test_case_type','parameter_values',mode==='gherkin'?'gherkin_document':'steps'];
  if(count!=null) {
    properties.priority={type:'integer',minimum:1,maximum:5};
    properties.requirement_refs={type:'array',minItems:refs?.length ? 1 : 0,maxItems:refs?.length || 0,items:refs?.length ? {type:'string',enum:refs} : {type:'string'}};
    return {type:'object',required:['testCases'],properties:{applicable_domain:string,testCases:{type:'array',minItems:1,maxItems:count,items:{type:'object',required:[...required,'requirement_refs'],properties}}}};
  }
  properties.summary=string;
  return {type:'object',required,properties};
}
function stepOutputSchema() {return {type:'object',required:['action','expected_result'],properties:{summary:string,action:{type:'string',minLength:1},expected_result:{type:'string',minLength:1}}};}
const nativeContracts = Object.freeze({
  'ai.requirement.creation': { collection: 'requirements', required: ['title','description','acceptance_criteria','priority'] },
  'ai.requirement.optimization': { required: ['title','description','acceptance_criteria','priority'] },
  'ai.case_authoring.full_case': { required: ['title','description','priority','test_case_type','parameter_values'] },
  'ai.test_case.design': { collection: 'testCases', aliases: ['test_cases'], required: ['title','description','priority','test_case_type','parameter_values'] },
  'ai.bug.draft': { object: 'draft', required: ['title','message','steps_to_reproduce','expected_result','actual_result','severity','priority'] },
  'ai.bug.triage': { collection: 'recommendations', required: ['issue_id','category','category_explanation','category_evidence_refs'] },
  'ai.execution.smart_plan': { collection: 'cases', required: ['test_case_id','reason','evidence_refs'] }
});
function nativeArtifactContract(id) { return nativeContracts[id] || null; }
function validateNativeArtifactOutput(id, parsed, {testCaseTypes}={}) {
  const contract = nativeArtifactContract(id);
  if (!contract) return;
  const errors=[];
  const missing = (path, field) => errors.push({ path, field, issue: 'required_or_invalid' });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) missing('', 'object');
  let items = contract.collection ? [contract.collection,...(contract.aliases||[])].map(key=>parsed?.[key]).find(Array.isArray) : [contract.object ? parsed?.[contract.object] : parsed];
  if (!items?.length) { missing('',contract.collection || contract.object || 'object'); items=[]; }
  if(items.length>30)throw Object.assign(new Error('The model returned too many artifact items. Request a smaller scope.'),{code:'AI_NATIVE_CONTRACT_INVALID',statusCode:502,validation_errors:[{path:contract.collection||'',field:'max_items',issue:'maximum_30'}]});
  for (const [index,item] of items.entries()) {
    const path=contract.collection ? `${contract.collection}[${index}]` : contract.object || '';
    for (const field of contract.required) if (!item || !Object.hasOwn(item,field)) missing(path,field);
    if (!item || typeof item!=='object') continue;
    for (const field of contract.required.filter(field=>!['priority','acceptance_criteria','parameter_values','category_evidence_refs','evidence_refs'].includes(field))) if(typeof item[field]!=='string' || (!['steps_to_reproduce','expected_result','actual_result','message'].includes(field)&&!item[field].trim())) missing(path,field);
    if ('acceptance_criteria' in item && (!Array.isArray(item.acceptance_criteria)||item.acceptance_criteria.some(value=>typeof value!=='string'||!value.trim())||(!item.acceptance_criteria.length&&!(Array.isArray(item.open_questions)&&item.open_questions.some(value=>typeof value==='string'&&value.trim()))))) missing(path,'acceptance_criteria');
    if (['ai.requirement.creation','ai.requirement.optimization','ai.case_authoring.full_case','ai.test_case.design'].includes(id) && (!Number.isSafeInteger(item.priority)||item.priority<1||item.priority>5)) missing(path,'priority');
    if ('parameter_values' in item && (!item.parameter_values || typeof item.parameter_values!=='object'||Array.isArray(item.parameter_values)||Object.entries(item.parameter_values).some(([key,value])=>!key.trim()||/^@|^[tsr]\./i.test(key)||typeof value!=='string'))) missing(path,'parameter_values');
    if (['ai.case_authoring.full_case','ai.test_case.design'].includes(id)) {
      if(Array.isArray(testCaseTypes)&&!testCaseTypes.includes(item.test_case_type))missing(path,'test_case_type');
      if(item.authoring_mode==='gherkin'||item.gherkin_document){if(typeof item.gherkin_document!=='string'||!/^\s*Feature\s*:/im.test(item.gherkin_document)||!/^\s*Scenario(?: Outline)?\s*:/im.test(item.gherkin_document)||!/^\s*Then\b/im.test(item.gherkin_document))missing(path,'gherkin_document');}
      else if(!Array.isArray(item.steps)||!item.steps.length||item.steps.length>30||item.steps.some(step=>!step||typeof step.action!=='string'||!step.action.trim()||typeof step.expected_result!=='string'||!step.expected_result.trim()||(step.step_type!=null&&!['web','api','android','ios'].includes(step.step_type))))missing(path,'steps');
    }
    if (id==='ai.bug.draft') {
      if (!['critical','high','medium','low'].includes(item.severity)) missing(path,'severity');
      if (!['Highest','High','Medium','Low','Lowest'].includes(item.priority)) missing(path,'priority');
      for (const field of ['message','steps_to_reproduce','expected_result','actual_result']) if (!String(item[field]||'').trim() && !(Array.isArray(parsed.gaps)&&parsed.gaps.some(gap=>gap?.field===field&&typeof gap.reason==='string'&&gap.reason.trim()))) missing(path,field);
    }
    for (const field of ['category_evidence_refs','evidence_refs'].filter(field=>contract.required.includes(field))) if(!Array.isArray(item[field])||!item[field].length||item[field].some(value=>typeof value!=='string'||!value.trim())) missing(path,field);
  }
  if(errors.length)throw Object.assign(new Error('The model omitted or invalidated required artifact fields. No incomplete proposal was accepted.'),{code:'AI_NATIVE_CONTRACT_INVALID',statusCode:502,validation_errors:errors.slice(0,12)});
}
module.exports={caseOutputSchema,stepOutputSchema,nativeArtifactContract,validateNativeArtifactOutput};
