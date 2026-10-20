import { parse } from 'acorn';

const functions = new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const browserMethods = new Set(['goto','reload','goBack','goForward','click','dblclick','fill','type','pressSequentially','check','uncheck','press','selectOption','hover','focus','waitFor','waitForURL','waitForTimeout','waitForLoadState','waitForSelector','waitForFunction','waitForEvent','setInputFiles','scrollIntoViewIfNeeded','screenshot','textContent','innerText','inputValue','getAttribute','count','isVisible','isEnabled','isChecked','title','evaluate','evaluateHandle','newPage','close','setContent']);
const locatorMatchers = new Set(['toBeVisible','toBeHidden','toBeEnabled','toBeDisabled','toBeChecked','toBeAttached','toHaveText','toContainText','toHaveURL','toHaveTitle','toHaveAttribute','toHaveCount','toHaveValue','toHaveValues','toHaveClass','toHaveCSS','toHaveJSProperty']);
const member = (node: any): string | undefined => node?.type === 'MemberExpression' ? node.computed ? node.property?.value : node.property?.name : undefined;
const root = (node: any): string | undefined => node?.type === 'Identifier' ? node.name : node?.type === 'MemberExpression' ? root(node.object) : node?.type === 'CallExpression' ? root(node.callee) : undefined;
const isPollMatcher = (node: any) => {
  let expectation = node?.callee?.object;
  if (expectation?.type === 'MemberExpression' && member(expectation) === 'not') expectation = expectation.object;
  return node?.type === 'CallExpression' && expectation?.type === 'CallExpression'
    && expectation.callee?.type === 'MemberExpression' && expectation.callee.object?.name === 'expect'
    && member(expectation.callee) === 'poll';
};

function implicitPollReturn(node: any, scope: any, ancestors: any[]) {
  if (scope?.type !== 'ArrowFunctionExpression' || scope.body !== node) return false;
  const boundary = ancestors.lastIndexOf(scope), factory = ancestors[boundary - 1];
  if (factory?.type !== 'CallExpression' || factory.arguments[0] !== scope
    || factory.callee?.object?.name !== 'expect' || member(factory.callee) !== 'poll') return false;
  let index = boundary - 2;
  if (ancestors[index]?.type === 'MemberExpression' && member(ancestors[index]) === 'not') index--;
  // Require the actual matcher call. Its outer promise is checked separately
  // for await/return/retained-and-joined ownership. A timer/forEach callback or
  // an unrelated expression cannot acquire ownership through an implicit body.
  return ancestors[index]?.type === 'MemberExpression' && isPollMatcher(ancestors[index - 1]);
}

