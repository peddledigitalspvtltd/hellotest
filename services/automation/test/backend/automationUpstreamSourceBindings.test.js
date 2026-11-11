const test=require('node:test');
const assert=require('node:assert/strict');
const {parse}=require('acorn');
const {bindUpstreamSourceParameters:bind,validateUpstreamSourceBoundary:boundary,selectUpstreamSourceParameterValues:selectValues}=require('../../backend/lib/automationUpstreamSourceBindings');

test('versioned tab URLs bind public record data while schema and native index remain exact',async()=>{
  const source='await web.switchTab({index:1,identity:{schema:"hellotest.tab-identity.v1",url:"https://app.test/record?id=Alice"}});';
  const output=bind({source,parameterValues:{'r.record':'Alice'},parameterExpressions:true}).source;
  assert.match(output,/params\["r.record"\]/);
  assert.match(output,/schema:"hellotest.tab-identity.v1"/);
  assert.match(output,/index:1/);
  let selected;
  await new Function('web','params',`return (async()=>{${output}})();`)({switchTab:value=>{selected=value;}},{'r.record':'Bob'});
  assert.equal(selected.identity.url,'https://app.test/record?id=Bob');
});

test('later assertions bind unique public samples while authored references select equal scoped values and private data remains section-scoped',()=>{
  const parameterValues={'r.first':'GeneratedName','t.user':'admin','r.user':'admin','r.password':'opaque-private-input','r.empty':''};
  const unique=selectValues({parameterValues,parameterReferences:[],privateNames:['r.password']});
  assert.deepEqual(unique,{'r.first':'GeneratedName'});
  const source='await expect(page.getByLabel("First Name")).toHaveValue("GeneratedName");';
  assert.equal(bind({source,parameterValues:unique}).source,'await expect(page.getByLabel("First Name")).toHaveValue("@r.first");');
  const selected=selectValues({parameterValues,parameterReferences:['r.user'],privateNames:['r.password']});
  assert.deepEqual(selected,{'r.first':'GeneratedName','r.user':'admin'});
  assert.equal(bind({source:'await page.getByLabel("Username").fill("admin");',parameterValues:selected}).source,'await page.getByLabel("Username").fill("@r.user");');
  assert.equal(selectValues({parameterValues,parameterReferences:['r.password'],privateNames:['r.password']})['r.password'],'opaque-private-input');
});

test('mixed record-name templates bind public literal fragments while preserving every expression and frame locator',()=>{
  const source='await expect(page.locator("#noncoreIframe").contentFrame().getByRole("link",{name:`Onboarding - India for ${params["r.employee_first_name"]} ${params["r.employee_last_name"]}`,exact:true})).toBeVisible();';
  const result=bind({source,parameterValues:{'r.onboarding_template':'Onboarding - India'}});
  assert.equal(result.source,source.replace('Onboarding - India','@r.onboarding_template'));
  assert.deepEqual(result.references,['@r.onboarding_template']);assert.equal(boundary(result.source),result.source);
  const templates=input=>{const found=[];const walk=node=>{if(!node||typeof node!=='object')return;if(node.type==='TemplateLiteral')found.push(node);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}};walk(parse(input,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}));return found;};
  assert.deepEqual(templates(result.source)[0].expressions.map(node=>result.source.slice(node.start,node.end)),templates(source)[0].expressions.map(node=>source.slice(node.start,node.end)));
});

