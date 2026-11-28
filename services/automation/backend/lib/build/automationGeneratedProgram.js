const {parse}=require('acorn');
const {visibilityWaitCondition,hasLinearProgramAssertion,deriveProgramTools}=require("./automationProgramTools");
const {normalizeParameterKey}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');

const playwrightModules=new Set(['@playwright/test','playwright/test']);
const suiteMethods=new Set(['describe','use','beforeEach','afterEach','beforeAll','afterAll','extend','only','skip','fixme']);
const webBindings=['page','web','expect','params','capture','playwrightPage','driver','bindings'];
const browserAsyncMethods=new Set(['goto','click','dblclick','fill','check','uncheck','press','selectOption','hover','waitFor','waitForURL','waitForTimeout','waitForLoadState','waitForSelector','waitForFunction','setInputFiles','scrollIntoViewIfNeeded','screenshot','textContent','innerText','inputValue','title']);
// Native Playwright assertions that do not require the Playwright Test runner's
// snapshot/testInfo state. Keep promise ownership and readiness on the same
// supported contract, including focus, viewport and accessibility outcomes.
const locatorMatchers=new Set(['toBeVisible','toBeHidden','toBeEnabled','toBeDisabled','toBeEditable','toBeChecked','toBeAttached','toBeEmpty','toBeFocused','toBeInViewport','toHaveText','toContainText','toContainClass','toHaveURL','toHaveTitle','toHaveAttribute','toHaveCount','toHaveValue','toHaveValues','toHaveClass','toHaveCSS','toHaveJSProperty','toHaveAccessibleDescription','toHaveAccessibleErrorMessage','toHaveAccessibleName','toHaveId','toHaveRole']);
const testRunnerMatchers=new Set(['toMatchAriaSnapshot','toHaveScreenshot','toMatchSnapshot']);
const member=node=>node?.type==='MemberExpression'?(node.computed?node.property?.value:node.property?.name):null;
const isFunction=node=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node?.type);
const parseProgram=source=>parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});
const fail=message=>{throw new Error(message);};
const isNamedStep=node=>node?.type==='CallExpression'&&node.callee?.object?.name==='test'&&member(node.callee)==='step';
function rootName(node) {
  if(node?.type==='Identifier')return node.name;
  if(node?.type==='MemberExpression')return rootName(node.object);
  if(node?.type==='CallExpression')return rootName(node.callee);
  return null;
}
function nativeExpectation(call){
  if(call?.type!=='CallExpression'||call.optional||call.callee?.type!=='MemberExpression'||call.callee.optional)return false;
  let target=call.callee.object;
  if(target?.type==='MemberExpression'&&member(target)==='not'&&!target.optional)target=target.object;
  if(target?.type!=='CallExpression'||target.optional||target.arguments.length<1||target.arguments.length>2)return false;
  if(target.arguments.length===2&&(target.arguments[1]?.type!=='Literal'||typeof target.arguments[1].value!=='string'))return false;
  return target.callee?.type==='Identifier'&&target.callee.name==='expect'
    ||target.callee?.type==='MemberExpression'&&!target.callee.optional&&target.callee.object?.name==='expect'&&(member(target.callee)==='soft'||member(target.callee)==='poll'&&isFunction(target.arguments[0]));
}
function pollingExpectation(call){let target=call?.callee?.object;if(target?.type==='MemberExpression'&&member(target)==='not')target=target.object;return target?.type==='CallExpression'&&target.callee?.object?.name==='expect'&&member(target.callee)==='poll';}
function hasExecutableWork(node) {
  if(!node||typeof node!=='object'||isFunction(node))return false;
  if(node.type==='ThrowStatement')return true;
  if(node.type==='CallExpression') {
    if(isFunction(node.callee))return hasExecutableWork(node.callee.body);
    if(isNamedStep(node))return hasExecutableWork(node.arguments.at(-1)?.body);
    if(node.callee.object?.name==='console')return false;
    return true;
  }
  return Object.values(node).some(value=>Array.isArray(value)?value.some(hasExecutableWork):value&&typeof value==='object'&&hasExecutableWork(value));
}
function walk(node,visit,{nestedFunctions=true}={},ancestors=[]) {
  if(!node||typeof node!=='object')return;
  visit(node,ancestors);
  if(!nestedFunctions&&isFunction(node))return;
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(item=>walk(item,visit,{nestedFunctions},[...ancestors,node]));else if(value&&typeof value==='object')walk(value,visit,{nestedFunctions},[...ancestors,node]);
}
function invocation(fn,source,{testBody=false}={}) {
  const expression=source.slice(fn.start,fn.end);
  const arity=fn.params.findIndex(param=>['AssignmentPattern','RestElement'].includes(param.type));
  const length=arity<0?fn.params.length:arity;
  if(testBody&&length>1)fail('A generated step cannot depend on a Playwright testInfo fixture. Use the supplied runtime bindings.');
  return `await (${expression})(${!testBody&&length>1?webBindings.join(', '):`{ ${webBindings.join(', ')} }`});`;
}

