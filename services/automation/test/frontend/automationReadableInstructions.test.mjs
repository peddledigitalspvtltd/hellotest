import assert from 'node:assert/strict';
import test from 'node:test';
import {readableAutomation} from '../helpers/readableAutomationLoader.mjs';
const {buildReadableAutomationInstructions:read,readableAutomationInstructionText:text}=readableAutomation;
const repository=[{id:'email',page_key:'Login',locator_intent:'Email',locator:'#email',metadata:{screen_name:'Login',object_name:'Email',reference_aliases:['OldLogin.Email']}},{id:'submit',page_key:'Login',locator_intent:'Submit',locator:'page.getByRole("button", {name:"Submit"})',metadata:{screen_name:'Login',object_name:'Submit'}}];
const context={repository,parameterValues:{'t.field':'OldLogin.Email','t.user':'Alice','t.button':'Submit'}};

test('helper actions use readable verbs, repository aliases and scoped parameters',()=>{
 const rows=read('await web.click("OldLogin.Email"); await web.fill(params["t.field"], params["t.user"]); await web.press("#email", "Enter");',context);
 assert.deepEqual(rows.map(row=>[row.label,row.args]),[['Click',['Login.Email']],['Type',['Login.Email','@t.user']],['Press',['Enter','Login.Email']]]);
 assert.equal(text(rows[1]),'Type @t.user into Login.Email');
});

