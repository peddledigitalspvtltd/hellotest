const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeGeneratedProgram,preserveGeneratedAssertions,joinGeneratedAssertions,hasExecutableAssertion}=require('../../backend/lib/automationGeneratedProgram');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

async function execute(source,actual='Saved') {
  const events=[];
  const locator={click:async()=>events.push('clicked'),textContent:async()=>actual};
  const page={locator:()=>locator,getByRole:()=>locator};
  const expect=value=>({toHaveText:async expected=>{events.push('asserted');assert.equal(await value.textContent(),expected);}});
  const code=normalizeGeneratedProgram(source);
  await new AsyncFunction('page','web','expect','params','capture','playwrightPage','driver','bindings','test',code)(page,{},expect,{},()=>{},page,null,{page,expect},{step:async(_title,callback)=>await callback()});
  return {code,events};
}

test('normalized Playwright test and function entry points actually execute their actions and failing assertions',async()=>{
  const body='await page.getByRole("button", {name:"Save"}).click();\nawait expect(page.locator("#status")).toHaveText("Saved");';
  for(const source of [body,`\`\`\`javascript\n${body}\n\`\`\``,`import {test, expect} from "@playwright/test";\ntest("save",async({page,expect})=>{${body}});`,`const {test,expect}=require("@playwright/test");\nit("save",async({page,expect})=>{${body}});`,`async function run({page,expect}) {${body}}`,`export default async ({page,expect}) => {${body}}`,`module.exports=async function(page,web,expect) {${body}}`,`exports.default=async bindings=>{await bindings.page.locator("#save").click();await bindings.expect(bindings.page.locator("#status")).toHaveText("Saved");}`]) {
    assert.deepEqual((await execute(source)).events,['clicked','asserted']);
    await assert.rejects(execute(source,'Unexpected'),/Unexpected/);
  }
});

test('generator accepts multiline helpers, aliased fixture parameters and legitimate TODO test data',async()=>{
 const source='import {test,expect} from "@playwright/test";\ntest("TODO task",async({page:p,expect:e})=>{\nconst label="TODO";\nawait p.locator(label).click();\nawait e(p.locator("#status")).toHaveText("Saved");\n});';
 assert.deepEqual((await execute(source)).events,['clicked','asserted']);
 const helper='async function verifyStatus() { await expect(page.locator("#status")).toHaveText("Saved"); }\nawait page.locator("#save").click();\nawait verifyStatus();';
 assert.deepEqual((await execute(helper)).events,['clicked','asserted']);
});

test('awaited named steps preserve sequential, nested and parallel callback execution and assertions',async()=>{
 const click='await page.locator("#save").click();',check='await expect(page.locator("#status")).toHaveText("Saved");';
 for(const source of [`await test.step("Save",async()=>{${click}${check}});`,`await test.step("Save",async()=>{${click}await test.step("Check",async()=>{${check}});});`,`await Promise.all([test.step("Save",async()=>{${click}}),test.step("Check",async()=>{${check}})]);`]){
  assert.deepEqual((await execute(source)).events,['clicked','asserted']);await assert.rejects(execute(source,'Unexpected'),/Unexpected/);
 }
 assert.throws(()=>normalizeGeneratedProgram('test.step("Skipped ownership",async()=>{await page.locator("#save").click();});'),/Await or return/);
 assert.throws(()=>normalizeGeneratedProgram('await test.step("Empty",async()=>{});'),/no executable/);
});

test('comments, detached helpers, empty wrappers and unsupported runners cannot become ready mappings',()=>{
 for(const source of ['// implemented','/* action */','const value=42;','const helper=async()=>{await page.locator("#save").click();};','async function run(){}','async ({page})=>{}','console.log("done");','return;','test.describe("suite",()=>{});','test.skip("skip",async({page})=>{await page.goto("/login");});','import helper from "custom-helper"; await helper();','test("one",async()=>{});test("two",async()=>{});'])assert.throws(()=>normalizeGeneratedProgram(source),undefined,source);
 assert.throws(()=>normalizeGeneratedProgram('test("native",async()=>{await driver.back();});',{runtime:'ios'}),/native/);
 assert.equal(normalizeGeneratedProgram('await ios.tap("Login.Submit");',{runtime:'ios'}),'await ios.tap("Login.Submit");');
});

