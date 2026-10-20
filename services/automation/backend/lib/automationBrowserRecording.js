const {browserReceipt,interactiveEvidenceFeedback}=require('./automationInteractiveEvidence');
const {createHash}=require('node:crypto');

// Model output, persisted observations and UI history cannot manufacture these
// records. Only the host's actual browser.call result enters this WeakMap.
const operations=new WeakMap();
const objectTargets=new WeakMap();
const actionTools=new Set(['browser_navigate','browser_click','browser_fill','browser_press_key','browser_select_option','browser_hover','browser_check','browser_uncheck']);
function recordBrowserOperation(observation,request,{snapshot}={}){
  if(!observation||observation.mcp_call===false||operations.has(observation)||observation.tool!==request?.name)return;
  const receipt=browserReceipt(observation);
  if(!receipt||!(actionTools.has(request.name)&&receipt.action_outcome==='completed'||request.name==='browser_assert'&&receipt.assertion_outcome==='satisfied'))return;
  const args=request.arguments;
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.values(args).some(value=>typeof value!=='string'||value.length>2000))return;
  operations.set(observation,Object.freeze({name:request.name,arguments:Object.freeze({...args}),...(request.name==='browser_navigate'&&request.navigation_intent==='reload'?{navigation_intent:'reload'}:{})}));
  if(typeof args.locator==='string'){
    const target=require('./automationBrowserModelTargets').repositoryTargetEvidence(args.locator,snapshot);
    let samePage=true;
    // A read which reports a different page cannot establish that the earlier
    // snapshot's field was its assertion subject. Click/fill targets still
    // belong to the pre-action page when that very action navigates.
    if(target&&request.name==='browser_assert'&&typeof receipt.url==='string'){
      try{const url=new URL(receipt.url),route=url.search||url.hash?createHash('sha256').update(url.href).digest('hex'):null;samePage=url.origin+url.pathname===target.page_url&&route===(target.observed_route_sha256||null);}catch{samePage=false;}
    }
    if(target&&samePage)objectTargets.set(observation,Object.freeze({...target,locator:args.locator}));
  }
}

/** A newly saved flow inherits its real planning-browser navigation prefix.
 * Assign scope on the same protected observations; no receipt or operation is
 * reconstructed from model/JSON/history data and no browser action is replayed. */
function adoptPlanningNavigation(observations,firstWebStepId){
  if(!Array.isArray(observations)||observations.length>2000||typeof firstWebStepId!=='string'||!firstWebStepId.trim()||firstWebStepId.length>200)return 0;
  let adopted=0;
  for(const observation of observations){
    if(!observation||observation.execution_step_id!==undefined||observation.mcp_call===false||observation.tool!=='browser_navigate'
      ||operations.get(observation)?.name!=='browser_navigate'||browserReceipt(observation)?.action_outcome!=='completed')continue;
    try{
      Object.defineProperty(observation,'execution_step_id',{value:firstWebStepId,writable:true,enumerable:true,configurable:true});
      adopted++;
    }catch{/* Immutable observations cannot be adopted; retain their original proof. */}
  }
  return adopted;
}

function recordedSectionRequests(observations,stepId){
  const seen=new Set(),requests=[];
  for(const observation of observations){
    if(observation?.execution_step_id!==stepId||!operations.has(observation))continue;
    if(observation.action_id&&seen.has(observation.action_id))continue;
    if(observation.action_id)seen.add(observation.action_id);
    requests.push(operations.get(observation));
  }
  return requests;
}

/** Only confirmed operations with the original validated pre-action snapshot
 * produce reusable fields. Operation indexes link the object to its exact
 * compiled instruction; assertion input/expected values are never retained. */
function recordedSectionObjectTargets(observations,stepId){
  const seen=new Set(),targets=[];let operationIndex=0;
  for(const observation of observations){
    if(observation?.execution_step_id!==stepId||!operations.has(observation))continue;
    if(observation.action_id&&seen.has(observation.action_id))continue;
    if(observation.action_id)seen.add(observation.action_id);
    operationIndex++;
    const target=objectTargets.get(observation);
    if(target)targets.push({...target,operation_index:operationIndex});
  }
  return targets;
}

/** A model's completion flag is a request to finalize, never execution proof. */
function recordedSectionCandidate({response,execution,observations,compile}){
  if(response?.stage!=='act'||response.section_complete!==true||response.step_id!==execution?.step_id||!execution?.required)return null;
  const requests=recordedSectionRequests(observations,execution.step_id);
  const recorded=compile(requests);
  if(!recorded?.source)return null;
  const payload={...response,steps:[{step_id:execution.step_id,step_type:'web',automation_code:recorded.source}],tool_calls:[]};
  // Actor-only protocol fields do not become the user's final output schema.
  delete payload.stage;delete payload.section_complete;delete payload.step_id;
  if(interactiveEvidenceFeedback({payload,execution,observations}))return null;
  return {payload,operation_count:recorded.operation_count,assertion_count:recorded.assertion_count};
}

function operationKey(request){
  const args=request?.arguments;
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.values(args).some(value=>typeof value!=='string'||value.length>2000))return null;
  return JSON.stringify([request.name,Object.entries(args).sort(([left],[right])=>left.localeCompare(right)),request.name==='browser_navigate'&&request.navigation_intent==='reload'?'reload':null]);
}

/** Actor decisions contain partial work, not a whole source prefix. Reconcile
 * cumulative operation ordinals directly against the protected section ledger;
 * intervening actions, malformed later requests and source rendering cannot
 * erase a confirmed submission. */
function actorOperationState({request,requestIndex,batch,observations,stepId}){
  if(!actionTools.has(request?.name))return null;
  const key=operationKey(request);
  if(!key)return {invalid:true,reason:'invalid_operation_arguments'};
  const implicit=batch.slice(0,requestIndex+1).filter(item=>operationKey(item)===key).length;
  const ordinal=request.occurrence??implicit;
  const completed=[],seen=new Set();
  for(const observation of observations){
    if(observation?.execution_step_id!==stepId||operationKey(operations.get(observation))!==key)continue;
    if(observation.action_id&&seen.has(observation.action_id))continue;
    if(observation.action_id)seen.add(observation.action_id);
    completed.push(observation);
  }
  if(!Number.isSafeInteger(ordinal)||ordinal<1||ordinal>250||ordinal>completed.length+1)return {invalid:true,reason:'operation_occurrence_gap',confirmed_count:completed.length,requested_count:ordinal};
  return ordinal<=completed.length?{reused:true,action_id:completed[ordinal-1].action_id,matching_count:completed.length,candidate_count:ordinal}:null;
}

module.exports={recordBrowserOperation,adoptPlanningNavigation,recordedSectionRequests,recordedSectionObjectTargets,recordedSectionCandidate,actorOperationState};
