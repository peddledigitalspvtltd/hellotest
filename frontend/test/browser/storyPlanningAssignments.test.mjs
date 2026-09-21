import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require("playwright");
const root = new URL("../../", import.meta.url);
const name = `story-planning-${randomUUID()}`;
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RequirementsPage} from '/src/pages/RequirementsPage';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/hooks/useCurrentProject';
import '/src/styles.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';
const session={token:'isolated-story-planning',user:{id:'planner',name:'Planner',role:'admin',email:'planner@example.test'}};
sessionStorage.write(session);setCurrentScope('project','app');window.calls=[];
function stub(value){for(const[key,entry]of Object.entries(value)){if(typeof entry==='function')value[key]=async()=>[];else if(entry&&typeof entry==='object')stub(entry)}}stub(api);
api.auth.session=async()=>{await new Promise(resolve=>setTimeout(resolve,80));return session};
api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.featureFlags.snapshot=async()=>{await new Promise(resolve=>setTimeout(resolve,100));return {flags:new Proxy({},{get:()=>true})}};
api.metadata.domain=async()=>({requirements:{default_status:'open',statuses:[{value:'open',label:'Open'}]},jira:{sprints:[],versions:[]}});
api.projects.list=async()=>[{id:'project',name:'Project'}];api.appTypes.list=async()=>[{id:'app',project_id:'project',name:'Web',type:'web'}];
const sprints=[{id:'native-sprint',project_id:'project',name:'Sprint Alpha',jira_sprint_id:'42',state:'active',requirement_count:0,requirement_ids:['saved-story']},{id:'next-sprint',project_id:'project',name:'Sprint Beta',state:'future',requirement_count:0},{id:'foreign-sprint',project_id:'other',name:'Foreign Sprint',state:'future'}];
const releases=[{id:'open-release',project_id:'project',name:'Autumn delivery',fix_version:'v2',state:'planned',persisted_state:'planned',sprint_ids:[],requirement_ids:[],requirement_count:0},{id:'next-release',project_id:'project',name:'Winter delivery',fix_version:'v3',state:'planned',sprint_ids:[],requirement_ids:[],requirement_count:0},{id:'closed-release',project_id:'project',name:'Summer delivery',fix_version:'v1',state:'released',sprint_ids:[],requirement_ids:[],requirement_count:0},{id:'foreign-release',project_id:'other',name:'Foreign release',fix_version:'foreign',state:'planned',sprint_ids:[],requirement_ids:[],requirement_count:0}];
api.requirementIterations.list=async input=>{window.calls.push({kind:'sprints',input});await new Promise(resolve=>setTimeout(resolve,80));return sprints};
api.requirementReleases.list=async input=>{window.calls.push({kind:'releases',input});await new Promise(resolve=>setTimeout(resolve,80));return releases};
let story=null;
const page=items=>({items,is_last:true,next_cursor:null});
api.requirements.listPage=async()=>page(story?[story]:[]);api.requirementIterations.listRequirements=async()=>page(story?[story]:[]);
const metrics={total:0,mapped:0,highPriority:0,open:0,completed:0,qaTotal:0,totalDefects:0,completionPercent:0,coveragePercent:0,defectDensity:0,groomed:0,notGroomed:0,described:0,specified:0,teamAssigned:0,slipped:0,onCourse:0,sprintCommitted:0,releaseScoped:0,backlog:0};
api.requirements.metrics=async()=>({all:metrics,backlog:metrics,sprints:metrics,sprint_health:[],filter_options:{statuses:['open'],labels:[],sprints:[],fix_versions:[],releases:[]}});
api.requirements.createMetadata=api.requirements.editMetadata=async()=>({fields:[],core_fields:[],custom_fields:[],workflow_statuses:{default_status:'open',statuses:[{value:'open',label:'Open'},{value:'qa_done',label:'QA Done'}]}});
api.requirements.create=async input=>{window.calls.push({kind:'create',input});story={id:'saved-story',display_id:'ST-1',...input,iteration_id:input.iteration_id||null,sprint:sprints.find(item=>item.id===input.iteration_id)?.name||input.sprint||'',labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:input.gherkin_scenarios||[],revision:1,updated_at:'2026-09-20T10:00:00Z'};return{id:story.id}};
api.requirements.get=async()=>story;
api.requirements.bulkImport=async input=>{window.calls.push({kind:'import',input});return {transaction_id:'story-import-receipt',queued:true,status:'queued'}};
api.requirements.update=async(id,input)=>{window.calls.push({kind:'update',id,input});story={...story,...input,sprint:sprints.find(item=>item.id===input.iteration_id)?.name||story.sprint,revision:story.revision+1,updated_at:'2026-09-20T11:00:00Z'};return{updated:true,revision:story.revision}};
api.requirementIterations.assignRequirements=async(id,ids)=>{window.calls.push({kind:'move',id,ids});story={...story,iteration_id:id,sprint:sprints.find(item=>item.id===id).name};return {assigned:ids.length,assigned_issue_ids:ids,assigned_issue_keys:ids.map(()=>story.display_id)}};
api.requirementReleases.appendScope=async()=>{throw new Error('Story assignment must be atomic in its create/update request')};
const mode=new URLSearchParams(location.search).get('mode')||'stories';
const router=createMemoryRouter([{path:'/',element:<RequirementsPage workspaceMode={mode}/>},{path:'/testops',element:<h1>Batch Process Receipt</h1>}],{initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><AuthProvider><LocalizationProvider userId='planner'><main style={{height:'100vh',overflowY:'auto',padding:24}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);`;

test("Story create/edit preserves planning, criteria layout, multiple scenarios and readiness review in Stories, Backlog and Sprints", { timeout: 120000 }, async () => {
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
    for (const mode of ["stories", "backlog", "sprints"]) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/**", route => { errors.push(`Unexpected real API request: ${route.request().url()}`); return route.abort(); });
      await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html?mode=${mode}`);
      const dialog = page.getByRole("dialog", { name: "Create Story", exact: true });
      await dialog.waitFor();
      const sprint = dialog.locator(".story-create-sprint-field select");
      const release = dialog.locator(".story-create-release-field select");
      assert.equal(await sprint.inputValue(), "native-sprint", `${mode}: deep-link Sprint survives delayed capabilities/catalogs`);
      assert.equal(await release.inputValue(), "release:open-release", `${mode}: deep-link Release survives loading`);
      assert.ok(!(await sprint.locator("option").allTextContents()).some(label => label.includes("Foreign")));
      assert.ok(!(await release.locator("option").allTextContents()).some(label => /Foreign|Summer/.test(label)));
      await dialog.locator("#create-requirement-title-input").fill(`Mapped Story ${mode}`);
      const criteria='Given a workspace membership, when I open the project, then I see its Stories.';
      await dialog.locator('.story-acceptance-criteria-field textarea').fill(criteria);
      const assertCriteriaOrder=async(surface)=>{
        const description=await surface.locator('.story-create-description-field').boundingBox();
        const acceptance=await surface.locator('.story-acceptance-criteria-field').boundingBox();
        const metadata=await surface.locator('.story-create-secondary-grid').boundingBox();
        assert.ok(acceptance.y >= description.y + description.height - 1, 'Acceptance Criteria follows Description visually');
        assert.ok(acceptance.y + acceptance.height <= metadata.y + 1, 'Acceptance Criteria precedes metadata visually');
      };
      await assertCriteriaOrder(dialog);
      if(mode==='stories') { await page.setViewportSize({width:390,height:844});await assertCriteriaOrder(dialog);await page.setViewportSize({width:1500,height:1000}); }
      assert.equal(await dialog.locator('.gherkin-editor.is-compact.is-document-layout').count(),1);
      if (!(await dialog.getByRole('textbox',{name:'Scenario name',exact:true}).count())) await dialog.getByRole('button',{name:'Add Scenario',exact:true}).click();
      await dialog.getByRole('textbox',{name:'Scenario name',exact:true}).last().fill('Successful workspace access');
      await dialog.getByRole('button',{name:'Add Scenario',exact:true}).click();
      assert.equal(await dialog.getByRole('textbox',{name:'Scenario name',exact:true}).last().inputValue(),'');
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Scenario name');
      await dialog.getByRole('textbox',{name:'Scenario name',exact:true}).last().fill('Restricted workspace access');
      assert.equal(await dialog.getByRole('textbox',{name:'Scenario name',exact:true}).count(),2);
      await dialog.getByRole('tab',{name:/Spec Kit/}).click();
      assert.equal(await dialog.locator('.speckit-editor.is-compact').count(),1);
      if(mode==='stories' && process.env.STORY_SCREENSHOT_DIR) {
        await mkdir(process.env.STORY_SCREENSHOT_DIR,{recursive:true});
        await dialog.locator('.story-specification-editor').screenshot({path:`${process.env.STORY_SCREENSHOT_DIR}/spec-kit.png`});
      }
      await dialog.getByRole('tab',{name:/Gherkin/}).click();
      if(mode==='stories' && process.env.STORY_SCREENSHOT_DIR) await dialog.locator('.story-specification-editor').screenshot({path:`${process.env.STORY_SCREENSHOT_DIR}/gherkin.png`});
      await dialog.getByRole("button", { name: "Create Story", exact: true }).click();
      await page.getByRole("heading", { name: "Story details", exact: true }).waitFor();
      const detail = page.locator("form.story-detail-form");
      await assertCriteriaOrder(detail);
      assert.equal(await page.locator('.story-detail-section-context.is-details').count(),0);
      assert.equal(await page.getByRole('button',{name:'AI Defect from Failures',exact:true}).count(),0);
      assert.equal(await detail.getByRole('textbox',{name:'Scenario name',exact:true}).count(),2);
      assert.equal(await detail.getByRole('textbox',{name:'Scenario name',exact:true}).nth(1).inputValue(),'Restricted workspace access');
      await detail.getByRole('button',{name:'Add Scenario',exact:true}).click();
      await detail.getByRole('textbox',{name:'Scenario name',exact:true}).last().fill('Expired membership access');
      if(mode==='stories' && process.env.STORY_SCREENSHOT_DIR) await page.getByRole('group',{name:'Selected Story health metrics',exact:true}).screenshot({path:`${process.env.STORY_SCREENSHOT_DIR}/readiness-card.png`});
      await page.getByRole('button',{name:'Review Story Release Readiness',exact:true}).click();
      const readiness=page.getByRole('dialog',{name:'Story Release Readiness',exact:true});await readiness.waitFor();
      assert.equal(await readiness.locator('.story-readiness-checklist > ul > li').count(),5);
      assert.match(await readiness.locator('#story-readiness-review-summary').innerText(),/0 of 5 Checks Met · 5 Unverified/);
      await readiness.getByRole('button',{name:'Close',exact:true}).click();
      assert.equal(await detail.locator('.story-acceptance-criteria-field textarea').inputValue(),criteria);
      const detailRelease = detail.locator(".story-detail-release-field select");
      assert.equal(await detailRelease.inputValue(), "release:open-release");
      assert.ok((await detailRelease.locator("option").allTextContents()).includes("Winter delivery"));
      await detailRelease.selectOption("release:next-release");
      await detail.locator(".story-detail-sprint-field select").selectOption("next-sprint");
      await detail.getByRole("button", { name: "Save Story", exact: true }).click();
      await page.waitForFunction(() => window.calls.some(call => call.kind === "update"));
      const calls = await page.evaluate(() => window.calls);
      const created = calls.find(call => call.kind === "create").input;
      const updated = calls.find(call => call.kind === "update").input;
      assert.equal(created.iteration_id, "native-sprint");
      assert.equal(created.release_id, "open-release");
      assert.deepEqual(created.acceptance_criteria,[criteria]);
      assert.deepEqual(updated.acceptance_criteria,[criteria]);
      assert.equal(created.gherkin_scenarios.length,2);
      assert.equal(updated.gherkin_scenarios.length,3);
      assert.match(updated.gherkin_scenarios[1],/Restricted workspace access/);
      assert.equal(updated.iteration_id, "next-sprint");
      assert.equal(updated.release_id, "next-release");
      assert.equal(updated.release, "Winter delivery");
      assert.equal(updated.fix_version, "v3");
      assert.ok(calls.filter(call => ["sprints", "releases"].includes(call.kind)).every(call => call.input.project_id === "project"));
      assert.deepEqual(errors, []);
      if(mode==='sprints') {
        await page.getByRole('button',{name:'Back to Story tiles',exact:true}).click();
        await page.getByRole('button',{name:'List view',exact:true}).click();
        const movedRow=page.getByRole('row').filter({hasText:'Mapped Story sprints'});
        await movedRow.waitFor();
        const assignedSprint=()=>movedRow.evaluate(row=>{
          let previous=row.previousElementSibling;
          while(previous) {
            const heading=previous.querySelector('.requirement-sprint-heading strong');
            if(heading)return heading.textContent;
            previous=previous.previousElementSibling;
          }
          return null;
        });
        assert.equal(await movedRow.count(),1,'A moved Story appears only once across expanded Sprints');
        assert.equal(await assignedSprint(),'Sprint Beta','A stale origin header cannot reclaim a saved Sprint assignment');
        await movedRow.locator('input[type=checkbox]').check();
        await page.getByRole('combobox',{name:'Move 1 selected Story to Sprint',exact:true}).selectOption('native-sprint');
        await page.waitForFunction(()=>window.calls.some(call=>call.kind==='move'));
        await page.waitForFunction(()=>{
          const row=Array.from(document.querySelectorAll('tr')).find(candidate=>!candidate.classList.contains('data-table-group-row')&&candidate.textContent.includes('Mapped Story sprints'));
          let previous=row?.previousElementSibling;
          while(previous){const heading=previous.querySelector('.requirement-sprint-heading strong');if(heading)return heading.textContent==='Sprint Alpha';previous=previous.previousElementSibling;}
          return false;
        });
        assert.equal(await movedRow.count(),1,'Moving back removes the Story from the previous destination');
        assert.equal(await assignedSprint(),'Sprint Alpha');
        assert.deepEqual(errors,[]);
      }
      if(mode==='stories') {
        await page.getByRole('button',{name:'Back to Story tiles',exact:true}).click();
        await page.getByRole('button',{name:'Open create Story options',exact:true}).click();
        await page.getByRole('menuitem',{name:/Bulk Import Stories/}).click();
        const importer=page.getByRole('dialog',{name:'Bulk import Stories',exact:true});
        const guidance=importer.getByRole('button',{name:'Story CSV import guidance',exact:true});
        await guidance.click();await page.getByRole('tooltip').filter({hasText:'Use the current Story fields'}).waitFor();
        await guidance.press('Escape');
        assert.equal(await importer.count(),1,'Escape closes the guidance while preserving the import dialog');
        assert.equal(await page.getByRole('tooltip').count(),0);
        const templateButton=importer.getByRole('button',{name:'Download Story Template',exact:true});
        assert.equal(await templateButton.locator('svg').count(),1);
        const templateBox=await templateButton.boundingBox();const importerBox=await importer.boundingBox();
        assert.ok(templateBox.x > importerBox.x + importerBox.width/2, 'Template download stays on the right of the dialog');
        const downloading=page.waitForEvent('download');
        await importer.getByRole('button',{name:'Download Story Template',exact:true}).click();
        const download=await downloading;
        assert.equal(download.suggestedFilename(),'hellotest-story-import-template.csv');
        const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
        const content=Buffer.concat(chunks);
        assert.match(content.toString(),/Acceptance Criteria/);assert.match(content.toString(),/native-sprint/);assert.match(content.toString(),/open-release/);
        await importer.locator('input[type=file]').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from('Title,Priority\nInvalid Story,99')});
        await importer.getByRole('alert').waitFor();assert.equal(await importer.getByRole('button',{name:'Queue 1 Story',exact:true}).isDisabled(),true);
        await importer.locator('input[type=file]').setInputFiles({name:'template.csv',mimeType:'text/csv',buffer:content});
        if(process.env.STORY_SCREENSHOT_DIR) await importer.screenshot({path:`${process.env.STORY_SCREENSHOT_DIR}/import.png`});
        await importer.getByRole('button',{name:'Queue 1 Story',exact:true}).click();
        await page.getByRole('heading',{name:'Batch Process Receipt'}).waitFor();
        const imported=await page.evaluate(()=>window.calls.find(call=>call.kind==='import').input);
        assert.equal(imported.rows[0].iteration_id,'native-sprint');assert.equal(imported.rows[0].release_id,'open-release');
        assert.equal(imported.rows[0].acceptance_criteria.length,1);
        assert.deepEqual(errors,[]);
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true })]);
  }
});