/** Normalize only entry points supported by TestEngine; never evaluate model code. */
function normalizeGeneratedProgram(input,{runtime='web'}={}) {
  if(typeof input!=='string'||!input.trim())fail('Executable instructions are missing.');
  const fence=input.trim().match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  let source=(fence?fence[1]:input).replace(/\r\n/g,'\n');
  let tree;
  try{tree=parseProgram(source);}catch{fail('Generated instructions contain invalid JavaScript.');}
  if(runtime==='web') {
    const imports=tree.body.filter(node=>node.type==='ImportDeclaration');
    for(const node of imports)if(!playwrightModules.has(node.source.value)||!node.specifiers.length||node.specifiers.some(item=>item.type!=='ImportSpecifier'||!['test','expect'].includes(item.imported.name)||item.local.name!==item.imported.name))fail('Generated steps provide page and expect; external or aliased module imports cannot execute in this runtime.');
    for(const node of [...imports].reverse())source=source.slice(0,node.start)+source.slice(node.end);
    tree=parseProgram(source);
    const requires=tree.body.filter(node=>node.type==='VariableDeclaration'&&node.declarations.some(item=>item.init?.type==='CallExpression'&&item.init.callee.name==='require'));
    for(const node of requires) {
      const declaration=node.declarations[0];
      if(node.declarations.length!==1||!playwrightModules.has(declaration.init.arguments[0]?.value)||declaration.id.type!=='ObjectPattern'||declaration.id.properties.some(item=>item.type!=='Property'||!['test','expect'].includes(item.key.name)||item.value?.name!==item.key.name))fail('Generated steps cannot load external modules. Use the supplied runtime bindings.');
    }
    for(const node of [...requires].reverse())source=source.slice(0,node.start)+source.slice(node.end);
    tree=parseProgram(source);
    walk(tree,node=>{if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&['test','it'].includes(node.callee.object?.name)&&suiteMethods.has(member(node.callee)))fail('Configure suites, hooks and skipped tests in the workspace; they cannot be hidden inside generated steps.');});
    const statements=tree.body.filter(node=>node.type!=='EmptyStatement');
    const tests=statements.filter(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression'&&['test','it'].includes(node.expression.callee?.name));
    if(tests.length) {
      if(tests.length!==1)fail('One automation section must contain exactly one Playwright test body.');
      const statement=tests[0],callback=statement.expression.arguments.at(-1);
      if(!isFunction(callback)||callback.body.type!=='BlockStatement')fail('The Playwright test wrapper needs an executable callback body.');
      source=source.slice(0,statement.start)+invocation(callback,source,{testBody:true})+source.slice(statement.end);
      tree=parseProgram(source);
    } else if(statements.length===1) {
      const statement=statements[0],expression=statement.type==='ExpressionStatement'?statement.expression:statement;
      const exported=statement.type==='ExportDefaultDeclaration'?statement.declaration:expression.type==='AssignmentExpression'&&expression.operator==='='&&((expression.left.object?.name==='module'&&member(expression.left)==='exports')||(expression.left.object?.name==='exports'&&member(expression.left)==='default'))?expression.right:null;
      const fn=isFunction(exported)?exported:isFunction(expression)?expression:null;
      if(fn) {source=invocation(fn,source);tree=parseProgram(source);}
    }
  }
  walk(tree,(node,ancestors)=>{
    if(['ImportDeclaration','ExportDefaultDeclaration','ExportNamedDeclaration'].includes(node.type))fail('Generated instructions must be a runtime step body, without module declarations.');
    if(node.type==='CallExpression'&&['test','it'].includes(node.callee?.name))fail('Generated native instructions cannot contain Playwright test wrappers.');
    if(isNamedStep(node)) {
      if(runtime!=='web'||!isFunction(node.arguments.at(-1)))fail('test.step requires an executable web callback.');
      const local=ancestors.slice(ancestors.findLastIndex(isFunction)+1);
      if(!local.some(parent=>parent.type==='AwaitExpression'||parent.type==='ReturnStatement'))fail('Await or return test.step so its actions and assertions finish before the section completes.');
    }
    if(runtime==='web'&&node.type==='CallExpression') {
      const root=rootName(node.callee),method=member(node.callee);
      if(root==='expect'&&testRunnerMatchers.has(method))throw Object.assign(new Error(`${method} requires Playwright Test testInfo and snapshot state, which the native step runner does not provide. Preserve completed actions and use supported awaited toBeVisible, toHaveText or toHaveCount checks against the actual observed locator/frame. For iframe results, use the observed iframe target; a main-page body snapshot does not establish its contents. Correct only the source without replaying browser actions.`),{code:'AUTOMATION_RUNNER_MATCHER_UNSUPPORTED',statusCode:422,matcher:method});
      const selector=node.arguments[0];
      const selectorText=selector?.type==='Literal'?selector.value:selector?.type==='TemplateLiteral'&&!selector.expressions.length?selector.quasis[0].value.cooked:null;
      if(['page','playwrightPage'].includes(root)&&method==='locator'&&typeof selectorText==='string'&&/^\s*(?:(?:page|playwrightPage)\.)?getBy(?:Role|Label|Text|TestId|Placeholder|Title|AltText)\s*\(/.test(selectorText))fail('A Playwright locator expression is wrapped in a selector string. Call page.getByRole/getByLabel directly, or use an observed CSS/repository selector. Correct the source without replaying completed browser actions.');
      const selectorArgument=['page','playwrightPage'].includes(root)&&(method==='locator'||['click','dblclick','fill','type','press','selectOption','check','uncheck','hover'].includes(method)&&['page','playwrightPage'].includes(node.callee.object?.name));
      if(selectorArgument&&typeof selectorText==='string'&&/\.(?:first|last)\(\s*\)\s*$|\.nth\(\s*\d+\s*\)\s*$/.test(selectorText))fail('A locator index is encoded inside a selector string. Use a native locator chain such as page.locator("button").first() or .nth(1), preserving the observed selector. Correct only the source for completed actions.');
      const asyncCall=['page','playwrightPage'].includes(root)&&browserAsyncMethods.has(method)||root==='expect'&&(locatorMatchers.has(method)||pollingExpectation(node))||root==='web'&&/^(?:expect|wait|click|dblclick|rightClick|fill|clear|select|check|uncheck|press|scroll|hover|upload|setInputFiles|openTab|switchTab|closeTab|text|value|captureText|screenshot)/.test(method||'');
      const local=ancestors.slice(ancestors.findLastIndex(isFunction)+1);
      if(asyncCall&&!local.some(parent=>['AwaitExpression','ReturnStatement','VariableDeclarator','AssignmentExpression'].includes(parent.type)))fail('Await, return or retain the browser operation promise; detached actions and assertions can finish after the step is reported complete.');
    }
  });
  if(!hasExecutableWork(tree))fail('Generated instructions contain no executable action or assertion; comments, declarations and logging are not a completed step.');
  return source.trim();
}

const stable=node=>typeof node==='bigint'?{bigint:String(node)}:Array.isArray(node)?node.map(stable):node&&typeof node==='object'?Object.fromEntries(Object.entries(node).filter(([key])=>!['start','end','loc','raw'].includes(key)).map(([key,value])=>[key,stable(value)])):node;
const precedingDeclarations=(tree,source,position)=>tree.body.filter(statement=>statement.end<=position&&statement.type==='VariableDeclaration').map(statement=>source.slice(statement.start,statement.end)).join('\n');
function redundantAdjacentAssertions(tree,source){
  const redundant=new Set();let previous=null;
  for(const statement of tree.body){
    const call=statement.type==='ExpressionStatement'&&statement.expression?.type==='AwaitExpression'?statement.expression.argument:null;
    if(call?.type!=='CallExpression'){previous=null;continue;}
    // The closed source-to-tool parser is the read-only allowlist. In
    // particular, an arbitrary evaluate/poll callback or dynamic expectation
    // cannot acquire purity merely because the same JavaScript occurs twice.
    const tools=deriveProgramTools({payload:{steps:[{step_id:'preserved-assertion',automation_code:precedingDeclarations(tree,source,statement.start)+'\n'+source.slice(statement.start,statement.end)}]},execution:{required:true,step_id:'preserved-assertion'}});
    if(tools?.length!==1||tools[0].name!=='browser_assert'){previous=null;continue;}
    // Unlike the portable matcher contract, this identity includes the exact
    // subject/callback. Every intervening statement ends the duplicate group.
    const signature=JSON.stringify(stable(call));
    if(signature===previous)redundant.add(call);
    previous=signature;
  }
  return redundant;
}
function assertionContracts(source,{coalesceAdjacent=false}={}) {
  let tree,normalized;try{normalized=normalizeGeneratedProgram(source);tree=parseProgram(normalized);}catch{return [];}
  const redundant=coalesceAdjacent?redundantAdjacentAssertions(tree,normalized):new Set();
  const contracts=[];
  walk(tree,(node,ancestors)=>{
    if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||redundant.has(node))return;
    const boundary=ancestors.findLastIndex(isFunction);
    const local=ancestors.slice(boundary+1);
    const joined=local.some(parent=>parent.type==='AwaitExpression'||parent.type==='ReturnStatement');
    const name=member(node.callee);
    if(pollingExpectation(node)){
      const declarations=ancestors.some(isFunction)?'':precedingDeclarations(tree,normalized,node.start);
      const tools=deriveProgramTools({payload:{steps:[{step_id:'native-poll-contract',automation_code:`${declarations}\nawait ${normalized.slice(node.start,node.end)};`}]},execution:{required:true,step_id:'native-poll-contract'}});
      const native=tools?.length===1&&tools[0].name==='browser_assert'&&['valid','invalid','field_valid','input_type'].includes(tools[0].arguments.assertion)?tools[0]:null;
      // Pin the known read-only predicate and subject, not just toBe(true).
      // Exact legacy field readers migrate to the same typed requirement;
      // changed callbacks, polarity, targets or options cannot use that path.
      if(native){contracts.push(JSON.stringify({helper:'native_validation_poll',joined,args:stable([native.arguments])}));return;}
    }
    if(node.callee.object?.name==='web'&&/^expect(?:Text|Visible|Hidden|Enabled|Url|Value)$/.test(name||'')) {
      const args=node.arguments.slice(name==='expectUrl'||name==='expectText'&&node.arguments.length===1?0:1);
      contracts.push(JSON.stringify({helper:name,joined,args:stable(args)}));return;
    }
    if(node.callee.object?.name==='expect'&&['equal','contains','truthy'].includes(name)) {
      contracts.push(JSON.stringify({helper:`expect.${name}`,joined,args:stable(node.arguments.slice(1))}));return;
    }
    const path=[name];let base=node.callee.object;
    while(base?.type==='MemberExpression'){path.unshift(member(base));base=base.object;}
    if(base?.type!=='CallExpression')return;
    let factory=base.callee;const modifiers=[];
    while(factory?.type==='MemberExpression'){modifiers.unshift(member(factory));factory=factory.object;}
    if(factory?.name==='expect')contracts.push(JSON.stringify({factory:modifiers,path,joined,args:stable(node.arguments)}));
  });
  return contracts;
}
const expectedString=node=>node?.type==='Literal'&&typeof node.value==='string'&&!node.regex?node.value
  :node?.type==='TemplateLiteral'&&!node.expressions.length?node.quasis[0].value.cooked:null;
