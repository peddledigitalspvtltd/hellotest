const {mapPlaywrightInstructions}=require('./automationInstructionMapping');
const {bindUpstreamSourceParameters}=require('./automationUpstreamSourceBindings');
const {auditAuthoredInputWrites}=require('./automationUpstreamInputWrites');
const fail=(message,code='AUTOMATION_UPSTREAM_BUILD_INCOMPLETE')=>Object.assign(new Error(message),{code,statusCode:422,nonRetryable:true});
const json=value=>typeof value==='string'?JSON.parse(value.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'')):value;

/** Display-only mapping of validated source. Native execution and offline
 * previews share its bounded retry and source-parser fallback policy. */
async function mapGeneratedSectionInstructions({step,source,complete,guard=async()=>{},onProgress=async()=>{},identity=id=>({step_id:id,active_step_id:id}),onStage=()=>{},signal}){
 let mapping,mappingFeedback,mappingWarning;
 onStage('mapping');
 await onProgress({phase:'automation.agent.instructions.started',message:`Mapping section ${step.step_order} to readable instructions.`,details:{...identity(step.id),step_order:step.step_order}});
 for(let attempt=0;attempt<2;attempt++){
  try{mapping=await mapPlaywrightInstructions({steps:[{...step,automation_code:source}],signal,validationFeedback:mappingFeedback,complete:input=>complete({phase:'upstream_instruction_mapping',step,prompt:[input.systemPrompt,input.prompt].join('\n\n')})});break;}
  catch(error){
   if(require('./automationProgressDiagnostics').isCriticalAutomationError(error)||!['AUTOMATION_INSTRUCTION_MAPPING_INVALID','AI_INVALID_JSON','AI_OUTPUT_SCHEMA_VIOLATION'].includes(error.code))throw error;
   await guard();
   mappingFeedback={code:error.code,...(error.validation_feedback?{validation_feedback:error.validation_feedback}:{})};
   if(attempt===1){
    mappingWarning={error_code:error.code,status:'fallback',display_mode:'source_parser',attempts:2};
    await onProgress({phase:'automation.agent.instructions.fallback',level:'warning',message:`Section ${step.step_order} uses parsed instructions because its display mapping could not be validated. The executable source remains authoritative.`,details:{...identity(step.id),...mappingWarning}});
   }
  }
 }
 return {...(mapping?{automation_instructions:mapping.steps[0]}:{}),...(mappingWarning?{instruction_mapping_warning:mappingWarning}:{})};
}

