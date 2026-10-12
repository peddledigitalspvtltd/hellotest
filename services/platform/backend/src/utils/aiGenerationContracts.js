// These schemas describe code-owned application fields and allowed values.
// Behavioral guidance belongs to AI Controls; labels are serialized as data.
const string={type:'string'};
const parameters={type:'object',additionalProperties:string};
const step={type:'object',required:['action','expected_result'],properties:{step_order:{type:'integer',minimum:1},step_type:{enum:['web','api','android','ios']},action:{type:'string',minLength:1},expected_result:{type:'string',minLength:1}}};
function caseOutputSchema(mode='structured',{count,refs}={}) {
  const properties={title:{type:'string',minLength:1,maxLength:255},description:string,authoring_mode:{enum:[mode]},parameter_values:parameters,steps:{type:'array',minItems:mode==='gherkin'?0:1,maxItems:30,items:step},gherkin_document:mode==='gherkin'?{type:'string',minLength:1}:{type:['string','null']}};
  if(count!=null) {
    properties.priority={type:'integer',minimum:1,maximum:5};
    properties.requirement_refs={type:'array',minItems:refs?.length ? 1 : 0,maxItems:refs?.length || 0,items:refs?.length ? {type:'string',enum:refs} : {type:'string'}};
    return {type:'object',required:['testCases'],properties:{applicable_domain:string,testCases:{type:'array',minItems:1,maxItems:count,items:{type:'object',required:['title','requirement_refs',mode==='gherkin'?'gherkin_document':'steps'],properties}}}};
  }
  properties.summary=string;
  return {type:'object',required:['title',mode==='gherkin'?'gherkin_document':'steps'],properties};
}
function stepOutputSchema() {return {type:'object',required:['action','expected_result'],properties:{summary:string,action:{type:'string',minLength:1},expected_result:{type:'string',minLength:1}}};}
module.exports={caseOutputSchema,stepOutputSchema};
