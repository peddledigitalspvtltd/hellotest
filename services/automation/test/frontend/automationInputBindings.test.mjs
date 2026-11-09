import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { collectAutomationInputBindings, applyAutomationInputBindings, suggestedAutomationInputBindings } from '../../frontend/lib/automationInputBindings.ts';

test('binding literal data preserves a complete program, selectors, comments, and unrelated equal strings', () => {
  const source = `// Alice stays a comment\nconst note = "Alice";\nawait page.locator("Alice").fill("Alice");\nawait page.getByRole("button", {name:"Alice"}).click();\nawait expect(page.locator("#name")).toHaveValue("Alice");\nawait web.fill("Account.Password", ${JSON.stringify("x'\\\"{}\nvalue")});`;
  const step = {step_type:'web', automation_code:source,api_request:null};
  const inputs = collectAutomationInputBindings(step);
  assert.equal(inputs.length,3);
  const next = applyAutomationInputBindings(step,{[inputs[0].id]:'@r.account',[inputs[1].id]:'@r.account',[inputs[2].id]:'@t.password'});
  parse(next.automation_code,{ecmaVersion:'latest',allowAwaitOutsideFunction:true});
  assert.match(next.automation_code,/locator\("Alice"\)\.fill\(params\["r.account"\]\)/);
  assert.match(next.automation_code,/toHaveValue\(params\["r.account"\]\)/);
  assert.match(next.automation_code,/web.fill\("Account.Password", params\["t.password"\]\)/);
  assert.match(next.automation_code,/const note = "Alice"/);
  assert.match(next.automation_code,/name:"Alice"/);
  assert.equal(step.automation_code,source);
  assert.equal(next.automation_code.split('\n').length,source.split('\n').length);
});

test('only unique complete values suggest a binding and only explicit scoped references apply',()=>{
  const step={step_type:'web',automation_code:'await page.fill("#user", "Alice"); await page.locator("#computed").fill(account.email);',api_request:null};
  const inputs=collectAutomationInputBindings(step);
  assert.equal(inputs.length,1);
  assert.deepEqual(suggestedAutomationInputBindings(inputs,{'t.user':'Alice','r.user':'Alice'}),{});
  assert.deepEqual(suggestedAutomationInputBindings(inputs,{'r.user':'Alice'}),{[inputs[0].id]:'@r.user'});
  assert.throws(()=>applyAutomationInputBindings(step,{[inputs[0].id]:'r.user'}),/reference changed/);
  assert.throws(()=>applyAutomationInputBindings(step,{'999:1000':'@r.user'}),/reference changed/);
});

test('arbitrary helper methods do not expose selectors or unrelated arguments as editable data',()=>{
  const step={step_type:'web',automation_code:'helper.fill("#email", "Alice"); helper.toBe("Alice"); const field = helper.locator("#name"); await field.fill("Alice"); await page.getByLabel("Email").fill("Alice");',api_request:null};
  const inputs=collectAutomationInputBindings(step);
  assert.equal(inputs.length,1);assert.equal(inputs[0].value,'Alice');
  const next=applyAutomationInputBindings(step,{[inputs[0].id]:'@r.email'});
  assert.match(next.automation_code,/helper.fill\("#email", "Alice"\)/);assert.match(next.automation_code,/helper.toBe\("Alice"\)/);assert.match(next.automation_code,/field.fill\("Alice"\)/);assert.match(next.automation_code,/getByLabel\("Email"\)\.fill\(params\["r.email"\]\)/);
});

test('compact immutable locator aliases expose only their executable data positions',()=>{
  const source='// Fixture remains a comment\nconst note="Fixture";\nconst object1=page.getByLabel("Fixture", {exact:true});\nconst field=object1;\nawait field.fill("Fixture");\nawait field.press("Tab");\nawait expect(field).toHaveValue("Fixture");';
  const step={step_type:'web',automation_code:source,api_request:null},inputs=collectAutomationInputBindings(step);
  assert.equal(inputs.length,3);
  const selected=Object.fromEntries(inputs.filter(input=>input.value==='Fixture').map(input=>[input.id,'@r.name']));
  const next=applyAutomationInputBindings(step,selected);parse(next.automation_code,{ecmaVersion:'latest',allowAwaitOutsideFunction:true});
  assert.match(next.automation_code,/field.fill\(params\["r.name"\]\)/);assert.match(next.automation_code,/toHaveValue\(params\["r.name"\]\)/);
  assert.match(next.automation_code,/getByLabel\("Fixture", \{exact:true\}\)/);assert.match(next.automation_code,/const note="Fixture"/);
  assert.match(next.automation_code,/field.press\("Tab"\)/);assert.equal(next.automation_code.split('\n').length,source.split('\n').length);assert.equal(step.automation_code,source);
});

