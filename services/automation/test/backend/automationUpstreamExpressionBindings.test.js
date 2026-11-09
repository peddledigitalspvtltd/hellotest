const test=require('node:test');
const assert=require('node:assert/strict');
const {parse}=require('acorn');
const {bindUpstreamSourceParameters:bind,PARAMETER_EXPRESSIONS_MARKER:marker}=require('../../backend/lib/automationUpstreamSourceBindings');
const {preserveNativeActions}=require('../../backend/lib/automationUpstreamEngineer');
const {createUpstreamPrivateBindingScope}=require('../../backend/lib/automationUpstreamPrivateBindings');
const native=(source,options={})=>bind({source,parameterExpressions:true,...options});

test('native data arguments and pre-evaluated URL joins use params expressions while legacy token mode stays unchanged',()=>{
 const parameterValues={'r.url':'https://app.example/','r.first':'BuildFirst'};
 const source='await page.goto("https://app.example/client/#/dashboard");await page.getByLabel("First Name").fill("@r.first");await expect(page).toHaveURL("@r.url"+"client/#/dashboard");';
 const result=native(source,{parameterValues});
 assert.equal(result.source,marker+'\nawait page.goto((params["r.url"] + "client/#/dashboard"));await page.getByLabel("First Name").fill(params["r.first"]);await expect(page).toHaveURL(params["r.url"]+"client/#/dashboard");');
 assert.doesNotMatch(result.source,/@r\./);assert.equal(native(result.source,{parameterValues}).source,result.source);
 assert.equal(bind({source:'await page.getByLabel("First Name").fill("BuildFirst");',parameterValues}).source,'await page.getByLabel("First Name").fill("@r.first");');
});

test('native mixed templates replace data fragments with expressions and retain escaped content and prior expressions',()=>{
 const source='await expect(page.getByRole("link",{name:`Path C:\\\\Temp; literal \\${untouched}; escaped \\`tick\\`; Template for ${params["r.first"]} ${params["r.last"]}`,exact:true})).toBeVisible();';
 const key='r.template `$\\${not_an_expression}',parameterValues={[key]:'Template'};
 const result=native(source,{parameterValues});
 const before=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}).body[0].expression.argument.callee.object.arguments[0].arguments[1].properties[0].value;
 const after=parse(result.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}).body[0].expression.argument.callee.object.arguments[0].arguments[1].properties[0].value;
 assert.equal(after.type,'TemplateLiteral');assert.equal(after.expressions.length,3);
 const originalExpressions=before.expressions.map(node=>source.slice(node.start,node.end));
 assert.deepEqual(after.expressions.slice(1).map(node=>result.source.slice(node.start,node.end)),originalExpressions);
 const evaluate=(input,node,params)=>new Function('params',`return (${input.slice(node.start,node.end)});`)(params);
 assert.equal(evaluate(result.source,after,{[key]:'Template','r.first':'Alex','r.last':'River'}),evaluate(source,before,{'r.first':'Alex','r.last':'River'}));
 assert.doesNotMatch(result.source,/@r\./);
});

test('expression mode leaves selectors, roles, form labels and unrelated expressions exact and rejects unresolved computed token strings',()=>{
 const source='const label="Username";function identity(value){return value;}await page.locator("#Username").getByRole("textbox",{name:"Username",exact:true}).fill("Username");await expect(page.getByLabel("Username")).toHaveValue(identity("Username"));';
 const result=native(source,{parameterValues:{'r.username':'Username'}});
 assert.equal(result.source,marker+'\n'+source.replace('.fill("Username")','.fill(params["r.username"])'));
 assert.throws(()=>native('await expect(page).toHaveURL(String("@r.url")+"client");',{parameterValues:{'r.url':'https://app.example/'}}),{code:'AUTOMATION_UPSTREAM_PARAMETER_COMPOSITION_UNSUPPORTED'});
 assert.throws(()=>native('await page.getByLabel("Name").fill("@r.missing");'),{code:'AUTOMATION_UPSTREAM_PARAMETER_MISSING'});
 assert.equal(native('await page.getByLabel("@r.missing").fill("ordinary literal");').source,marker+'\nawait page.getByLabel("@r.missing").fill("ordinary literal");');
});

