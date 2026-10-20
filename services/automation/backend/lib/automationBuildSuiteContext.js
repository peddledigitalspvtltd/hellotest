const {createSuiteExecutionContext}=require('@hellotest/testing/backend/services/suiteExecutionContext.service');
const {normalizeParameterLayer}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {normalizeDataOptions}=require('@hellotest/platform/backend/src/utils/scopedTestData');

const failure=(code,message,statusCode=422)=>Object.assign(new Error(message),{code,statusCode,nonRetryable:true,failure_stage:'context',automation_stage:'context',generation_provider_requests:0,browser_actions:0});
const parse=(value,fallback={})=>{if(typeof value!=='string')return value||fallback;try{return JSON.parse(value);}catch{return fallback;}};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const identity=value=>JSON.stringify(canonical(value));

/** Read only the selected case's suite graph. The normal execution context
 * resolver owns ancestor/default precedence; this adapter adds build ACL,
 * deterministic selection and an immutable source receipt. */
async function loadAutomationBuildSuiteContext({testCase,projectId,testSuiteId,hasSuiteAccess,allowUnselectedSuite=false,lock=false,database}={}){
  if(testSuiteId!==undefined&&testSuiteId!==null&&(typeof testSuiteId!=='string'||!testSuiteId.trim()||testSuiteId.length>200))throw failure('AUTOMATION_BUILD_SUITE_INVALID','Choose a linked suite for this automation case.',400);
  const requested=testSuiteId||null;
  if(requested&&!hasSuiteAccess)throw failure('AUTOMATION_BUILD_SUITE_ACCESS_REQUIRED','Suite view access is required to use the selected suite test data.',403);
  // The target case is already locked by the source-save transaction. Keep
  // its existing mapping rows stable too: a concurrent unlink must not commit
  // between our source-receipt comparison and the generated Plan write.
  if(lock)await database.prepare(`SELECT membership.suite_id FROM suite_test_cases membership
    JOIN test_suites suite ON suite.id=membership.suite_id JOIN app_types app ON app.id=suite.app_type_id
    WHERE membership.test_case_id=? AND suite.app_type_id=? AND app.project_id=?
    ORDER BY membership.suite_id FOR SHARE OF membership`).all(testCase.id,testCase.app_type_id,projectId);
  const membershipRows=await database.prepare(`SELECT suite.id,suite.app_type_id,app.project_id FROM test_suites suite JOIN app_types app ON app.id=suite.app_type_id
    WHERE suite.app_type_id=? AND app.project_id=? AND (suite.id=? OR EXISTS(SELECT 1 FROM suite_test_cases membership WHERE membership.suite_id=suite.id AND membership.test_case_id=?))
    ORDER BY suite.id${lock?' FOR SHARE OF suite,app':''}`).all(testCase.app_type_id,projectId,testCase.suite_id||null,testCase.id);
  const ids=[...new Set(membershipRows.map(row=>row.id))].sort();
  if(requested&&!ids.includes(requested))throw failure('AUTOMATION_BUILD_SUITE_INVALID','The selected suite is not linked to this case in the current application and project.',404);
  if(!ids.length)return {test_suite_id:null,suite_selection_required:false};
  if(!requested&&allowUnselectedSuite&&ids.length>1)return {test_suite_id:null,suite_selection_required:true};
  if(!hasSuiteAccess){
    if(allowUnselectedSuite)return {test_suite_id:null,suite_selection_required:true};
    throw failure('AUTOMATION_BUILD_SUITE_ACCESS_REQUIRED','Suite view access is required to resolve this case’s linked suite test data.',403);
  }
  const candidates=requested?[requested]:ids;
  let ancestorRows=[],dataRows=[];
  const scopedRepository={
    async findAncestors(selected){
      ancestorRows=await database.prepare(`WITH RECURSIVE ancestry AS (
        SELECT id,app_type_id,parent_id FROM test_suites WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND app_type_id=?
        UNION SELECT parent.id,parent.app_type_id,parent.parent_id FROM test_suites parent JOIN ancestry child ON child.parent_id=parent.id AND parent.app_type_id=child.app_type_id
      ) SELECT suite.id,suite.parent_id,suite.app_type_id,suite.parameter_values,suite.test_data_set_id,suite.test_data_options,app.project_id
        FROM ancestry JOIN test_suites suite ON suite.id=ancestry.id JOIN app_types app ON app.id=suite.app_type_id
        WHERE suite.app_type_id=? AND app.project_id=? ORDER BY suite.id${lock?' FOR SHARE OF suite,app':''}`).all(selected,testCase.app_type_id,testCase.app_type_id,projectId);
      if(selected.some(id=>!ancestorRows.some(row=>row.id===id)))throw failure('AUTOMATION_BUILD_SUITE_INVALID','The selected suite is unavailable in the current application.',404);
      return ancestorRows.map(row=>({...row,parameter_values:parse(row.parameter_values),test_data_options:parse(row.test_data_options)}));
    },
    async findDataSets(selected){
      dataRows=await database.prepare(`SELECT data.* FROM test_data_sets data WHERE data.id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND data.project_id=? AND (data.app_type_id IS NULL OR data.app_type_id=?) ORDER BY data.id${lock?' FOR SHARE':''}`).all(selected,projectId,testCase.app_type_id);
      if(selected.some(id=>!dataRows.some(row=>row.id===id)))throw failure('AUTOMATION_BUILD_SUITE_DATA_UNAVAILABLE','A linked suite data set is unavailable in this application. Correct the suite data link before building.',404);
      return dataRows;
    }
  };
  const contexts=await createSuiteExecutionContext(scopedRepository).loadSuiteContexts(candidates);
  const chainFor=id=>{const chain=[],seen=new Set();let row=ancestorRows.find(item=>item.id===id);while(row&&!seen.has(row.id)){seen.add(row.id);chain.unshift(row);row=ancestorRows.find(item=>item.id===row.parent_id);}return chain;};
  const privateFor=chain=>[...new Set(chain.flatMap(item=>(parse(item.test_data_options).private_parameter_names||[]).map(name=>Object.keys(normalizeParameterLayer({[name]:''},'s'))[0])).filter(Boolean))].sort();
  if(!requested&&ids.length>1&&new Set(ids.map(id=>identity({...contexts.get(id),private_parameter_names:privateFor(chainFor(id))}))).size>1)throw failure('AUTOMATION_BUILD_SUITE_SELECTION_REQUIRED','This case belongs to suites with different test data. Choose its Suite target before building.');
  const selectedId=requested||ids[0],context=contexts.get(selectedId),chain=chainFor(selectedId);
  const privateNames=privateFor(chain);
  const sourceSnapshot={selected_test_suite_id:selectedId,linked_suite_ids:ids,ancestors:chain.map(item=>({id:item.id,parent_id:item.parent_id||null,parameter_values:normalizeParameterLayer(parse(item.parameter_values),'s'),test_data_set_id:item.test_data_set_id||null,test_data_options:normalizeDataOptions(parse(item.test_data_options))}))};
  return {...context,test_suite_id:selectedId,private_parameter_names:privateNames,source_snapshot:sourceSnapshot,suite_selection_required:false};
}

module.exports={loadAutomationBuildSuiteContext};