test('detached Playwright actions and locator assertions cannot complete before their work',()=>{
 for(const source of ['page.locator("#save").click();','expect(page.locator("#status")).toHaveText("Saved");','Promise.all([page.locator("#save").click()]);'])assert.throws(()=>normalizeGeneratedProgram(source),/promise/);
 for(const source of ['await page.locator("#save").click();','const pending=page.locator("#save").click();await pending;','return Promise.all([page.locator("#save").click()]);','await customOutcomeVerifier(params);'])assert.doesNotThrow(()=>normalizeGeneratedProgram(source));
});

test('shared web source validation rejects quoted semantic locator wrappers while retaining native calls and repository selectors',()=>{
 for(const source of [
  `await page.locator('getByLabel("Email address", {exact:true})').fill('@t.email');`,
  `await playwrightPage.locator('page.getByRole("button", {name:"Continue",exact:true})').click();`,
  'await page.locator(`getByPlaceholder("Email address")`).fill("@t.email");',
  'await page.locator("#email").fill("@t.email");\nawait expect(page.locator(\'getByText("Ready")\')).toBeVisible();'
 ])assert.throws(()=>normalizeGeneratedProgram(source),/Playwright locator expression.*selector string/);
 for(const source of [
  'await page.getByLabel("Email address", {exact:true}).fill("@t.email");',
  'await page.getByRole("button", {name:"Continue",exact:true}).click();',
  'await page.locator("#email").fill("@t.email");',
  'await page.locator("Signup.Email").fill("@t.email");'
 ])assert.equal(normalizeGeneratedProgram(source),source,'Validation must preserve valid source and its original parameter references.');
 assert.equal(normalizeGeneratedProgram('await ios.tap(\'getByLabel("Email")\');',{runtime:'ios'}),'await ios.tap(\'getByLabel("Email")\');');
});

test('native selector indices use locator chains and never an encoded CSS suffix',()=>{
 for(const source of ['await page.locator("button.first()").click();','await page.click("button.nth(1)");','await page.fill("input.last()","value");'])assert.throws(()=>normalizeGeneratedProgram(source),/locator index.*selector string/);
 for(const source of ['await page.locator("button").first().click();','await page.locator("button").nth(1).click();',"await page.locator('[data-name=\"button.first()\"]').click();",'await page.locator("#email").fill("value.first()");'])assert.equal(normalizeGeneratedProgram(source),source);
});

test('regeneration retains matcher polarity, expected values and asynchronous completion without freezing locators',()=>{
 const before='await page.locator("#old").click(); await expect(page.locator("#old-status")).not.toHaveText("Failed"); await web.expectText("#old-status", "Saved");';
 const after='await page.locator("#new").click(); await expect(page.getByRole("status")).not.toHaveText("Failed"); await web.expectText("#new-status", "Saved");';
 assert.doesNotThrow(()=>preserveGeneratedAssertions(before,after));
 for(const code of ['await page.locator("#save").click();',after.replace('.not.toHaveText','.toHaveText'),after.replace('"Failed"','"Saved"'),after.replace('await expect','expect'),after.replace('await web.expectText','web.expectText')])assert.throws(()=>preserveGeneratedAssertions(before,code),/assertion/);
 assert.doesNotThrow(()=>normalizeGeneratedProgram('await customOutcomeVerifier(params);'));
});

