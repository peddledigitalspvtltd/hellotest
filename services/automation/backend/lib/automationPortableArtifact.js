// The browser download and the backend artifact use one source/runtime emitter.
// Public frozen data and deliberately empty bindings belong in an artifact;
// nonempty private values are supplied through QAIRA_DATA_JSON.
async function createPortableAutomationArtifact({testCase,updates,repositoryRows=[],values={},sensitiveNames=[],baseURL=testCase.automation_start_url||'',runtimeSettings={}}){
  const {buildPlaywrightArtifact,createPlaywrightExecutionOptions,preparePlaywrightRepository}=await import('../../shared/playwrightArtifact.mjs');
  let options=testCase.test_data_options||{};if(typeof options==='string')try{options=JSON.parse(options);}catch{options={};}
  const privateNames=new Set([...sensitiveNames,...(Array.isArray(options.private_parameter_names)?options.private_parameter_names:[])].map(value=>String(value).replace(/^@/,'').toLowerCase()));
  const privateName=key=>privateNames.has(key.toLowerCase())||/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i.test(key);
  const privateValues=new Set(Object.entries(values).filter(([key])=>privateName(key)).map(([,value])=>String(value??'')).filter(Boolean));
  const publicValues=Object.fromEntries(Object.entries(values).filter(([key,value])=>String(value??'')===''||!privateName(key)&&!privateValues.has(String(value??''))).map(([key,value])=>[key,String(value??'')]));
  const steps=updates.map(update=>({...update.step,step_type:update.step_type||update.step.step_type||(update.api_request?'api':'web'),automation_code:update.automation_code||null,api_request:update.api_request||null}));
  const {objects,repositoryIssues}=preparePlaywrightRepository(repositoryRows);
  return buildPlaywrightArtifact({testCase,steps,rows:[publicValues],objects,repositoryIssues,baseURL,executionOptions:createPlaywrightExecutionOptions(runtimeSettings)});
}
module.exports={createPortableAutomationArtifact};