test('changed template fragments retain backticks, dollar interpolation escapes and backslashes without creating expressions',()=>{
  const source='await page.getByText(`Path C:\\\\Temp\\\\file; escaped \\`tick\\`; dollar $5; literal \\${untouched}; Onboarding - India for ${params["r.first"]} suffix \\\\`,{exact:true}).click();';
  for(const parameter of ['r.onboarding_template','r.template `$\\${not_an_expression}']){
    const parameterValues={[parameter]:'Onboarding - India'};
    const result=bind({source,parameterValues});
    const before=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}).body[0].expression.argument.callee.object.arguments[0];
    const after=parse(result.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}).body[0].expression.argument.callee.object.arguments[0];
    assert.equal(before.type,'TemplateLiteral');assert.equal(after.type,'TemplateLiteral');assert.equal(after.expressions.length,1);
    assert.equal(result.source.slice(after.expressions[0].start,after.expressions[0].end),source.slice(before.expressions[0].start,before.expressions[0].end));
    assert.equal(after.quasis[0].value.cooked,before.quasis[0].value.cooked.replace('Onboarding - India',result.references[0]));
    assert.equal(after.quasis[1].value.raw,before.quasis[1].value.raw,'an unchanged fragment retains its exact escaping');
    const evaluate=(input,node)=>new Function('params',`return (${input.slice(node.start,node.end)});`)({'r.first':'Alex'});
    assert.equal(evaluate(result.source,after).replace(result.references[0],'Onboarding - India'),evaluate(source,before));
    require('../../backend/lib/automationUpstreamEngineer').preserveNativeActions(result.source,source,{parameterValues,secretBindings:{}},true);
  }
});

test('mixed templates do not bind selectors, static control labels, expression literals or empty expression separators',()=>{
  const source='const label="Onboarding - India";await page.locator(`#Onboarding - India-${params["r.first"]}`).getByLabel(`Onboarding - India ${params["r.first"]}`).fill(`${params["r.first"]}`);await expect(page.getByRole("textbox",{name:`Onboarding - India ${params["r.first"]}`})).toHaveValue(`${"Onboarding - India"}`);';
  const result=bind({source,parameterValues:{'r.template':'Onboarding - India','r.empty':''},privateNames:['r.empty']});
  assert.equal(result.source,source);assert.equal(result.changed,false);assert.deepEqual(result.references,[]);
});

test('public URL prefixes close their scoped names before path suffixes and retain the original URL at execution',()=>{
  const base='https://app.example/',parameterValues={'r.orangehrm_url':base};
  const source='await page.goto("https://app.example/client/#/dashboard");await expect(page).toHaveURL("https://app.example/client/#/dashboard");await expect(page).toHaveURL(/https:\\/\\/app\\.example\\/client/);';
  const result=bind({source,parameterValues});
  assert.equal(result.source,source.replaceAll('"https://app.example/client/#/dashboard"','"@r.[orangehrm_url]client/#/dashboard"'));
  assert.doesNotMatch(result.source,/@r\.orangehrm_urlclient/);assert.deepEqual(result.references,['@r.[orangehrm_url]']);
  const {parameterTemplateParts}=require('../../backend/lib/automationParameterTemplates');
  const resolved=parameterTemplateParts('@r.[orangehrm_url]client/#/dashboard').map(part=>part.key?parameterValues[part.key]:part.literal).join('');
  assert.equal(resolved,base+'client/#/dashboard');
  require('../../backend/lib/automationUpstreamEngineer').preserveNativeActions(result.source,source,{parameterValues,secretBindings:{}},true);
});

test('adjacent suffix characters, authored references and replacement fragments never become merged parameter names',()=>{
  const {parameterTemplateParts}=require('../../backend/lib/automationParameterTemplates');
  const parameterValues={'r.base':'prefix/','r.end':'<END>','r.path':'client'};
  for(const suffix of ['client','42','_more','-more','@r.path','<END>']){
    const source=`await expect(page.getByRole("status")).toHaveText(${JSON.stringify('prefix/'+suffix)});`;
    const result=bind({source,parameterValues});
    const argument=parse(result.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}).body[0].expression.argument.arguments[0].value;
    const parts=parameterTemplateParts(argument);assert.equal(parts[0].key,'r.base');
    const resolved=parts.map(part=>part.key?parameterValues[part.key]:part.literal).join('');
    assert.equal(resolved,'prefix/'+(suffix==='@r.path'?'client':suffix));
  }
  const mixed='await expect(page).toHaveURL(`prefix/${params["r.path"]}`);';
  const bound=bind({source:mixed,parameterValues}).source;
  assert.equal(bound,mixed.replace('prefix/','@r.[base]'));
});

