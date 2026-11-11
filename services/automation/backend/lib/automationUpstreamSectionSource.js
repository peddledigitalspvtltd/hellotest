const {parse}=require('acorn');
const {mapPlaywrightInstructions,prepareSteps,validateMappingResponse,RESPONSE_SCHEMA}=require('./automationInstructionMapping');
const {bindUpstreamSourceParameters}=require('./automationUpstreamSourceBindings');
const {auditAuthoredInputWrites}=require('./automationUpstreamInputWrites');
const fail=(message,code='AUTOMATION_UPSTREAM_BUILD_INCOMPLETE')=>Object.assign(new Error(message),{code,statusCode:422,nonRetryable:true});
const json=value=>typeof value==='string'?JSON.parse(value.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'')):value;
const gapText=(value,redact,limit)=>String(require('@hellotest/platform/backend/src/utils/llmTraceCapture').sanitize({text:redact(String(value))}).payload.text||'').slice(0,limit);

/** Map a closed straight-line source grammar without executing or rewriting it.
 * Every statement, locator and argument is retained verbatim; complex programs
 * continue through the configured display model rather than a partial summary. */
function deterministicSectionInstructions(step,source){
 try{
  const prepared=prepareSteps([{...step,automation_code:source}]),entry=prepared[0];
  const tree=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true});
  const statements=tree.body.filter(node=>node.type!=='EmptyStatement');
  if(statements.length!==entry.operations.length)return null;
  const aliases=new Map(),reserved=new Set(['page','playwrightPage','web','expect','params','String','Number','Boolean']);
  const member=node=>node?.type==='MemberExpression'&&!node.computed&&!node.optional?node.property?.name:null;
  const raw=node=>source.slice(node.start,node.end);
  const call=node=>node?.type==='CallExpression'&&!node.optional;
  const page=node=>node?.type==='Identifier'&&['page','playwrightPage'].includes(node.name);
  const value=(node,depth=0)=>{
   if(!node||depth>16)return false;
   if(node.type==='Literal')return true;
   if(node.type==='Identifier')return node.name==='undefined'||aliases.get(node.name)==='value';
   if(node.type==='MemberExpression')return !node.optional&&node.computed&&node.object?.name==='params'&&node.property?.type==='Literal'&&typeof node.property.value==='string';
   if(node.type==='TemplateLiteral')return node.expressions.every(item=>value(item,depth+1));
   if(node.type==='UnaryExpression')return ['!','+','-','~','typeof'].includes(node.operator)&&value(node.argument,depth+1);
   if(node.type==='BinaryExpression'||node.type==='LogicalExpression')return value(node.left,depth+1)&&value(node.right,depth+1);
   if(node.type==='ArrayExpression')return node.elements.every(item=>value(item,depth+1));
   if(node.type==='ObjectExpression')return node.properties.every(property=>property.type==='Property'&&property.kind==='init'&&!property.computed&&!property.method&&!property.shorthand
    &&(value(property.value,depth+1)||locator(property.value,depth+1)));
   return call(node)&&node.callee?.type==='Identifier'&&['String','Number','Boolean'].includes(node.callee.name)&&node.arguments.length===1&&value(node.arguments[0],depth+1);
  };
  const locator=(node,depth=0)=>{
   if(!node||depth>16)return false;
   if(node.type==='Identifier')return aliases.get(node.name)==='locator';
   return call(node)&&['locator','getByRole','getByLabel','getByText','getByPlaceholder','getByTitle','getByAltText','getByTestId','frameLocator','first','last','nth','filter'].includes(member(node.callee))
    &&(page(node.callee.object)||locator(node.callee.object,depth+1))&&node.arguments.every(item=>value(item,depth+1));
  };
  const labels={goto:'Open URL',click:'Click',dblclick:'Double click',fill:'Type',type:'Type',pressSequentially:'Type',press:'Press',selectOption:'Select',check:'Check',uncheck:'Uncheck',setChecked:'Set checked',hover:'Hover',focus:'Focus',scrollIntoViewIfNeeded:'Scroll to',waitFor:'Wait for element',waitForURL:'Wait for URL',waitForTimeout:'Wait',waitForLoadState:'Wait for page',waitForSelector:'Wait for element',setInputFiles:'Upload file',switchTab:'Switch tab'};
  const instructions=[];
  for(const [index,node] of statements.entries()){
   const operation=entry.operations[index];
   if(operation.start!==node.start||operation.end!==node.end||operation.depth!==0||raw(node).length>2000)return null;
   let label,args,kind;
   if(node.type==='VariableDeclaration'&&node.kind==='const'){
    for(const declaration of node.declarations){
     if(declaration.id?.type!=='Identifier'||reserved.has(declaration.id.name)||aliases.has(declaration.id.name))return null;
     const type=locator(declaration.init)?'locator':value(declaration.init)?'value':null;
     if(!type)return null;aliases.set(declaration.id.name,type);
    }
    label=node.declarations.length===1&&aliases.get(node.declarations[0].id.name)==='locator'?'Find field':'Set value';
    args=node.declarations.map(raw);kind='setup';
   }else{
    if(node.type!=='ExpressionStatement'||node.expression?.type!=='AwaitExpression'||!call(node.expression.argument))return null;
    const expression=node.expression.argument,method=member(expression.callee),receiver=expression.callee.object;
    let expectation=receiver,negated=false;
    if(member(expectation)==='not'){negated=true;expectation=expectation.object;}
    const soft=call(expectation)&&member(expectation.callee)==='soft'&&expectation.callee.object?.name==='expect';
    if(call(expectation)&&(expectation.callee?.name==='expect'||soft)){
     if(!require('./automationGeneratedProgram').hasExecutableAssertion(raw(node))||expectation.arguments.length<1||expectation.arguments.length>2
      ||!(page(expectation.arguments[0])||locator(expectation.arguments[0])||value(expectation.arguments[0]))
      ||!expectation.arguments.slice(1).every(item=>value(item))||!expression.arguments.every(item=>value(item)))return null;
     label=`Verify ${method.replace(/^to(?:Be|Have)?/,'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase()}${soft?' (soft)':''}${negated?' (not)':''}`;
     args=[raw(expectation.arguments[0]),...expression.arguments.map(raw),...expectation.arguments.slice(1).map(item=>`message: ${raw(item)}`)];kind='assertion';
    }else{
     if(!Object.hasOwn(labels,method)||!(page(receiver)||locator(receiver)||receiver?.name==='web'&&method==='switchTab')||!expression.arguments.every(item=>value(item)))return null;
     label=labels[method];args=[...(locator(receiver)?[raw(receiver)]:[]),...expression.arguments.map(raw)];kind='action';
    }
   }
   if(operation.kind!==kind||args.length>12||args.some(argument=>argument.length>2000))return null;
   instructions.push({operation_id:operation.operation_id,kind:operation.kind,depth:operation.depth,label,args,detail:raw(node)});
  }
  return validateMappingResponse({schema:RESPONSE_SCHEMA,steps:[{step_id:entry.step_id,source_sha256:entry.source_sha256,instructions}]},prepared);
 }catch{return null;}
}

