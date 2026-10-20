const {getOptionalEvidenceAccess}=require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const cases=require('@hellotest/testing/backend/services/testCase.service');
const {parameterValues}=require('@hellotest/platform/backend/src/utils/linkedManualParameters');
const {normalizeDataOptions}=require('@hellotest/platform/backend/src/utils/scopedTestData');

function snapshotOptions(testCase,values,reviewedNames,privateNames=[]){
 const options=normalizeDataOptions(testCase.test_data_options||{});
 const parameter_overrides=[...new Set([...(options.parameter_overrides||[]),...reviewedNames])].filter(key=>Object.hasOwn(values,key));
 const private_parameter_names=[...new Set([...(options.private_parameter_names||[]),...privateNames])].filter(key=>Object.hasOwn(values,key));
 try{return {options:normalizeDataOptions({...options,parameter_overrides,private_parameter_names}),hasMarkers:Boolean(options.parameter_overrides?.length||parameter_overrides.length||options.private_parameter_names?.length||private_parameter_names.length)};}
 catch(error){throw Object.assign(error,{code:'AUTOMATION_BUILD_PARAMETERS_INVALID',nonRetryable:true});}
}

async function assertDataSnapshotAccess({userId,projectId}){
 const permissions=['testcase.update','data.view'];
 const access=await getOptionalEvidenceAccess({id:userId},projectId,permissions);
 if(permissions.some(permission=>!access[permission]))throw Object.assign(new Error('Saving generated automation data requires test case update and test data access.'),{statusCode:403,code:'AUTOMATION_GENERATED_DATA_ACCESS_REQUIRED'});
}

/** Freeze generated public data and authored build choices with first source.
 * Hidden inherited/environment values are intentionally never copied here. */
async function prepareBuildDataSnapshot({testCase,projectId,userId,generatedValues={},authoredValues={},defaultedValues={},privateNames=[],parameterOverrides=[]}){
 const defaults=Object.fromEntries(Object.entries(parameterValues(defaultedValues)).filter(([,value])=>value===''));
 const values={...parameterValues(generatedValues),...defaults,...parameterValues(authoredValues)};
 if(!Object.keys(values).length)return null;
 await assertDataSnapshotAccess({userId,projectId});
 const reviewedNames=Object.keys(parameterValues(authoredValues));
 const originalPriority=new Set(normalizeDataOptions({parameter_overrides:parameterOverrides}).parameter_overrides||[]);
 // Materializing a public inherited generator changes its owner to this case.
 // Preserve its existing chosen priority without promoting other generators
 // or the server's missing-input blanks above reusable data sources.
 const generatedPriorityNames=Object.keys(parameterValues(generatedValues)).filter(name=>originalPriority.has(name));
 const candidates=new Set([...reviewedNames,...Object.keys(defaults)]);
 const privateSet=new Set(privateNames);
 const privateKeys=normalizeDataOptions({private_parameter_names:[...candidates].filter(key=>privateSet.has(key))}).private_parameter_names||[];
 snapshotOptions(testCase,{...parameterValues(testCase.parameter_values),...values},[...reviewedNames,...generatedPriorityNames],privateKeys);
 const current=await cases.getTestCase(testCase.id);
 return {values,reviewed_parameter_names:reviewedNames,...(generatedPriorityNames.length?{generated_priority_parameter_names:generatedPriorityNames}:{}),private_parameter_names:privateKeys,expected_revision:Number(current.revision)};
}

/** Caller holds target/source locks; defaults and the current section commit together. */
async function persistBuildDataSnapshot({testCase,projectId,userId,snapshot}){
 if(!snapshot||!Object.keys(snapshot.values||{}).length)return;
 await assertDataSnapshotAccess({userId,projectId});
 const values={...parameterValues(testCase.parameter_values),...snapshot.values};
 const {options,hasMarkers}=snapshotOptions(testCase,values,[...(snapshot.reviewed_parameter_names||[]),...(snapshot.generated_priority_parameter_names||[])],snapshot.private_parameter_names||[]);
 await cases.updateTestCase(testCase.id,{
  parameter_values:values,
  ...(hasMarkers?{test_data_options:options}:{}),
  expected_revision:snapshot.expected_revision,
  updated_by:userId
 },{syncSharedGroups:false});
}

module.exports={prepareBuildDataSnapshot,persistBuildDataSnapshot};
