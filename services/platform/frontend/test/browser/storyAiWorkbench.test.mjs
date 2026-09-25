import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const name = `story-workbench-${randomUUID()}`;
const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{AuthProvider}from'/src/auth/AuthContext';import{LocalizationProvider}from'/src/context/LocalizationContext';
import{api,sessionStorage}from'/src/lib/api';import{StoryAiStudioShell,StoryAiSettingsGroup}from'/services/ai/frontend/components/StoryAiStudioShell';
import{StoryAiDraftQueue,StoryAiDraftInspector}from'/services/ai/frontend/components/StoryAiStudioContent';import{AiPromptContextPanel}from'/services/ai/frontend/components/AiPromptContextPanel';import{AiLlmSelect}from'/services/ai/frontend/components/AiLlmSelect';
import '/src/styles.css';import '/src/modal-system.css';import '/services/manual/frontend/pages/RequirementsPage.ai.css';
const session={token:'isolated-story-workbench',user:{id:'fixture',role:'admin',name:'Fixture',email:'fixture@example.test'}};sessionStorage.write(session);
function stub(object){for(const[key,value]of Object.entries(object)){if(typeof value==='function')object[key]=async()=>[];else if(value&&typeof value==='object')stub(value)}}stub(api);api.auth.session=async()=>session;api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});api.settings.getLocalization=async()=>({strings:{}});window.calls=[];api.aiPromptTemplates.list=async input=>{window.calls.push({type:'templates',input});return[{id:'template',scope:input.scope,name:'Scoped Story guidance',prompt_text:'Keep delivery changes measurable and preserve saved preferences.',applies_to:['requirements'],tags:[]}]};
const evidence={evidence:[{ref:'S1',type:'story',title:'Delivery policy',excerpt:'Eligible delivery windows must be available.'}],evidenceRefs:['S1'],contextReductionReason:'Full context exceeded the provider limit; generated with shorter context.'};
const modes=new URLSearchParams(location.search);const mode=modes.get('mode')||'create';
const drafts=[{...evidence,id:'first',title:'Save delivery preferences',description:'As a customer, I want to save delivery preferences so that checkout reflects my chosen address and delivery window.',priority:2,status:'Open',generated:mode==='create',acceptanceCriteria:['The customer can save an eligible delivery address.','Unavailable delivery windows cannot be selected.'],gherkinScenarios:['Scenario: Save a delivery preference\\nGiven the customer has an eligible address\\nWhen they save a delivery window\\nThen checkout displays that address and delivery window'],sprint:'Checkout Sprint',release:'Autumn delivery'}, {...evidence,id:'second',title:mode==='create'?'Update an existing delivery window':'Complete delivery preferences',description:'Preserve the saved address when changing the requested delivery window. Explain validation errors without discarding the customer’s edits.',priority:3,status:'Open',generated:true,acceptanceCriteria:['A valid new window replaces the previous selection.'],gherkinScenarios:['Scenario: Update the window\\nGiven a saved delivery preference\\nWhen the customer selects an available window\\nThen the updated window is saved'],sprint:'Checkout Sprint',release:'Autumn delivery'}].filter(draft=>mode==='create'||draft.generated);
function App(){const[items,setItems]=useState(drafts);const[active,setActive]=useState(mode==='create'?'first':'second');const[selected,setSelected]=useState(['first','second']);const[context,setContext]=useState('Create a customer Story for saving delivery preferences. Preserve the existing address validation and include measurable acceptance criteria.');const[links,setLinks]=useState('');const[llm,setLlm]=useState('');const[include,setInclude]=useState(true);const[busy,setBusy]=useState(false);const[fields,setFields]=useState({title:true,description:true,priority:false});const[message,setMessage]=useState('');const item=items.find(d=>d.id===active);const edit=patch=>setItems(current=>current.map(d=>d.id===active?{...d,...patch}:d));const engines=[{id:'provider-a',name:'Product team LLM',model:'Model A'},{id:'provider-b',name:'Review LLM',model:'Model B'}];
return <div className='modal-backdrop story-ai-workbench-backdrop'><div className='modal-card story-ai-workbench-dialog' role='dialog' aria-modal='true' aria-labelledby='story-test-title'><StoryAiStudioShell mode={mode} titleId='story-test-title' descriptionId='story-test-description' agentStatus={busy?'running':'completed'} hasProposal={items.length>0} includeGherkin={include} onIncludeGherkinChange={setInclude} includeGherkinDisabled={busy} onClose={()=>window.calls.push({type:'close'})} closeDisabled={busy} primaryGenerateDisabled={busy} primaryGenerateLabel={busy?'Generating…':mode==='create'?'Generate drafts':'Complete Story'} onPrimaryGenerate={()=>{window.calls.push({type:'generate',llm,context,include});setBusy(true);setTimeout(()=>{setBusy(false);setMessage('Drafts generated. Review before saving.');},100)}} contextLabel='Project delivery context' integrationId={llm} integrations={engines}
settingsPane={<div className='story-studio-settings-content'><StoryAiSettingsGroup title='Generation Context' description='Manual + Templates'><AiPromptContextPanel additionalContext={context} externalLinksText={links} onAdditionalContextChange={setContext} onExternalLinksTextChange={setLinks} onAddImages={()=>{}} onRemoveImage={()=>{}} referenceImages={[]} projectId='project' appTypeId='app' promptScope={mode==='create'?'requirement_creation':'requirement_completion'} showPromptEditor/></StoryAiSettingsGroup><StoryAiSettingsGroup title='Intelligence Engine' description='Configured LLM'><AiLlmSelect integrations={engines} value={llm} onChange={setLlm}/><label>Draft count<select defaultValue='2'><option>1</option><option>2</option><option>3</option></select></label></StoryAiSettingsGroup><StoryAiSettingsGroup title='Delivery scope' description='Selected drafts'><label>Sprint<select defaultValue='sprint'><option value='sprint'>Checkout Sprint</option></select></label><label>Release<select defaultValue='release'><option value='release'>Autumn delivery</option></select></label></StoryAiSettingsGroup></div>}
queuePane={<StoryAiDraftQueue drafts={items} activeDraftId={active} onActivateDraft={setActive} allowSelection={mode==='create'&&!busy} selectedDraftIds={selected} onSelectAll={value=>setSelected(value?items.map(d=>d.id):[])} onClearSelection={()=>setSelected([])} onToggleDraft={(id,value)=>setSelected(current=>value?[...new Set([...current,id])]:current.filter(d=>d!==id))}/>}
inspectorContent={<StoryAiDraftInspector draft={item} editable={!busy&&(mode==='create'||item?.generated)} showGherkin={include} showProperties onTitleChange={title=>edit({title})} onDescriptionChange={description=>edit({description})} onAcceptanceCriteriaChange={acceptanceCriteria=>edit({acceptanceCriteria})} onPriorityChange={priority=>edit({priority})} onGherkinScenariosChange={gherkinScenarios=>edit({gherkinScenarios})} fieldSelection={mode==='improve'&&item?.generated?Object.entries(fields).map(([key,checked])=>({key,label:key[0].toUpperCase()+key.slice(1),value:String(item[key]),checked})):[]} onFieldSelectionChange={(key,checked)=>setFields(current=>({...current,[key]:checked}))} statusContent={message?<div role='status'>{message}</div>:null}/>}
commandBar={<><button disabled={busy||!item} onClick={()=>{window.calls.push({type:'decline',id:active});setItems(current=>current.filter(d=>d.id!==active));setActive(items.find(d=>d.id!==active)?.id||'')}}>Decline {mode==='create'?'Draft':'Changes'}</button><button className='story-studio-accept-button' disabled={busy||(mode==='create'?!selected.length:!item?.generated||!Object.values(fields).some(Boolean))} onClick={()=>window.calls.push({type:'accept',selected,fields,items})}>{mode==='create'?'Accept into Library':'Apply to Story'}</button></>}/></div></div>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><LocalizationProvider userId='fixture'><App/></LocalizationProvider></AuthProvider></QueryClientProvider>);`;

test('Story AI workbenches match shared layout and preserve review interactions on desktop and mobile', {timeout:120000}, async()=>{
  let browser;
  const screenshots=process.env.STORY_AI_SCREENSHOTS||'/tmp/qaira-story-ai-workbench';
  await mkdir(screenshots,{recursive:true});
  try{
    await writeFile(new URL(`${name}.tsx`,root),fixture);
    await writeFile(new URL(`${name}.html`,root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0"><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    for(const mode of ['create','improve'])for(const mobile of [false,true]){
      const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];
      page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push(`Unexpected API request ${route.request().url()}`);return route.abort()});
      await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html?mode=${mode}`);
      await page.getByRole('heading',{name:mode==='create'?'Create Stories using AI':'AI Complete Story',exact:true}).waitFor();
      const toolbar=page.locator('.ai-prompt-context-toolbar');await toolbar.waitFor();
      const positions=await toolbar.locator('[role="tab"], .ai-prompt-template-trigger').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}}));
      assert.equal(positions.length,5);assert.ok(Math.max(...positions.map(p=>p.y+p.h/2))-Math.min(...positions.map(p=>p.y+p.h/2))<3,'Text/Files/Links/Images/Templates share one row');
      const contextBox=await page.locator('.ai-test-generator-context').boundingBox();assert.ok(positions.every(p=>p.x>=contextBox.x&&p.x+p.w<=contextBox.x+contextBox.width+1),JSON.stringify({positions,contextBox}));
      await page.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:'Use',exact:true}).click();
      await page.getByRole('tab',{name:/Text/}).click();const prompt=page.locator('.ai-prompt-copy-field textarea');assert.match(await prompt.inputValue(),/Keep delivery changes measurable/);await page.getByRole('tab',{name:/Links/}).click();await page.locator('.ai-external-links-field textarea').fill('https://example.test/delivery');await page.getByRole('tab',{name:/Text/}).click();assert.match(await prompt.inputValue(),/Keep delivery changes measurable/);
      const populatedToolbar=await toolbar.evaluate(element=>{const row=element.getBoundingClientRect();const button=element.querySelector('.ai-prompt-template-trigger').getBoundingClientRect();return {right:button.right,bound:row.right}});assert.ok(populatedToolbar.right<=populatedToolbar.bound+1);
      const templateCalls=await page.evaluate(()=>window.calls.filter(c=>c.type==='templates'));assert.equal(templateCalls[0].input.scope,mode==='create'?'requirement_creation':'requirement_completion');assert.equal(templateCalls[0].input.project_id,'project');assert.equal(templateCalls[0].input.app_type_id,'app');
      await page.locator('.ai-llm-select select').selectOption('provider-b');assert.equal(await page.locator('.ai-llm-select select').inputValue(),'provider-b');
      await page.locator('.ai-test-generator-context').evaluate(e=>e.scrollTop=0);await page.screenshot({animations:'disabled',path:`${screenshots}/${mode}-${mobile?'mobile-context':'desktop'}.png`});
      const workspace=page.locator('.ai-test-generator-workspace');await workspace.scrollIntoViewIfNeeded();await workspace.getByRole('heading',{name:'Title',exact:true}).waitFor();assert.equal(await workspace.getByText('Review notes',{exact:true}).count(),0);assert.equal(await page.locator('.story-studio-draft-tile').count(),mode==='create'?2:1);
      await page.getByLabel('Include Gherkin',{exact:true}).uncheck();await workspace.scrollIntoViewIfNeeded();
      await page.getByRole('radio',{name:'Gherkin',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Add scenario',exact:true}).isDisabled(),true);assert.equal(await page.locator('.story-studio-scenario__actions').count(),0);await page.getByLabel('Include Gherkin',{exact:true}).check();await workspace.scrollIntoViewIfNeeded();await page.locator('.story-studio-scenario__steps').waitFor();await page.locator('.story-studio-scenario__steps').scrollIntoViewIfNeeded();
      await page.screenshot({animations:'disabled',path:`${screenshots}/${mode}-${mobile?'mobile-output':'desktop-gherkin'}.png`});
      await page.getByRole('radio',{name:'Structured',exact:true}).click();
      await page.getByLabel('Story title',{exact:true}).fill('Reviewed delivery preferences');
      await page.getByLabel('Acceptance criterion 1',{exact:true}).fill('A saved preference is restored on the next checkout.');
      if(mode==='create'){
        await page.getByRole('button',{name:'Clear selection',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Accept into Library'}).isDisabled(),true);
        await page.getByLabel('Select all',{exact:true}).check();
      }else{await page.locator('.story-studio-field-review').getByRole('checkbox',{name:/Title/}).uncheck();}
      await page.getByRole('button',{name:mode==='create'?'Generate drafts':'Complete Story',exact:true}).click();
      await page.waitForFunction(()=>window.calls.some(c=>c.type==='generate'));
      await page.getByRole('button',{name:mode==='create'?'Accept into Library':'Apply to Story',exact:true}).click();
      const calls=await page.evaluate(()=>window.calls);const accepted=calls.find(c=>c.type==='accept');assert.ok(accepted);assert.equal(calls.find(c=>c.type==='generate').llm,'provider-b');
      assert.ok(accepted.items.some(d=>d.title==='Reviewed delivery preferences'));if(mode==='improve')assert.equal(accepted.fields.title,false);
      await page.getByRole('button',{name:'Show intelligence status'}).click();await page.getByText('Intelligence Status',{exact:true}).waitFor();
      const evidencePane=page.getByRole('region',{name:'Story cited evidence'});await evidencePane.getByText('1 cited source',{exact:true}).waitFor();
      assert.equal(await workspace.getByRole('button',{name:/View cited evidence/}).count(),0);
      await evidencePane.getByText('Delivery policy',{exact:true}).first().waitFor();
      await evidencePane.getByRole('status').filter({hasText:'shorter context'}).waitFor();
      await evidencePane.getByText('Sources and review boundaries',{exact:true}).click();
      await evidencePane.getByText('Eligible delivery windows must be available.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Hide intelligence status'}).click();
      if(!mobile){await page.getByRole('textbox',{name:'Search Story drafts'}).fill('no match');await page.getByRole('heading',{name:'No matching drafts'}).waitFor();assert.equal(await page.getByRole('button',{name:mode==='create'?'Decline Draft':'Decline Changes',exact:true}).isDisabled(),true);await page.getByText('Drafts generated. Review before saving.',{exact:true}).waitFor();await page.getByRole('textbox',{name:'Search Story drafts'}).fill('');}
      await page.getByRole('button',{name:mode==='create'?'Decline Draft':'Decline Changes',exact:true}).click();assert.equal(await page.locator('.story-studio-draft-tile').count(),mode==='create'?1:0);
      assert.deepEqual(errors,[]);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
      await page.close();
    }
  }finally{await browser?.close();await Promise.all([rm(new URL(`${name}.tsx`,root),{force:true}),rm(new URL(`${name}.html`,root),{force:true})]);}
});