test('native input, URL, option and assertion data bind exact scoped references while locators, role names and labels stay intact',()=>{
  const source=[
    '// Keep admin comments and formatting exactly as authored.',
    'await page.goto("https://app.test/admin");',
    'await page.locator("#admin").fill("admin");',
    'await page.fill("#admin", "admin", {timeout:1200});',
    'await page.getByLabel("admin").fill("admin");',
    'await page.getByRole("admin", {name:"Admin",exact:true}).click();',
    'await page.getByRole("option", {name:"Pune",exact:true}).click();',
    'await page.getByText("Alice Doe", {exact:true}).click();',
    'await page.locator(".row").filter({hasText:"Alice Doe"}).click();',
    'await expect(page.locator("#admin")).toHaveValue("admin", {timeout:1200});',
    'await expect(page.getByRole("status")).not.toContainText("Welcome, Alice Doe", {timeout:1200});',
    'await expect(page.locator("#names")).toHaveText(["Alice", "Doe"]);',
    'await page.selectOption("#location", {label:"Pune"});',
    'await page.locator("#location").selectOption([{value:"Pune"}]);'
  ].join('\n');
  const result=bind({source,parameterValues:{'r.url':'https://app.test/admin','t.username':'admin','r.location':'Pune','t.first':'Alice','t.last':'Doe'}});
  assert.match(result.source,/goto\("@r\.url"\)/);
  assert.match(result.source,/locator\("#admin"\)\.fill\("@t\.username"\)/);
  assert.match(result.source,/page\.fill\("#admin", "@t\.username", \{timeout:1200\}\)/);
  assert.match(result.source,/getByLabel\("admin"\)\.fill\("@t\.username"\)/);
  assert.match(result.source,/getByRole\("admin", \{name:"Admin",exact:true\}\)/);
  assert.match(result.source,/getByRole\("option", \{name:"@r\.location",exact:true\}\)/);
  assert.match(result.source,/getByText\("@t\.first @t\.last", \{exact:true\}\)/);
  assert.match(result.source,/hasText:"@t\.first @t\.last"/);
  assert.match(result.source,/not\.toContainText\("Welcome, @t\.first @t\.last", \{timeout:1200\}\)/);
  assert.match(result.source,/toHaveText\(\["@t\.first", "@t\.last"\]\)/);
  assert.match(result.source,/page\.selectOption\("#location", \{label:"@r\.location"\}\)/);
  assert.match(result.source,/selectOption\(\[\{value:"@r\.location"\}\]\)/);
  assert.ok(result.source.startsWith(source.split('\n')[0]));
  assert.deepEqual(new Set(result.references),new Set(['@r.url','@t.username','@r.location','@t.first','@t.last']));
  assert.doesNotMatch(JSON.stringify(result.bindings),/https:|Pune|Alice|Doe/);
});

test('explicit native secret env references become correctly quoted symbolic strings without evaluating environment values',()=>{
  const source='await page.getByLabel("Password").fill(process.env["HELLOTEST_T_PASSWORD_123"]);\nawait expect(page.locator("#password")).toHaveValue(process.env.HELLOTEST_T_PASSWORD_123);';
  const result=bind({source,secretBindings:{HELLOTEST_T_PASSWORD_123:'@t.[Private password]'}});
  assert.equal(result.source,'await page.getByLabel("Password").fill("@t.[private password]");\nawait expect(page.locator("#password")).toHaveValue("@t.[private password]");');
  assert.deepEqual(result.references,['@t.[private password]']);
  assert.deepEqual(result.bindings,[{parameter:'t.private password',reference:'@t.[private password]',kind:'secret'}]);
  assert.throws(()=>bind({source,secretBindings:{}}),error=>error.code==='AUTOMATION_UPSTREAM_SECRET_BINDING_MISSING');
  assert.throws(()=>bind({source:'process.env.HELLOTEST_T_PASSWORD_123 = "other";',secretBindings:{HELLOTEST_T_PASSWORD_123:'t.password'}}),error=>error.code==='AUTOMATION_UPSTREAM_SECRET_BINDING_INVALID');
});

