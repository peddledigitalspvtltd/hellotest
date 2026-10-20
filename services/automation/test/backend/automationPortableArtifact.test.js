const test=require('node:test'),assert=require('node:assert/strict');
const {createPortableAutomationArtifact}=require('../../backend/lib/automationPortableArtifact');
const testCase={id:'portable',title:'Standalone checkout'};
const update=(code,extra={})=>({step:{id:'save',step_order:1,action:'Save account',step_type:'web'},automation_code:code,...extra});

test('backend artifacts use the shared Playwright emitter with explicit data, repository and runtime bindings',async()=>{
 const {buildPlaywrightArtifact,preparePlaywrightRepository}=await import('../../shared/playwrightArtifact.mjs');
 const repositoryRows=[{id:'email',page_key:'Signup',locator_intent:'Email',locator:'#email',metadata:{screen_name:'Signup',object_name:'Email',reference_aliases:['Account.Email']}}];
 const updates=[update('await page.locator("Account.Email").fill("@t.email"); await expect(page.locator("Account.Email")).toHaveValue("@t.email");')];
 const values={'t.email':'fixture@example.test'};
 const actual=await createPortableAutomationArtifact({testCase,updates,repositoryRows,values,baseURL:'https://app.example.test/signup'});
 const expected=buildPlaywrightArtifact({testCase,steps:updates.map(item=>({...item.step,step_type:'web',automation_code:item.automation_code,api_request:null})),rows:[values],...preparePlaywrightRepository(repositoryRows),baseURL:'https://app.example.test/signup'});
 assert.equal(actual,expected,'UI and backend share one emitter; backend adaptation cannot change runner semantics');
 assert.match(actual,/import \{ test, expect as playwrightExpect/);assert.match(actual,/test\("Standalone checkout/);
 assert.match(actual,/"account.email": "#email"/);assert.match(actual,/fixture@example.test/);assert.doesNotMatch(actual,/from ['"]@hellotest\//);
});

test('private parameter values and public aliases of those values never enter downloadable artifact defaults',async()=>{
 const source=await createPortableAutomationArtifact({testCase,updates:[update('await page.locator("#password").fill("@t.password");')],values:{'t.password':'PRIVATE_DEFAULT','t.alias':'PRIVATE_DEFAULT','t.custom':'PRIVATE_CUSTOM','t.public':'Safe name'},sensitiveNames:['t.custom']});
 assert.doesNotMatch(source,/PRIVATE_DEFAULT|PRIVATE_CUSTOM/);assert.match(source,/Safe name/);assert.match(source,/QAIRA_DATA_JSON/);assert.match(source,/@t.password/);
});
test('deliberately empty private-named inputs remain runnable frozen defaults without exporting nonempty private material',async()=>{
 const source=await createPortableAutomationArtifact({testCase,updates:[update('await page.getByLabel("Password").fill("@r.password"); await expect(page.getByLabel("Password")).toHaveValue("@r.password");')],values:{'r.password':'','r.hidden_empty':'','r.secret':'PRIVATE_VALUE','r.alias':'PRIVATE_VALUE'},sensitiveNames:['r.hidden_empty']});
 const rows=JSON.parse(source.match(/const rows: DataValues\[\] = ([\s\S]*?);/)[1]);
 assert.deepEqual(rows,[{'r.password':'','r.hidden_empty':''}]);assert.doesNotMatch(source,/PRIVATE_VALUE/);
 assert.match(source,/@r.password/);
});

test('API sections emit executable requests with validations and captures instead of request comments',async()=>{
 const source=await createPortableAutomationArtifact({testCase,updates:[update(null,{step:{id:'api',step_order:2,action:'Verify profile',step_type:'api'},api_request:{method:'GET',url:'/profile',validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.name',expected:'@t.name'}],captures:[{path:'$.id',parameter:'@r.profile_id'}]}})]});
 assert.match(source,/const response = await api.request/);assert.match(source,/expect\(response.status\).toBe\(200\)/);assert.match(source,/readJsonPath\(response.body,"\$\.name"\)/);assert.match(source,/capture\("@r.profile_id"/);
 assert.doesNotMatch(source,/API request is stored structurally/);
});

test('unsupported native, empty and application-only instructions cannot turn into passing portable tests',async()=>{
 for(const [entry,pattern] of [[update('// pending'),/Standalone export blocked/],[update('await ios.tap("~save");',{step:{id:'native',step_order:1,step_type:'ios',action:'Tap save'}}),/requires the Appium runner/],[update('import {helper} from "@hellotest/internal"; await helper();'),/Application module/]]){
  const source=await createPortableAutomationArtifact({testCase,updates:[entry]});
  assert.match(source,pattern);assert.match(source,/throw new Error/);
 }
 const empty=await createPortableAutomationArtifact({testCase,updates:[]});assert.match(empty,/no executable sections/);
});

test('native-only exports omit unused web and API compatibility implementations without rewriting saved checks',async()=>{
 const source=await createPortableAutomationArtifact({testCase,updates:[update('await page.locator("#email").fill("@t.email"); await expect(page.locator("#email")).toHaveValue("@t.email");')],values:{'t.email':'user@example.test'}});
 assert.doesNotMatch(source,/const findTab|uploadRemoteFile:|lastResponse|request.fetch\(|const readJsonPath = \(/);
 assert.match(source,/await expect\(page.locator\("#email"\)\).toHaveValue\("@t.email"\)/);
 assert.match(source,/const wrapPage/,'native inputs still resolve the same scoped values');
 const web=await createPortableAutomationArtifact({testCase,updates:[update('await web.fill("#email","@t.email"); await web.expectValue("#email","@t.email");')]});
 assert.match(web,/const findTab/);assert.doesNotMatch(web,/lastResponse|request.fetch\(/);
});

test('export dependency discovery retains helpers for wrappers and dynamic or imported code',async()=>{
 const {automationExportRuntimeUsage}=await import('../../shared/automationExportSource.mjs');
 for(const code of ['await bindings.web.fill("#a","x");','eval("web.fill()");','import {helper} from "./helper.mjs"; await helper(page);','const {web}=require("./helper.cjs");','async function automate(current, ui) { await ui.fill("#a","x"); }','async function automate(ctx) { await ctx["web"].fill("#a","x"); }'])
  assert.deepEqual(automationExportRuntimeUsage([code]),{web:true,api:true,readJsonPath:true});
 assert.deepEqual(automationExportRuntimeUsage(['const note="api web bindings"; await page.locator("#name").fill("x");']),{web:false,api:false,readJsonPath:false});
 const api=await createPortableAutomationArtifact({testCase,updates:[update('// @hellotest-options not-skip',{step_type:'api',api_request:{method:'GET',url:'/profile'}})]});
 assert.match(api,/request.fetch\(/,'a substring of an option must not prune a live API implementation');
});

test('standalone exports cannot silently pass while omitting linked Before/After cases',async()=>{
 const source=await createPortableAutomationArtifact({testCase:{...testCase,execution_hooks:[{phase:'pre',source_test_case_id:'login'}]},baseURL:'https://example.test',updates:[update('await expect(page.locator("#email")).toBeVisible();')]});
 assert.match(source,/throw new Error\("This case has linked Before\/After cases/);
 assert.ok(source.indexOf('throw new Error("This case has linked Before/After cases')<source.indexOf('if (baseURL) await page.goto'));
 const {hasConfiguredCaseExecutionHooks}=await import('../../shared/automationCaseExecutionHooks.mjs');
 for(const empty of [undefined,null,'','  ',[],'[]'])assert.equal(hasConfiguredCaseExecutionHooks(empty),false);
 for(const configured of [[{phase:'pre'}],'[{"phase":"post"}]','broken',{}])assert.equal(hasConfiguredCaseExecutionHooks(configured),true);
});