test('Production RequirementsPage mounts both Story workbenches with the reference geometry', {timeout:90000}, async()=>{
  const planningSource=await readFile(new URL('../../../../manual/test/browser/storyPlanningAssignments.test.mjs',import.meta.url),'utf8');
  let actual=runInNewContext(planningSource.match(/const fixture = (`[\s\S]*?`);/)[1]);
  actual=actual.replace("let story=null;", "let story={id:'saved-story',project_id:'project',display_id:'ST-1',title:'Save delivery preferences',description:'Customers can save an eligible address and delivery window.',status:'open',priority:2,iteration_id:'native-sprint',sprint:'Sprint Alpha',release:'Autumn delivery',fix_version:'v2',labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],revision:1};");
  actual=actual.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']", "initialEntries:['/']");
  actual=actual.replace("api.requirements.get=async()=>story;", "api.requirements.get=async()=>story;api.integrations.list=async()=>[{id:'llm',name:'Product LLM',type:'llm',is_active:true}];");
  const actualName=`${name}-actual`;let browser;
  try{
    await writeFile(new URL(`${actualName}.tsx`,root),actual);
    await writeFile(new URL(`${actualName}.html`,root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${actualName}.tsx"></script></body></html>`);
    browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    for(const mobile of [false,true]){
      const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push(`Unexpected API ${route.request().url()}`);return route.abort()});
      await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${actualName}.html?mode=stories`);await page.getByText('Save delivery preferences',{exact:true}).waitFor().catch(async error=>{throw new Error(error.message+'\n'+JSON.stringify(errors)+'\n'+(await page.locator('body').innerText()).slice(0,2000))});
      const clickEnabled=async name=>{for(const button of await page.getByRole('button',{name,exact:true}).all())if(await button.isVisible()&&!await button.isDisabled()){await button.click();return;}throw new Error(`No enabled ${name}`)};
      for(const mode of ['create','improve']){
        if(mode==='improve'){await page.getByText('Save delivery preferences',{exact:true}).click();await page.getByRole('heading',{name:'Story details',exact:true}).waitFor();}
        await clickEnabled(mode==='create'?'Create Stories using AI':'AI Complete Story');
        const dialog=page.getByRole('dialog',{name:mode==='create'?'Create Stories using AI':'AI Complete Story',exact:true});await dialog.waitFor();
        assert.equal(await dialog.locator('.story-studio-shell').evaluate(e=>getComputedStyle(e).display),'grid');
        assert.equal(await dialog.locator('.ai-feature-composer').count(),0);assert.equal(await dialog.locator('.ai-llm-select select').count(),1);
        await dialog.getByRole('tab',{name:/Text/}).waitFor();await dialog.getByRole('button',{name:'Templates',exact:true}).waitFor();
        await page.screenshot({animations:'disabled',path:`/tmp/qaira-story-ai-workbench/actual-${mode}-${mobile?'mobile':'desktop'}.png`});
        if(!mobile){const searchStyle=await dialog.locator('.story-studio-search').evaluate(input=>{const s=getComputedStyle(input);return {background:s.background,shadow:s.boxShadow,height:s.height,padding:s.padding,html:input.outerHTML}});assert.match(searchStyle.background,/rgba\(0, 0, 0, 0\)/);assert.equal(searchStyle.height,'20px');await writeFile(`/tmp/qaira-story-ai-workbench/actual-search-style.json`,JSON.stringify(searchStyle,null,2));}
        await page.evaluate(()=>document.documentElement.dataset.theme='dark');assert.equal(await dialog.locator('.ai-test-generator-header h1').evaluate(e=>getComputedStyle(e).color),'rgb(0, 61, 155)');assert.equal(await dialog.locator('.ai-llm-select').evaluate(e=>getComputedStyle(e).color),'rgb(5, 26, 62)');assert.notEqual(await dialog.locator('.story-studio-inspector-empty h2, .story-studio-inspector__title h1').first().evaluate(e=>getComputedStyle(e).color),'rgb(248, 250, 252)');assert.equal(await dialog.locator('.ai-prompt-copy-field textarea').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');assert.equal(await dialog.locator('.story-studio-rovo-provider').count(),0);assert.equal(await dialog.getByText('HelloTest QA Agent',{exact:true}).count(),0);await page.screenshot({animations:'disabled',path:`/tmp/qaira-story-ai-workbench/actual-${mode}-${mobile?'mobile':'desktop'}-dark.png`});await page.evaluate(()=>delete document.documentElement.dataset.theme);
        if(mode==='improve'){await dialog.locator('.ai-test-generator-workspace').scrollIntoViewIfNeeded();await dialog.getByRole('heading',{name:'Your Story draft will appear here',exact:true}).waitFor();assert.match(await dialog.locator('.story-studio-selected-context').innerText(),/Save delivery preferences/);}
        await dialog.getByRole('button',{name:mode==='create'?'Close AI Story creation':'Close AI Story improvement',exact:true}).click();
      }
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser?.close();await Promise.all([rm(new URL(`${actualName}.tsx`,root),{force:true}),rm(new URL(`${actualName}.html`,root),{force:true})]);}
});
