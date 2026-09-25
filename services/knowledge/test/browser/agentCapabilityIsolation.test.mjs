import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const baseSource = await readFile(new URL('agentWorkspace.test.mjs', import.meta.url), 'utf8');
const baseFixture = baseSource.match(/const fixture = `
import { knowledgeApi } from "/services/knowledge/frontend/api.client";([\s\S]*?)`;\nconst specialists/)[1];
const fixture = baseFixture
  .replace("import { AuthProvider }", "import { AuthProvider, useAuth }")
  .replace("import '/src/styles.css';", "import policy from '/src/platform/lib/featurePolicy.generated.json'; import '/src/catalog-list.css'; import '/src/styles.css';")
  .replace('const client = new QueryClient', `
let flags = Object.fromEntries(policy.feature_keys.map(key => [key, true]));
if (params.get('disabled') === 'true') for (const key of ['hellotest.api.integrations', 'hellotest.ops.projects', 'hellotest.ai.knowledge', 'hellotest.manual.test_cases']) flags[key] = false;
window.workflowCalls = { providers: 0, projects: 0, apps: 0, reviews: [] };
window.workflowSession = session;
api.auth.session = async () => window.workflowSession;
api.featureFlags.snapshot = async () => ({ flags });
const projectList = api.projects.list, appList = api.appTypes.list;
api.projects.list = async (...args) => { window.workflowCalls.projects++; return projectList(...args); };
api.appTypes.list = async (...args) => { window.workflowCalls.apps++; return appList(...args); };
api.integrations.list = async (query, options) => {
 window.workflowCalls.providers++; window.providerSignal = options?.signal;
 if (window.holdProvider) return new Promise(resolve => { window.finishProvider = resolve; });
 return [{ id: 'model', type: 'llm', name: 'Project model', model: 'review-model', is_active: true }];
};
api.knowledgeRepo.search = knowledgeApi.knowledgeRepo.search = async () => ({ results:[{id:'context-1',chunk_id:'chunk-1',source_id:'source-1',source_kind:'knowledge_item',title:'Review source',content:'Only approved evidence.',score:1}] });
api.agenticWorkflows.ask = async input => {
 window.workflowCalls.reviews.push(input);
 return { transaction: {id:'review-created',project_id:'project',app_type_id:'app',metadata:{agent_id:'test-designer'}},result:{headline:'Manual review',executive_summary:'Manual review completed.',response:'Review the available sources.',recommendations:[],assumptions:[],evidence_gaps:[],citation_ids:[],findings:[],deliverables:[],evaluation:{grounding:0,completeness:0,traceability:0,risk_control:100},readiness:{status:'limited_evidence',limitations:[]}},citations:[],events:[],guardrails:[],provenance:{} };
};
function AccessBridge() {
 const {refreshSession} = useAuth();
 window.changeWorkflowPermissions = async permissions => {
  window.workflowSession = {...session,user:{...session.user,role:'member',permissions,project_permissions:{project:permissions}}};
  await refreshSession();
 };
 return null;
}
const client = new QueryClient`)
  .replace('function RouteObserver()', `
window.changeWorkflowFlags = patch => { flags = {...flags,...patch}; client.setQueryData(['feature-flags'], {flags}); };
window.refreshProviders = () => { void client.invalidateQueries({queryKey:['integrations','agentic-workflows']}); };
function RouteObserver()`)
  .replace('<AuthProvider><RouteObserver />', '<AuthProvider><AccessBridge /><RouteObserver />');

