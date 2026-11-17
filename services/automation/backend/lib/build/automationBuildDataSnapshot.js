const {getOptionalEvidenceAccess}=require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const cases=require('@hellotest/testing/backend/services/testCase.service');
const {parameterValues}=require('@hellotest/platform/backend/src/utils/linkedManualParameters');
const {normalizeDataOptions}=require('@hellotest/platform/backend/src/utils/scopedTestData');
const {hasGeneratorTemplate}=require('@hellotest/platform/backend/src/utils/testDataGenerators');

function authoringValues(snapshot){
 const generated=new Set(snapshot.generated_parameter_names||[]);
 const templates=parameterValues(snapshot.parameter_template_values);
 return Object.fromEntries(Object.entries(parameterValues(snapshot.values)).filter(([name])=>!generated.has(name))
  .map(([name,value])=>[name,Object.hasOwn(templates,name)?templates[name]:value]));
}

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

/** Keep generated build samples separate from reusable authoring defaults.
 * Hidden inherited/environment values are intentionally never copied here. */
async function prepareBuildDataSnapshot({testCase,projectId,userId,generatedValues={},authoredValues={},authoredTemplates={},defaultedValues={},privateNames=[]}){
 const defaults=Object.fromEntries(Object.entries(parameterValues(defaultedValues)).filter(([,value])=>value===''));
 const reviewed=parameterValues(authoredValues);
 const values={...parameterValues(generatedValues),...defaults,...reviewed};
 if(!Object.keys(values).length)return null;
 await assertDataSnapshotAccess({userId,projectId});
 const reviewedNames=Object.keys(reviewed);
 const generatedNames=Object.keys(parameterValues(generatedValues)).filter(name=>!Object.hasOwn(defaults,name)&&!Object.hasOwn(reviewed,name));
 const templates=parameterValues(authoredTemplates);
 const parameterTemplates=Object.fromEntries(reviewedNames.filter(name=>hasGeneratorTemplate(templates[name])).map(name=>[name,templates[name]]));
 const candidates=new Set([...reviewedNames,...Object.keys(defaults)]);
 const privateSet=new Set(privateNames);
 const privateKeys=normalizeDataOptions({private_parameter_names:[...candidates].filter(key=>privateSet.has(key))}).private_parameter_names||[];
 const snapshot={values,reviewed_parameter_names:reviewedNames,generated_parameter_names:generatedNames,
  ...(Object.keys(parameterTemplates).length?{parameter_template_values:parameterTemplates}:{}),private_parameter_names:privateKeys};
 snapshotOptions(testCase,{...parameterValues(testCase.parameter_values),...authoringValues(snapshot)},reviewedNames,privateKeys);
 const current=await cases.getTestCase(testCase.id);
 return {...snapshot,expected_revision:Number(current.revision)};
}

/** Caller holds target/source locks; defaults and the current section commit together. */
async function persistBuildDataSnapshot({testCase,projectId,userId,snapshot}){
 if(!snapshot||!Object.keys(snapshot.values||{}).length)return;
 await assertDataSnapshotAccess({userId,projectId});
 // Existing own or linked generators keep their original source and policy.
 // The build's fixed samples stay in snapshot.values for its observed actions.
 const values={...parameterValues(testCase.parameter_values),...authoringValues(snapshot)};
 const {options,hasMarkers}=snapshotOptions(testCase,values,[...(snapshot.reviewed_parameter_names||[]),...(snapshot.generated_priority_parameter_names||[])],snapshot.private_parameter_names||[]);
 await cases.updateTestCase(testCase.id,{
  parameter_values:values,
  ...(hasMarkers?{test_data_options:options}:{}),
  expected_revision:snapshot.expected_revision,
  updated_by:userId
 },{syncSharedGroups:false});
}

module.exports={prepareBuildDataSnapshot,persistBuildDataSnapshot};
