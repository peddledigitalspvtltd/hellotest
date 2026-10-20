/** Check authored static test/suite inputs, not legacy generated code or run
 * captures that an earlier section may produce. Never generate missing values. */
function missingBuildInputs(steps,resolver){
  return (Array.isArray(steps)?steps:[]).map(step=>{
    const data=resolver.buildData({steps:[{id:step.id,action:step.action,expected_result:step.expected_result}]});
    const missing=(data.missing_parameter_references||[]).filter(key=>/^[ts]\./i.test(key));
    return missing.length?{step_id:step.id,dependency_type:'parameter',reason:'Configure the referenced test inputs before starting browser interaction.',required_context:[],required_parameters:missing}:null;
  }).filter(Boolean);
}
function assertBuildInputs(steps,resolver){
  const blocked=missingBuildInputs(steps,resolver);
  if(!blocked.length)return;
  throw Object.assign(new Error('Automation needs configured test inputs before opening the browser. Review the named parameters under Test Data or the linked manual case.'),{
    code:'AUTOMATION_DEPENDENCY_MISSING',statusCode:422,nonRetryable:true,blocked_steps:blocked,active_step_id:blocked[0].step_id,
    failure_stage:'context',automation_stage:'context',generation_provider_requests:0,browser_actions:0
  });
}

/** Runtime bindings may be produced by earlier work, so the initial static
 * preflight must not require every future capture. At the active section,
 * however, its original authored references must already have a host binding.
 * Model-invented literals cannot substitute for a missing named input. */
function assertCurrentBuildInputs({stepId,parameterReferences=[]},resolver){
  const state=resolver.buildData({steps:[]});
  // parameter_references also advertises unresolved authored names; an
  // advertised name becomes a binding only after it has an actual value,
  // including an explicitly selected empty string.
  const unresolved=new Set(state.missing_parameter_references||[]);
  const available=new Set((state.parameter_references||[]).filter(key=>!unresolved.has(key)));
  const missing=[...new Set(parameterReferences)].filter(key=>!available.has(key));
  if(!missing.length)return;
  const blocked={step_id:stepId,dependency_type:'parameter',reason:'Configure the referenced input or bind its authorized runtime value before this section interacts with the application.',required_context:[],required_parameters:missing};
  throw Object.assign(new Error(`This section needs configured test inputs: ${missing.map(key=>require('./automationBrowserParameters').parameterReference(key)).join(', ')}. Supply their values or runtime bindings before retrying. Previously saved sections remain in Plan.`),{
    code:'AUTOMATION_DEPENDENCY_MISSING',statusCode:422,nonRetryable:true,blocked_steps:[blocked],active_step_id:stepId,
    failure_stage:'context',automation_stage:'context',current_step_generation_provider_requests:0,current_step_browser_actions:0
  });
}
module.exports={missingBuildInputs,assertBuildInputs,assertCurrentBuildInputs};