test('public values equal to form labels bind inputs and assertions without changing the controls they identify',()=>{
  const parameterValues={'r.username':'Username'};
  const source='await page.getByRole("textbox", {name:"Username",exact:true}).fill("Username");\nawait expect(page.getByRole("textbox", {name:"Username",exact:true})).toHaveValue("Username");';
  const result=bind({source,parameterValues});
  assert.equal(result.source,'await page.getByRole("textbox", {name:"Username",exact:true}).fill("@r.username");\nawait expect(page.getByRole("textbox", {name:"Username",exact:true})).toHaveValue("@r.username");');
  const {preserveNativeActions}=require('../../backend/lib/automationUpstreamEngineer');
  const bindings={parameterValues,secretBindings:{}};
  assert.doesNotThrow(()=>preserveNativeActions(result.source,source,bindings,true));
  assert.throws(()=>preserveNativeActions(result.source.replace('name:"Username"','name:"@r.username"'),source,bindings,true),error=>error.code==='AUTOMATION_UPSTREAM_SOURCE_CHANGED','a synthesized locator change still fails native-action equivalence');
  for(const role of ['textbox','searchbox','combobox','listbox','checkbox','radio','radiogroup','switch','slider','spinbutton','scrollbar','progressbar','meter']){
    const control=`await page.getByRole(${JSON.stringify(role)}, {name:"Username",exact:true}).click();`;
    assert.equal(bind({source:control,parameterValues}).source,control,`${role} uses its original static accessible label`);
  }
  for(const role of ['option','row','cell','gridcell','listitem','treeitem']){
    const record=`await page.getByRole(${JSON.stringify(role)}, {name:"Username",exact:true}).click();`;
    assert.equal(bind({source:record,parameterValues}).source,record.replace('name:"Username"','name:"@r.username"'),`${role} retains authored record selection data`);
  }
});

test('known native secret markers in verification data become scoped references while unrelated text and locators stay unchanged',()=>{
  const marker='<secret>HELLOTEST_PASSWORD</secret>';
  const source=`await expect(page.getByLabel("Password")).toHaveValue(${JSON.stringify(marker)});\nawait expect(page.getByRole("status")).toContainText(${JSON.stringify('Value '+marker+' accepted')});\nawait page.locator(${JSON.stringify(marker)}).click();`;
  const result=bind({source,secretBindings:{HELLOTEST_PASSWORD:'t.password'}});
  assert.equal(result.source,`await expect(page.getByLabel("Password")).toHaveValue("@t.password");\nawait expect(page.getByRole("status")).toContainText("Value @t.password accepted");\nawait page.locator(${JSON.stringify(marker)}).click();`);
  assert.deepEqual(result.references,['@t.password']);
  assert.equal(bind({source:'await expect(page.locator("#x")).toHaveValue("<secret>UNKNOWN</secret>");',secretBindings:{HELLOTEST_PASSWORD:'t.password'}}).changed,false);
  const empty=bind({source:'await page.getByLabel("Password").fill("");\nawait expect(page.getByLabel("Password")).toHaveValue("");',parameterValues:{'t.password':''},privateNames:['t.password'],secretBindings:{HELLOTEST_PASSWORD:'t.password'}});
  assert.equal(empty.source,'await page.getByLabel("Password").fill("@t.password");\nawait expect(page.getByLabel("Password")).toHaveValue("@t.password");');
});

test('composite boundaries, longest matches, escaped literals and existing parameter references retain valid JavaScript',()=>{
  const source=String.raw`await page.getByText('Welcome, Alice Doe!').click();
await page.getByText("Aliceville superadmin ADMIN admin").click();
await page.getByLabel("Quoted").fill('O\'Brien \\ home');
await page.getByLabel("Keep").fill("@t.username");`+'\n'+'await page.getByText(`Alice Doe`).click();';
  const result=bind({source,parameterValues:{'t.fullname':'Alice Doe','t.first':'Alice','t.username':'admin','t.quoted':"O'Brien \\ home"}});
  assert.match(result.source,/Welcome, @t\.fullname!/);
  assert.match(result.source,/Aliceville superadmin ADMIN @t\.username/);
  assert.match(result.source,/fill\("@t\.quoted"\)/);
  assert.match(result.source,/fill\("@t\.username"\)/);
  assert.equal(result.references.filter(reference=>reference==='@t.fullname').length,1);
  assert.doesNotThrow(()=>parse(result.source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true}));
});

