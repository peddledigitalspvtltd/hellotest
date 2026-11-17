const record=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const issue=(field,expected)=>({field,expected});

/** Describe decisions, not executable source. Actual tool schemas, pinned
 * requirements and host receipts remain the authority for dispatch and saving. */
function automationActorResponseContract({stepId,activeGoal,canRequestContext=false,canRecoverPrerequisite=false,deferredTools=[],completionOnly=false}={}){
 const choices=[...(!completionOnly?[{section_complete:false,tool_calls:[{name:'catalog name',arguments:{}}]}]:[]),
  ...(!completionOnly?[{section_complete:true,tool_calls:[{name:'final catalog check',arguments:{}}]}]:[]),
  {section_complete:true,tool_calls:[]}];
 if(canRequestContext&&!completionOnly)choices.push({actor_context_request:'advertised request'});
 if(deferredTools.length&&!completionOnly)choices.push({tool_catalog_request:['deferred name']});
 if(canRecoverPrerequisite&&!completionOnly)choices.push({prerequisite_request:{reason:'current-goal necessity',evidence_refs:['current ref'],tool_call:{name:'browser_click',arguments:{locator:'current target ref'}}}});
 choices.push({section_issue:{kind:'unmet_prerequisite | expectation_mismatch | unexpected_application_state',reason:'observed reason',evidence_refs:['current ref']}});
 return {question:`Return ONE flat JSON choice, not this contract/menu. ${completionOnly?'Complete from receipts or report an observed blocker.':'Current goal only.'}`,envelope:{stage:'act',step_id:stepId},
  choices,rules:['Current goal only; broader constraints never authorize later actions. Visible inputs/data grant no fill. Preserve authored policy/order, every outcome/literal, scoped input/recipient refs.',
   'Advertised prerequisites only: one observed same-origin UI reachability click after host validation + independent review. No invented data/submission/expectation.',
   'Boolean section_complete; exact-schema tool_calls array. Context/discovery/issues exclude actions; examples grant no data/actions.',
   'Element actions/positive checks copy current target refs, never rebuild CSS/roles. Missing target: scoped read-only discovery. Page/hidden/count: schemas.',
   'All clauses need persistent page/destination proof and fresh targets/validation. Vanished notices/other-target failures prove no absence; keep explicit notices. Sent code is not delivered email; never repeat submission.',
   completionOnly?'Receipts only: no browser/context/discovery requests.':'Batch current actions/checks; section_complete:true with final checks, no ack turn. Host review follows actual success; flag proves none.',
   'Mismatch: section_issue with current evidence. No source/shell.'],
   ...(record(activeGoal)&&typeof activeGoal.action==='string'&&typeof activeGoal.expected_result==='string'
     &&activeGoal.action.length+activeGoal.expected_result.length<=2000?{active_goal:{action:activeGoal.action,expected_result:activeGoal.expected_result},active_goal_scope:'current_section'}:{})};
}

/** Mechanical envelope defaults reduce copying work for small models. They
 * supply only the already-pinned phase/identity and never an action, assertion,
 * completion decision, parameter value or execution receipt. Explicit conflicts
 * and malformed intent receive feedback before any accompanying tool runs. */
function normalizeAutomationActorResponse(response,{stepId}={}){
 if(!record(response))return {issues:[issue('response','JSON object')]};
 // A copied decision menu is neither a flat actor choice nor legacy source.
 // Reject accompanying tools too; examples never become dispatch authority.
 if(typeof response.question==='string'&&Array.isArray(response.choices)
   &&(record(response.envelope)||Array.isArray(response.rules)))return {issues:[issue('response','ONE flat JSON choice, not the contract/menu')]};
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