test('native secret data and redacted assertion markers become params members without altering private-scope authorization',()=>{
 const env='HELLOTEST_R_PASSWORD',secret='private-value-never-in-source';
 const bindings={secrets:{[env]:secret},references:{'@r.password':env},secretBindings:{[env]:'r.password'},parameterValues:{}};
 const source=`await page.getByLabel("Password").fill(process.env.${env});await expect(page.getByLabel("Password")).toHaveValue("<secret>${env}</secret>");`;
 const scope=createUpstreamPrivateBindingScope({step:{parameter_references:['r.password']},bindings});scope.assertSource(source);
 const result=native(source,{secretBindings:scope.secretBindings});scope.assertSource(result.source);
 assert.match(result.source,/fill\(params\["r\.password"\]\)/);assert.match(result.source,/toHaveValue\(params\["r\.password"\]\)/);assert.doesNotMatch(result.source,/process\.env|<secret>|private-value/);
 assert.throws(()=>createUpstreamPrivateBindingScope({step:{parameter_references:[]},bindings}).assertSource(result.source),{code:'AUTOMATION_UPSTREAM_PRIVATE_BINDING_SCOPE'});
 assert.throws(()=>native(`const unrelated=process.env.${env};await expect(page).toHaveTitle("Ready");`,{secretBindings:bindings.secretBindings}),{code:'AUTOMATION_UPSTREAM_SECRET_BINDING_INVALID'});
});

test('native action authority keeps exact scopes, data order, locators and control ownership in expression programs',()=>{
 const parameterValues={'r.url':'https://app.example/','r.message':'@r.other','r.other':'Different value'},bindings={parameterValues,secretBindings:{},parameterExpressions:true};
 const emitted='await page.goto("https://app.example/client");await page.getByLabel("Name").fill("@r.other");';
 const source=marker+'\nawait page.goto(params["r.url"] + "client");await page.getByLabel("Name").fill(params["r.message"]);';
 assert.doesNotThrow(()=>preserveNativeActions(source,emitted,bindings,true));
 for(const changed of [source.replace('r.message','r.other'),source.replace('getByLabel("Name")','getByLabel("Other")'),source.replace('await page.getByLabel','if(false)await page.getByLabel')])assert.throws(()=>preserveNativeActions(changed,emitted,bindings,true),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'});
});

test('an emitted token-looking literal binds to its actual data owner before scoped-token fallback',()=>{
 const parameterValues={'r.literal':'@r.other','r.other':'CHANGED'},emitted='await page.getByLabel("Name").fill("@r.other");';
 const bound=native(emitted,{parameterValues});assert.equal(bound.source,marker+'\nawait page.getByLabel("Name").fill(params["r.literal"]);');
 const proposal=marker+'\nawait page.getByLabel("Name").fill(params["r.literal"]);';
 assert.doesNotThrow(()=>preserveNativeActions(proposal,emitted,{parameterValues,secretBindings:{},parameterExpressions:true},true));
 assert.throws(()=>preserveNativeActions(proposal.replace('r.literal','r.other'),emitted,{parameterValues,secretBindings:{},parameterExpressions:true},true),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'});
});

test('the expression marker is idempotent, portable and never inferred from string or block-comment contents',async()=>{
 const statement='await expect(page).toHaveTitle("Ready");';
 const marked='// Descriptive source comment\n'+marker+'\n'+statement;
 assert.equal(native(marked).source,marked);assert.equal(native(statement).source,marker+'\n'+statement);
 const block='/* '+marker+' */\n'+statement;assert.equal(native(block).source,marker+'\n'+block);
 const literal='const text='+JSON.stringify(marker)+';'+statement;assert.equal(native(literal).source,marker+'\n'+literal);
 const {usesExpressionParameterBindings}=await import('../../../../testengine/backend/dist/lib/playwrightBindings.js');
 for(const variant of ['//  @hellotest-parameter-bindings expressions-v1','//\t@hellotest-parameter-bindings expressions-v1']){
  const original=variant+'\n'+statement,bound=native(original).source;
  assert.equal(usesExpressionParameterBindings(original),false);assert.equal(bound,marker+'\n'+original);
  assert.equal(native(bound).source,bound);assert.equal(usesExpressionParameterBindings(bound),true);
 }
});
