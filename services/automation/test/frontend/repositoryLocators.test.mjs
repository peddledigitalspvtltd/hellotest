import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributeLocator, isRepositoryMemberUsed, collectRouteScopedLocatorKeys } from '../../frontend/lib/repositoryLocators.ts';
test('combines captured attributes, scope and explicit zero-based index without losing escaping', () => {
  assert.equal(buildAttributeLocator('INPUT', [['name', 'email'], ['data-label', 'say "hello"']], 'form#login', 1), 'form#login input[name="email"][data-label="say \\"hello\\""] >> nth=1');
  assert.equal(buildAttributeLocator('button', [], '', 0), 'button >> nth=0');
  assert.equal(buildAttributeLocator('button', [], '', -1), 'button');
});
test('case repository bindings exclude unrelated objects and similarly named fields', () => {
  const member = { ref: 'Login.Email', entry: { id: 'field', locator: '[name="email"]' } };
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: 'await page.locator("Login.Email").fill("x");' }]), true);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: 'await page.locator("OtherLogin.Email").click();' }]), false);
  assert.equal(isRepositoryMemberUsed(member, undefined, []), false);
  assert.equal(isRepositoryMemberUsed({ ...member, entry: { ...member.entry, test_case_id: 'case' } }, 'case', []), true);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: '// await web.fill("Login.Email", "example");' }]), false);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: '/* "Login.Email" */ await web.click("Login.Submit");' }]), false);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ objectRefs: ['Login.Email'] }]), true);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: 'await web.fill("[name=\\"email\\"]", "example");' }]), true);
});
test('used-only case objects ignore captured ownership and literal data but resolve explicit parameter targets', () => {
  const member={ref:'Login.Email',entry:{id:'email',test_case_id:'case',locator:'#email'}};
  assert.equal(isRepositoryMemberUsed(member,'case',[],{includeCaseOwned:false}),false);
  assert.equal(isRepositoryMemberUsed(member,'case',[{automation_code:'await web.fill("#note", "Login.Email");'}],{includeCaseOwned:false}),false);
  assert.equal(isRepositoryMemberUsed(member,'case',[{automation_code:'await page.locator("#note").fill("Login.Email");'}],{includeCaseOwned:false}),false);
  assert.equal(isRepositoryMemberUsed(member,'case',[{automation_code:'await web.expectText("Login.Email");'}],{includeCaseOwned:false}),false);
  assert.equal(isRepositoryMemberUsed(member,'case',[{automation_code:'await web.click(params["t.field"]);'}],{includeCaseOwned:false,parameterValues:{'t.field':'Login.Email'}}),true);
  assert.equal(isRepositoryMemberUsed(member,'case',[{objectRefs:['@t.field']}],{includeCaseOwned:false,parameterValues:{'t.field':'Login.Email'}}),true);
  assert.equal(isRepositoryMemberUsed({ref:'Login.Submit',entry:{id:'submit',locator:'page.getByRole("button",{name:"Submit"}).first()'}},'case',[{automation_code:"await page.getByRole('button',{name:'Submit',exact:true}).first().click();"}],{includeCaseOwned:false}),true);
});

test('host compiler semantic locators match used objects while preserving native and repository exact defaults',()=>{
 const member={ref:'Login.SignIn',entry:{id:'signin',locator:'getByRole("button", {name:"Sign In"})'}};
 const check=(code)=>isRepositoryMemberUsed(member,'case',[{automation_code:code}],{includeCaseOwned:false});
 assert.equal(check('await page.getByRole("button", {"exact":true,"name":"Sign In"}).click();'),true);
 assert.equal(check('await expect(page.getByRole("button", {name:"Sign In",exact:true})).toBeVisible();'),true);
 assert.equal(check('await page.getByRole("button", {name:"Sign In"}).click();'),false,'native exact:false must not be presented as the stricter saved binding');
 assert.equal(check('await page.getByRole("button", {name:"Sign In",exact:false}).click();'),false);
 assert.equal(check('await page.getByRole("button", {name:"Sign Up",exact:true}).click();'),false);
 assert.equal(check('await web.fill("#email", "Sign In");'),false);
 assert.equal(check('// page.getByRole("button", {name:"Sign In",exact:true})'),false);
});

