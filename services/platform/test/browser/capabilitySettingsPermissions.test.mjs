import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url))('playwright');
const { FEATURE_GROUPS, FEATURE_DEFINITIONS, FEATURE_DEPENDENCIES } = require('../../backend/services/featureFlag.service');
const root = new URL('../../frontend/', import.meta.url);
const host = process.env.VITE_TEST_URL || 'http://127.0.0.1:5294';
async function withFixture(fixture, run, query = '') {
  const name = 'capability-access-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected API request: ${route.request().url()}`); return route.abort(); });
    await page.goto(`${host}/${name}.html${query}`);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
}

test('all capability groups render and unavailable deployments remain unavailable after publishing preferences', { timeout: 60000 }, async () => {
  const source = await readFile(new URL('./featureAvailability.test.mjs', import.meta.url), 'utf8');
  let fixture = source.match(/const fixture = `([\s\S]*?)`;/)[1];
  const key = 'hellotest.ai.prompt_templates';
  const flags = Object.fromEntries(FEATURE_DEFINITIONS.map(feature => [feature.key, true]));
  const snapshot = { groups: FEATURE_GROUPS, flags: { ...flags, [key]: false }, local_flags: flags, dependencies: FEATURE_DEPENDENCIES, capability_availability: { ...flags, [key]: false } };
  fixture = fixture.replace("createRoot(document.getElementById('root'))", `state.flags=${JSON.stringify(flags)}; state.failRead=false; adminApi.flags=async()=>(${JSON.stringify(snapshot)}); createRoot(document.getElementById('root'))`);
  await withFixture(fixture, async page => {
    await page.locator('.flag-row').first().waitFor();
    assert.equal(await page.locator('.flag-group').count(), 11);
    assert.equal(await page.locator('.flag-row').count(), FEATURE_DEFINITIONS.length);
    const detail = page.getByRole('region', { name: 'Shared AI prompt templates', exact: true });
    await detail.getByText('prompt_template.view', { exact: true }).waitFor();
    assert.deepEqual(await detail.locator('.feature-detail-availability dd').allTextContents(), ['Unavailable', 'Unavailable']);
    const toggle = page.getByRole('button', { name: /^Shared AI prompt templates/ });
    await toggle.click();
    await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
    await page.getByText('All changes published').waitFor();
    await toggle.click();
    await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
    await page.getByText('All changes published').waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'Configured preference is saved');
    assert.deepEqual(await detail.locator('.feature-detail-availability dd').allTextContents(), ['Unavailable', 'Unavailable'], 'A feature preference cannot enable a package missing from the deployment');
    await page.getByRole('textbox', { name: 'Find a capability' }).fill('Integrations & AI configuration');
    assert.equal(await page.locator('.flag-group').count(), 1);
    await page.screenshot({ path: '/tmp/hellotest-review-feature-settings.png', fullPage: true });
  }, `?section=features&feature=${key}`);
});

