const { browserReceipt } = require('./automationInteractiveEvidence');
const {isNavigationPrerequisite}=require('./automationActionReconciliation');
const {unsuccessfulBrowserCheck,browserCheckPromptDetails}=require('./automationBrowserRecovery');

function compactBrowserObservations(observations,maxChars=32000) {
  // Screenshots/validation feedback often follow the snapshot. Keep the latest
  // usable page state readable even when it is no longer the last two entries.
  const currentLocation=[...observations].reverse().map(browserReceipt).find(receipt=>typeof receipt?.url==='string')?.url;
  const stalePage=entry=>entry.tool==='browser_snapshot'&&currentLocation&&browserReceipt(entry)?.url&&browserReceipt(entry).url!==currentLocation;
  const latestSnapshot=observations.findLastIndex(entry=>entry.tool==='browser_snapshot'&&!entry.result?.isError&&!stalePage(entry));
  const packed=observations.map((entry,index)=>({...entry,...(stalePage(entry)?{stale_page:true}:{}),result:{...entry.result,content:(Array.isArray(entry.result?.content)?entry.result.content:[]).filter(item=>item.type === "text").map(item=>{
    const recent=index===latestSnapshot||index>=observations.length-2;
    const limit=recent?12000:1800;
    if(String(item.text || "").length<=limit)return item;
    try {const value=JSON.parse(item.text);if(value.accessibility)value.accessibility=String(value.accessibility).slice(0,Math.floor(limit*.55));if(Array.isArray(value.elements))value.elements=value.elements.slice(0,recent?60:12);const compact={...value,excerpt_truncated:true};
      // Preserve usable typed locator candidates instead of hiding an oversized
      // serialized element array inside a partial JSON excerpt.
      while(Array.isArray(compact.elements)&&compact.elements.length&&JSON.stringify(compact).length>limit)compact.elements.pop();
      const encoded=JSON.stringify(compact);
      return {...item,text:encoded.length>limit+1000?JSON.stringify({url:value.url,excerpt:encoded.slice(0,limit),excerpt_truncated:true,omitted_structured_fields:true}):encoded};}
    catch{return {...item,text:JSON.stringify({excerpt:String(item.text).slice(0,limit),excerpt_truncated:true})};}
  })}}));
  for(let index=0;JSON.stringify(packed).length>maxChars&&index<packed.length-1;index++)if(index!==latestSnapshot)packed[index]={tool:packed[index].tool,result:{isError:packed[index].result?.isError,omitted_older_observation:true}};
  return packed;
}

function snapshotMetadata(entry) {
  const receipt=browserReceipt(entry);
  return {...entry,result:{...entry.result,content:[{type:'text',text:JSON.stringify({source:'playwright',url:receipt?.url,observation_id:receipt?.observation_id,captured_at:receipt?.captured_at,superseded_page_snapshot:true})}]}};
}

/** Give the model one current page, separate from historical receipts. Old DOM
 * controls must not compete with the page that is actually open now. */
function browserCurrentSnapshotObservation(observations) {
  const location=[...observations].reverse().map(browserReceipt).find(value=>typeof value?.url==='string')?.url;
  // A failed navigation can replace a same-URL SPA with an error document.
  // Evidence from before that attempt is no longer the current rendered page.
  const invalidated=observations.findLastIndex(entry=>entry.tool==='browser_navigate'&&entry.result?.isError);
  return observations.findLast((entry,index)=>index>invalidated&&entry.tool==='browser_snapshot'&&!entry.result?.isError&&(!location||browserReceipt(entry)?.url===location));
}

function browserCurrentSnapshot(observations) {
  const snapshot=browserCurrentSnapshotObservation(observations);
  return snapshot?browserReceipt(snapshot):null;
}

/** Keep retained evidence in the activity store, rather than replaying all of
 * its JSON/arguments into every model turn. Current controls live in one slot;
 * history contains bounded outcome and validation diagnostics only. */