/** Detect known detached browser operations before executing any section code. */
export function assertAutomationAsyncOwnership(source: string) {
  let tree: any;
  try { tree = parse(`async function __section__(){\n${source}\n}`,{ecmaVersion:'latest',locations:true}); }
  catch { tree = parse(`async function __section__(){\n(${source}\n)}`,{ecmaVersion:'latest',locations:true}); }
  const browserAliases = new Set(['page','playwrightPage']);
  const retained: Array<{name:string;scope:any;line:number;position:number}> = [];
  const joins: Array<{names:string[];scope:any;position:number}> = [];
  const aliases: Array<{name:string;dependencies:string[];scope:any}> = [];
  const promiseNames = (node:any): string[] => {
    if(node?.type==='Identifier')return [node.name];
    if(node?.type==='AwaitExpression'||node?.type==='ChainExpression')return promiseNames(node.argument||node.expression);
    if(node?.type==='CallExpression'&&node.callee?.object?.name==='Promise'&&['all','allSettled','resolve'].includes(member(node.callee)||'')) {
      const argument=node.arguments[0];return argument?.type==='ArrayExpression'?argument.elements.flatMap(promiseNames):promiseNames(argument);
    }
    if(node?.type==='CallExpression'&&['then','catch','finally'].includes(member(node.callee)||''))return promiseNames(node.callee.object);
    return [];
  };
  function visit(node: any, ancestors: any[] = []) {
    if (!node || typeof node !== 'object') return;
    let scope:any;
    for(let index=ancestors.length-1;index>=0;index--)if(functions.has(ancestors[index].type)){scope=ancestors[index];break;}
    if(node.type==='AwaitExpression'||node.type==='ReturnStatement')joins.push({scope,names:promiseNames(node.argument),position:node.start});
    if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier')aliases.push({scope,name:node.id.name,dependencies:promiseNames(node.init)});
    if(node.type==='AssignmentExpression'&&node.left?.type==='Identifier')aliases.push({scope,name:node.left.name,dependencies:promiseNames(node.right)});
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const initial = node.init?.type === 'AwaitExpression' ? node.init.argument : node.init;
      const name = member(initial?.callee);
      if (initial?.type === 'CallExpression' && browserAliases.has(root(initial.callee) || '')
        && /^(?:locator|getBy\w+|first|last|nth|filter|frameLocator|newPage|waitForEvent)$/.test(name || '')) browserAliases.add(node.id.name);
    }
    if (node.type === 'CallExpression') {
      const origin = root(node.callee), method = member(node.callee);
      const namedStep = origin === 'test' && method === 'step';
      const knownAsync = browserAliases.has(origin || '') && browserMethods.has(method || '')
        || origin === 'expect' && (locatorMatchers.has(method || '') || isPollMatcher(node))
        || origin === 'web' && /^(?:expect|wait|click|dblclick|rightClick|fill|clear|select|check|uncheck|press|scroll|hover|upload|setInputFiles|openTab|switchTab|closeTab|text|value|captureText|screenshot)/.test(method || '');
      let boundary=-1;
      for(let index=ancestors.length-1;index>=0;index--) if(functions.has(ancestors[index].type)){boundary=index;break;}
      const local = ancestors.slice(boundary + 1);
      const implicitlyReturned = implicitPollReturn(node, scope, ancestors);
      const owned = implicitlyReturned || local.some(parent => ['AwaitExpression','ReturnStatement',...(namedStep ? [] : ['VariableDeclarator','AssignmentExpression'])].includes(parent.type));
      if ((knownAsync || namedStep) && !owned) {
        throw Object.assign(new Error('Await, return or retain the browser operation promise before this section completes. Detached actions and assertions cannot be reported as passed.'),{hellotestLine:Math.max(1,node.loc.start.line-1)});
      }
      if(knownAsync&&!implicitlyReturned&&!local.some(parent=>parent.type==='AwaitExpression'||parent.type==='ReturnStatement')) {
        let owner:any;
        for(let index=local.length-1;index>=0;index--)if(['VariableDeclarator','AssignmentExpression'].includes(local[index].type)){owner=local[index];break;}
        const identifier=owner?.type==='VariableDeclarator'?owner.id:owner?.left;
        if(identifier?.type==='Identifier')retained.push({scope,name:identifier.name,line:Math.max(1,node.loc.start.line-1),position:node.start});
      }
    }
    for (const [key,value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) value.forEach(child => visit(child,[...ancestors,node]));
      else if (value && typeof value === 'object') visit(value,[...ancestors,node]);
    }
  }
  visit(tree);
  for(const promise of retained) {
    const joined=new Set(joins.filter(join=>join.scope===promise.scope&&join.position>promise.position).flatMap(join=>join.names));
    let changed=true;
    while(changed) {
      changed=false;
      for(const alias of aliases)if(alias.scope===promise.scope&&joined.has(alias.name))for(const name of alias.dependencies)if(!joined.has(name)){joined.add(name);changed=true;}
    }
    if(!joined.has(promise.name))throw Object.assign(new Error(`Await or return the retained browser promise "${promise.name}", or join it with Promise.all, before this section completes.`),{hellotestLine:promise.line});
  }
}
