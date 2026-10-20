const record=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const issue=(field,expected)=>({field,expected});

/** Describe decisions, not executable source. Actual tool schemas, pinned
 * requirements and host receipts remain the authority for dispatch and saving. */
function automationActorResponseContract({stepId,activeGoal,canRequestContext=false,canRecoverPrerequisite=false,deferredTools=[],completionOnly=false}={}){
 const choices=[...(!completionOnly?[{stage:'act',step_id:stepId,section_complete:false,tool_calls:[{name:'choose exact name from Tool catalog',arguments:{}}]}]:[]),
  ...(!completionOnly?[{stage:'act',step_id:stepId,section_complete:true,tool_calls:[{name:'choose final required check from Tool catalog',arguments:{}}]}]:[]),
  {stage:'act',step_id:stepId,section_complete:true,tool_calls:[]}];
 if(canRequestContext&&!completionOnly)choices.push({actor_context_request:'advertised context request'});
 if(deferredTools.length&&!completionOnly)choices.push({tool_catalog_request:'nonempty array of deferred tool names'});
 if(canRecoverPrerequisite&&!completionOnly)choices.push({prerequisite_request:{reason:'Why one missing UI navigation/disclosure is necessary for this current goal and case intent.',evidence_refs:['exact current observation or target ref'],tool_call:{name:'browser_click',arguments:{locator:'exact current target ref'}}}});
 choices.push({stage:'act',step_id:stepId,section_issue:{kind:'unmet_prerequisite | expectation_mismatch | unexpected_application_state',reason:'short observed reason',evidence_refs:['current observation or target ref']}});
 return {question:completionOnly?'Can this section finish from its confirmed receipts, or which observed prerequisite prevents completion?':'What remains for the pinned active section action and expected result only? Choose one response shape.',
  choices,rules:['The broader user request/flow supplies constraints and context, not permission to execute later actions now. A visible input or available parameter does not request a fill.',
   'Tools excluded by the current authored action policy cannot be borrowed for later actions. If current application evidence establishes a missing same-origin UI navigation/disclosure, use the separate prerequisite_request when advertised; it needs host validation and independent review before one click.',
   'Use boolean section_complete and an array of tool_calls. Do not mix actions with context, discovery or an issue.',
   'Use actual advertised tool argument schemas; examples supply no actions or values.',
   'For element actions and positive checks, copy locator from current_snapshot.targets[].ref. Do not reconstruct role names or CSS. If the target is missing, request scoped discovery before acting. Page checks and hidden/count predicates retain their advertised schemas.',
   'For a semantic outcome, compare persistent in-page statements and the reached destination with every authored clause. A status/alert notification can disappear; prefer a current page_content target when it proves the same requirement. Preserve explicit notification requirements and exact authored literals. A code-sent message does not prove email delivery.',
   'After a failed text check, a vanished notification alone does not prove the outcome failed. Use fresh evidence and advertised read-only discovery/checks before reporting absence. Keep recipient/data clauses bound to their configured parameter references and never repeat a completed submission.',
   completionOnly?'Use confirmed receipts only; no further browser actions, context or discovery requests.':'Batch the remaining supported actions and required checks for this section. If that batch finishes the goal, set section_complete:true in the same response, without a separate acknowledgement turn. Host review follows actual success; this flag certifies nothing.',
   'Check case intent, current goal, prior confirmed work and future order before acting. Infer only necessary UI reachability through prerequisite_request; never invent data, business submissions or expectations. Inaccurate intent/application must report section_issue with current evidence.',
   'Use scoped parameter references for inputs. Preserve every authored outcome and literal. Do not generate source or shell commands.'],
   ...(record(activeGoal)&&typeof activeGoal.action==='string'&&typeof activeGoal.expected_result==='string'
     &&activeGoal.action.length+activeGoal.expected_result.length<=2000?{active_goal:{action:activeGoal.action,expected_result:activeGoal.expected_result},active_goal_scope:'This is the current section only. Perform its action and every outcome; later case actions are not requested now.'}:{})};
}

/** Mechanical envelope defaults reduce copying work for small models. They
 * supply only the already-pinned phase/identity and never an action, assertion,
 * completion decision, parameter value or execution receipt. Explicit conflicts
 * and malformed intent receive feedback before any accompanying tool runs. */
function normalizeAutomationActorResponse(response,{stepId}={}){
 if(!record(response))return {issues:[issue('response','JSON object')]};
 const dispositions=['actor_context_request','tool_catalog_request','section_issue','prerequisite_request'].filter(key=>Object.hasOwn(response,key));
 if(dispositions.length>1)return {issues:[issue('response','one context, discovery or issue decision')]};
 if(response.stage!==undefined&&!['act','source'].includes(response.stage))return {issues:[issue('stage','act for current browser work')]};
 if(response.step_id!==undefined&&response.step_id!==stepId)return {issues:[issue('step_id','the pinned current step ID')]};
 // Existing control branches take precedence and suppress ALL accompanying
 // actions. Keep that conservative behavior instead of asking another model
 // call merely to delete ignored proposals from a context/issue response.
 if(dispositions.length)return {response:dispositions[0]==='section_issue'?{...response,stage:response.stage||'act',step_id:response.step_id??stepId,section_complete:response.section_complete??false}:response};
 if(Object.hasOwn(response,'tool_calls')&&!Array.isArray(response.tool_calls))return {issues:[issue('tool_calls','array of typed tool requests')]};
 if(response.section_complete!==undefined&&typeof response.section_complete!=='boolean')return {issues:[issue('section_complete','boolean true or false')]};
 if(Array.isArray(response.tool_calls)&&response.tool_calls.some(call=>!record(call)||typeof call.name!=='string'||!record(call.arguments)))return {issues:[issue('tool_calls','objects with name and arguments object')]};
 // Legacy source proposals still go through the existing closed lowering and
 // receipt checks. Missing act metadata on a typed proposal is unambiguous.
 const legacySource=response.stage===undefined&&Array.isArray(response.steps)&&response.steps.some(step=>typeof step?.automation_code==='string');
 const typed=!legacySource&&Object.hasOwn(response,'tool_calls')||response.stage==='act';
 return {response:typed?{...response,stage:response.stage||'act',step_id:response.step_id??stepId,section_complete:response.section_complete??false}:response};
}

module.exports={automationActorResponseContract,normalizeAutomationActorResponse};