function modelObservationHistory(observations,stepId,maxChars=4500) {
  const rows=[];
  const historicalChecks=new Map();
  for(const entry of observations){
    if(['browser_snapshot','browser_screenshot'].includes(entry.tool))continue;
    // Current real receipts are already represented once in current progress.
    if(entry.tool?.startsWith('browser_')&&entry.execution_step_id===stepId)continue;
    const row={tool:entry.tool,...(entry.execution_step_id?{step_id:entry.execution_step_id}:{}),...(entry.mcp_call===false?{mcp_call:false}:{})};
    if(entry.tool?.startsWith('browser_')){
      const value=browserReceipt(entry),failure=unsuccessfulBrowserCheck(entry);
      // Earlier-section successes cannot prove the current predicate. Retain
      // their count once per section; the complete receipts stay host-side.
      if(entry.tool==='browser_assert'&&entry.execution_step_id&&entry.execution_step_id!==stepId&&entry.mcp_call!==false
        &&value?.assertion_outcome==='satisfied'&&!failure&&!entry.result?.isError){
        let summary=historicalChecks.get(entry.execution_step_id);
        if(!summary){summary={tool:'historical_assertion_summary',step_id:entry.execution_step_id,evidence_scope:'prior_section_only',satisfied_check_count:0};historicalChecks.set(entry.execution_step_id,summary);rows.push(summary);}
        summary.satisfied_check_count++;
        continue;
      }
      Object.assign(row,{action_outcome:value?.action_outcome,assertion:entry.arguments?.assertion,assertion_outcome:value?.assertion_outcome,
        ...(Number.isSafeInteger(value?.match_count)?{match_count:value.match_count}:{}),...(typeof value?.unique==='boolean'?{unique:value.unique}:{}),failed:Boolean(failure||entry.result?.isError)});
      if(failure)row.code=failure.code;
    }else if(entry.execution_step_id===stepId||!entry.execution_step_id){
      let value;for(const part of entry.result?.content||[])if(part.type==='text')try{value=JSON.parse(part.text);break;}catch{}
      if(!value||typeof value!=='object')continue;
      for(const key of ['code','reason','generation_mode','generation_complete','active_step_id','expected_result_check','remaining_contract','completion_available','action_outcome','retry_safe','assertion_subject','attempted_assertion'])if(['string','boolean','number'].includes(typeof value[key]))row[key]=typeof value[key]==='string'?value[key].slice(0,180):value[key];
      if(value.value_assertion_contract)row.value_assertion_contract=value.value_assertion_contract;
      if(typeof value.message==='string')row.message=value.message.slice(0,350);
      for(const key of ['completed_step_ids','saved_step_ids','required_arguments','forbidden_arguments','argument_names'])if(Array.isArray(value[key]))row[key]=value[key].filter(item=>typeof item==='string').slice(0,12);
      if(value.selected_mode&&typeof value.selected_mode==='object')row.selected_mode=value.selected_mode;
      if(Array.isArray(value.field_issues))row.field_issues=value.field_issues.slice(0,8);
      if(Array.isArray(value.validation_errors))row.validation_errors=value.validation_errors.slice(0,6).map(item=>typeof item==='string'?item.slice(0,300):{code:item?.code,step_id:item?.step_id,message:typeof item?.message==='string'?item.message.slice(0,300):undefined});
    }else continue;
    rows.push(row);
  }
  const recent=rows.slice(-10);
  while(recent.length>1&&JSON.stringify(recent).length>maxChars)recent.shift();
  return recent;
}