test('shared templates enforce read/manage access, save versus apply and live revocation independently of case AI', { timeout: 60000 }, async () => {
  const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider,useAuth} from '/src/auth/AuthContext';
import {api,sessionStorage} from '/src/lib/api';
import {integrationApi} from '/services/integration/frontend/api.client';
import {AiPromptTemplatePicker} from '/services/integration/frontend/components/AiPromptTemplatePicker';
import policy from '/src/platform/lib/featurePolicy.generated.json';
import '/src/styles.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
let session={token:'isolated-template-fixture',user:{id:'viewer',role:'member',workspace_permissions:['workspace.view'],project_permissions:{project:[]}}};
sessionStorage.write(session); api.auth.session=async()=>structuredClone(session);
let flags=Object.fromEntries(policy.feature_keys.map(key=>[key,key!=='hellotest.ai.test_authoring']));
api.featureFlags.snapshot=async()=>({...policy,flags:{...flags}});
const state=window.accessFixture={reads:0,writes:[],applied:[]};
let template={id:'template',project_id:'project',name:'Story evidence',description:'Reusable Story guidance',scope:'requirement_creation',applies_to:['requirements'],prompt_text:'Preserve acceptance criteria and cite evidence',tags:[],metadata:{},built_in:false};
integrationApi.aiPromptTemplates.list=async()=>{state.reads++;return [template]};
integrationApi.aiPromptTemplates.update=async(id,input)=>{state.writes.push({id,...input});template={...template,...input};return template};
integrationApi.aiPromptTemplates.create=async(input)=>{state.writes.push(input);return {...template,...input,id:'new-template'}};
function Screen(){const{refreshSession}=useAuth();window.setTemplateGrants=async grants=>{session={...session,user:{...session.user,project_permissions:{project:grants}}};await refreshSession()}; window.setTemplateFlag=async(value)=>{flags['hellotest.ai.prompt_templates']=value;await client.invalidateQueries()};return <><h1>Template access</h1><AiPromptTemplatePicker projectId="project" appTypeId="app" scope="requirement_creation" onApply={(prompt,template)=>state.applied.push({prompt,template})}/></>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><Screen/></AuthProvider></QueryClientProvider>);`;
  await withFixture(fixture, async page => {
    await page.getByRole('heading', { name: 'Template access' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Story templates' }).count(), 0);
    assert.equal(await page.evaluate(() => window.accessFixture.reads), 0);
    await page.evaluate(() => window.setTemplateGrants(['prompt_template.view']));
    await page.getByRole('button', { name: 'Story templates' }).click();
    await page.getByRole('button', { name: 'Use', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'New template', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Edit Story evidence' }).count(), 0);
    assert.equal(await page.getByLabel('Template name', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    assert.equal(await page.evaluate(() => window.accessFixture.applied.length), 1);
    await page.evaluate(() => window.setTemplateGrants(['prompt_template.view','prompt_template.manage']));
    await page.getByRole('button', { name: 'Story templates' }).click();
    await page.getByRole('button', { name: 'Edit Story evidence' }).click();
    await page.getByLabel('Template name', { exact: true }).fill('Updated Story evidence');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved "Updated Story evidence".', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.accessFixture.applied.length), 1, 'Save does not apply guidance');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByRole('button', { name: 'Save and Use', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.accessFixture.applied.length), 2);
    assert.equal(await page.evaluate(() => window.accessFixture.writes[0].id), 'template', 'Existing templates update their stable identity');
    await page.getByRole('button', { name: 'Story templates' }).click();
    await page.evaluate(() => window.setTemplateGrants(['prompt_template.view']));
    await page.getByLabel('Template name', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Use', exact: true }).waitFor();
    await page.evaluate(() => window.setTemplateFlag(false));
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Story templates' }).count(), 0);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
    assert.equal(await page.evaluate(() => window.accessFixture.writes.length), 2);
  });
});

test('read-only dashboards and dataset panels hide mutation controls and close editors on revocation', { timeout: 60000 }, async () => {
  const source = await readFile(new URL('../../../dashboard/test/browser/qualityDashboard.test.mjs', import.meta.url), 'utf8');
  let fixture = source.match(/const fixture = `([\s\S]*?)`;\n/)[1];
  fixture = fixture.replace('function FixtureDashboard() {', `import {AuthoringDataSetPanel} from '/src/platform/components/AuthoringDataSetPanel';
function FixtureDashboard() { const[canManage,setManage]=React.useState(false);window.setDashboardManage=setManage;`);
  fixture = fixture.replace('return <CustomQualityDashboard projectId={projectId} canManage canUseAi canUseAutomation />;', `return <><CustomQualityDashboard projectId={projectId} canManage={canManage} canUseAi canUseAutomation /><AuthoringDataSetPanel canView canLink={canManage} canCreate={canManage} dataSet={{id:'data',name:'Review data',mode:'table',columns:[],rows:[{}]}} onCreate={()=>{}} onLink={()=>{}} onUnlink={()=>{}} onManageParameters={()=>{}} onDownloadTemplate={()=>{}} hasParameters={false}/></>;`);
  await withFixture(fixture, async page => {
    await page.getByRole('heading', { name: 'Dashboards', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create dashboard', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Customize', exact: true }).count(), 0);
    await page.getByLabel('Current dashboard').selectOption('saved');
    await page.getByRole('group').count();
    await page.locator('summary[aria-label="Dashboard actions"]').click();
    await page.getByRole('button', { name: 'Export PDF', exact: true }).waitFor();
    for (const name of ['Email report','Delete dashboard','Change','Unlink Review data','Create a replacement data set']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, name);
    await page.evaluate(() => window.setDashboardManage(true));
    await page.getByRole('button', { name: 'Unlink Review data', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => window.setDashboardManage(false));
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Create dashboard', exact: true }).count(), 0);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
    assert.deepEqual(await page.evaluate(() => window.dashboardWrites), []);
  });
});

test('Knowledge source pickers request only granted records and hide ingestion from readers', { timeout: 60000 }, async () => {
  const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider,useAuth} from '/src/auth/AuthContext'; import {api,sessionStorage} from '/src/lib/api';
import {KnowledgeContextStudio} from '/services/knowledge/frontend/components/KnowledgeContextStudio';
import policy from '/src/platform/lib/featurePolicy.generated.json';
import '/src/styles.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
let session={token:'isolated-knowledge-fixture',user:{id:'viewer',role:'member',workspace_permissions:['workspace.view'],project_permissions:{project:['knowledge.view','knowledge.manage','testcase.view']}}};
sessionStorage.write(session);api.auth.session=async()=>structuredClone(session);
api.featureFlags.snapshot=async()=>({...policy,flags:Object.fromEntries(policy.feature_keys.map(key=>[key,true]))});
const calls=window.knowledgeCalls={stories:0,cases:0,runs:0,defects:0};
api.knowledgeRepo.overview=async()=>({counts:{},recent_jobs:[],capabilities:{}});
api.knowledgeRepo.sources=async()=>[];api.knowledgeRepo.collections.list=async()=>[];
api.requirements.list=async()=>{calls.stories++;return []};api.testCases.list=async()=>{calls.cases++;return [{id:'case',title:'Authorized example'}]};api.executions.list=async()=>{calls.runs++;return []};api.issues.list=async()=>{calls.defects++;return []};
function Screen(){const{refreshSession}=useAuth();const[manage,setManage]=React.useState(true);window.setKnowledgeManage=setManage;window.setKnowledgeGrants=async grants=>{session={...session,user:{...session.user,project_permissions:{project:grants}}};await refreshSession()};return <KnowledgeContextStudio projectId="project" appTypeId="app" canManage={manage} onError={()=>{}} onSuccess={()=>{}}/>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><Screen/></AuthProvider></QueryClientProvider>);`;
  await withFixture(fixture, async page => {
    await page.getByText('Authorized example', { exact: true }).waitFor();
    const sources = page.getByRole('navigation', { name: 'Context source types' });
    assert.equal(await sources.getByRole('button').count(), 1);
    assert.deepEqual(await page.evaluate(() => window.knowledgeCalls), { stories:0,cases:1,runs:0,defects:0 });
    await page.locator('.knowledge-record-row input').check();
    await page.evaluate(() => window.setKnowledgeGrants(['knowledge.view','knowledge.manage']));
    await page.locator('.knowledge-record-picker').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Process context', exact: true }).isDisabled(), true, 'Revoked source selections cannot be submitted');
    await page.evaluate(() => window.setKnowledgeManage(false));
    await page.getByRole('tab', { name: 'Search & validate', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Build context', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Process context', exact: true }).count(), 0);
    await page.getByRole('textbox', { name: 'Search indexed project context' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.knowledgeCalls), { stories:0,cases:1,runs:0,defects:0 });
  });
});