function expectedParameter(node){
  const value=expectedString(node);
  if(typeof value==='string'&&/^@[tsr]\.(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i.test(value))return normalizeParameterKey(value,'r');
  if(node?.type!=='MemberExpression'||node.optional||!node.computed||node.object?.type!=='Identifier'||node.object.name!=='params')return null;
  const key=expectedString(node.property);
  return typeof key==='string'&&/^@?[tsr]\..+/i.test(key)?normalizeParameterKey(key,'r'):null;
}
function equivalentExpectedArgument(before,after,{parameters={},resolveParameter,allowLiteralBinding=false}={}){
  if(JSON.stringify(before)===JSON.stringify(after))return true;
  const left=expectedParameter(before),right=expectedParameter(after);
  // Equal current values do not make two different dynamic bindings the same
  // oracle. Only a literal and one fixed binding may be compared by value.
  if(left&&right)return left===right&&Object.hasOwn(parameters,left);
  const key=left||right,literal=expectedString(left?after:before);
  // Parameterizing a business/status/URL constant changes its future oracle.
  // Frozen literal equivalence is restricted to native input content checks.
  if(!allowLiteralBinding||!key||literal===null||!Object.hasOwn(parameters,key))return false;
  let resolved;
  try{resolved=typeof resolveParameter==='function'?resolveParameter(key):parameters[key];}catch{return false;}
  // The host supplies its frozen raw binding. A prompt privacy placeholder is
  // never executable data and must not establish equivalence accidentally.
  return typeof resolved==='string'&&!/^\[(?:private parameter (?:value|reference)|redacted(?:_[a-z]+)?)\]$/i.test(resolved)&&resolved===literal;
}
function preserveGeneratedAssertions(before,after,options={}) {
  const remaining=assertionContracts(after).map(value=>JSON.parse(value));
  for(const value of assertionContracts(before,{coalesceAdjacent:true})) {
    const assertion=JSON.parse(value),{args,...contract}=assertion;
    const index=remaining.findIndex(candidate=>{
      const {args:expected,...other}=candidate;
      return JSON.stringify(contract)===JSON.stringify(other)&&args.length===expected.length
        &&args.every((argument,index)=>equivalentExpectedArgument(argument,expected[index],{...options,
          allowLiteralBinding:contract.helper==='expectValue'||contract.path?.at(-1)==='toHaveValue'}));
    });
    if(index<0)throw Object.assign(new Error('Generated instructions removed or weakened an existing assertion. Preserve its matcher, polarity and expected value; update the saved specification explicitly before changing the outcome.'),{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED',statusCode:422});
    remaining.splice(index,1);
  }
}

/** Join only bare native async assertion statements in an async step. This
 * preserves every locator, matcher, polarity and expected value. Sync helper
 * bodies, arbitrary calls and invalid selectors still require correction. */
function joinGeneratedAssertions(input,{runtime='web'}={}){
  if(runtime!=='web'||typeof input!=='string')return {source:input,joined:0};
  const fence=input.trim().match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/),source=fence?fence[1]:input;
  let tree;try{tree=parseProgram(source);}catch{return {source:input,joined:0};}
  const positions=[];
  walk(tree,(node,ancestors)=>{
    if(node.type!=='ExpressionStatement'||node.expression?.type!=='CallExpression')return;
    const call=node.expression;
    if(!nativeExpectation(call)||!locatorMatchers.has(member(call.callee)))return;
    const fn=ancestors.findLast(isFunction);if(fn&&!fn.async)return;
    positions.push(call.start);
  });
  let result=source;for(const position of positions.sort((a,b)=>b-a))result=result.slice(0,position)+'await '+result.slice(position);
  return {source:positions.length?result:input,joined:positions.length};
}

function fixtureOnly(node, bindings, depth = 0) {
  if (!node || depth > 25) return false;
  const isFixture = child => fixtureOnly(child, bindings, depth + 1);
  switch (node.type) {
    case 'Literal': return true;
    case 'Identifier': return node.name === 'undefined' || bindings.has(node.name);
    case 'MemberExpression': return node.object?.name === 'params' && (!node.computed || isFixture(node.property));
    case 'TemplateLiteral': return node.expressions.every(isFixture);
    case 'ArrayExpression': return node.elements.every(isFixture);
    case 'ObjectExpression': return node.properties.every(property => property.type === 'Property'
      && property.kind === 'init' && (!property.computed || isFixture(property.key)) && isFixture(property.value));
    case 'UnaryExpression': return ['!', '+', '-', '~', 'typeof', 'void'].includes(node.operator) && isFixture(node.argument);
    case 'LogicalExpression':
    case 'BinaryExpression': return isFixture(node.left) && isFixture(node.right);
    case 'ConditionalExpression': return isFixture(node.test) && isFixture(node.consequent) && isFixture(node.alternate);
    case 'CallExpression': return ['String', 'Number', 'Boolean'].includes(node.callee?.name) && node.arguments.every(isFixture);
    default: return false;
  }
}

function hasNonFixtureOracle(call, bindings) {
  const name = member(call.callee);
  const helper = call.callee.object?.name === 'expect';
  let expectation = call.callee.object;
  if (member(expectation) === 'not') expectation = expectation.object;
  let subject = helper ? call.arguments[0] : expectation?.arguments?.[0];
  const expected = helper ? call.arguments.slice(1) : call.arguments;
  if (pollingExpectation(call)) {
    const body = subject.body;
    subject = body.type === 'BlockStatement' && body.body.length === 1 && body.body[0].type === 'ReturnStatement'
      ? body.body[0].argument : body;
  }
  if (!subject || fixtureOnly(subject, bindings) && expected.every(argument => fixtureOnly(argument, bindings))) return false;
  if (['equal', 'toBe', 'toEqual', 'toStrictEqual'].includes(name) && subject.type === 'Identifier'
    && expected[0]?.type === 'Identifier' && expected[0].name === subject.name) return false;
  return true;
}

/** A saved expected result needs a real executable check, rather than a check
 * present only in development calls, fixture constants or suppressed errors. */
function hasExecutableAssertion(source) {
  let tree,normalized;try{normalized=normalizeGeneratedProgram(source);tree=parseProgram(normalized);}catch{return false;}
  // Reuse atomic lowering for linear const-locator aliases rather than
  // inventing a second alias resolver in the source-completion gate.
  if(hasLinearProgramAssertion({payload:{steps:[{step_id:'assertion-check',automation_code:normalized}]},execution:{required:true,step_id:'assertion-check'}}))return true;
  const helpers=new Map(),visited=new Map();let found=false;
  for(const node of tree.body){
    if(node.type==='FunctionDeclaration'&&node.id)helpers.set(node.id.name,node);
    if(node.type==='VariableDeclaration')for(const item of node.declarations)if(item.id?.type==='Identifier'&&isFunction(item.init))helpers.set(item.id.name,item.init);
  }
  const synchronous=new Set(['toBe','toEqual','toStrictEqual','toContain','toMatch','toBeTruthy','toBeFalsy','toBeDefined','toBeNull','toHaveLength']);
  const visit=(node,joined=false,returnJoined=true,fixtures=new Set())=>{
    if(found||!node||typeof node!=='object'||isFunction(node))return;
    if(node.type==='Program'||node.type==='BlockStatement'){
      const scope = new Set(fixtures);
      for (const statement of node.body) {
        visit(statement, false, returnJoined, scope);
        if (statement.type === 'VariableDeclaration') for (const item of statement.declarations) {
          if (item.id.type !== 'Identifier') continue;
          if (statement.kind === 'const' && !['ArrayExpression', 'ObjectExpression'].includes(item.init?.type)
            && fixtureOnly(item.init, scope)) scope.add(item.id.name);
          else scope.delete(item.id.name);
        }
        if (['ReturnStatement', 'ThrowStatement'].includes(statement.type)) break;
      }
      return;
    }
    if(node.type==='AwaitExpression'){visit(node.argument,true,returnJoined,fixtures);return;}
    if(node.type==='ReturnStatement'){visit(node.argument,returnJoined,returnJoined,fixtures);return;}
    if(['IfStatement','ConditionalExpression'].includes(node.type)&&node.test?.type==='Literal'&&typeof node.test.value==='boolean'){visit(node.test.value?node.consequent:node.alternate,joined,returnJoined,fixtures);return;}
    if(node.type==='LogicalExpression'&&node.left?.type==='Literal'){
      const value=node.left.value;
      if(node.operator==='&&'&&value||node.operator==='||'&&!value||node.operator==='??'&&value==null)visit(node.right,joined,returnJoined,fixtures);
      return;
    }
    if(['WhileStatement','ForStatement'].includes(node.type)&&node.test?.type==='Literal'&&node.test.value===false){if(node.init)visit(node.init,false,returnJoined,fixtures);return;}
    if (node.type === 'TryStatement') {
      const handler = node.handler;
      const rethrow = handler?.body.body[0];
      const propagates = !handler || (handler.param?.type === 'Identifier' && handler.body.body.length === 1
        && rethrow?.type === 'ThrowStatement' && rethrow.argument?.type === 'Identifier' && rethrow.argument.name === handler.param.name);
      const returnsFromFinally = node.finalizer?.body.some(statement => statement.type === 'ReturnStatement');
      if (propagates && !returnsFromFinally) visit(node.block, joined, returnJoined, fixtures);
      visit(node.finalizer, joined, returnJoined, fixtures);
      return;
    }
    if(node.type==='CallExpression'){
      const name=member(node.callee);
      if(joined&&visibilityWaitCondition(node,new Map(),{allowCustomTimeout:true}))found=true;
      if(nativeExpectation(node)&&(locatorMatchers.has(name)||synchronous.has(name))&&(joined||!pollingExpectation(node)&&synchronous.has(name))&&hasNonFixtureOracle(node,fixtures))found=true;
      if(node.callee.object?.name==='web'&&/^expect(?:Text|Visible|Hidden|Enabled|Url|Value)$/.test(name||'')&&joined)found=true;
      if(node.callee.object?.name==='expect'&&['equal','contains','truthy'].includes(name)&&hasNonFixtureOracle(node,fixtures))found=true;
      const helper=isFunction(node.callee)?node.callee:node.callee?.type==='Identifier'?helpers.get(node.callee.name):isNamedStep(node)?node.arguments.at(-1):null;
      if(helper&&(joined||!helper.async)){
        const modes=visited.get(helper)||new Set();
        if(!modes.has(joined)){modes.add(joined);visited.set(helper,modes);visit(helper.body,false,joined);}
      }
      if(joined&&node.callee.object?.name==='Promise'&&name==='all'&&node.arguments.length===1&&node.arguments[0]?.type==='ArrayExpression'){
        node.arguments[0].elements.forEach(item=>visit(item,true,returnJoined,fixtures));
      }
      // Awaiting an unrelated call does not join assertion promises passed as
      // its arguments. Only an explicit Promise.all preserves that contract.
      visit(node.callee,false,returnJoined,fixtures);node.arguments.forEach(item=>visit(item,false,returnJoined,fixtures));return;
    }
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(item=>visit(item,false,returnJoined,fixtures));else if(value&&typeof value==='object')visit(value,false,returnJoined,fixtures);
  };
  visit(tree);return found;
}

/** Lint newly generated browser source. Historical and explicitly authored
 * steps keep their existing runtime contract. */
function assertGeneratedBrowserSourceQuality(source, { expectedResult = '' } = {}) {
  const failQuality = message => { throw Object.assign(new Error(message), { code: 'AUTOMATION_GENERATED_SOURCE_QUALITY', statusCode: 422 }); };
  const comments = [];
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, onComment: comments });
  const directives = comments.filter(comment => comment.end <= tree.body[0]?.start && /^\s*@hellotest-options\b/i.test(comment.value));
  if (directives.some(comment => /\b(?:skip|optional)\b/i.test(comment.value))) {
    failQuality('Generated sections must run and propagate assertion failures. Remove the skip or optional execution directive.');
  }
  const forcedActions = new Set(['click', 'dblclick', 'fill', 'check', 'uncheck', 'setChecked', 'selectOption', 'hover', 'dragTo']);
  const navigation = new Set(['goto', 'reload', 'goBack', 'goForward', 'waitForURL', 'setContent']);
  const transitions = new Set([...forcedActions, 'goto', 'reload', 'goBack', 'goForward', 'press', 'type', 'pressSequentially', 'setInputFiles', 'switchTab']);
  const hasOption = (args, name, value) => args.some(argument => argument.type === 'ObjectExpression'
    && argument.properties.some(option => (option.key?.name ?? option.key?.value) === name && option.value?.value === value));
  walk(tree, node => {
    if (node.type !== 'CallExpression') return;
    const method = member(node.callee);
    if (method === 'waitForTimeout') failQuality('Replace the fixed sleep with a bounded wait for the observed application state.');
    if (method === 'waitForLoadState' && node.arguments[0]?.value === 'networkidle'
      || navigation.has(method) && hasOption(node.arguments, 'waitUntil', 'networkidle')) {
      failQuality('Use a specific response, locator or route condition for readiness instead of networkidle.');
    }
    if (forcedActions.has(method) && hasOption(node.arguments, 'force', true)) {
      failQuality('Preserve normal Playwright actionability. Use the observed actionable target or report the blocker.');
    }
  });
  if (typeof expectedResult === 'string' && expectedResult.trim()) {
    const finalTransition = tree.body.findLast(statement => statement.type === 'ExpressionStatement'
      && statement.expression.type === 'AwaitExpression' && statement.expression.argument.type === 'CallExpression'
      && transitions.has(member(statement.expression.argument.callee)));
    if (finalTransition && !hasExecutableAssertion(source.slice(finalTransition.end))) {
      failQuality('Keep the expected-result assertion after the final action. An earlier check proves only the earlier application state.');
    }
  }
}
module.exports={normalizeGeneratedProgram,preserveGeneratedAssertions,assertionContracts,hasExecutableAssertion,joinGeneratedAssertions,assertGeneratedBrowserSourceQuality};
