const db = require('@hellotest/platform/backend/src/db');
const {createHash}=require('node:crypto');
const {sanitizeAiText}=require('@hellotest/platform/backend/src/security/aiTextPolicy');
const fail=(message,code='EXECUTION_PLAN_STALE',statusCode=409)=>Object.assign(new Error(message),{statusCode,code,publicMessage:message});
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);

// Reuse the application's history revision, plus exact stored case/step facts:
// standalone step edits need not create a test_case_versions entry.
function createPreconditions(store=db){
 function selectors({projectId,appTypeId,caseIds}){
  if(!projectId||!appTypeId||!Array.isArray(caseIds)||!caseIds.length||caseIds.length>50||caseIds.some(id=>typeof id!=='string'||!id||id.length>255))throw fail('Select 1–50 explicit Test Cases in one project and application.','EXECUTION_PLAN_INVALID',400);
  return [...new Set(caseIds)].sort();
 }
 async function capture(input){
  const ids=selectors(input);
  if(input.lock){
   // The parent lock also prevents new FK-linked steps while current rows are
   // locked below. Keep these locks until the run's snapshots are persisted.
   await store.prepare(`SELECT cases.id FROM test_cases cases JOIN app_types app ON app.id=cases.app_type_id
    WHERE app.project_id=? AND app.id=? AND cases.id IN(SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY cases.id FOR UPDATE OF cases`).all(input.projectId,input.appTypeId,ids);
   await store.prepare(`SELECT steps.id FROM test_steps steps JOIN test_cases cases ON cases.id=steps.test_case_id
    JOIN app_types app ON app.id=cases.app_type_id WHERE app.project_id=? AND app.id=?
    AND cases.id IN(SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY steps.id FOR SHARE OF steps`).all(input.projectId,input.appTypeId,ids);
  }
  const rows=await store.prepare(`SELECT cases.id,cases.title,
    COALESCE((SELECT MAX(version.revision) FROM test_case_versions version WHERE version.test_case_id=cases.id),0)+1 AS revision,
    jsonb_build_object('case',to_jsonb(cases),'steps',COALESCE((SELECT jsonb_agg(to_jsonb(steps) ORDER BY steps.step_order,steps.id)
      FROM test_steps steps WHERE steps.test_case_id=cases.id),'[]'::jsonb)) AS definition
    FROM test_cases cases JOIN app_types app ON app.id=cases.app_type_id WHERE app.project_id=? AND app.id=?
      AND cases.id IN(SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY cases.id`).all(input.projectId,input.appTypeId,ids);
  if(rows.length!==ids.length||rows.some(row=>!ids.includes(row.id)))throw fail('A selected Test Case is unavailable in this project/application. Review a new plan.');
  return rows.map(row=>({test_case_id:row.id,title:sanitizeAiText(String(row.title||'')).text.slice(0,500),revision:Number(row.revision),content_hash:createHash('sha256').update(canonical(row.definition)).digest('hex')}));
 }
 async function verify(input){
  const ids=selectors(input),expected=input.expected;
  if(!Array.isArray(expected)||expected.length!==ids.length||new Set(expected.map(item=>item?.test_case_id)).size!==ids.length
   ||expected.some(item=>!item||!ids.includes(item.test_case_id)||!Number.isSafeInteger(item.revision)||item.revision<1||!/^[a-f0-9]{64}$/.test(item.content_hash||'')))throw fail('This execution plan has no valid reviewed source revisions. Prepare a new plan.');
  const current=await capture(input),byId=new Map(expected.map(item=>[item.test_case_id,item]));
  if(current.some(item=>item.revision!==byId.get(item.test_case_id).revision||item.content_hash!==byId.get(item.test_case_id).content_hash))throw fail('A selected Test Case or its steps changed after review. Prepare and review a new execution plan.');
  return current;
 }
 return {capture,verify};
}
module.exports={...createPreconditions(),createPreconditions};