test('ambiguous values are rejected rather than silently choosing a different scope',()=>{
  const source='await page.getByLabel("Email").fill("same@example.test");';
  assert.throws(()=>bind({source,parameterValues:{'t.email':'same@example.test','r.email':'same@example.test'}}),error=>error.code==='AUTOMATION_UPSTREAM_PARAMETER_AMBIGUOUS'&&!error.message.includes('same@example.test'));
});

test('private literal values are never emitted for synthesis when outside safely bindable AST positions',()=>{
  const password='private@example.test';
  const input={parameterValues:{'t.password':password},privateNames:['t.password']};
  const good=bind({...input,source:`await page.getByLabel("Password").fill(${JSON.stringify(password)});`});
  assert.doesNotMatch(good.source,/private@example/);assert.match(good.source,/@t\.password/);
  for(const source of [`console.log(${JSON.stringify(password)});`,`// ${password}\nawait page.click("#save");`,`await page.getByLabel(${JSON.stringify(password)}).click();`,`const password=${JSON.stringify(password)};await page.getByLabel("Password").fill(password);`]){
    assert.throws(()=>bind({...input,source}),error=>error.code==='AUTOMATION_UPSTREAM_PRIVATE_LITERAL'&&!JSON.stringify(error).includes(password)&&!error.message.includes(password));
  }
  assert.doesNotThrow(()=>bind({source:'await page.getByLabel("Password").fill(params["t.password"]);',parameterValues:{'t.password':'password'},privateNames:['t.password']}));
  assert.doesNotThrow(()=>bind({source:'await page.getByLabel("Password").fill("password");',parameterValues:{'t.password':'password'},privateNames:['t.password']}));
});

test('arbitrary source logic and unreferenced string positions are retained exactly',()=>{
  const source='const title="admin";\nif (enabled) { await page.locator("admin").click({force:false}); }\nconst literal="process.env.HELLOTEST_ADMIN";';
  const result=bind({source,parameterValues:{'t.username':'admin'}});
  assert.equal(result.source,source);assert.equal(result.changed,false);assert.deepEqual(result.bindings,[]);
  assert.throws(()=>bind({source:'await page.'}),error=>error.code==='AUTOMATION_UPSTREAM_SOURCE_INVALID');
});

test('the native source boundary rejects unobserved network, script evaluation and new browser capabilities',()=>{
  for(const source of [
    'await fetch("/delete", {method:"POST"});',
    'const send=fetch;await send("/hidden");',
    'const secret=process.env.SECRET;',
    'require("node:fs");',
    'eval("1+1");',
    'new Function("return 1")();',
    'globalThis["fetch"]("/delete");',
    'new XMLHttpRequest();',
    'new WebSocket("wss://example.test");',
    'await import("node:fs");',
    'await page.evaluate(() => 1);',
    'const evaluate=page["evaluate"];',
    'await page.evaluateHandle(() => document);',
    'await page.addInitScript("1+1");',
    'await page.addScriptTag({content:"1+1"});',
    'await page.route("**/*", route => route.abort());',
    'await page.unroute("**/*");',
    'await page.request.post("/delete");',
    'await page.context().newPage();',
    'await browser.newContext();',
    'await chromium.launch();'
  ])assert.throws(()=>boundary(source),error=>error.code==='AUTOMATION_UPSTREAM_SOURCE_CAPABILITY_DENIED',source);
});

test('the native boundary preserves standard locator chains, frameLocator, waits, assertions and JavaScript control flow',()=>{
  const source=[
    'const form=page.frameLocator("iframe#profile");',
    'for (const name of ["Alice", "Bob"]) {',
    '  await form.getByRole("textbox", {name:"Name",exact:true}).fill(name);',
    '  await expect(form.getByText(name)).toBeVisible({timeout:4500});',
    '}',
    'await page.waitForURL(/\\/saved$/);',
    'await expect(page.getByRole("status")).not.toContainText("fetch process eval request");',
    'const labels={process:"context",request:"browser"};',
    'await expect(page.getByText("request")).toHaveText("fetch");'
  ].join('\n');
  assert.equal(boundary(source),source);
  const bound=bind({source:'await page.getByLabel("Password").fill(process.env.HELLOTEST_PASSWORD);',secretBindings:{HELLOTEST_PASSWORD:'t.password'}});
  assert.equal(boundary(bound.source),bound.source);
});