/** Source/model work only. Native execution and persistence belong to callers. */
async function generateUpstreamSectionSource({step,emitted,taskContext,sourceContext,sourceBindings,privateScope,completed=[],interactive=true,complete,validate,guard=async()=>{},redact=value=>value,onProgress=async()=>{},identity=id=>({step_id:id,active_step_id:id}),onStage=()=>{},signal}){
 const {validateSectionSource,preserveNativeActions}=require('./automationUpstreamEngineer');
   let source,feedback;
   onStage('source');
   for(let attempt=0;attempt<3;attempt++){
    await guard();
    await onProgress({phase:'automation.agent.source.started',message:`Generating executable Playwright instructions for section ${step.step_order}.`,details:{...identity(step.id),step_order:step.step_order,attempt:attempt+1}});
    let proposal;
    try{proposal=json(await complete({phase:'upstream_source',step,prompt:JSON.stringify({task:'Save this section as executable Playwright JavaScript. Use native MCP emitted mutations as the action authority, preserve those performed mutations exactly once and in order, and include executable expect assertions for the full authored expected result based on actual observed evidence. Return {automation_code:"statements only"}. Use page and expect supplied by HelloTest; no imports, exports, test wrappers, process, require, eval, arbitrary network calls, custom fixtures or new browser contexts. Native emitted secret process.env accesses must be retained for host parameter binding. Do not copy refs as CSS locators. Use direct getByRole/getByLabel chains, native generated locators, and frameLocator for observed iframes. Preserve completed sections: this source executes immediately after them, never navigate back or redo previous actions. Do not replay the browser to correct source. This is a native expression program: use params["r.name"] for every configured data binding, including direct arguments, URL concatenation and template fragments. Never compose @scope token strings or depend on runtime string interpolation. Keep ordinary literal content literal; the host adds the versioned binding marker and normalizes native public samples and secret expressions without changing the native action authority. For read-only preview synthesize an unverified plan from observed controls and supplied requirements. If a section only verifies the current state, save assertions rather than inventing a click. An authored Fill, Type or Enter command must retain its input write with the exact scoped parameter; matching defaults or assertions cannot replace it. Playwright actions and expect assertions auto-wait for their conditions, so do not add duplicate visible waits before actions. When observed evidence shows a delayed element or loading overlay, add an awaited locator.waitFor({state:"visible"|"hidden"}) or retrying expect check before dependent work and use the configured assertion timeout. Do not add fixed sleeps or wait for networkidle as a generic readiness check. Keep navigation readiness separate from the final outcome assertions.',navigation_wait_contract:'This contract applies to native saved Playwright source, not typed MCP or recorded-ledger operations. Never invent an unsupported typed wait tool or discard an explicit wait while lowering source. When the authored final outcome includes a URL or route transition, including a hash or History API SPA route after a successful submission, preserve the action exactly once and await page.waitForURL with the identical expected URL or regex and {waitUntil:"commit"} before retaining the original exact URL and business-result assertions. Omit the wait timeout to inherit the configured engine navigation budget; preserve any explicitly authored wait or assertion timeout. Do not increase an expect timeout, substitute a successful API response for the final route or business assertions, repeat the submission, or add a route wait to an action with no grounded route postcondition.',native_locator_contract:'For an observed iframe table, prefer a row filtered by full parameterized identity with hasText for portability, then assert cells within that row. If using has/hasNot, outer and inner locators must share the identical native frame prefix; equivalent but differently written iframe selectors can fail. Use exact:true for named record links and named metadata cells so a type such as Onboarding does not also match the record-name cell. getByRole options do not include hasText/has/hasNot; append .filter({hasText: fullParameterizedIdentity}) to getByRole("row") instead of passing filter fields into getByRole.',runner_assertion_contract:'This native step runner supplies page and expect without Playwright Test testInfo or snapshot baseline state. Do not emit toMatchAriaSnapshot, toHaveScreenshot or toMatchSnapshot, even with inline text. Upstream browser_verify_list_visible can emit a main-body ARIA snapshot while its actual observed target was inside an iframe; that generated assertion cannot execute here and does not establish main-page body contents. Preserve native actions exactly, choose the actual observed iframe/locator, and cover every authored item with supported awaited toBeVisible, toHaveText or toHaveCount assertions. Correct source without replaying browser actions.',native_assertion_contract:'Native emitted assertions are evidence, not mandatory source statements. Replace unsupported, ambiguous or unnecessary intermediate assertions with supported checks for the authored final expected result. Native mutations must remain exactly once and in order.',expected_result_contract:'For a named-record expectation, use the full authored composite identity: template text plus the configured first name and last name where authored. Do not replace it with a broad template prefix or choose .first() to hide ambiguous matches. Keep authored final-result assertions after the final authored action. For table records, select the unique row using the full parameterized identity and assert type, status and other authored metadata within that same row. Never use table-wide metadata cells or index them with .first(), .last() or .nth(). An intermediate-state assertion does not establish the final outcome. Preserve successful native actions without replay.',interactive,task_context:taskContext,step:{id:step.id,step_order:step.step_order,action:step.action,expected_result:step.expected_result},parameters:sourceBindings.parameterValues,private_parameter_tokens:privateScope.references,private_parameter_availability:privateScope.availability,native_emitted_code:redact(emitted),final_observation:sourceContext.latest_observation,observations:sourceContext.observations,observation_delivery:sourceContext.delivery,previous_source:completed.slice(-2).map(item=>item.automation_code),feedback})}));}
    catch(error){
     if(!(error instanceof SyntaxError)&&error.code!=='AI_INVALID_JSON')throw error;
     // Correct only the buffered source response. Native actions are already
     // retained and must never be repeated to repair a serialization error.
     feedback='Return valid JSON with one automation_code string containing the retained native Playwright statements and supported authored assertions. No browser actions were replayed.';
     if(attempt===2)throw fail('The source model did not return valid executable-section JSON after three proposals. No browser actions were replayed.','AI_INVALID_JSON');
     continue;
    }
    try{
     privateScope.assertSource(proposal.automation_code);
     const bound=bindUpstreamSourceParameters({source:proposal.automation_code,parameterValues:sourceBindings.parameterValues,privateNames:Object.values(sourceBindings.secretBindings||{}),secretBindings:sourceBindings.secretBindings,parameterExpressions:true});
     privateScope.assertSource(bound.source);
     source=validateSectionSource(bound.source,step,validate);preserveNativeActions(source,emitted,sourceBindings,interactive);
     if(auditAuthoredInputWrites({step,source}).missing_parameter_references.length)throw fail('The executable section must perform its explicitly authored Fill/Type/Enter action with the scoped input parameter. A default value or assertion cannot replace that write.','AUTOMATION_UPSTREAM_AUTHORED_INPUT_REQUIRED');
     break;
    }catch(error){feedback=redact(error.message);if(attempt===2)throw error;}
   }
   if(redact(source)!==source)throw fail('Generated source contains a private literal. Rebuild with scoped parameters.','AUTOMATION_PRIVATE_VALUE_IN_SOURCE');
   // The second LLM stage is display-only and cannot mutate executable source.
   const mapping=await mapGeneratedSectionInstructions({step,source,complete,guard,onProgress,identity,onStage,signal});
 return {step,step_type:'web',automation_code:source,api_request:null,...mapping};
}
module.exports={generateUpstreamSectionSource,mapGeneratedSectionInstructions};
