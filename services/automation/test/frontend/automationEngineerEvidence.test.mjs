import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as progression from '../../frontend/lib/automationEngineerProgress.ts';

const localRequire=createRequire(import.meta.url);
const platformRequire=createRequire(new URL('../../../platform/frontend/package.json',import.meta.url));
const {createElement}=platformRequire('react');
const {renderToStaticMarkup}=platformRequire('react-dom/server');
const {browserEvidence}=localRequire('../../backend/lib/automationWorkspacePreview');
const component=readFileSync(new URL('../../frontend/components/AutomationEngineerWorkspace.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(component,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;

function render({evidence,screenshot,allowed=true,steps,manualSteps=[],preview,application,stepErrors=[],working=true,incomplete=false,stopped=false}={}){
  const exports={};
  const icon=props=>createElement('svg',{'aria-hidden':props['aria-hidden']});
  const dependencies={
    '@tanstack/react-query':{useQuery:options=>({data:options.enabled?(options.queryKey[0]==='automation-engineer-evidence'?evidence:options.queryKey[0]==='automation-engineer-preview'?preview:options.queryKey[0]==='automation-engineer-screenshot'?screenshot:undefined):undefined,isFetching:false,isPending:false,isError:false})},
    '@tabler/icons-react':new Proxy({},{get:()=>icon}),
    '@hellotest/testing/frontend/api.client':{testingApi:{testCases:{}}},
    '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess':{useCapabilityAccess:()=>({can:permission=>allowed||permission!=='automation.code.view'})},
    '@hellotest/platform/frontend/src/platform/components/RichTextEditor':{richTextToPlainText:value=>value.replace(/<[^>]*>/g,'')},
    '@hellotest/platform/frontend/src/platform/capabilities/CapabilityView':{capabilityView:()=>()=>null},
    './AutomationInstructionPreview':{AutomationInstructionPreview:props=>createElement('pre',{'data-testid':'selected-source'},props.code)},
    '../lib/automationInstructions':{formatAutomationSourceLines:value=>value},
    '../lib/automationEngineerProgress':progression,
    '../lib/automationActivityMonitoring':{automationSemanticIssueMessage:()=>''},
    '../lib/automationEngineerData':{projectEngineerStepData:step=>({step,resolution:{missing:[],deferred:[],private:[]}})},
    '../lib/automationGenerationApplicability':{generationApplicabilityNotice:()=>null},
    './AutomationEngineerWorkspace.css':{}
  };
  new Function('require','exports',compiled)(name=>Object.hasOwn(dependencies,name)?dependencies[name]:platformRequire(name),exports);
  return renderToStaticMarkup(createElement(exports.AutomationEngineerWorkspace,{
    projectId:'project',appTypeId:'app',activityId:'activity',caseId:'case',caseTitle:'Account',
    steps:steps||[{test_case_id:'case',step_id:'login',step_order:1,action:'Sign in',status:'in_progress',instruction_status:'requested'}],
    manualSteps,cases:[],working,incomplete,stopped,stepErrors,
    application:application||{test_case_id:'case',active_step_id:'login',snapshot_artifact_id:'native-snapshot',url:evidence?.url,observed_at:'2026-11-06T10:01:00.000Z'}
  }));
}

test('Application renders actual native snapshot text with current Developing state and escapes page markup',()=>{
  const snapshot='- main [ref=e1]:\n  - heading "Account" [ref=e2]\n  - text: <script>alert(1)</script>\n  - textbox "Email": [private parameter value]';
  const evidence=browserEvidence({testCaseId:'case',transport:'upstream_playwright_mcp',observation:{tool:'browser_click',result:{content:[{type:'text',text:'### Page\n- Page URL: https://app.test/account?token=private\n### Snapshot\n```yaml\n'+snapshot+'\n```'}]}}}).evidence;
  const html=render({evidence});
  assert.match(html,/aria-label="Application evidence"/);assert.match(html,/<pre>- main \[ref=e1\]/);
  assert.match(html,/heading &quot;Account&quot; \[ref=e2\]/);assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/https:\/\/app\.test\/account/);assert.doesNotMatch(html,/token=private|Waiting for browser evidence/);
  assert.match(html,/Developing/);assert.match(html,/data-status="working"/);assert.match(html,/\[private parameter value\]/);
});

test('native session preview is visible as a case browser capture and stays hidden when source access is denied',()=>{
  const screenshot={data_url:'data:image/jpeg;base64,/9j/AQID'};
  const application={test_case_id:'case',active_step_id:'login',screenshot_artifact_id:'protected-native-preview',snapshot_artifact_id:'native-snapshot',url:'https://app.test/login',observed_at:'2026-11-09T10:01:00.000Z'};
  const visible=render({application,screenshot});
  assert.match(visible,/role="tab" aria-selected="true"[^>]*>.*?Browser capture/);
  assert.match(visible,/<img src="data:image\/jpeg;base64,\/9j\/AQID" alt="Captured application for Account\. Execution is unverified\."/);
  assert.doesNotMatch(visible,/Waiting for browser evidence/);
  const hidden=render({application,screenshot,allowed:false});
  assert.match(hidden,/Application evidence is hidden by your role/);
  assert.doesNotMatch(hidden,/<img|data:image/);
});

test('native find excerpts are visibly partial and code-view denial hides their page contents',()=>{
  const evidence=browserEvidence({testCaseId:'case',transport:'upstream_playwright_mcp',observation:{tool:'browser_find',result:{content:[{type:'text',text:'### Result\nFound 1 match for "Submit":\n- button "Submit" [ref=e5]'}]}}}).evidence;
  assert.match(render({evidence}),/Partial page observation/);
  const hidden=render({evidence,allowed:false});
  assert.match(hidden,/Application evidence is hidden by your role/);assert.doesNotMatch(hidden,/Found 1 match|ref=e5/);
});

test('an unfinished selected step shows its recorded error immediately with a direct Build Error control',()=>{
  const html=render({working:false,incomplete:true,steps:[{test_case_id:'case',step_id:'login',step_order:1,action:'Sign in',status:'needs_attention',instruction_status:'not_saved'}],
    stepErrors:[{id:'failure',test_case_id:'case',step_id:'login',manual_step_ids:[],message:'The native browser action did not confirm completion.',code:'AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED',phase:'automation.agent.browser.failed',required_context:[],required_parameters:[],semantic_issues:[]}]
  });
  assert.match(html,/data-status="attention"/);assert.match(html,/Needs attention/);
  assert.match(html,/role="alert"[^>]*><p>The native browser action did not confirm completion\./);
  assert.match(html,/View build errors/);assert.match(html,/aria-label="Build Error \(1\)"/);
});

test('a stopped workspace retains saved sections and page evidence without showing an active Developing step',()=>{
  const html=render({working:false,stopped:true,evidence:{accessibility:'RETAINED_NATIVE_EVIDENCE'},steps:[
    {test_case_id:'case',step_id:'saved',step_order:1,action:'Saved section',status:'performed',instruction_status:'saved'},
    {test_case_id:'case',step_id:'login',step_order:2,action:'Stopped section',status:'in_progress',instruction_status:'requested'}
  ]});
  assert.match(html,/Saved · Not run/);assert.match(html,/Stopped/);assert.match(html,/RETAINED_NATIVE_EVIDENCE/);
  assert.match(html,/data-progress-paused="true"/);assert.doesNotMatch(html,/Developing|aria-busy="true"/);
});

test('linked manual rows select their native section preview and observation after a durable saved event',()=>{
  const {groundedManualCoverage}=localRequire('../../backend/lib/automationBuildCompletion');
  const {reduceActivityProgress}=localRequire('../../backend/lib/automationActivityProgress');
  const {sectionPreview}=localRequire('../../backend/lib/automationWorkspacePreview');
  const section={id:'auto-login',step_order:1,step_type:'web',action:'Open Login',expected_result:'Login is visible'};
  const manual={...section,id:'manual-login'};
  const lineage=groundedManualCoverage([section],[{id:'manual-case',steps:[manual]}]);
  let metadata={};
  const progress=(phase,details)=>{metadata={...metadata,...reduceActivityProgress(metadata,{phase,details:{test_case_id:'case',...details}})};};
  progress('automation.agent.plan',{steps:[{...section,step_id:section.id}],manual_steps:[{...manual,manual_step_id:manual.id,manual_test_case_id:'manual-case'}],manual_coverage:lineage.manualCoverage});
  progress('automation.agent.section.started',{step_id:section.id,active_step_id:section.id,active_manual_step_ids:[manual.id]});
  progress('automation.agent.section.saved',{step_id:section.id,active_step_id:section.id,active_manual_step_ids:[manual.id],preview_artifact_id:'saved-preview',development_status:'completed'});
  const application={test_case_id:'case',active_step_id:section.id,active_manual_step_ids:[manual.id],snapshot_artifact_id:'native-snapshot',observed_at:'2026-11-06T10:01:00.000Z'};
  const preview=sectionPreview({testCaseId:'case',step:section,update:{step_type:'web',automation_code:'await expect(page.getByRole("heading",{name:"Login"})).toBeVisible();'},manualCoverage:lineage.manualCoverage,manualSpecification:lineage.manualSpecification,attempt:1});
  const evidence=browserEvidence({testCaseId:'case',active_step_id:section.id,active_manual_step_ids:[manual.id],transport:'upstream_playwright_mcp',observation:{tool:'browser_snapshot',result:{content:[{type:'text',text:'### Snapshot\n```yaml\n- heading "Login" [ref=e16]\n```'}]}}}).evidence;
  const html=render({steps:metadata.step_progress,manualSteps:metadata.manual_step_progress,application,preview,evidence,working:false});
  assert.match(html,/Manual steps to automate/);assert.match(html,/data-status="saved"/);assert.match(html,/Selected step observation/);
  assert.match(html,/data-testid="selected-source"/);assert.match(html,/toBeVisible/);
  assert.doesNotMatch(html,/Waiting for a section mapping|No validated preview retained|Another step observation/);
});

test('linked manual failure follows its exact automation section and exposes that step error immediately',()=>{
  const html=render({working:false,incomplete:true,steps:[{test_case_id:'case',step_id:'auto-user',step_order:1,action:'Enter username',status:'needs_attention',instruction_status:'not_saved'}],
    manualSteps:[{test_case_id:'case',manual_test_case_id:'manual-case',manual_step_id:'manual-user',section_step_id:'auto-user',step_order:1,action:'Enter username',status:'needs_attention',instruction_status:'not_saved'}],
    stepErrors:[{id:'failure',test_case_id:'case',step_id:'auto-user',manual_step_ids:['manual-user'],message:'The Username control needs a current native reference.',code:'AUTOMATION_UPSTREAM_BUILD_INCOMPLETE',phase:'automation.agent.browser.failed',required_context:[],required_parameters:[],semantic_issues:[]}]
  });
  assert.match(html,/Needs attention/);assert.match(html,/role="alert"[^>]*><p>The Username control needs a current native reference/);assert.match(html,/aria-label="Build Error \(1\)"/);
});