test('agent reviews retain manual work when optional features or permissions become unavailable', { timeout: 60000 }, async () => {
 const name = 'agent-capabilities-' + randomUUID();
 const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
 let browser;
 try {
  await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx, fixture);
  browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport:{width:1280,height:1000}});
  page.setDefaultTimeout(10000);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  const baseUrl = `${process.env.VITE_TEST_URL || 'http://127.0.0.1:5179'}/${name}.html?route=${encodeURIComponent('/agentic-workflows?view=workbench&agent=test-designer')}`;
  await page.goto(baseUrl + '&disabled=true');
  await page.getByRole('button',{name:'Start review',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Start review"]').disabled);
  assert.deepEqual(await page.evaluate(()=>[window.workflowCalls.providers,window.workflowCalls.projects]),[0,0]);
  assert.equal(await page.locator('.agent-command-provider select').count(),0);
  assert.equal(await page.getByRole('button',{name:'Smart Context',exact:true}).count(),0);
  await page.getByLabel('Ask or delegate to HelloTest AI').fill('Keep this manual task while optional sources are off.');
  await page.getByRole('button',{name:'Start review',exact:true}).click();
  await page.getByText('Manual review completed.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open Test Cases',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.workflowCalls.reviews[0].integration_id),undefined);
  assert.deepEqual(await page.evaluate(()=>[window.workflowCalls.reviews[0].project_id,window.workflowCalls.reviews[0].app_type_id]),['project','app'],'optional project administration does not discard the selected workspace');

  await page.goto(baseUrl);
  const prompt = page.getByLabel('Ask or delegate to HelloTest AI');
  await page.locator('.agent-command-provider select').waitFor();
  await page.locator('.agent-command-provider select').selectOption('model');
  await prompt.fill('Keep my unsaved review during access changes.');
  await page.getByRole('button',{name:'Smart Context',exact:true}).click();
  await page.getByRole('dialog',{name:'Smart Context workbench'}).getByRole('button',{name:'Retrieve',exact:true}).click();
  await page.getByRole('button',{name:'Apply 1 source',exact:true}).click();
  await page.getByRole('dialog',{name:'Smart Context workbench'}).waitFor({state:'detached'});
  await page.evaluate(()=>{window.holdProvider=true;window.refreshProviders();});
  await page.waitForFunction(()=>Boolean(window.finishProvider));
  await page.evaluate(()=>window.changeWorkflowFlags({'hellotest.api.integrations':false,'hellotest.ai.knowledge':false}));
  await page.locator('.agent-command-provider select').waitFor({state:'detached'});
  await page.waitForFunction(()=>window.providerSignal.aborted);
  assert.equal(await prompt.inputValue(),'Keep my unsaved review during access changes.');
  assert.equal(await page.getByRole('button',{name:'Start review',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Smart Context',exact:true}).count(),0);
  await page.evaluate(()=>{window.holdProvider=false;window.finishProvider([{id:'revoked-model',name:'Revoked model',type:'llm',is_active:true}]);window.changeWorkflowFlags({'hellotest.api.integrations':true,'hellotest.ai.knowledge':true});});
  await page.locator('.agent-command-provider select').waitFor();
  assert.equal(await page.locator('.agent-command-provider select').inputValue(),'model','restoring access preserves the original provider selection');
  assert.equal(await page.getByRole('option',{name:'Revoked model',exact:true}).count(),0,'a late cancelled response does not replace the provider cache');
  await page.evaluate(()=>window.changeWorkflowPermissions(['workspace.view','agentic_workflow.view','agentic_workflow.run','project.view','app_type.view','testcase.view']));
  await page.locator('.agent-command-provider select').waitFor({state:'detached'});
  assert.equal(await prompt.inputValue(),'Keep my unsaved review during access changes.');
  await page.getByRole('button',{name:'Start review',exact:true}).click();
  await page.getByText('Manual review completed.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.workflowCalls.reviews[0].integration_id),undefined,'review falls back to its default provider after permission removal');
  assert.equal(await page.evaluate(()=>window.workflowCalls.reviews[0].smart_context),undefined,'cached knowledge evidence is omitted after permission removal');
  assert.deepEqual(errors,[]);
 } finally {
  await browser?.close();
  await Promise.allSettled([unlink(html),unlink(tsx)]);
 }
});
