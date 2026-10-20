const {normalizeParameterKey}=require('./stepParameterResolution');
const {normalizeDataOptions}=require('./scopedTestData');
function parameterValues(input){
 let value=input;if(typeof value==='string')try{value=JSON.parse(value);}catch{return {};}
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[normalizeParameterKey(key,'t'),item==null?'':String(item)]).filter(([key])=>key));
}
/** Linked source values are live defaults. Only authored automation keys are overrides. */
function resolveLinkedManualParameters(automation,sources=[]){
 const targetId=automation.id||automation.test_case_id;
 const ordered=[...sources].sort((a,b)=>Number(Boolean(b.is_primary))-Number(Boolean(a.is_primary))||String(a.manual_test_case_id||a.id).localeCompare(String(b.manual_test_case_id||b.id)));
 const sourceOptions=new Map(ordered.map(source=>[source.manual_test_case_id||source.id,normalizeDataOptions(source.test_data_options||{})]));
 const inherited={},provenance={},conflicts=new Map();
 for(const source of ordered){
  const id=source.manual_test_case_id||source.id;
  for(const [name,value]of Object.entries(parameterValues(source.parameter_values))){
   // Unfilled manual placeholders cannot hide filled defaults from another link.
   if(value===''&&!sourceOptions.get(id)?.parameter_overrides?.includes(name))continue;
   if(!Object.hasOwn(inherited,name)){inherited[name]=value;provenance[name]={kind:'linked_manual',test_case_id:id,...(source.display_id?{display_id:source.display_id}:{})};}
   else if(inherited[name]!==value){const conflict=conflicts.get(name)||{name,chosen_test_case_id:provenance[name].test_case_id,other_test_case_ids:[]};if(!conflict.other_test_case_ids.includes(id))conflict.other_test_case_ids.push(id);conflicts.set(name,conflict);}
  }
 }
 // Keep authored blanks when no linked source has a filled value. This makes
 // inheritance, clone previews and execution use the same explicit binding.
 for(const source of ordered){
  const id=source.manual_test_case_id||source.id;
  for(const [name,value]of Object.entries(parameterValues(source.parameter_values))){
   if(value===''&&!Object.hasOwn(inherited,name)){inherited[name]='';provenance[name]={kind:'linked_manual',test_case_id:id,...(source.display_id?{display_id:source.display_id}:{})};}
  }
 }
 const sourcePrivacy=new Map([...sourceOptions].map(([id,options])=>[id,new Set(options.private_parameter_names||[])]));
 const ownOptions=normalizeDataOptions(automation.test_data_options||{});
 const privateNames=new Set(ownOptions.private_parameter_names||[]);
 for(const [name,receipt]of Object.entries(provenance))if(sourcePrivacy.get(receipt.test_case_id)?.has(name))privateNames.add(name);
 const own=parameterValues(automation.parameter_values),effective={...inherited,...own};
 for(const name of Object.keys(own))provenance[name]={kind:'automation',test_case_id:targetId,...(automation.display_id?{display_id:automation.display_id}:{})};
 const inheritedOverrides=Object.entries(provenance).filter(([name,receipt])=>receipt.kind==='linked_manual'&&sourceOptions.get(receipt.test_case_id)?.parameter_overrides?.includes(name)).map(([name])=>name).sort();
 const effectiveOverrides=[...new Set([...inheritedOverrides,...(ownOptions.parameter_overrides||[]).filter(name=>Object.hasOwn(own,name))])].sort();
 return {inherited_parameter_values:inherited,effective_parameter_values:effective,inherited_parameter_overrides:inheritedOverrides,effective_parameter_overrides:effectiveOverrides,private_parameter_names:[...privateNames].filter(name=>Object.hasOwn(effective,name)).sort(),parameter_sources:provenance,parameter_conflicts:[...conflicts.values()].filter(row=>!Object.hasOwn(own,row.name)),
  // Internal optimistic-build receipt. Never return source values in public provenance.
  source_key:JSON.stringify({own,options:ownOptions,sources:ordered.map(source=>({id:source.manual_test_case_id||source.id,primary:Boolean(source.is_primary),parameters:parameterValues(source.parameter_values),options:sourceOptions.get(source.manual_test_case_id||source.id)}))})};
}
function parameterProjection(resolved){const {inherited_parameter_values,effective_parameter_values,parameter_sources,parameter_conflicts}=resolved;return {inherited_parameter_values,effective_parameter_values,inherited_parameter_overrides:resolved.inherited_parameter_overrides||[],effective_parameter_overrides:resolved.effective_parameter_overrides||[],effective_private_parameter_names:resolved.private_parameter_names||[],parameter_sources,parameter_conflicts};}
/** Apply name-only chosen-source provenance to an immutable runtime snapshot.
 * Authoring options and inherited values keep their separate owners. */
function effectiveLinkedDataOptions(testCase,resolved){
 const options=normalizeDataOptions(testCase.test_data_options||{},testCase.automated==='yes'?'sections':'steps');
 return normalizeDataOptions({...options,parameter_overrides:[...new Set([...(options.parameter_overrides||[]),...(resolved?.effective_parameter_overrides||[])])],private_parameter_names:[...new Set([...(options.private_parameter_names||[]),...(resolved?.private_parameter_names||[])])]},testCase.automated==='yes'?'sections':'steps');
}
module.exports={parameterValues,resolveLinkedManualParameters,parameterProjection,effectiveLinkedDataOptions};
