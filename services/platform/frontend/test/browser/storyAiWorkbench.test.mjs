import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const contrastRatio = (foreground, background) => {
  const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
    const srgb = channel / 255; return srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};
const name = `story-workbench-${randomUUID()}`;
const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{AuthProvider}from'/src/auth/AuthContext';import{LocalizationProvider}from'/src/context/LocalizationContext';
import{api,sessionStorage}from'/src/lib/api';import{StoryAiStudioShell,StoryAiSettingsGroup}from'/services/ai/frontend/components/StoryAiStudioShell';
import{StoryAiDraftQueue,StoryAiDraftInspector}from'/services/ai/frontend/components/StoryAiStudioContent';import{AiPromptContextPanel}from'/services/ai/frontend/components/AiPromptContextPanel';import{AiLlmSelect}from'/services/ai/frontend/components/AiLlmSelect';
import '/src/styles.css';import '/src/modal-system.css';import '/src/dark-theme.css';import '/services/manual/frontend/pages/RequirementsPage.ai.css';import '/src/product-experience.css';
const session={token:'isolated-story-workbench',user:{id:'fixture',role:'admin',name:'Fixture',email:'fixture@example.test'}};sessionStorage.write(session);
function stub(object){for(const[key,value]of Object.entries(object)){if(typeof value==='function')object[key]=async()=>[];else if(value&&typeof value==='object')stub(value)}}stub(api);api.auth.session=async()=>session;api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});api.settings.getLocalization=async()=>({strings:{}});window.calls=[];api.aiPromptTemplates.list=async input=>{window.calls.push({type:'templates',input});return[{id:'template',scope:input.scope,name:'Scoped Story guidance',prompt_text:'Keep delivery changes measurable and preserve saved preferences.',applies_to:['requirements'],tags:[]}]};
const evidence={evidence:[{ref:'S1',type:'story',title:'Delivery policy',excerpt:'Eligible delivery windows must be available.'}],evidenceRefs:['S1'],contextReductionReason:'Full context exceeded the provider limit; generated with shorter context.'};
const modes=new URLSearchParams(location.search);const mode=modes.get('mode')||'create';
const drafts=[{...evidence,id:'first',title:'Save delivery preferences',description:'As a customer, I want to save delivery preferences so that checkout reflects my chosen address and delivery window.',priority:2,status:'Open',generated:mode==='create',acceptanceCriteria:['The customer can save an eligible delivery address.','Unavailable delivery windows cannot be selected.'],gherkinScenarios:['Scenario: Save a delivery preference\\nGiven the customer has an eligible address\\nWhen they save a delivery window\\nThen checkout displays that address and delivery window'],sprint:'Checkout Sprint',release:'Autumn delivery'}, {...evidence,id:'second',title:mode==='create'?'Update an existing delivery window':'Complete delivery preferences',description:'Preserve the saved address when changing the requested delivery window. Explain validation errors without discarding the customer’s edits.',priority:3,status:'Open',generated:true,acceptanceCriteria:['A valid new window replaces the previous selection.'],gherkinScenarios:['Scenario: Update the window\\nGiven a saved delivery preference\\nWhen the customer selects an available window\\nThen the updated window is saved'],sprint:'Checkout Sprint',release:'Autumn delivery'}].filter(draft=>mode==='create'||draft.generated);
function App(){const[items,setItems]=useState(drafts);const[active,setActive]=useState(mode==='create'?'first':'second');const[selected,setSelected]=useState(['first','second']);const[context,setContext]=useState('Create a customer Story for saving delivery preferences. Preserve the existing address validation and include measurable acceptance criteria.');const[links,setLinks]=useState('');const[llm,setLlm]=useState('');const[include,setInclude]=useState(true);const[busy,setBusy]=useState(false);const[fields,setFields]=useState({title:true,description:true,priority:false});const[message,setMessage]=useState('');const item=items.find(d=>d.id===active);const edit=patch=>setItems(current=>current.map(d=>d.id===active?{...d,...patch}:d));const engines=[{id:'provider-a',name:'Product team LLM',model:'Model A'},{id:'provider-b',name:'Review LLM',model:'Model B'}];
return <div className='modal-backdrop story-ai-workbench-backdrop'><div className='modal-card story-ai-workbench-dialog' role='dialog' aria-modal='true' aria-labelledby='story-test-title'><StoryAiStudioShell mode={mode} titleId='story-test-title' descriptionId='story-test-description' agentStatus={busy?'running':'completed'} hasProposal={items.length>0} includeGherkin={include} onIncludeGherkinChange={setInclude} includeGherkinDisabled={busy} onClose={()=>window.calls.push({type:'close'})} closeDisabled={busy} primaryGenerateDisabled={busy} primaryGenerateLabel={busy?'Generating…':mode==='create'?'Generate drafts':'Complete Story'} onPrimaryGenerate={()=>{window.calls.push({type:'generate',llm,context,include});setBusy(true);setTimeout(()=>{setBusy(false);setMessage('Drafts generated. Review before saving.');},800)}} mission={context} onMissionChange={setContext} contextLabel='Project delivery context' integrationId={llm} integrations={engines}
settingsPane={<div className='story-studio-settings-content'><StoryAiSettingsGroup title='Generation Context' description='Manual + Templates'><AiPromptContextPanel additionalContext={context} externalLinksText={links} onAdditionalContextChange={setContext} onExternalLinksTextChange={setLinks} onAddImages={()=>{}} onRemoveImage={()=>{}} referenceImages={[]} projectId='project' appTypeId='app' promptScope={mode==='create'?'requirement_creation':'requirement_completion'} showPromptEditor/></StoryAiSettingsGroup><StoryAiSettingsGroup title='Intelligence Engine' description='Configured LLM'><AiLlmSelect integrations={engines} value={llm} onChange={setLlm}/><label>Draft count<select defaultValue='2'><option>1</option><option>2</option><option>3</option></select></label></StoryAiSettingsGroup><StoryAiSettingsGroup title='Delivery scope' description='Selected drafts'><label>Sprint<select defaultValue='sprint'><option value='sprint'>Checkout Sprint</option></select></label><label>Release<select defaultValue='release'><option value='release'>Autumn delivery</option></select></label></StoryAiSettingsGroup></div>}
queuePane={<StoryAiDraftQueue drafts={items} activeDraftId={active} onActivateDraft={setActive} allowSelection={mode==='create'&&!busy} selectedDraftIds={selected} onSelectAll={value=>setSelected(value?items.map(d=>d.id):[])} onClearSelection={()=>setSelected([])} onToggleDraft={(id,value)=>setSelected(current=>value?[...new Set([...current,id])]:current.filter(d=>d!==id))}/>}
inspectorContent={<StoryAiDraftInspector baseline={mode==='improve'?{title:'Saved delivery preferences',description:'Saved address and delivery window.'}:undefined} draft={item} editable={!busy&&(mode==='create'||item?.generated)} showGherkin={include} showProperties onTitleChange={title=>edit({title})} onDescriptionChange={description=>edit({description})} onAcceptanceCriteriaChange={acceptanceCriteria=>edit({acceptanceCriteria})} onPriorityChange={priority=>edit({priority})} onGherkinScenariosChange={gherkinScenarios=>edit({gherkinScenarios})} fieldSelection={mode==='improve'&&item?.generated?Object.entries(fields).map(([key,checked])=>({key,label:key[0].toUpperCase()+key.slice(1),value:String(item[key]),checked})):[]} onFieldSelectionChange={(key,checked)=>setFields(current=>({...current,[key]:checked}))} statusContent={message?<div role='status'>{message}</div>:null}/>}
commandBar={<><button disabled={busy||!item} onClick={()=>{window.calls.push({type:'decline',id:active});setItems(current=>current.filter(d=>d.id!==active));setActive(items.find(d=>d.id!==active)?.id||'')}}>Decline {mode==='create'?'Draft':'Changes'}</button><button className='story-studio-accept-button' disabled={busy||(mode==='create'?!selected.length:!item?.generated||!Object.values(fields).some(Boolean))} onClick={()=>window.calls.push({type:'accept',selected,fields,items})}>{mode==='create'?'Accept into Library':'Apply to Story'}</button></>}/></div></div>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><LocalizationProvider userId='fixture'><App/></LocalizationProvider></AuthProvider></QueryClientProvider>);`;

test('Story command canvases preserve evidence, selection and comparison on desktop and mobile', {timeout:120000}, async()=>{
  let browser;
  const screenshots=process.env.STORY_AI_SCREENSHOTS||'/tmp/qaira-v2-story-studio';
  await mkdir(screenshots,{recursive:true});
  try{
    await writeFile(new URL(`${name}.tsx`,root),fixture);
    await writeFile(new URL(`${name}.html`,root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0"><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    for(const mode of ['create','improve'])for(const mobile of [false,true]){
      const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];
      page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push(`Unexpected API request ${route.request().url()}`);return route.abort()});
      await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html?mode=${mode}`);
      const studio=page.getByRole('dialog',{name:mode==='create'?'Create Stories using AI':'AI Complete Story',exact:true});await studio.waitFor();
      assert.equal(await page.locator('.ai-context-peek-backdrop').first().isVisible(),false);
      await studio.locator('.ai-intent-canvas summary').click();
      const instructions=studio.getByRole('textbox',{name:'Instructions for Story Architect',exact:true});assert.match(await instructions.inputValue(),/Create a customer Story/);
      await studio.getByRole('button',{name:'Show context',exact:true}).click();
      const context=page.getByRole('dialog',{name:'Context & options',exact:true});await context.waitFor();
      assert.equal(await context.getByRole('tab',{name:/Text/}).count(),0,'Instructions have one home');
      await context.getByRole('button',{name:'Templates',exact:true}).click();await page.getByRole('button',{name:'Use',exact:true}).click();
      await context.getByText('Template included',{exact:true}).waitFor();await context.locator('.ai-context-pack-summary summary').click();assert.match(await context.locator('.ai-context-pack-summary pre').textContent(),/Keep delivery changes measurable/);
      await context.getByRole('tab',{name:/Links/}).click();await context.locator('.ai-external-links-field textarea').fill('https://example.test/delivery');
      await context.locator('.ai-llm-select select').selectOption('provider-b');await context.getByLabel('Include Gherkin',{exact:true}).uncheck();
      await page.keyboard.press('Escape');assert.equal(await context.isVisible(),false);assert.equal(await studio.getByRole('button',{name:'Show context',exact:true}).evaluate(element=>element===document.activeElement),true);
      assert.match(await instructions.inputValue(),/Create a customer Story/);await instructions.fill('Preserve saved preferences and clarify measurable delivery outcomes.');
      await studio.locator('.ai-intent-canvas summary').click();
      const workspace=studio.locator('.ai-test-generator-workspace');await workspace.getByRole('heading',{name:'Title',exact:true}).waitFor();
      await studio.getByRole('radio',{name:'Gherkin',exact:true}).click();assert.equal(await studio.getByRole('button',{name:'Add scenario',exact:true}).isDisabled(),true);
      await studio.getByRole('button',{name:'Show context',exact:true}).click();await context.getByLabel('Include Gherkin',{exact:true}).check();await page.keyboard.press('Escape');
      await studio.locator('.story-studio-scenario__steps').waitFor();await studio.getByRole('radio',{name:'Structured',exact:true}).click();
      await studio.getByLabel('Story title',{exact:true}).fill('Reviewed delivery preferences');await studio.getByLabel('Acceptance criterion 1',{exact:true}).fill('A saved preference is restored on the next checkout.');
      if(mode==='create'){
        await studio.getByRole('button',{name:'Clear selection',exact:true}).click();assert.equal(await studio.getByRole('button',{name:'Accept into Library'}).isDisabled(),true);await studio.getByLabel('Select all',{exact:true}).check();
      }else{
        await studio.getByRole('button',{name:'Compare changes',exact:true}).click();await studio.getByRole('region',{name:'Current and proposed content',exact:true}).getByText('Saved delivery preferences',{exact:true}).waitFor();
        await studio.getByRole('button',{name:'Hide comparison',exact:true}).click();await studio.locator('.story-studio-field-review').getByRole('checkbox',{name:/Title/}).uncheck();
      }
      await studio.getByRole('button',{name:mode==='create'?'Generate drafts':'Complete Story',exact:true}).click();await studio.getByRole('list',{name:'Generation stages'}).waitFor();
      await studio.getByRole('button',{name:mode==='create'?'Accept into Library':'Apply to Story',exact:true}).click();
      const calls=await page.evaluate(()=>window.calls);const accepted=calls.find(c=>c.type==='accept');assert.ok(accepted);const generated=calls.find(c=>c.type==='generate');assert.equal(generated.llm,'provider-b');assert.match(generated.context,/Keep delivery changes measurable/);assert.match(generated.context,/clarify measurable/);assert.ok(accepted.items.some(d=>d.title==='Reviewed delivery preferences'));if(mode==='improve')assert.equal(accepted.fields.title,false);
      assert.equal(await studio.getByRole('button',{name:'Show intelligence status'}).count(),0);
      await studio.getByRole('button',{name:'View cited evidence',exact:false}).click();await page.getByText('Delivery policy',{exact:true}).first().waitFor();await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-loading-host]').count(),0,'Completed inline generation leaves no global loading overlay');
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      if(mode==='improve'){const reviewColors=await studio.locator('.story-studio-field-review__grid label').first().evaluate(element=>({foreground:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor}));assert.ok(contrastRatio(reviewColors.foreground,reviewColors.background)>=4.5,JSON.stringify(reviewColors));}
      await studio.locator('.ai-test-generator-workspace').evaluate(element=>element.scrollTop=0);
      await page.screenshot({animations:'disabled',path:`${screenshots}/${mode}-${mobile?'mobile':'desktop'}-dark.png`});
      const outline=studio.getByRole('navigation',{name:'Story proposal outline'});assert.equal(await outline.locator('.ai-artifact-item').count(),mode==='create'?2:1);assert.equal(await studio.locator('.ai-artifact-detail').count(),1);
      if(mode==='create'){await outline.locator('.ai-artifact-item > button').first().focus();await page.keyboard.press('ArrowDown');assert.equal(await outline.locator('.ai-artifact-item > button').nth(1).evaluate(element=>element===document.activeElement),true);}
      if(mobile)await studio.getByRole('button',{name:'Search Story drafts',exact:true}).click();
      await studio.getByRole('textbox',{name:'Search Story drafts'}).fill('no match');await studio.getByRole('heading',{name:'No matching drafts'}).waitFor();assert.equal(await studio.getByRole('button',{name:mode==='create'?'Decline Draft':'Decline Changes',exact:true}).isDisabled(),true);await studio.getByRole('textbox',{name:'Search Story drafts'}).fill('');
      assert.equal(await studio.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);assert.deepEqual(errors,[]);
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
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    for(const mobile of [false,true]){
      const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push(`Unexpected API ${route.request().url()}`);return route.abort()});
      await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${actualName}.html?mode=stories`);await page.getByText('Save delivery preferences',{exact:true}).waitFor().catch(async error=>{throw new Error(error.message+'\n'+JSON.stringify(errors)+'\n'+(await page.locator('body').innerText()).slice(0,2000))});
      const clickEnabled=async name=>{for(const button of await page.getByRole('button',{name,exact:true}).all())if(await button.isVisible()&&!await button.isDisabled()){await button.click();return;}throw new Error(`No enabled ${name}`)};
      for(const mode of ['create','improve']){
        if(mode==='improve'){await page.getByText('Save delivery preferences',{exact:true}).click();await page.getByRole('heading',{name:'Story details',exact:true}).waitFor();}
        await clickEnabled(mode==='create'?'Create Stories using AI':'AI Complete Story');
        const dialog=page.getByRole('dialog',{name:mode==='create'?'Create Stories using AI':'AI Complete Story',exact:true});await dialog.waitFor();
        await dialog.getByRole('textbox',{name:'Instructions for Story Architect',exact:true}).waitFor();
        assert.equal(await dialog.locator('.story-studio-shell').evaluate(e=>getComputedStyle(e).display),'grid');
        assert.equal(await dialog.locator('.ai-feature-composer').count(),0);
        await dialog.getByRole('button',{name:'Show context',exact:true}).click();
        const context=page.getByRole('dialog',{name:'Context & options',exact:true});await context.waitFor();
        assert.equal(await context.locator('.ai-llm-select select').count(),1);
        await context.getByRole('tab',{name:/Files/}).waitFor();await context.getByRole('button',{name:'Templates',exact:true}).waitFor();
        await page.keyboard.press('Escape');
        await page.screenshot({animations:'disabled',path:`/tmp/qaira-v2-story-studio/actual-${mode}-${mobile?'mobile':'desktop'}.png`});
        if(!mobile){const searchStyle=await dialog.locator('.story-studio-search').evaluate(input=>{const s=getComputedStyle(input);return {background:s.background,shadow:s.boxShadow,height:s.height,padding:s.padding,html:input.outerHTML}});assert.match(searchStyle.background,/rgba\(0, 0, 0, 0\)/);assert.equal(searchStyle.height,'20px');await writeFile(`/tmp/qaira-v2-story-studio/actual-search-style.json`,JSON.stringify(searchStyle,null,2));}
        await page.evaluate(()=>document.documentElement.dataset.theme='dark');const fieldColors=await dialog.getByRole('textbox',{name:'Instructions for Story Architect',exact:true}).evaluate(e=>{let parent=e;while(parent&&getComputedStyle(parent).backgroundColor==='rgba(0, 0, 0, 0)')parent=parent.parentElement;return{foreground:getComputedStyle(e).color,background:getComputedStyle(parent).backgroundColor}});assert.ok(contrastRatio(fieldColors.foreground,fieldColors.background)>=4.5,JSON.stringify(fieldColors));const emptyColors=await dialog.locator('.story-studio-inspector-empty').evaluate(element=>({foreground:getComputedStyle(element.querySelector('h2')).color,background:getComputedStyle(element.parentElement).backgroundColor}));assert.ok(contrastRatio(emptyColors.foreground,emptyColors.background)>=4.5,JSON.stringify(emptyColors));assert.equal(await dialog.locator('.story-studio-inspector-empty > button').isVisible(),false,'Primary generate action has one home');assert.equal(await dialog.locator('.story-studio-rovo-provider').count(),0);assert.equal(await dialog.getByText('HelloTest QA Agent',{exact:true}).count(),0);await page.screenshot({animations:'disabled',path:`/tmp/qaira-v2-story-studio/actual-${mode}-${mobile?'mobile':'desktop'}-dark.png`});await page.evaluate(()=>delete document.documentElement.dataset.theme);

        if(mode==='improve'){await dialog.locator('.ai-test-generator-workspace').scrollIntoViewIfNeeded();await dialog.getByRole('heading',{name:'Your Story draft will appear here',exact:true}).waitFor();await dialog.getByRole('button',{name:'Show context',exact:true}).click();assert.match(await context.locator('.story-studio-selected-context').innerText(),/Save delivery preferences/);await page.keyboard.press('Escape');}
        await dialog.getByRole('button',{name:mode==='create'?'Close AI Story creation':'Close AI Story improvement',exact:true}).click();
      }
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser?.close();await Promise.all([rm(new URL(`${actualName}.tsx`,root),{force:true}),rm(new URL(`${actualName}.html`,root),{force:true})]);}
});
