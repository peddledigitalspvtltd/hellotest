const transactions=require('@hellotest/platform/backend/services/workspaceTransaction.service');
const workspace=require('../lib/automationWorkspacePreview');
const MIME='application/vnd.hellotest.automation-build-data+json';
const invalid=()=>Object.assign(new Error('Resolved build data is unavailable for this activity.'),{statusCode:404});
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);
function snapshot(input){
 if(!input||!identifier(input.test_case_id)||!Array.isArray(input.steps)||!Array.isArray(input.manual_steps)||input.steps.length>2000||input.manual_steps.length>2000)throw invalid();
 const content=value=>{if(value==null)return '';if(typeof value!=='string'||value.length>20000)throw invalid();return value;};
 const steps=input.steps.map(row=>{if(!identifier(row?.step_id))throw invalid();return {step_id:row.step_id,action:content(row.action),expected_result:content(row.expected_result)};});
 const manual_steps=input.manual_steps.map(row=>{if(!identifier(row?.manual_step_id)||!identifier(row?.manual_test_case_id))throw invalid();return {manual_step_id:row.manual_step_id,manual_test_case_id:row.manual_test_case_id,action:content(row.action),expected_result:content(row.expected_result)};});
 const parameter_values=Object.fromEntries(Object.entries(input.parameter_values||{}).filter(([key,value])=>identifier(key)&&typeof value==='string'&&value.length<=20000&&!/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i.test(key)));
 const references=value=>[...new Set((Array.isArray(value)?value:[]).filter(identifier))].slice(0,2000);
 return {schema_version:1,kind:'automation_build_data',test_case_id:input.test_case_id,steps,manual_steps,parameter_values,
  parameter_references:references(input.parameter_references),private_parameter_references:references(input.private_parameter_references),
  missing_parameter_references:references(input.missing_parameter_references),
  created_at:new Date().toISOString(),verification_status:'unverified'};
}
async function create(transactionId,input){
 if(!transactionId)return {};
 const payload=snapshot(input);
 const artifact=await transactions.createTransactionArtifact(transactionId,{file_name:`build-data-${payload.test_case_id}.json`,mime_type:MIME,content:workspace.artifactJson(payload)});
 return {build_data_artifact_id:artifact.id};
}
async function read(transaction,artifactId){
 let artifact;try{artifact=await transactions.getTransactionArtifact(artifactId);}catch(error){if(error.message==='Workspace transaction artifact not found')throw invalid();throw error;}
 const value=workspace.readArtifact(artifact,transaction,MIME,'automation_build_data');
 if(transaction.metadata?.build_data_artifacts?.[value.test_case_id]!==artifactId)throw invalid();
 return value;
}
module.exports={MIME,snapshot,create,read};