test('preservation coalesces only adjacent identical closed read-only assertions without rewriting either source',()=>{
 const {assertionContracts}=require('../../backend/lib/automationGeneratedProgram');
 const url='await expect.poll(() => page.url()).toBe("https://fixture.test/login");';
 const visible='await expect(page.getByRole("textbox", {name:"Account",exact:true})).toBeVisible();';
 const before=visible+'\n'+url+'\n'+url,after=url+'\n'+visible;
 assert.doesNotThrow(()=>preserveGeneratedAssertions(before,after));
 assert.equal(assertionContracts(before).length,3,'the public/source audit retains the actual saved assertion count');
 assert.equal(assertionContracts(before,{coalesceAdjacent:true}).length,2);
 assert.doesNotThrow(()=>preserveGeneratedAssertions(visible+'\n'+visible,visible));
 assert.ok(before.endsWith(url+'\n'+url),'preservation does not edit saved code');
 assert.equal(after,url+'\n'+visible,'preservation does not insert or remove candidate code');
});

test('assertion deduplication retains different subjects, literals, polarity, callbacks and intervening work',()=>{
 const check='await expect(page.locator("#account")).toBeVisible();';
 const url='await expect.poll(() => page.url()).toBe("https://fixture.test/login");';
 for(const [before,after]of [
  [check+'\n'+check.replace('#account','#secret'),check],
  [url+'\n'+url.replace('/login','/other'),url],
  [check+'\n'+check.replace('.toBeVisible','.not.toBeVisible'),check],
  [check+'\nawait page.locator("#submit").click();\n'+check,check],
  [check+'\nawait page.waitForTimeout(1);\n'+check,check],
  [check+'\nconst marker=1;\n'+check,check],
  [url+'\n'+url.replace('() => page.url()','async () => await page.title()'),url],
  ['await expect.poll(() => customCounter()).toBe(1);\nawait expect.poll(() => customCounter()).toBe(1);','await expect.poll(() => customCounter()).toBe(1);'],
  ['await expect.poll(() => page.evaluate(() => ++window.counter)).toBe(1);\nawait expect.poll(() => page.evaluate(() => ++window.counter)).toBe(1);','await expect.poll(() => page.evaluate(() => ++window.counter)).toBe(1);'],
  ['await expect(page.locator("#account")).toHaveValue(nextValue());\nawait expect(page.locator("#account")).toHaveValue(nextValue());','await expect(page.locator("#account")).toHaveValue(nextValue());']
 ])assert.throws(()=>preserveGeneratedAssertions(before,after),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'});
});

test('native input value regeneration preserves a fixed literal through its trusted frozen parameter binding',()=>{
 const before='await expect(page.locator("#old-name")).toHaveValue("Fixture Name");';
 const token='await expect(page.getByLabel("Name")).toHaveValue("@r.name");';
 const direct='await expect(page.locator("#new-name")).toHaveValue(params["r.name"]);';
 const parameters={'r.name':'Fixture Name','r.other':'Fixture Name'};
 for(const after of [token,direct]){
  assert.doesNotThrow(()=>preserveGeneratedAssertions(before,after,{parameters}));
  assert.doesNotThrow(()=>preserveGeneratedAssertions(after,before,{parameters}));
 }
 assert.doesNotThrow(()=>preserveGeneratedAssertions(token,direct,{parameters}));
 for(const after of [direct.replace('r.name','r.missing'),direct.replace('.toHaveValue(','.not.toHaveValue('),direct.replace('await expect','expect')]){
  assert.throws(()=>preserveGeneratedAssertions(before,after,{parameters}),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'});
 }
 assert.throws(()=>preserveGeneratedAssertions(token,direct.replace('r.name','r.other'),{parameters}),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'},'different dynamic bindings retain their identity even when current values coincide');
 assert.throws(()=>preserveGeneratedAssertions(before,token),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'},'a model token without a frozen host binding proves no equivalence');
 assert.throws(()=>preserveGeneratedAssertions(before,token,{parameters:{'r.name':'Different Name'}}),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'});
});

test('private field equivalence resolves only the exact scoped binding in host memory without rewriting source',()=>{
 const literal='Fixture credential containing @r.unrelated';
 const before=`await expect(page.locator("#old")).toHaveValue(${JSON.stringify(literal)});`;
 const after='await expect(page.locator("#new")).toHaveValue(params["r.opaque"]);';
 const parameters={'r.opaque':'@r.opaque'},resolved=[];
 assert.doesNotThrow(()=>preserveGeneratedAssertions(before,after,{parameters,resolveParameter:key=>{resolved.push(key);return literal;}}));
 assert.deepEqual(resolved,['r.opaque'],'inserted token-looking data is never resolved a second time');
 assert.ok(before.includes(literal));assert.ok(!after.includes(literal));assert.deepEqual(parameters,{'r.opaque':'@r.opaque'});
 for(const value of ['[private parameter value]','[redacted]'])assert.throws(()=>preserveGeneratedAssertions(
  `await expect(page.locator("#old")).toHaveValue(${JSON.stringify(value)});`,after,{parameters,resolveParameter:()=>value}),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'});
});

test('status, text and URL constants retain static meaning despite coincident parameter values',()=>{
 const parameters={'r.expected':'Approved','r.url':'https://fixture.test/approved'};
 for(const [matcher,literal,key,target]of [['toHaveText','Approved','r.expected','page.locator("#result")'],['toContainText','Approved','r.expected','page.locator("#result")'],['toHaveTitle','Approved','r.expected','page'],['toHaveURL','https://fixture.test/approved','r.url','page']]){
  const before=`await expect(${target}).${matcher}(${JSON.stringify(literal)});`;
  const after=`await expect(${target}).${matcher}(params[${JSON.stringify(key)}]);`;
  assert.throws(()=>preserveGeneratedAssertions(before,after,{parameters}),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'});
  const token=before.replace(JSON.stringify(literal),JSON.stringify('@'+key));
  assert.doesNotThrow(()=>preserveGeneratedAssertions(token,after,{parameters}),'same explicit binding retains its identity across source representations');
 }
 const helperBefore='await web.expectValue("#old", "Approved");',helperAfter='await web.expectValue("#new", "@r.expected");';
 assert.doesNotThrow(()=>preserveGeneratedAssertions(helperBefore,helperAfter,{parameters}));
});

test('expected argument normalization never descends into callback bodies or composite strings',()=>{
 const parameters={'r.name':'Fixture Name'};
 for(const [before,after]of [
  ['await expect(page.locator("#name")).toHaveValue("Prefix Fixture Name");','await expect(page.locator("#name")).toHaveValue("Prefix @r.name");'],
  ['await expect(page.locator("#name")).toHaveValue(() => "Fixture Name");','await expect(page.locator("#name")).toHaveValue(() => params["r.name"]);']
 ])assert.throws(()=>preserveGeneratedAssertions(before,after,{parameters}),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'});
});

test('saved source expected-result checks must be executable and joined to the section',()=>{
 const {hasExecutableAssertion}=require('../../backend/lib/automationGeneratedProgram');
 for(const code of [
  'await page.locator("#email").fill("value"); await expect(page.locator("#email")).toHaveValue("value");',
  'await (async ({page,expect})=>{await expect(page.getByRole("heading")).toBeVisible();})({page,expect});',
  'async function verify(){await expect(page.getByRole("heading")).toBeVisible();} await verify();',
  'await web.expectText("#status","Saved");',
  'expect.equal(await page.title(),"Signup");',
  'await Promise.all([expect(page.locator("#email")).toHaveValue("value")]);',
  'expect(await page.title()).toBe("Signup");'
 ])assert.equal(hasExecutableAssertion(code),true,code);
 for(const code of [
  'await page.locator("#email").fill("value");',
  'const comment="await expect(page).toHaveTitle(\"Signup\")"; await page.locator("#email").fill("value");',
  'async function unused(){await expect(page).toHaveTitle("Signup");} await page.locator("#email").fill("value");',
  'async function detached(){await expect(page).toHaveTitle("Signup");} detached();',
  'if(false){await expect(page).toHaveTitle("Signup");} await page.locator("#email").fill("value");',
  'return; await expect(page).toHaveTitle("Signup");',
  'while(false){await expect(page).toHaveTitle("Signup");} await page.locator("#email").fill("value");',
  'for(;false;){await expect(page).toHaveTitle("Signup");} await page.locator("#email").fill("value");',
  'await console.log(expect(page.locator("#email")).toHaveValue("value"));',
  'await [expect(page.locator("#email")).toHaveValue("value")];',
  'await Promise.allSettled([expect(page.locator("#email")).toHaveValue("value")]);',
  'function detached(){return expect(page).toHaveTitle("Signup");} detached();'
 ])assert.equal(hasExecutableAssertion(code),false,code);
});

test('generated bare native async assertions are joined without changing their checks',async()=>{
 const source='await page.locator("#save").click();\nexpect(page.locator("#status")).toHaveText("Saved");';
 const joined=joinGeneratedAssertions(source);
 assert.equal(joined.joined,1);
 assert.equal(joined.source,source.replace('\nexpect','\nawait expect'));
 assert.deepEqual((await execute(joined.source)).events,['clicked','asserted']);
 await assert.rejects(execute(joined.source,'Unexpected'),/Unexpected/);
 const negated='expect(page.getByLabel("Secret")).not.toHaveValue(params["t.password"]);';
 assert.deepEqual(joinGeneratedAssertions(negated),{source:`await ${negated}`,joined:1});
 assert.equal(joinGeneratedAssertions('```javascript\n'+source+'\n```').source,joined.source);
 const asyncHelper='async function verify(){expect(page).toHaveTitle("Signup");} await verify();';
 assert.equal(joinGeneratedAssertions(asyncHelper).source,asyncHelper.replace('{expect','{await expect'));
 for(const unchanged of ['await expect(page).toHaveTitle("Signup");','expect(await page.title()).toBe("Signup");','expect.equal("actual","expected");','function verify(){expect(page).toHaveTitle("Signup");} verify();','expect.toBeVisible();','expect.foo.toBeVisible();']){
  assert.deepEqual(joinGeneratedAssertions(unchanged),{source:unchanged,joined:0});
 }
 assert.throws(()=>normalizeGeneratedProgram('function verify(){expect(page).toHaveTitle("Signup");} verify();'),/promise/);
 const invalid='expect(page.locator(\'getByRole("heading")\')).toBeVisible();';
 assert.throws(()=>normalizeGeneratedProgram(joinGeneratedAssertions(invalid).source),/selector string/);
 assert.deepEqual(joinGeneratedAssertions(source,{runtime:'ios'}),{source,joined:0});
});

test('only joined visible or hidden native waits provide an executable expected-result check',()=>{
 for(const source of ['await page.locator("#signup").waitFor();','await page.waitForSelector("#signup",{state:"visible",timeout:10000});','await page.getByRole("dialog").waitFor({state:"hidden"});','const field=page.getByLabel("Email"); await field.waitFor({state:"visible"});','const field=page.getByLabel("Email"); await field.waitFor({state:"visible",timeout:45000});'])assert.equal(hasExecutableAssertion(source),true,source);
 for(const source of ['page.locator("#signup").waitFor();','async function unused(){await page.locator("#signup").waitFor();} await page.locator("#submit").click();','await page.locator("#signup").waitFor({state:"attached"});','await console.log(page.locator("#signup").waitFor());','await expect.toBeVisible();','await expect.foo.toBeVisible();'])assert.equal(hasExecutableAssertion(source),false,source);
});

test('recorded polling checks are executable only when awaited with a real polling callback',()=>{
 const source='await expect.poll(async () => (await page.title())).toBe("Exact title");';
 assert.equal(normalizeGeneratedProgram(source),source);assert.equal(hasExecutableAssertion(source),true);
 assert.throws(()=>normalizeGeneratedProgram(source.replace('await expect','expect')),/promise/);
 assert.equal(hasExecutableAssertion('await expect.poll("not a callback").toBe("Exact title");'),false);
 assert.equal(hasExecutableAssertion('async function unused(){'+source+'} await page.locator("#save").click();'),false);
});