function browserPromptContext(observations,stepId,{compactModel=false}={}) {
  const location=[...observations].reverse().map(browserReceipt).find(value=>typeof value?.url==='string')?.url;
  const snapshot=browserCurrentSnapshotObservation(observations);
  let page;
  if(snapshot){
    if(compactModel)page=require('./automationBrowserModelTargets').projectModelSnapshot(snapshot);
    else{
      const packed=compactBrowserObservations([snapshot])[0];
      const item=packed.result.content.find(part=>part.type==='text');
      try{page=JSON.parse(item?.text);}catch{page={accessibility:item?.text};}
    }
  }
  const completed={};
  const receipts=[];
  let latestFailure,assertionFailure,failureBeforeLocator,locatorResolution;
  for(const entry of observations){
    if(!stepId||entry.execution_step_id!==stepId)continue;
    if(entry.mcp_call===false&&['automation_source_validation','automation_program_tools','automation_execution_feedback','automation_parameter_feedback','automation_browser_recovery_feedback','automation_browser_budget_feedback','automation_tool_schema_feedback','automation_navigation_feedback','automation_target_feedback','automation_locator_feedback','automation_assertion_feedback','automation_verification_feedback','automation_action_order_feedback','automation_snapshot_feedback','automation_actor_response_feedback','automation_section_issue_feedback'].includes(entry.tool)){
      for(const part of entry.result?.content||[])if(part.type==='text')try{
        const value=JSON.parse(part.text);
        if(entry.tool==='automation_section_issue_feedback'&&value.code==='AUTOMATION_BROWSER_OUTCOME_TARGET_REVIEW_REQUIRED'){
          latestFailure={tool:entry.tool,kind:'outcome_target',code:value.code,message:typeof value.message==='string'?value.message.slice(0,1400):undefined,
            allowed_recovery:'read_only_outcome_reassessment',reason:value.reason,action_outcome:'not_attempted'};continue;
        }
        if(entry.tool==='automation_actor_response_feedback'&&value.code==='AUTOMATION_ACTOR_RESPONSE_INVALID'){
          latestFailure={tool:entry.tool,kind:'actor_response',code:value.code,message:value.message,issues:value.issues,action_outcome:'not_attempted'};continue;
        }
        if(entry.tool==='automation_snapshot_feedback'&&value.code==='AUTOMATION_BROWSER_SNAPSHOT_UNCHANGED'){
          latestFailure={tool:entry.tool,kind:'snapshot_redundant',code:value.code,message:typeof value.message==='string'?value.message.slice(0,1000):undefined,
            action_outcome:'not_attempted',expected_result_verified:false,remaining_unchanged_snapshot_refreshes:0};continue;
        }
        if(entry.tool==='automation_assertion_feedback'&&value.code==='AUTOMATION_BROWSER_ASSERTION_SUBJECT_MISMATCH'){
          latestFailure={tool:entry.tool,kind:'assertion_subject',code:value.code,assertion_subject:value.assertion_subject,attempted_assertion:value.attempted_assertion,
            message:typeof value.message==='string'?value.message.slice(0,1400):undefined,action_outcome:'not_attempted',retry_safe:true,...(value.value_assertion_contract?{value_assertion_contract:value.value_assertion_contract}:{})};continue;
        }
        if(entry.tool==='automation_assertion_feedback'&&value.code==='AUTOMATION_BROWSER_ASSERTION_EXCERPT_NOT_EXACT'){
          latestFailure={tool:entry.tool,kind:'assertion_excerpt',code:value.code,message:typeof value.message==='string'?value.message.slice(0,1000):undefined,action_outcome:'not_attempted',retry_safe:true};continue;
        }
        if(entry.tool==='automation_assertion_feedback'&&value.code==='AUTOMATION_BROWSER_ASSERTION_CONTAINER_TEXT_MISMATCH'){
          latestFailure={tool:entry.tool,kind:'assertion_container_text',code:value.code,message:typeof value.message==='string'?value.message.slice(0,1000):undefined,
            remaining_contract:typeof value.remaining_contract==='string'?value.remaining_contract.slice(0,180):undefined,
            evidence_refs:Array.isArray(value.evidence_refs)?value.evidence_refs.filter(ref=>typeof ref==='string'&&/^ref:[a-f0-9]{12}:[1-9]\d{0,2}$/.test(ref)).slice(0,6):[],
            action_outcome:'not_attempted',retry_safe:true};continue;
        }
        if(entry.tool==='automation_assertion_feedback'&&value.code==='AUTOMATION_BROWSER_EXPECTED_PROSE_AS_TEXT'){
          latestFailure={tool:entry.tool,kind:'assertion_prose',code:value.code,message:typeof value.message==='string'?value.message.slice(0,1000):undefined,
            remaining_contract:typeof value.remaining_contract==='string'?value.remaining_contract.slice(0,180):undefined,
            evidence_refs:Array.isArray(value.evidence_refs)?value.evidence_refs.filter(ref=>typeof ref==='string'&&/^ref:[a-f0-9]{12}:[1-9]\d{0,2}$/.test(ref)).slice(0,6):[],
            action_outcome:'not_attempted',retry_safe:true};continue;
        }
        if(entry.tool==='automation_verification_feedback'&&value.code==='AUTOMATION_BROWSER_VERIFICATION_ACTION_BLOCKED'){
          latestFailure={...(assertionFailure||{}),recovery:{code:value.code,phase:'verification_observation_only',message:typeof value.message==='string'?value.message.slice(0,1000):undefined,action_outcome:'not_attempted'}};continue;
        }
        if(entry.tool==='automation_action_order_feedback'&&value.code==='AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER'){
          latestFailure={tool:entry.tool,kind:'action_order',code:value.code,message:typeof value.message==='string'?value.message.slice(0,1000):undefined,action_outcome:'not_attempted',retry_safe:true};continue;
        }
        if(entry.tool==='automation_locator_feedback')continue;
        if((entry.tool.startsWith('automation_browser_')||entry.tool==='automation_navigation_feedback')&&latestFailure){latestFailure={...latestFailure,recovery:{code:value.code,message:typeof value.message==='string'?value.message.slice(0,1000):undefined,
          ...(Number.isSafeInteger(value.latest_browser_failure?.failed_check_count)?{failed_check_count:value.latest_browser_failure.failed_check_count}:{}),
          ...(value.latest_browser_failure?.remaining_unchanged_state_retries===0?{remaining_unchanged_state_retries:0,recovery_required:'inspect_observed_failure_or_correct_target'}:{})}};continue;}
        if(entry.tool==='automation_navigation_feedback'&&value.code==='AUTOMATION_NAVIGATION_ALREADY_REACHED'){
          latestFailure={tool:entry.tool,kind:'navigation_feedback',code:value.code,message:typeof value.message==='string'?value.message.slice(0,1000):undefined,remaining_contract:value.remaining_contract,observed_at:entry.observed_at};continue;
        }
        if(['AUTOMATION_GENERATED_SOURCE_INVALID','AUTOMATION_PROGRAM_TOOLS_UNSUPPORTED','AUTOMATION_TOOL_BATCH_TOO_LARGE','AUTOMATION_BROWSER_PREREQUISITE_SOURCE_REQUIRED','AUTOMATION_PARAMETER_REFERENCE_REQUIRED','AUTOMATION_BROWSER_REPEATED_CHECK','AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED','AUTOMATION_BROWSER_ARGUMENT_SCHEMA_INVALID','AUTOMATION_BROWSER_TARGET_REF_STALE','AUTOMATION_BROWSER_TARGET_REF_INVALID','AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED'].includes(value?.code)||value?.code==='AUTOMATION_BROWSER_EXECUTION_REQUIRED'&&value.source_expected_result_check==='executable_assertion_required')latestFailure={tool:entry.tool,kind:value.code==='AUTOMATION_PARAMETER_REFERENCE_REQUIRED'?'input_reference':['automation_tool_schema_feedback','automation_target_feedback'].includes(entry.tool)?'tool_arguments':entry.tool.startsWith('automation_browser_')?'browser_recovery':'generated_source',code:value.code,
          message:typeof value.message==='string'?value.message.slice(0,1000):undefined,reason:value.reason,...(entry.tool==='automation_target_feedback'?{tool_name:value.tool,action_outcome:value.action_outcome,retry_safe:value.retry_safe}:{}),...(entry.tool==='automation_tool_schema_feedback'?{tool_name:value.tool,argument_names:value.argument_names,selected_mode:value.selected_mode,field_issues:value.field_issues}:{}),observed_at:entry.observed_at};
      }catch{}
      continue;
    }
    if(!entry.tool?.startsWith('browser_')||['browser_snapshot','browser_screenshot'].includes(entry.tool))continue;
    const result=browserReceipt(entry);
    if(result?.action_outcome==='completed')completed[entry.tool]=(completed[entry.tool]||0)+1;
    const checkFailure=unsuccessfulBrowserCheck(entry);
    const row={tool:entry.tool,locator:typeof entry.arguments?.locator==='string'?entry.arguments.locator.slice(0,500):undefined,
      assertion:entry.arguments?.assertion,action_outcome:result?.action_outcome,
      assertion_outcome:result?.assertion_outcome,...(Number.isSafeInteger(result?.match_count)?{match_count:result.match_count}:{}),...(typeof result?.unique==='boolean'?{unique:result.unique}:{}),failed:entry.result?.isError===true||Boolean(checkFailure),observed_at:entry.observed_at};
    if(isNavigationPrerequisite(entry))row.include_in_section_source=true;
    // Values are intentionally absent: data references remain in the reviewed
    // task, while the ledger establishes what really ran and which check failed.
    receipts.push(row);
    if(checkFailure){
      const privateDetails=browserCheckPromptDetails(entry);
      const failure={...checkFailure,...(privateDetails?{attempted_check:privateDetails}:{}),observed_at:entry.observed_at};
      if(entry.tool==='browser_assert')assertionFailure=failure;
      else if(latestFailure?.tool!=='browser_validate_locator')failureBeforeLocator=latestFailure;
      latestFailure=failure;
      if(entry.tool==='browser_validate_locator')locatorResolution=undefined;
    }
    else if(entry.result?.isError){
      let fault;
      for(const part of entry.result.content||[])if(part.type==='text')try{const value=JSON.parse(part.text);if(value?.source==='playwright')fault=value;}catch{}
      // Failed checks are not success receipts. Keep their typed diagnostics
      // prominent without returning expected input values or raw exceptions.
      latestFailure={tool:entry.tool,assertion:entry.arguments?.assertion,
        assertion_subject:['url','url_contains'].includes(entry.arguments?.assertion)?'address_bar_url':['title','title_normalized'].includes(entry.arguments?.assertion)?'document_title':undefined,
        locator:row.locator,code:typeof fault?.code==='string'?fault.code:undefined,
        action_outcome:fault?.action_outcome,assertion_outcome:fault?.assertion_outcome,
        observed_at:entry.observed_at};
    }else if(entry.tool==='browser_validate_locator'&&result?.match_count===1&&result.unique===true){
      locatorResolution={locator:row.locator,match_count:1,unique:true,expected_result_verified:false};
      // Discovery can repair a lookup without satisfying an earlier visible,
      // text or business-state assertion. Keep that obligation explicit, while
      // retiring the obsolete zero/ambiguous-match diagnostic.
      if(latestFailure?.tool==='browser_validate_locator')latestFailure=assertionFailure||failureBeforeLocator;
      if(latestFailure?.tool==='browser_assert')latestFailure={...latestFailure,locator_resolution:'a_unique_locator_is_available',remaining_contract:'browser_assert_required_after_failed_check'};
    }else if(entry.tool==='browser_assert'&&result?.assertion_outcome==='satisfied'){
      assertionFailure=undefined;failureBeforeLocator=undefined;
      if(latestFailure?.tool==='browser_assert'||latestFailure?.tool==='browser_validate_locator'||latestFailure?.kind==='navigation_feedback'||latestFailure?.kind==='browser_recovery'||latestFailure?.kind==='assertion_subject'||latestFailure?.kind==='assertion_prose'||latestFailure?.kind==='assertion_container_text'||latestFailure?.kind==='snapshot_redundant'||latestFailure?.kind==='actor_response'||latestFailure?.kind==='outcome_target'||latestFailure?.code==='AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED'&&latestFailure.tool_name===entry.tool)latestFailure=undefined;
    }
    if(result?.action_outcome==='completed'){
      locatorResolution=undefined;
      if(latestFailure?.kind==='snapshot_redundant'||latestFailure?.code==='AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED'&&latestFailure.tool_name===entry.tool)latestFailure=undefined;
    }
  }
  while(receipts.length>1&&JSON.stringify(receipts).length>(compactModel?2500:6000))receipts.shift();
  if(compactModel&&snapshot){
    const {modelTargetForLocator}=require('./automationBrowserModelTargets');
    if(locatorResolution&&typeof modelTargetForLocator==='function')locatorResolution.locator=modelTargetForLocator(locatorResolution.locator,snapshot)||locatorResolution.locator;
    for(const row of receipts)if(row.locator){const target=typeof modelTargetForLocator==='function'&&modelTargetForLocator(row.locator,snapshot);if(target)row.locator=target;else delete row.locator;}
  }
  if(compactModel){
    for(const row of receipts)delete row.observed_at;
    if(latestFailure){
      latestFailure={...latestFailure};delete latestFailure.observed_at;
      if(latestFailure.locator&&snapshot){
        const target=require('./automationBrowserModelTargets').modelTargetForLocator(latestFailure.locator,snapshot);
        if(target)latestFailure.locator=target;
        else {delete latestFailure.locator;latestFailure.target_not_in_current_snapshot=true;}
      }
      if(latestFailure.tool==='browser_assert'&&locatorResolution){
        delete latestFailure.locator;
        latestFailure.message='A previous expected-result assertion remains unsatisfied. Locator discovery now succeeded; perform the intended assertion with the current observed target. Locator validation alone does not establish the expected result.';
      }
    }
    if(receipts.length>6)receipts.splice(0,receipts.length-6);
  }
  const history=compactModel?modelObservationHistory(observations,stepId):compactBrowserObservations(observations.map(entry=>entry.tool==='browser_snapshot'&&!entry.result?.isError?snapshotMetadata(entry):entry),14000);
  return {current:{url:location,active_step_id:stepId,current_snapshot:page||null,snapshot_available:Boolean(page),
    snapshot_captured_for_step_id:snapshot?.execution_step_id,completed_actions:completed,recent_section_receipts:receipts,
    latest_failure:latestFailure,locator_resolution:locatorResolution},history};
}

module.exports={compactBrowserObservations,browserPromptContext,browserCurrentSnapshotObservation,browserCurrentSnapshot,modelObservationHistory};
