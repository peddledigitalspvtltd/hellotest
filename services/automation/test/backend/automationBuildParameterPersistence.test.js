const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const source=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8');
const body=source.slice(source.indexOf('const applyBuild ='),source.indexOf('const buildCaseCore ='));
test('atomic first-source choices refresh their own optimistic receipt; later selected-source changes still reject before writes',async()=>{
 let selectedRegion='East',writes=0,snapshotWrites=0;
 const testCase={id:'automation',display_id:'AT_1',app_type_id:'app',project_id:'project',automated:'yes',parameter_values:{'t.manual':'Live inherited'},test_data_options:{},automation_start_url:null};
 const step={id:'one',test_case_id:'automation',step_order:1,step_type:'web',action:'Enter @r.name',expected_result:'Saved',automation_code:''};
 const rows=[structuredClone(step)];
 const inputResolver=values=>createBrowserParameterResolver({caseValues:values,caseOptions:testCase.test_data_options,environment:{id:'env',variables:[{key:'r.region',value:selectedRegion}]},materialize:false});
 const database={transaction:callback=>callback,prepare:sql=>({get:async()=>structuredClone(testCase),all:async()=>sql.includes('automation_case_links')?[]:structuredClone(rows)})};
 const parameters=async()=>({source_key:JSON.stringify(testCase.parameter_values),runtime_parameter_values:structuredClone(testCase.parameter_values)});
 const steps={updateTestStep:async(id,update)=>{writes++;Object.assign(rows.find(row=>row.id===id),update);}};
 const apply=new Function('db','loadAutomationManualContext','loadAutomationParameterContext','manualContextKey','require','testStepService','markTestCaseAutomationIncomplete','markTestCaseAutomationReady','normalizeText',body+'return applyBuild;')(
  database,async()=>[],parameters,JSON.stringify,id=>{
   if(id.endsWith('automationBrowserParameters'))return{loadBrowserParameterResolver:async input=>{assert.equal(input.lock,true);assert.equal(input.materialize,false);return inputResolver(input.caseValues);}};
   if(id.endsWith('automationBuildDataSnapshot'))return{persistBuildDataSnapshot:async({snapshot})=>{snapshotWrites++;Object.assign(testCase.parameter_values,snapshot.values);testCase.test_data_options={parameter_overrides:snapshot.reviewed_parameter_names};}};
   throw new Error(`Unexpected module ${id}`);
  },steps,{run:async()=>{}},{run:async()=>{}},value=>value
 );
 const identity={project_id:'project',app_type_id:'app',manual_context:[],manual_link_ids:[]};
 const state={steps:structuredClone(rows),parameter_context_key:(await parameters()).source_key,input_context:{selection:{test_environment_id:'env'},source_key:inputResolver(testCase.parameter_values).inputSourceKey},data_snapshot:{values:{'r.name':''},reviewed_parameter_names:['r.name']}};
 const initialKey=state.input_context.source_key;
 const build={...identity,updates:[{step,step_type:'web',automation_code:'await page.getByLabel("Name").fill("@r.name");'}]};
 await apply({build,progressiveState:state,createdBy:'author',partial:true});
 assert.equal(writes,1);assert.equal(snapshotWrites,1);assert.equal(state.data_snapshot,null);assert.notEqual(state.input_context.source_key,initialKey);
 await apply({build,progressiveState:state,createdBy:'author'});assert.equal(writes,1,'final completion does not rewrite identical accepted source');assert.equal(snapshotWrites,1);
 selectedRegion='West';await assert.rejects(apply({build,progressiveState:state,createdBy:'author'}),{code:'AUTOMATION_PARAMETERS_CHANGED'});assert.equal(writes,1);
});