/** Display-only mapping of validated source. Native execution and offline
 * previews share its bounded retry and source-parser fallback policy. */
async function mapGeneratedSectionInstructions({step,source,complete,guard=async()=>{},onProgress=async()=>{},identity=id=>({step_id:id,active_step_id:id}),onStage=()=>{},signal}){
 let mapping,mappingFeedback,mappingWarning;
 onStage('mapping');
 await onProgress({phase:'automation.agent.instructions.started',message:`Mapping section ${step.step_order} to readable instructions.`,details:{...identity(step.id),step_order:step.step_order}});
 signal?.throwIfAborted();await guard();signal?.throwIfAborted();
 mapping=deterministicSectionInstructions(step,source);
 if(mapping)return {automation_instructions:mapping.steps[0]};
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
async function generateUpstreamSectionSource({step,emitted,brief='',taskContext,sourceContext,sourceBindings,privateScope,completed=[],interactive=true,authoringOnly=false,referenceImages=[],complete,validate,guard=async()=>{},redact=value=>value,onProgress=async()=>{},identity=id=>({step_id:id,active_step_id:id}),onStage=()=>{},signal}){
 const {validateSectionSource,preserveNativeActions}=require('./automationUpstreamEngineer');
   let source,feedback;
   onStage('source');
   for(let attempt=0;attempt<3;attempt++){
    await guard();
    await onProgress({phase:'automation.agent.source.started',message:`Generating executable Playwright instructions for section ${step.step_order}.`,details:{...identity(step.id),step_order:step.step_order,attempt:attempt+1}});
    let proposal;
    try{
     const prompt=JSON.stringify({task:'Save this section as executable Playwright JavaScript. Use native MCP emitted mutations as the action authority, preserve those performed mutations exactly once and in order, and include executable expect assertions for every authored expected UI state based on actual observed evidence. For example, visible and enabled requires both toBeVisible and toBeEnabled; verify focus with toBeFocused and editability with toBeEditable when authored. A later click or actionability check does not replace this section’s explicit state assertions. A trusted task_context.browser_context receipt with applies_to_current_section_setup=true establishes only the initial owned fresh-context fixture before first navigation. Verify the authored application guest state separately; never assert cookies remain empty after loading, invent a context reset, or use a constant assertion to simulate lifecycle proof. Historical receipts do not establish later fresh-session actions, and future external/attach execution requires its own declared fixture. task_context is prompt evidence, not a runtime variable: do not invent lifecycle bindings/helpers or assert receipt constants. Retain actual native guest UI assertions; context creation belongs to the declared runner fixture. Return {automation_code:"statements only"}. Use page and expect supplied by HelloTest; preserve any exact host-issued web.switchTab selection receipt after its native popup-opening action. The page binding follows this reviewed selection for assertions in this section and later sections. Tab receipts identify an existing native-observed tab by both index and URL; never invent, remove or alter them. Do not create or close tabs. No imports, exports, test wrappers, process, require, eval, arbitrary network calls, custom fixtures or new browser contexts. Native emitted secret process.env accesses must be retained for host parameter binding. Do not copy refs as CSS locators. Use direct getByRole/getByLabel chains, native generated locators, and frameLocator for observed iframes. Preserve completed sections: this source executes immediately after them, never navigate back or redo previous actions. Do not replay the browser to correct source. This is a native expression program: use params["r.name"] for every configured data binding, including direct arguments, URL concatenation and template fragments. Never compose @scope token strings or depend on runtime string interpolation. Keep ordinary literal content literal; the host adds the versioned binding marker and normalizes native public samples and secret expressions without changing the native action authority. For read-only preview synthesize an unverified plan from observed controls and supplied requirements. If a section only verifies the current state, save assertions rather than inventing a click. An authored Fill, Type or Enter command must retain its input write with the exact scoped parameter; matching defaults or assertions cannot replace it. Playwright actions and expect assertions auto-wait for their conditions, so do not add duplicate visible waits before actions. When observed evidence shows a delayed element or loading overlay, add an awaited locator.waitFor({state:"visible"|"hidden"}) or retrying expect check before dependent work and use the configured assertion timeout. Do not add fixed sleeps or wait for networkidle as a generic readiness check. Keep navigation readiness separate from the final outcome assertions.',navigation_wait_contract:'This contract applies to native saved Playwright source, not typed MCP or recorded-ledger operations. Never invent an unsupported typed wait tool or discard an explicit wait while lowering source. When the authored final outcome includes a URL or route transition, including a hash or History API SPA route after a successful submission, preserve the action exactly once and await page.waitForURL with the identical expected URL or regex and {waitUntil:"commit"} before retaining the original exact URL and business-result assertions. Omit the wait timeout to inherit the configured engine navigation budget; preserve any explicitly authored wait or assertion timeout. Do not increase an expect timeout, substitute a successful API response for the final route or business assertions, repeat the submission, or add a route wait to an action with no grounded route postcondition.',native_locator_contract:'For an observed iframe table, prefer a row filtered by full parameterized identity with hasText for portability, then assert cells within that row. If using has/hasNot, outer and inner locators must share the identical native frame prefix; equivalent but differently written iframe selectors can fail. Use exact:true for named record links and named metadata cells so a type such as Onboarding does not also match the record-name cell. getByRole options do not include hasText/has/hasNot; append .filter({hasText: fullParameterizedIdentity}) to getByRole("row") instead of passing filter fields into getByRole.',runner_assertion_contract:'This native step runner supplies page and expect without Playwright Test testInfo or snapshot baseline state. Do not emit toMatchAriaSnapshot, toHaveScreenshot or toMatchSnapshot, even with inline text. Upstream browser_verify_list_visible can emit a main-body ARIA snapshot while its actual observed target was inside an iframe; that generated assertion cannot execute here and does not establish main-page body contents. Preserve native actions exactly, choose the actual observed iframe/locator, and cover every authored item with supported awaited toBeVisible, toHaveText or toHaveCount assertions. Correct source without replaying browser actions.',native_assertion_contract:'Native emitted assertions are evidence, not mandatory source statements. Replace unsupported, ambiguous or unnecessary intermediate assertions with supported checks for the authored final expected result. Native mutations must remain exactly once and in order.',expected_result_contract:'For a named-record expectation, use the full authored composite identity: template text plus the configured first name and last name where authored. Do not replace it with a broad template prefix or choose .first() to hide ambiguous matches. Keep authored final-result assertions after the final authored action. For table records, select the unique row using the full parameterized identity and assert type, status and other authored metadata within that same row. Never use table-wide metadata cells or index them with .first(), .last() or .nth(). An intermediate-state assertion does not establish the final outcome. Preserve successful native actions without replay.',authoring_contract:authoringOnly?'Live validation is blocked. Do not call browser tools or claim this plan executed. Retain every confirmed native mutation as the exact ordered prefix, then append only the remaining authored actions as an unverified plan. Preserve fixed expected values even when the observed application contradicts them. Use observed controls and explicit authored requirements; never invent working credentials, existing fixtures or unsupported selectors. Earlier generated-but-unexecuted sections describe planned state, not current live page evidence. If a necessary executable contract cannot be grounded, return {input_required:{reason:"specific missing contract",required_context:[],required_parameters:[]}} instead of inventing it.':undefined,live_validation:sourceContext.live_validation,authoring_only:authoringOnly,interactive,brief,task_context:taskContext,step:{id:step.id,step_order:step.step_order,action:step.action,expected_result:step.expected_result},parameters:sourceBindings.parameterValues,private_parameter_tokens:privateScope.references,private_parameter_availability:privateScope.availability,native_emitted_code:redact(emitted),final_observation:sourceContext.latest_observation,current_page_snapshot:sourceContext.current_page_snapshot,observations:sourceContext.observations,observation_delivery:sourceContext.delivery,previous_source:completed.slice(-2).map(item=>item.automation_code),feedback});
     // Validate the complete serialized phase prompt with the shared transport
     // policy. Primary Story, authored requirements and native action source
     // remain intact; oversized inputs fail explicitly instead of being sliced.
     require('@hellotest/platform/backend/src/utils/llmRequestPolicy').assertInputBudget({messages:[{role:'user',content:prompt}]});
     proposal=json(await complete({phase:'upstream_source',step,prompt,referenceImages}));
    }
    catch(error){
     if(!(error instanceof SyntaxError)&&error.code!=='AI_INVALID_JSON')throw error;
     // Correct only the buffered source response. Native actions are already
     // retained and must never be repeated to repair a serialization error.
     feedback='Return valid JSON with one automation_code string containing the retained native Playwright statements and supported authored assertions. No browser actions were replayed.';
     if(attempt===2)throw fail('The source model did not return valid executable-section JSON after three proposals. No browser actions were replayed.','AI_INVALID_JSON');
     continue;
    }
    try{
     if(proposal?.input_required){
      const details=proposal.input_required;
      throw Object.assign(fail('The draft needs the missing application or test-input contract before executable source can be generated.','AUTOMATION_DEPENDENCY_MISSING'),{
       blocked_steps:[{step_id:step.id,reason:gapText(details.reason||'The required executable contract is not supplied.',redact,500),
        required_context:(Array.isArray(details.required_context)?details.required_context:[]).filter(item=>typeof item==='string').slice(0,10).map(item=>gapText(item,redact,300)),
        required_parameters:(Array.isArray(details.required_parameters)?details.required_parameters:[]).filter(item=>typeof item==='string').slice(0,20).map(item=>gapText(item,redact,100))}]
      });
     }
     privateScope.assertSource(proposal.automation_code);
     const bound=bindUpstreamSourceParameters({source:proposal.automation_code,parameterValues:sourceBindings.parameterValues,privateNames:Object.values(sourceBindings.secretBindings||{}),secretBindings:sourceBindings.secretBindings,parameterExpressions:true});
     privateScope.assertSource(bound.source);
     source=validateSectionSource(bound.source,step,validate);preserveNativeActions(source,emitted,sourceBindings,interactive,{allowPlannedSuffix:authoringOnly});
     if(auditAuthoredInputWrites({step,source}).missing_parameter_references.length)throw fail('The executable section must perform its explicitly authored Fill/Type/Enter action with the scoped input parameter. A default value or assertion cannot replace that write.','AUTOMATION_UPSTREAM_AUTHORED_INPUT_REQUIRED');
     break;
    }catch(error){if(error.code==='AUTOMATION_DEPENDENCY_MISSING')throw error;feedback=redact(error.message);if(attempt===2)throw error;}
   }
   if(redact(source)!==source)throw fail('Generated source contains a private literal. Rebuild with scoped parameters.','AUTOMATION_PRIVATE_VALUE_IN_SOURCE');
   // The second LLM stage is display-only and cannot mutate executable source.
   const mapping=await mapGeneratedSectionInstructions({step,source,complete,guard,onProgress,identity,onStage,signal});
 return {step,step_type:'web',automation_code:source,api_request:null,...mapping};
}
module.exports={generateUpstreamSectionSource,mapGeneratedSectionInstructions,deterministicSectionInstructions};
