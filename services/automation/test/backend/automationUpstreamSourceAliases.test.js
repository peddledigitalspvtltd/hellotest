const test=require('node:test');
const assert=require('node:assert/strict');
const {preserveNativeActions}=require('../../backend/lib/automationUpstreamEngineer');
const {auditAuthoredInputWrites}=require('../../backend/lib/automationUpstreamInputWrites');

const bindings={parameterValues:{'r.message':'Hello','r.label':'Message','s.message':'Other'},secretBindings:{},parameterExpressions:true};
const fill='await page.frameLocator("#editor").getByLabel("Message",{exact:true}).fill(params["r.message"]);';
const click='await page.frameLocator("#editor").getByRole("button",{name:"Save",exact:true}).click();';
const aliased='const frame=page.frameLocator("#editor");\nconst message=params["r.message"];\nconst field=frame.getByLabel("Message",{exact:true});\nawait field.fill(message);\nconst save=frame.getByRole("button",{name:"Save",exact:true});\nawait save.click();';
const step={action:'Type @r.message into the field labelled @r.label',expected_result:'The message is retained.'};

test('immutable earlier scalar, page, frame and locator aliases preserve native targets, scoped data and action order',()=>{
 assert.doesNotThrow(()=>preserveNativeActions(aliased,[fill,click].join('\n'),bindings,true));
 assert.doesNotThrow(()=>preserveNativeActions([fill,click].join('\n'),aliased,bindings,true));
 assert.doesNotThrow(()=>preserveNativeActions('const app=page; const field=app.getByLabel("Name"); const text="Hello"; await field.fill(text);','await page.getByLabel("Name").fill("Hello");',{parameterValues:{},secretBindings:{}},true));
 assert.doesNotThrow(()=>preserveNativeActions('const name="Save"; const target=page.getByRole("button",{name}); await target.click();','await page.getByRole("button",{name:"Save"}).click();',{parameterValues:{},secretBindings:{}},true));
 assert.doesNotThrow(()=>preserveNativeActions('const target=page.getByRole("button",{name:/Save/i}); await target.click();','await page.getByRole("button",{name:/Save/i}).click();',{parameterValues:{},secretBindings:{}},true));
 assert.deepEqual(auditAuthoredInputWrites({step,source:aliased}).missing_parameter_references,[]);
});

test('aliases cannot change values, parameter scope, frame ownership, count, order or execution ownership',()=>{
 const original=[fill,click].join('\n');
 for(const source of [
  aliased.replace('params["r.message"]','params["s.message"]'),
  aliased.replace('params["r.message"]','"Different"'),
  aliased.replace('#editor','#other'),
  aliased.replace('await save.click();','await save.click(); await save.click();'),
  aliased.replace('await field.fill(message);',''),
  `const frame=page.frameLocator("#editor"); const message=params["r.message"]; const field=frame.getByLabel("Message",{exact:true}); const save=frame.getByRole("button",{name:"Save",exact:true}); await save.click(); await field.fill(message);`,
  aliased.replace('await field.fill(message);','if(false) await field.fill(message);'),
  aliased.replace('await field.fill(message);','field.fill(message);'),
  aliased.replace('await field.fill(message);','await Promise.all([field.fill(message)]);'),
  aliased.replace('await save.click();','await save.click(); await save["click"]();')
 ])assert.throws(()=>preserveNativeActions(source,original,bindings,true),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'},source);
});

test('mutable, escaped, shadowed or not-yet-initialized aliases cannot establish native equivalence',()=>{
 const original='await page.getByLabel("Message").fill(params["r.message"]);';
 for(const source of [
  'let field=page.getByLabel("Message"); await field.fill(params["r.message"]);',
  'const field=page.getByLabel("Message"); field.fill=other; await field.fill(params["r.message"]);',
  'const field=page.getByLabel("Message"); rewrite(field); await field.fill(params["r.message"]);',
  'const field=page.getByLabel("Message"); let escaped=field; rewrite(escaped); await field.fill(params["r.message"]);',
  'const field=page.getByLabel("Message"); const escaped=field; rewrite(escaped); await field.fill(params["r.message"]);',
  'const message=params["r.message"]; rewriteParameters(); await page.getByLabel("Message").fill(message);',
  'const message=params["r.message"]; const helper=unknown; helper.count(); await page.getByLabel("Message").fill(message);',
  'const message=params["r.message"]; await (rewriteParameters(),page.getByLabel("Message").fill(message));',
  'const field=page.getByLabel("Message"); { const field=page.getByLabel("Other"); await field.fill(params["r.message"]); }',
  'await field.fill(params["r.message"]); const field=page.getByLabel("Message");',
  'params["r.message"]="Changed"; const message=params["r.message"]; await page.getByLabel("Message").fill(message);',
  'const message=params["r.message"]; ({value:params["r.message"]}=changed); await page.getByLabel("Message").fill(message);',
  'const message=params["r.message"]; let external=params; external["r.message"]="Changed"; await page.getByLabel("Message").fill(message);',
  'const message=params["r.message"]; const external=params; external["r.message"]="Changed"; await page.getByLabel("Message").fill(message);',
  'const page=other; const field=page.getByLabel("Message"); await field.fill(params["r.message"]);',
  'const options={exact:true}; const field=page.getByLabel("Message",options); options.exact=false; await field.fill(params["r.message"]);'
 ])assert.throws(()=>preserveNativeActions(source,original,bindings,true),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'},source);
 const switchTab='await web.switchTab({index:1,url:"https://app.test/other"});';
 assert.throws(()=>preserveNativeActions(`const field=page.getByLabel("Message"); ${switchTab} await field.fill(params["r.message"]);`,`${switchTab} ${original}`,bindings,true),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'});
});

test('an explicit authoring suffix preserves every confirmed action as an exact prefix; ordinary source stays exact',()=>{
 const original=[fill,click].join('\n'),planned='await page.getByRole("button",{name:"Next",exact:true}).click();';
 assert.throws(()=>preserveNativeActions(`${aliased}\n${planned}`,original,bindings,true),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'});
 assert.doesNotThrow(()=>preserveNativeActions(`${aliased}\n${planned}`,original,bindings,true,{allowPlannedSuffix:true}));
 for(const source of [`${planned}\n${aliased}`,aliased.replace('await field.fill(message);',`await field.fill(message); ${planned}`),aliased.replace('params["r.message"]','params["s.message"]'),fill,`${click}\n${fill}\n${planned}`]){
  assert.throws(()=>preserveNativeActions(source,original,bindings,true,{allowPlannedSuffix:true}),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'},source);
 }
 assert.doesNotThrow(()=>preserveNativeActions(planned,'',bindings,true,{allowPlannedSuffix:true}));
});