test('closed nested frame roots and immutable aliases work inside the complete entry wrapper',()=>{
  const source='export default async function(page) {\n const frames=page.frameLocator("#outer").frameLocator(\'iframe[name="inner"]\');\n const field=frames.getByRole("textbox", {name:"First Last",exact:true}).nth(0);\n await field.fill("First Last");\n await expect(field).toHaveValue("First Last");\n}';
  const step={step_type:'web',automation_code:source,api_request:null},inputs=collectAutomationInputBindings(step);
  assert.equal(inputs.length,2);
  const next=applyAutomationInputBindings(step,Object.fromEntries(inputs.map(input=>[input.id,'@r.[employee name]'])));
  parse(next.automation_code,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true});
  assert.match(next.automation_code,/field.fill\(params\["r.employee name"\]\)/);assert.match(next.automation_code,/toHaveValue\(params\["r.employee name"\]\)/);
  assert.match(next.automation_code,/name:"First Last",exact:true/);assert.match(next.automation_code,/frameLocator\("#outer"\)/);assert.match(next.automation_code,/export default async function\(page\)/);
  const direct={...step,automation_code:'await page.frameLocator("#outer").getByLabel("Name").fill("First Last");'};
  assert.equal(collectAutomationInputBindings(direct).length,1);
});

test('composite runtime expressions retain every original reference and are never split into literal binding fragments',()=>{
  const source='const field=page.frameLocator("#work").getByLabel("Name");\nawait field.fill("literal ${notJavaScript} \\\" value");\nawait expect(field).toHaveValue(`Name ${params["r.first"]} ${params["r.last"]}`);';
  const step={step_type:'web',automation_code:source,api_request:null},inputs=collectAutomationInputBindings(step);
  assert.equal(inputs.length,1);
  const next=applyAutomationInputBindings(step,{[inputs[0].id]:'@t.name'});
  parse(next.automation_code,{ecmaVersion:'latest',allowAwaitOutsideFunction:true});
  assert.match(next.automation_code,/fill\(params\["t.name"\]\)/);
  assert.ok(next.automation_code.endsWith('await expect(field).toHaveValue(`Name ${params["r.first"]} ${params["r.last"]}`);'));
});

test('mutable, reassigned, destructured and arbitrary helper aliases never become locator data bindings',()=>{
  for(const source of [
    'let field=page.getByLabel("Name");await field.fill("keep");',
    'var field=page.getByLabel("Name");const alias=field;await alias.fill("keep");',
    'const field=page.getByLabel("Name");field=helper;await field.fill("keep");',
    'const field=page.getByLabel("Name");field.fill=helper.fill;await field.fill("keep");',
    'const {field}=page;await field.fill("keep");',
    'const field=helper.locator("#name");await field.fill("keep");',
    'const one=two;const two=one;await one.fill("keep");',
    'const frames=page.frameLocator(selector);await frames.getByLabel("Name").fill("keep");',
    'await page.frameLocator("#a").frameLocator("#b").frameLocator("#c").frameLocator("#d").getByLabel("Name").fill("keep");',
    'await page.frameLocator?.("#a").getByLabel("Name").fill("keep");'
  ])assert.equal(collectAutomationInputBindings({step_type:'web',automation_code:source,api_request:null}).length,0,source);
});

test('lexical shadowing protects helper arguments while independent immutable entry aliases remain editable',()=>{
  const source='const field=page.getByLabel("Name");\nfunction helper(field){field=other;field.fill("helper literal");}\n{const field=helperObject.locator("#not-native");field.fill("nested helper literal");}\nawait field.fill("native literal");';
  const step={step_type:'web',automation_code:source,api_request:null},inputs=collectAutomationInputBindings(step);
  assert.deepEqual(inputs.map(input=>input.value),['native literal']);
  const next=applyAutomationInputBindings(step,{[inputs[0].id]:'@r.name'});
  assert.match(next.automation_code,/field.fill\("helper literal"\)/);assert.match(next.automation_code,/field.fill\("nested helper literal"\)/);assert.match(next.automation_code,/await field.fill\(params\["r.name"\]\)/);
  const entries={...step,automation_code:'async function first(){const field=page.getByLabel("One");await field.fill("one");}\nasync function second(){const field=page.getByLabel("Two");await field.fill("two");}'};
  assert.deepEqual(collectAutomationInputBindings(entries).map(input=>input.value),['one','two']);
});

test('API binding changes chosen values without rewriting keys, JSON paths, captures or unrelated data',()=>{
  const request={method:'POST',url:'/users',headers:[{key:'Alice',value:'Alice'}],query_params:[{key:'user',value:'Alice'}],body:'{"name":"Alice"}',validations:[{kind:'json_path',target:'$.Alice',expected:'Alice'}],captures:[{path:'$.Alice',parameter:'r.saved'}]};
  const step={step_type:'api',automation_code:'// reference',api_request:request};
  const inputs=collectAutomationInputBindings(step);
  const target=inputs.find(input=>input.label==='Query user');
  const result=applyAutomationInputBindings(step,{[target.id]:'@r.[Display name]'});
  assert.equal(result.api_request.query_params[0].value,'@r.[display name]');
  assert.deepEqual(result.api_request.headers,request.headers);
  assert.deepEqual(result.api_request.captures,request.captures);
  assert.deepEqual(result.api_request.validations,request.validations);
  assert.equal(request.query_params[0].value,'Alice');
});
