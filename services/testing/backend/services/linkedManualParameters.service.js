const db=require('@hellotest/platform/backend/src/db');
const {resolveLinkedManualParameters,parameterProjection}=require('@hellotest/platform/backend/src/utils/linkedManualParameters');
async function resolveForCases(cases,{projectId=null,lock=false}={}){
 const targets=cases.filter(row=>row?.automated==='yes'),ids=[...new Set(targets.map(row=>row.id||row.test_case_id).filter(Boolean))];
 if(!ids.length)return new Map();
 const sources=await db.prepare(`SELECT target.id AS automation_test_case_id, source.id AS manual_test_case_id,
 source.display_id,source.parameter_values,source.test_data_options,link.is_primary
 FROM automation_case_links link
 JOIN test_cases target ON target.id=link.automation_test_case_id AND target.automated='yes'
 JOIN test_cases source ON source.id=link.manual_test_case_id AND COALESCE(source.automated,'no')='no' AND source.app_type_id=target.app_type_id
 JOIN app_types app ON app.id=target.app_type_id
 WHERE target.id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND (?::text IS NULL OR app.project_id=?)
 ORDER BY target.id,link.is_primary DESC,source.id${lock?' FOR SHARE OF target,source,link,app':''}`).all(ids,projectId,projectId);
 const grouped=new Map();for(const row of sources){if(!grouped.has(row.automation_test_case_id))grouped.set(row.automation_test_case_id,[]);grouped.get(row.automation_test_case_id).push(row);}
 return new Map(targets.map(row=>{const id=row.id||row.test_case_id;return [id,resolveLinkedManualParameters(row,grouped.get(id)||[])];}));
}
async function resolveForCase(testCase,options){return (await resolveForCases([testCase],options)).get(testCase.id||testCase.test_case_id)||resolveLinkedManualParameters(testCase);}
async function projectCases(cases,options){const values=await resolveForCases(cases,options);return cases.map(row=>{const resolved=values.get(row.id||row.test_case_id);return resolved?{...row,...parameterProjection(resolved)}:row;});}
module.exports={resolveForCases,resolveForCase,projectCases};
