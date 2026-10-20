const db = require("@hellotest/platform/backend/src/db");
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");

async function loadAutomationStoryContext({ caseId, projectId, userId }) {
  if (!userId || !projectId || !(await getOptionalEvidenceAccess({ id: userId }, projectId, ["requirement.view"]))["requirement.view"]) return { stories: [], related_stories: [] };
  const stories = await db.prepare(`
    SELECT DISTINCT r.id, r.display_id, r.title, r.description, r.additional_fields, r.status,
      r.gherkin_scenarios, r.specification_format, r.specification_content, r.external_references
    FROM requirements r
    LEFT JOIN requirement_test_cases link ON link.requirement_id = r.id
    WHERE (link.test_case_id = ? OR link.test_case_id IN (SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ?) OR r.id IN (SELECT requirement_id FROM test_cases WHERE id = ? OR id IN (SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ?))) AND r.project_id = ?
    ORDER BY r.id LIMIT 30
  `).all(caseId, caseId, caseId, caseId, projectId);
  const related = stories.length ? await db.prepare(`
    SELECT DISTINCT r.id, r.display_id, r.title, r.description, r.additional_fields, r.status,
      r.gherkin_scenarios, r.specification_format, r.specification_content, r.external_references
    FROM requirement_relations rel
    JOIN requirements r ON r.id = rel.related_requirement_id OR r.id = rel.requirement_id
    WHERE r.project_id = ? AND (
      (rel.requirement_id IN (${stories.map(() => '?').join(',')}) AND r.id = rel.related_requirement_id)
      OR (rel.related_requirement_id IN (${stories.map(() => '?').join(',')}) AND r.id = rel.requirement_id)
    ) ORDER BY r.id LIMIT 30
  `).all(projectId, ...stories.map((story) => story.id), ...stories.map((story) => story.id)) : [];
  const bounded = (rows) => rows.map(({ additional_fields, ...row }) => {
    let fields = additional_fields;
    if (typeof fields === "string") { try { fields = JSON.parse(fields); } catch { fields = {}; } }
    return {
      ...row,
      description: String(row.description || '').slice(0, 4000),
      acceptance_criteria: JSON.stringify(fields?.acceptance_criteria || []).slice(0, 4000),
      gherkin_scenarios: JSON.stringify(row.gherkin_scenarios || []).slice(0, 8000),
      specification_content: String(row.specification_content || '').slice(0, 8000),
      external_references: JSON.stringify(row.external_references || []).slice(0, 2000)
    };
  });
  return { stories: bounded(stories), related_stories: related.filter((row) => !stories.some((story) => story.id === row.id)).map(({id,display_id,title,status})=>({id,display_id,title,status})) };
}
async function loadAutomationManualContext({caseId, projectId, userId,lock=false}) {
  if (!userId || !(await getOptionalEvidenceAccess({id:userId}, projectId, ["testcase.view"]))["testcase.view"]) return [];
  const cases = await db.prepare(`SELECT tc.id, tc.display_id, tc.title, tc.description, tc.gherkin_document, tc.priority
    FROM automation_case_links link
    JOIN test_cases target ON target.id=link.automation_test_case_id AND target.automated='yes'
    JOIN test_cases tc ON tc.id = link.manual_test_case_id AND tc.app_type_id=target.app_type_id AND COALESCE(tc.automated,'no')='no'
    JOIN app_types app ON app.id = tc.app_type_id
    WHERE link.automation_test_case_id = ? AND app.project_id = ? ORDER BY tc.id${lock?' FOR SHARE OF tc, link, app':''}`).all(caseId, projectId);
  return Promise.all(cases.map(async (item) => ({...item, steps: await db.prepare(`SELECT id, step_order, step_type, action, expected_result, group_id, group_name, group_kind
    FROM test_steps WHERE test_case_id = ? ORDER BY step_order, id${lock?' FOR SHARE':''}`).all(item.id)})));
}
function manualContextKey(cases=[]){return JSON.stringify(cases.map(item=>({...item,steps:[...(item.steps||[])].sort((a,b)=>Number(a.step_order)-Number(b.step_order)||String(a.id).localeCompare(String(b.id)))})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));}
function automationPromptParameters(values, canView,privateNames=[]) {
  if (!canView || !values || typeof values !== "object" || Array.isArray(values)) return {};
  const privateKeys=new Set(privateNames);
  return Object.fromEntries(Object.entries(values).map(([key,value]) => [key,
    privateKeys.has(key)||/password|secret|token|credential|api.?key|passcode|pin|otp|verification.?code|one.?time.?code/i.test(key) ? "[private parameter reference]" : value]));
}
async function loadAutomationParameterContext({testCase,projectId,userId,lock=false}){
 if(!userId||!projectId)return {parameter_values:{},runtime_parameter_values:{},source_key:null};
 const access=await getOptionalEvidenceAccess({id:userId},projectId,['data.view','testcase.view']);
 if(!access['data.view'])return {parameter_values:{},runtime_parameter_values:{},source_key:null};
 const linked=require('@hellotest/testing/backend/services/linkedManualParameters.service');
 const resolved=access['testcase.view']?await linked.resolveForCase(testCase,{projectId,lock}):require('@hellotest/platform/backend/src/utils/linkedManualParameters').resolveLinkedManualParameters(testCase);
 return {parameter_values:automationPromptParameters(resolved.effective_parameter_values,true,resolved.private_parameter_names),runtime_parameter_values:resolved.effective_parameter_values,parameter_overrides:resolved.effective_parameter_overrides||[],private_parameter_names:resolved.private_parameter_names||[],source_key:resolved.source_key};
}
/** Only explicit navigation is an application entry point; story/reference links are not. */
function resolveAutomationStartUrl({startUrl, caseUrl, environmentUrl, steps=[], required=false}={}) {
  if(required){
    const {normalizeAutomationStartUrl}=require('@hellotest/platform/backend/src/utils/automationStartUrl');
    return {url:normalizeAutomationStartUrl(startUrl!=null?startUrl:caseUrl,{required:true}),source:startUrl!=null?'selected_url':'case_url'};
  }
  const usable=value=>{
    if(typeof value!=="string" || value.length>2000 || /\$\{|@(?:t|c|e)\./.test(value))return null;
    try {const url=new URL(value.trim());return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
  };
  for(const [value,source] of [[startUrl,"selected_url"],[caseUrl,"case_url"],[environmentUrl,"environment"]]) {
    if(value)return {url:usable(value),source};
  }
  for(const step of steps) {
    if(step.step_type && step.step_type!=="web")continue;
    const code=String(step.automation_code||"");
    const literal=code.match(/^\s*(?:await\s+)?(?:page|playwrightPage)\.goto\(\s*(["'])(https?:\/\/[^\s"'\\]+)\1\s*[,)]/im);
    const action=String(step.action||"").trim().match(/^(?:open|navigate\s+to|go\s+to|visit)\s+(https?:\/\/\S+)\s*$/i);
    const url=usable(literal?.[2]||action?.[1]);
    if(url)return {url,source:literal?"saved_navigation":"case_navigation",step_id:step.id};
  }
  return {url:null,source:null};
}
module.exports = { loadAutomationStoryContext, loadAutomationManualContext, manualContextKey, automationPromptParameters, loadAutomationParameterContext, resolveAutomationStartUrl };
