const {parameterReference,referenceKey}=require('./automationBrowserParameters');
const {supersedingInputAction}=require('./automationRecorderActions');

const inputField=action=>action?.type==='navigation'?'url':action?.type==='press'?(action.text?'text':'value'):['fill','change','select','upload'].includes(action?.type)?'value':null;
const privateName=/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;
const privateTarget=action=>{
  if(privateName.test(`${action?.locator||''} ${action?.text||''}`))return true;
  if(action?.type==='navigation')try{const url=new URL(action.url);return Boolean(url.username||url.password||[...url.searchParams].some(([key,value])=>value&&privateName.test(key)));}catch{}
  return false;
};

/** Bind explicitly selected references or references in the mapped source action.
 * Equal values elsewhere in the case cannot grant a binding. Rebuild the
 * host-owned candidate from the symbolic action; never rewrite source text. */
function bindRecorderParameterCandidates({candidates=[],mappings=[],actions=[],resolver,rebuildCandidate,parameterBindings=[]}){
  const actionByIndex=new Map(actions.map(action=>[Number(action.index),action]));
  const bindingFailure=()=>Object.assign(new Error('A recorded input parameter selection is invalid or unavailable. Choose an existing scoped parameter for that recorded input and save again. Existing instructions were retained.'),{code:'AUTOMATION_RECORDER_PARAMETER_BINDING_INVALID',statusCode:422});
  if(!Array.isArray(parameterBindings)||parameterBindings.length>actions.length)throw bindingFailure();
  const explicit=new Map();
  for(const binding of parameterBindings){
    const index=binding?.source_action_index,reference=binding?.parameter_reference;
    if(!Number.isSafeInteger(index)||!actionByIndex.has(index)||!inputField(actionByIndex.get(index))||typeof reference!=='string'||!/^@[tsr]\./i.test(reference)||explicit.has(index))throw bindingFailure();
    const key=referenceKey(reference);if(!key)throw bindingFailure();
    try{resolver.resolve('browser_fill',{value:parameterReference(key)});}catch{throw bindingFailure();}
    explicit.set(index,key);
  }
  // A choice made on an early keystroke follows the same input burst to the
  // final compiled fill. A later explicit choice takes precedence.
  const effective=new Map(explicit);
  for(let index=actions.length-1;index>=0;index--){
    const action=actions[index];if(!explicit.has(Number(action.index)))continue;
    let current=action,position=index,next;
    while((next=supersedingInputAction(current,actions,position))){current=next;position++;}
    if(!effective.has(Number(current.index)))effective.set(Number(current.index),explicit.get(Number(action.index)));
  }
  const sourceByIndex=new Map();
  for(const mapping of mappings)for(const candidate of mapping.candidates||[]){
    const index=Number(candidate.source_action_index);
    if(sourceByIndex.has(index)&&sourceByIndex.get(index)!==mapping.step)throw Object.assign(new Error('A recorded action maps to more than one source step. Review its mapping before saving.'),{code:'AUTOMATION_RECORDER_PARAMETER_MAPPING_INVALID',statusCode:422});
    sourceByIndex.set(index,mapping.step);
  }
  const byIndex=new Map();
  for(const candidate of candidates){
    const action=actionByIndex.get(Number(candidate.source_action_index)),field=inputField(action);
    if(!field){byIndex.set(Number(candidate.source_action_index),candidate);continue;}
    const value=String(action[field]??''),step=sourceByIndex.get(Number(candidate.source_action_index));
    const names=step?resolver.referencedParameterNames([{action:step.action||'',expected_result:''}]):[];
    const selected=effective.get(Number(candidate.source_action_index));
    const matches=selected?[selected]:names.filter(name=>{
      try{return String(resolver.resolve('browser_fill',{value:parameterReference(name)}).value)===value;}
      catch{return false;}
    });
    if(matches.length===1){
      const next=rebuildCandidate({...action,[field]:parameterReference(matches[0])},candidate.step_order);
      if(!next)throw Object.assign(new Error('The recorded parameter input could not be rebuilt. Existing sections were retained.'),{code:'AUTOMATION_RECORDER_PARAMETER_MAPPING_INVALID',statusCode:422});
      const reference=parameterReference(matches[0]);
      if(!String(next.action||'').includes(reference))next.action=`${next.action} using ${reference}`;
      byIndex.set(Number(candidate.source_action_index),next);
      continue;
    }
    // Never replace a private value with an invented @t.password, and never
    // save a private literal into executable source or downloadable artifacts.
    if(privateTarget(action)||resolver.projectPrivateText(value)!==value||action.type==='upload'&&!value){
      throw Object.assign(new Error('Choose a configured Test, Suite or Run Param for this recorded private input, then save this recording again. A unique matching reference in its source action can also supply the binding. Existing sections were retained.'),{
        code:'AUTOMATION_RECORDER_PRIVATE_INPUT_REQUIRED',statusCode:422,step_id:step?.id||null,parameter_references:names
      });
    }
    byIndex.set(Number(candidate.source_action_index),candidate);
  }
  return {candidates:candidates.map(candidate=>byIndex.get(Number(candidate.source_action_index))),mappings:mappings.map(mapping=>({...mapping,candidates:mapping.candidates.map(candidate=>byIndex.get(Number(candidate.source_action_index)))}))};
}

/** Input values are unnecessary for repository naming and step alignment.
 * Known case secrets use the common projector; additional recorded private
 * fields are removed even before a valid symbolic binding has been selected. */
function recorderPromptProjector({actions=[],resolver}){
  const values=[...new Set(actions.filter(privateTarget).map(action=>String(action.value??'')).filter(Boolean))].sort((a,b)=>b.length-a.length);
  return input=>{
    let output=resolver.projectPrivateText(String(input??''),{preserveReferences:true});
    for(const value of values){
      output=output.split(JSON.stringify(value)).join(JSON.stringify('[private recorded input]'));
      if(value.length>=4)output=output.split(value).join('[private recorded input]');
    }
    return output;
  };
}

module.exports={bindRecorderParameterCandidates,recorderPromptProjector};
