const configuration=require('./aiConfiguration.service');
const {composeMessages}=require('../src/utils/aiFeatureRuntime');
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,code:'AI_PREVIEW_INVALID'});
async function preview(id,input={}) {
 const item=configuration.adminDefinition(id);
 if(item.transport!=='chat'||item.runtime_status==='reserved')throw fail('This profile does not generate a chat request.',422);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['config','user_request','authoring_mode','reduced_context'].includes(key)))throw fail('Provide supported request inspection fields.');
 if(typeof input.user_request!=='string'||input.user_request.length>18000)throw fail('Provide a sample user request of at most 18,000 characters.');
 if(input.authoring_mode!=null&&!['structured','gherkin'].includes(input.authoring_mode))throw fail('Choose structured or Gherkin output.');
 if(input.reduced_context!=null&&typeof input.reduced_context!=='boolean')throw fail('Choose whether to inspect reduced context.');
 const profile=input.config?{...item,config:configuration.validate(input.config,id),published_version:null}:await configuration.resolve(id);
 const config=profile.config,mode=input.authoring_mode||'structured';
 const appType={id:'sample-app',project_id:'sample-project',name:'Sample web application',type:'web'};
 const story={id:'sample-story',project_id:'sample-project',title:'Checkout response time',description:'Checkout accepts an authorized order.',acceptance_criteria:['At 150 concurrent users, checkout p95 latency is at most 250 ms.'],specification_format:'text',specification_content:'Measure response latency in the agreed performance environment.'};
 const currentCase={title:'Checkout latency',description:'Measure checkout response time.',parameter_values:{concurrent_users:'150'},steps:[],authoring_mode:'structured'};
 const keys=[],native=[];let task={generation_request:{user_request:input.user_request}},complete=false;
 if(['ai.case_authoring.full_case','ai.case_authoring.step_rephrase','ai.automation.step_rephrase','ai.test_case.design'].includes(id)) {
  complete=true;keys.push('legacy.reviewed');
  if(id==='ai.test_case.design') {
   task=JSON.parse(require('@hellotest/manual/backend/services/requirementDesign.service')._promptBuilders.buildPrompt({requirements:[story],appType,maxCases:3,additionalContext:input.user_request,externalLinks:[],images:[],knowledge:[],authoringMode:mode}));
   keys.push(`format.${mode}`);
  } else {
   const builders=require('@hellotest/ai/backend/services/aiCaseAuthoring.service')._promptBuilders;
   if(id==='ai.case_authoring.full_case') {task=JSON.parse(builders.buildPrompt({requirement:story,appType,currentCase,authoringMode:mode,additionalContext:input.user_request,externalLinks:[],images:[]}));keys.push(`format.${mode}`);}
   else task=JSON.parse(builders.buildStepRephrasePrompt({requirement:story,appType,currentCase,step:{step_order:1,step_type:'web',action:'Measure checkout latency under the supplied workload',expected_result:'p95 is at most 250 ms'},additionalContext:input.user_request}));
  }
 }
 for(const key of keys)if(config.instruction_blocks[key])native.push(config.instruction_blocks[key]);
 const metrics=await require('./metricGovernance.service').resolveForFeature(id);
 let messages=composeMessages([{role:'system',content:[metrics.instruction,...native].filter(Boolean).join('\n\n')},{role:'user',content:JSON.stringify(task)}],config);
 if(input.reduced_context && config.instruction_blocks['recovery.context_size']) {
  messages.splice(1,0,{role:'system',content:config.instruction_blocks['recovery.context_size']});keys.push('recovery.context_size');
 }
 return {feature_id:id,configuration_source:input.config?'draft':'effective',configuration_version:profile.published_version,fingerprint:configuration.hash(config),inspection_scope:complete?'generation-request':'feature-instructions',messages,
  model_settings:{temperature:config.temperature,top_p:config.top_p,max_output_tokens:config.max_output_tokens,integration_id:config.integration_id},context_policy:config.context,active_templates:keys.filter(key=>config.instruction_blocks[key]?.trim()),
  notes:[complete?'The task payload uses the same builder as live generation, with clearly identified sample records.':'This feature-policy preview excludes feature-specific task data and native request contracts.', 'No model call, MCP retrieval, publication or workspace write is performed. Live runs add authorized evidence, provider selection and spending limits.']};
}
module.exports={preview};
