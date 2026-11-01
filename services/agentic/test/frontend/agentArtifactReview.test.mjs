import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
function load(path, modules = {}) { const exports = {}; new Function('exports', 'require', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports, name => modules[name] || (() => { throw Error(`Unexpected import ${name}`); })()); return exports; }
const parameters=load('../../../platform/frontend/src/shared/lib/stepParameters.ts',{'acorn':require('acorn')});
const readiness=load('../../../ai/frontend/lib/draftReadiness.ts',{'@hellotest/platform/frontend/src/shared/lib/stepParameters':parameters});
const {agentArtifactIssues,agentArtifactSavedRoute}=load('../../frontend/lib/agentArtifactReview.ts',{'@hellotest/ai/frontend/lib/draftReadiness':readiness});
const base={title:'Reviewed checkout',description:'One order after retry.',priority:'P2',citation_ids:['source-1']};
test('library approval requires the artifact-specific mandatory fields and accepts native case parameter names',()=>{
  assert.deepEqual(agentArtifactIssues({...base,kind:'story',acceptance_criteria:['One order.']}),[]);
  assert.ok(agentArtifactIssues({...base,kind:'story',acceptance_criteria:[' ']}).length);
  const testcase={...base,kind:'test_case',test_case_type:'regression',steps:[{action:'Retry @t.order.',expected_result:'One order.'}],parameter_values:{'t.order':'order-1','t.optional':''}};
  assert.deepEqual(agentArtifactIssues(testcase),[]);
  assert.ok(agentArtifactIssues({...testcase,parameter_values:{'r.order':'wrong-scope'}}).length);
  assert.ok(agentArtifactIssues({...testcase,steps:[{action:'Retry',expected_result:''}]}).length);
  assert.ok(agentArtifactIssues({...base,kind:'defect',severity:'high',reproduction_steps:['Retry'],expected_result:'One order',actual_result:''}).length);
  assert.ok(agentArtifactIssues({...base,kind:'run',test_case_ids:['case-1'],exit_criteria:[' ']}).length);
});
test('automation proposals remain Plans and route to the saved automation case',()=>{
  const plan={...base,kind:'automation',parameter_values:{},steps:[{step_type:'web',action:'Open checkout',expected_result:'Checkout is visible'}]};
  assert.match(agentArtifactIssues(plan).join(' '),/start URL/);
  assert.deepEqual(agentArtifactIssues({...plan,start_url:'http://localhost:8080/checkout'}),[]);
  assert.equal(agentArtifactSavedRoute('automation','case 1'),'/automation?case=case%201');
});
test('approval requires source attribution and versioned Story update targets',()=>{
  const story={...base,kind:'story',acceptance_criteria:['One order after retry.']};
  assert.match(agentArtifactIssues({...story,citation_ids:[]}).join(' '),/source references/);
  assert.match(agentArtifactIssues({...story,target_id:'story-1'}).join(' '),/target revision/);
  assert.deepEqual(agentArtifactIssues({...story,target_id:'story-1',target_revision:2}),[]);
});
test('customizing an authoring specialist retains its declared output rather than silently becoming a prose reviewer',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../../shared/agentOutcomeContracts.json',import.meta.url),'utf8'));
  const definitions=load('../../frontend/agents/agentDefinitions.ts',{'../../shared/agentOutcomeContracts.json':{default:catalog},'../workflows/specialistProfiles':{specialistDefaults:()=>({skills:[],allowedTools:[],knowledgeScope:'stories'}),specialistProfiles:{}}});
  assert.deepEqual(definitions.agentFromSpecialist('test-designer','Test Designer').output_contract,{kind:'test_case',minimum_artifacts:1});
  assert.deepEqual(definitions.agentFromSpecialist('risk-prediction','Risk Prediction').output_contract,{kind:'review',minimum_artifacts:0});
  assert.match(definitions.agentResultLabel(definitions.agentFromSpecialist('automation-engineer','Engineer')),/Automation Plan/);
});
