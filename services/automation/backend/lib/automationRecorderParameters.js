const {parameterReference}=require('./automationBrowserParameters');

const inputField=action=>action?.type==='navigation'?'url':action?.type==='press'?(action.text?'text':'value'):['fill','change','select','upload'].includes(action?.type)?'value':null;
const privateTarget=action=>/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i.test(`${action?.locator||''} ${action?.text||''}`);

/** A recording uses only references authored in its mapped source action.
 * Equal values elsewhere in the case cannot grant a binding. Rebuild the
 * host-owned candidate from the symbolic action; never rewrite source text. */
function bindRecorderParameterCandidates({candidates=[],mappings=[],actions=[],resolver,rebuildCandidate}){
  const actionByIndex=new Map(actions.map(action=>[Number(action.index),action]));
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
    const matches=names.filter(name=>{
      try{return String(resolver.resolve('browser_fill',{value:parameterReference(name)}).value)===value;}
      catch{return false;}
    });
    if(matches.length===1){
      const next=rebuildCandidate({...action,[field]:parameterReference(matches[0])},candidate.step_order);
      if(!next)throw Object.assign(new Error('The recorded parameter input could not be rebuilt. Existing sections were retained.'),{code:'AUTOMATION_RECORDER_PARAMETER_MAPPING_INVALID',statusCode:422});
      byIndex.set(Number(candidate.source_action_index),next);
      continue;
    }
    // Never replace a private value with an invented @t.password, and never
    // save a private literal into executable source or downloadable artifacts.
    if(privateTarget(action)||resolver.projectPrivateText(value)!==value||action.type==='upload'&&!value){
      throw Object.assign(new Error('A recorded private input needs one matching Test Param reference in its mapped step action. Configure the parameter and reference, then save this recording again. Existing sections were retained.'),{
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