test('native Playwright locators and aliased imported test callbacks describe actual fields',()=>{
 const code='import {test as scenario,expect as check} from "@playwright/test";scenario("Sign in", async ({page:browserPage})=>{await browserPage.locator("#email").fill("@t.user");await browserPage.getByRole("button",{name:"Submit"}).click();await check(browserPage.locator("#email")).toHaveValue("@t.user");});';
 const rows=read(code,context);assert.deepEqual(rows.map(row=>row.label),['Type','Click','Verify value']);assert.equal(rows[0].args[0],'Login.Email');assert.equal(rows[1].args[0],'Login.Submit');assert.equal(rows[2].args[0],'Login.Email');
 assert.doesNotMatch(rows.map(text).join('\n'),/await |browserPage\.|scenario\(/);
});

test('locator variables, bindings and keyboard calls retain object and value context',()=>{
 const rows=read('const email=bindings.page.locator("#email");await email.fill(params["t.user"]);await playwrightPage.keyboard.press("Enter");',context);
 assert.deepEqual(rows.map(row=>row.label),['Find field','Type','Press']);assert.equal(rows[1].args[0],'Login.Email');assert.deepEqual(rows[2].args,['Enter','Page keyboard']);
});

test('conditional and repeated actions retain their control flow instead of becoming unconditional',()=>{
 const rows=read('if (ready) {await web.click("OldLogin.Email");} else {await page.evaluate(()=>window.reload());}for (const item of users){await web.fill("#email",item);}',context);
 assert.deepEqual(rows.map(row=>row.label),['If','Click','Otherwise','Run browser JavaScript','For each','Type']);assert.equal(rows[1].depth,1);assert.match(text(rows[1]),/^If ready: Click/);assert.match(text(rows[5]),/^For each item in users:/);assert.match(text(rows[3]),/review Source/);
});

test('literals containing code stay data and custom operations remain explicit',()=>{
 const rows=read('await web.fill("#email", "await page.click(\\"not an action\\");");await customClient().click();',context);
 assert.equal(rows.length,2);assert.equal(rows[0].label,'Type');assert.equal(rows[0].args[1],'await page.click("not an action");');assert.equal(rows[1].label,'Run custom instruction');
 assert.equal(read('await web.fill(',context)[0].label,'Review incomplete instructions');
});

test('function definitions do not pretend their bodies have already run',()=>{
 const rows=read('function helper(){web.click("#email");}await page.goto("/login");',context);
 assert.deepEqual(rows.map(row=>row.label),['Define helper','Open URL']);
 const raw=read('export default async function({playwrightPage}){await playwrightPage.locator("#email").fill("Alice");}',context);assert.deepEqual(raw.map(row=>row.label),['Type']);
});

test('canonical references take precedence and ambiguous historical aliases stay explicit',()=>{
 const extra=[...repository,{id:'canonical',page_key:'OldLogin',locator_intent:'Email',locator:'#canonical',metadata:{screen_name:'OldLogin',object_name:'Email'}},{id:'duplicate',page_key:'Other',locator_intent:'Email',locator:'#other',metadata:{screen_name:'Other',object_name:'Email',reference_aliases:['Legacy.Email']}}];
 extra[0]={...extra[0],metadata:{...extra[0].metadata,reference_aliases:['OldLogin.Email','Legacy.Email']}};
 assert.equal(read('await web.click("OldLogin.Email");',{repository:extra})[0].args[0],'OldLogin.Email');
 assert.equal(read('await web.click("Legacy.Email");',{repository:extra})[0].args[0],'Legacy.Email');
});

test('semantic locator parameter values identify the repository field without replacing input tokens',()=>{
 const rows=read('await page.getByRole("button", {name:params["t.button"]}).click();await web.fill("#email", "");',context);
 assert.equal(rows[0].args[0],'Login.Submit');assert.deepEqual(rows[1].args,['Login.Email','""']);
});

test('equivalent quoted/reordered locator options and page aliases use the canonical field',()=>{
 const entries=[{id:'submit',page_key:'OldLogin',locator_intent:'Submit',locator:'page.getByRole("button", {name:"Submit",exact:true})',metadata:{screen_name:'Account',object_name:'Submit',reference_aliases:['OldLogin.Submit'],page_url:'https://example.test/login'}}];
 const rows=read('const browser=page;await browser["getByRole"]("button", {"exact":true,"name":"Submit"}).click();await web.click("OldLogin.Submit");',{repository:entries});
 assert.equal(rows[1].args[0],'Account.Submit');assert.equal(rows[2].args[0],'Account.Submit');
});

test('nested locator scopes never borrow an unrelated unscoped repository field',()=>{
 const rows=read('await page.locator("#billing").locator("#email").fill("Alice");await page.getByRole("dialog").getByRole("button",{name:"Submit"}).click();await page.locator("#email").filter({hasText:"Business"}).click();',context);
 assert.equal(rows[0].args[0],'#billing → #email');assert.equal(rows[1].args[0],'dialog → Submit button');assert.equal(rows[2].args[0],'Login.Email with text "Business"');
 const scoped=[...repository,{id:'billing',page_key:'Billing',locator_intent:'Email',locator:'page.locator("#billing").locator("#email")',metadata:{screen_name:'Billing',object_name:'Email'}}];
 assert.equal(read('await page.locator("#billing").locator("#email").fill("Alice");',{repository:scoped})[0].args[0],'Billing.Email');
});

test('selector reassignment follows definite writes and clears uncertain branch/loop bindings',()=>{
 const rows=read('let field="#email";field="Login.Submit";await web.click(field);{field="#email";}await web.click(field);if (ready) {field="Login.Submit";}await web.click(field);for (const field of fields) {await web.click(field);}',context);
 assert.deepEqual(rows.filter(row=>row.label==='Click').map(row=>row.args[0]),['Login.Submit','Login.Email','field','field']);
 const scoped=read('let field="#email";{const field="Login.Submit";await web.click(field);}await web.click(field);',context);
 assert.deepEqual(scoped.filter(row=>row.label==='Click').map(row=>row.args[0]),['Login.Submit','Login.Email']);
});

test('source-mutated parameters do not present stale configured repository targets',()=>{
 const rows=read('params["t.field"]="Other.Email";await web.click(params["t.field"]);',context);
 assert.equal(rows[0].label,'Set parameter');assert.equal(rows[1].args[0],'runtime parameter t.field (see Source)');
 assert.doesNotMatch(rows[1].text,/Login.Email|OldLogin.Email/);
});

test('readable instructions use native quoted parameter grammar and retain current values after edits',()=>{
 const source='await web.fill(params["t.field.name"],params["t.account.email"]);await web.fill("mail@t.account", "literal");';
 const initial={parameterValues:{'t.field.name':'#first','t.account.email':'first@example.test','t.account':'wrong'}};
 const rows=read(source,initial);
 assert.deepEqual(rows[0].args,['#first','@t.[account.email]']);
 assert.equal(rows[1].args[0],'mail@t.account','an email/identifier fragment is literal, matching the execution grammar');
 const changed=read(source,{parameterValues:{...initial.parameterValues,'t.field.name':'#second','t.account.email':'second@example.test'}});
 assert.deepEqual(changed[0].args,['#second','@t.[account.email]']);
 assert.equal(source,'await web.fill(params["t.field.name"],params["t.account.email"]);await web.fill("mail@t.account", "literal");','values never rewrite saved source');
});

test('canonical casing and unique legacy field names render Screen.Field without guessing ambiguous names',()=>{
 const rows=read('await web.click("login.email");await web.click("oldlogin.email");await web.click("Email");',context);
 assert.deepEqual(rows.map(row=>row.args[0]),['Login.Email','Login.Email','Login.Email']);
 const duplicate={id:'other-email',page_key:'Other',locator_intent:'Email',locator:'#other-email',metadata:{screen_name:'Other',object_name:'Email'}};
 assert.equal(read('await web.click("Email");',{repository:[...repository,duplicate]})[0].args[0],'Email');
});

test('native closed URL, title and visible-text polls have readable bounded condition rows',()=>{
 const source='await expect.poll(() => page.url()).toBe("https://app.test/login");await expect.poll(async () => await page.title()).toBe("Login");await expect.poll(async () => (await page.locator("#email").isVisible()) && ((await page.locator("#email").innerText()).replace(/\\s+/g, " ").trim() === "Saved")).toBe(true);';
 const rows=read(source,context);
 assert.deepEqual(rows.map(row=>row.label),['Poll until condition','Poll until condition','Poll until condition']);
 assert.ok(rows.every(row=>row.kind==='assertion'));
 assert.match(rows[0].text,/Page URL equals "https:\/\/app.test\/login"/);
 assert.match(rows[2].text,/Login.Email is visible and rendered text equals "Saved"/);
 assert.doesNotMatch(rows.map(text).join('\n'),/Run custom|review Source/);
 assert.equal(source.includes('expect.poll'),true,'presentation does not rewrite the saved source');
});

test('contains polls preserve scoped expected data while arbitrary, mutated and nonmatching callbacks remain custom source',()=>{
 const code='await expect.poll(async () => (await page.locator("#email").isVisible()) && ((await page.locator("#email").innerText()).replace(/\\s+/g, " ").trim().includes(String(params["t.user"]).replace(/\\s+/g," ").trim()))).toBe(true);';
 const row=read(code,context)[0];assert.equal(row.label,'Poll until condition');assert.match(row.text,/contains @t.user/);
 for(const custom of [
  'await expect.poll(async () => { await page.click("#email"); return true; }).toBe(true);',
  'await expect.poll(() => customCheck()).toBe(true);',
  'await expect.poll(() => page.url(),{timeout:12000}).toBe("/login");',
  'await expect.poll(() => page.url()).not.toBe("/login");',
  'await expect.poll(async () => (await page.locator("#email").isVisible()) && ((await page.locator("#other").innerText()).replace(/\\s+/g," ").trim() === "Saved")).toBe(true);'
 ]){const customRow=read(custom,context)[0];assert.equal(customRow.label,'Run custom code poll');assert.equal(customRow.kind,'custom');assert.match(text(customRow),/review Source/);}
});