test('repository shorthand and ordinal locators remain visible after deterministic Playwright compilation',()=>{
 for(const [locator,source] of [
  ['role=button[name="Sign In"]','page.getByRole("button", {name:"Sign In",exact:true})'],
  ['label=Email','page.getByLabel("Email", {exact:true})'],
  ['placeholder=Email','page.getByPlaceholder("Email", {exact:true})'],
  ['testid=submit','page.getByTestId("submit")'],
  ['#email.nth(0)','page.locator("#email").nth(0)'],
  ['getByLabel(`Email`)','page.getByLabel("Email", {exact:true})']
 ]){
  const member={ref:'Page.Field',entry:{id:'field',locator}};
  assert.equal(isRepositoryMemberUsed(member,'case',[{automation_code:`await ${source}.click();`}],{includeCaseOwned:false}),true,locator);
 }
});

test('merged fields match old executable references without displacing current exact canonical fields', () => {
 const merged={ref:'Account.Email',entry:{id:'email',locator:'#email',metadata:{reference_aliases:['Account.Email','Login.Email']}}};
 const code=[{automation_code:'await web.fill("Login.Email", "hello");'}];
 assert.equal(isRepositoryMemberUsed(merged,'case',code,{includeCaseOwned:false}),true);
 assert.equal(isRepositoryMemberUsed(merged,'case',code,{includeCaseOwned:false,canonicalReferences:new Set(['Account.Email','Login.Email'])}),false);
 assert.equal(isRepositoryMemberUsed(merged,'case',[{automation_code:'await web.fill("#note", "Login.Email");'}],{includeCaseOwned:false}),false);
 const retired={...merged,entry:{...merged.entry,test_case_id:'case',metadata:{...merged.entry.metadata,merged_into_entry_id:'other'}}};
 assert.equal(isRepositoryMemberUsed(retired,'case',code),false);
});

test('identical inline locators on query/hash routes require the exact current case, step and saved source digest',()=>{
 const digest='a'.repeat(64),route='b'.repeat(64),other='c'.repeat(64);
 const member={ref:'App routeA.Email',entry:{id:'route-email',locator:'#email',metadata:{observed_route_sha256:route,instruction_usages:[{test_case_id:'case',step_id:'fill',source_sha256:digest,context_sha256:digest,operation_indexes:[1]}]}}};
 const steps=[{id:'fill',automation_source_sha256:digest,automation_context_sha256:digest,automation_code:'await page.locator("#email").fill("@r.email");'}];
 assert.equal(isRepositoryMemberUsed(member,'case',steps,{includeCaseOwned:false}),true);
 assert.equal(isRepositoryMemberUsed(member,'other-case',steps,{includeCaseOwned:false}),false);
 assert.equal(isRepositoryMemberUsed(member,'case',[{...steps[0],id:'different-step'}],{includeCaseOwned:false}),false);
 assert.equal(isRepositoryMemberUsed(member,'case',[{...steps[0],automation_source_sha256:other}],{includeCaseOwned:false}),false);
 assert.equal(isRepositoryMemberUsed(member,'case',[{...steps[0],automation_source_sha256:undefined}],{includeCaseOwned:false}),false,'an unsaved source draft has no current digest');
 assert.equal(isRepositoryMemberUsed(member,'case',[{...steps[0],automation_context_sha256:other}],{includeCaseOwned:false}),false,'a prior step/start URL edit invalidates the route binding');
 assert.equal(isRepositoryMemberUsed(member,'case',[{...steps[0],automation_context_sha256:null}],{includeCaseOwned:false}),false,'a missing legacy context cannot assert a route binding');
 assert.equal(isRepositoryMemberUsed(member,'case',[{automation_code:'await web.fill("App routeA.Email","@r.email");'}],{includeCaseOwned:false}),true,'explicit repository references remain unambiguous');
 const generic={ref:'Curated.Email',entry:{id:'generic-email',locator:'#email',metadata:{}}};
 const routeScopedLocatorKeys=collectRouteScopedLocatorKeys([member,generic]);
 assert.equal(isRepositoryMemberUsed(generic,'case',steps,{includeCaseOwned:false,routeScopedLocatorKeys}),false,'a generic identical selector cannot steal a confirmed route binding');
});
