const {parse}=require('acorn');
const {normalizeParameterKey}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {tokenFor}=require('@hellotest/platform/backend/src/utils/parameterNames');
const PARAMETER_EXPRESSIONS_MARKER='// @hellotest-parameter-bindings expressions-v1';

const error=(code,message)=>Object.assign(new Error(message),{code,statusCode:422});
const member=node=>node?.type==='MemberExpression'?(node.computed?node.property?.value:node.property?.name):null;
const string=node=>node?.type==='Literal'&&typeof node.value==='string'?node.value:node?.type==='TemplateLiteral'&&!node.expressions.length?node.quasis[0].value.cooked:null;
const parseSource=(source,comments=[])=>parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true,onComment:comments});
const entries=value=>value instanceof Map?[...value.entries()]:Object.entries(value||{});
const root=node=>node?.type==='Identifier'?node.name:node?.type==='MemberExpression'?root(node.object):node?.type==='CallExpression'?root(node.callee):node?.type==='AwaitExpression'?root(node.argument):null;
const wordBefore=(text,offset)=>/[\p{L}\p{N}_]$/u.test(text.slice(0,offset));
const wordAfter=(text,offset)=>/^[\p{L}\p{N}_]/u.test(text.slice(offset));
const boundedMatch=(text,value,offset)=>!(/^[\p{L}\p{N}_]/u.test(value)&&wordBefore(text,offset))&&!(/[\p{L}\p{N}_]$/u.test(value)&&wordAfter(text,offset+value.length));
const tokenRanges=text=>[...text.matchAll(/(?<![A-Za-z0-9_])@[tsr]\.(?:\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi)].map(match=>[match.index,match.index+match[0].length]);
const templateFragment=text=>JSON.stringify(text).slice(1,-1).replaceAll('`','\\`').replaceAll('${','\\${');

/** Later sections can verify public data entered earlier without repeating its
 * reference in their prose. Bind unique public samples globally; authored refs
 * select the intended namespace when several public keys share a value. */
function selectUpstreamSourceParameterValues({parameterValues={},parameterReferences,privateNames=[]}={}){
  if(!Array.isArray(parameterReferences))return {...parameterValues};
  const preferred=new Set(parameterReferences.map(name=>normalizeParameterKey(name,'t')));
  const privateKeys=new Set(privateNames.map(name=>normalizeParameterKey(name,'t'))),groups=new Map(),selected=[];
  for(const [name,value]of entries(parameterValues)){
    const key=normalizeParameterKey(name,'t');
    if(privateKeys.has(key)&&!preferred.has(key))continue;
    const sample=String(value??''),group=groups.get(sample)||[];group.push({name,key,value});groups.set(sample,group);
  }
  for(const [sample,group]of groups){
    const explicit=group.filter(item=>preferred.has(item.key));
    const candidates=explicit.length?explicit:group.length===1&&sample!==''?group:[];
    for(const {name,value}of candidates)selected.push([name,value]);
  }
  return Object.fromEntries(selected);
}

/** Bind only authored data-bearing AST positions in native Playwright source.
 * Callers supply the values referenced by the current authored step. No data
 * values appear in the returned metadata or errors, and source is never run. */
function bindUpstreamSourceParameters({source,parameterValues={},privateNames=[],secretBindings={},parameterExpressions=false}={}) {
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source,'utf8')>256*1024)throw error('AUTOMATION_UPSTREAM_SOURCE_INVALID','Upstream Playwright source must be bounded JavaScript.');
  const sourceComments=[];let tree;try{tree=parseSource(source,sourceComments);}catch{throw error('AUTOMATION_UPSTREAM_SOURCE_INVALID','Upstream Playwright source contains invalid JavaScript.');}
  const privateKeys=new Set([...privateNames].map(name=>normalizeParameterKey(name,'t')).filter(Boolean));
  const byValue=new Map(),privateValues=new Set();
  for(const [name,raw]of entries(parameterValues)){
    const key=normalizeParameterKey(name,'t');if(!key)continue;
    const value=String(raw??''),keys=byValue.get(value)||new Set();keys.add(key);byValue.set(value,keys);
    if(privateKeys.has(key)&&value)privateValues.add(value);
  }
  const secrets=new Map(entries(secretBindings).map(([env,name])=>{
    const key=normalizeParameterKey(name,'t');
    if(typeof env!=='string'||!/^HELLOTEST[A-Z0-9_]*$/i.test(env)||!key)throw error('AUTOMATION_UPSTREAM_SECRET_BINDING_INVALID','Native secret bindings need an explicit environment key and scoped parameter reference.');
    return [env,key];
  }));
  // Native verification emits the real value, then its formatter redacts it
  // to this exact known marker. Recover the scoped binding only in the same
  // data-bearing AST positions as authored literals; never alter selectors.
  for(const [env,key]of secrets){
    const marker=`<secret>${env}</secret>`,keys=byValue.get(marker)||new Set();keys.add(key);byValue.set(marker,keys);
  }
  const candidates=[...byValue.keys()].filter(Boolean).sort((a,b)=>b.length-a.length||a.localeCompare(b));
  const safe=new Set(),safeEnvs=new Set(),edits=[],references=new Set(),bindings=new Map();
  const availableKeys=new Set([...entries(parameterValues).map(([key])=>normalizeParameterKey(key,'t')),...secrets.values()]);
  const playwrightNames=new Set(['page','playwrightPage']);
  const declarations=[];
  const discover=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier')declarations.push(node);
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(discover);else if(value&&typeof value==='object')discover(value);
  };
  discover(tree);
  for(let count=0;count<=declarations.length;count++){
    let changed=false;
    for(const node of declarations)if(playwrightNames.has(root(node.init))&&!playwrightNames.has(node.id.name)){playwrightNames.add(node.id.name);changed=true;}
    if(!changed)break;
  }
  const record=(key,kind,terminated=false)=>{
    const reference=terminated?`@${key.slice(0,2)}[${key.slice(2).replace(/\\/g,'\\\\').replace(/\]/g,'\\]')}]`:tokenFor(key);
    references.add(reference);bindings.set(`${kind}:${key}`,{parameter:key,reference,kind});return reference;
  };
  const unresolvedComposition=node=>{
    if(!node||typeof node!=='object')return false;
    if(node.type==='MemberExpression'&&node.object?.name==='params')return false;
    const value=node.type==='Literal'&&typeof node.value==='string'?node.value:node.type==='TemplateElement'?node.value.cooked:null;
    if(typeof value==='string'&&tokenRanges(value).length)return true;
    return Object.values(node).some(value=>Array.isArray(value)?value.some(unresolvedComposition):value&&typeof value==='object'&&unresolvedComposition(value));
  };
  const data=(node,depth=0)=>{
    if(!node)return;
    if(parameterExpressions&&depth>32)throw error('AUTOMATION_UPSTREAM_SOURCE_INVALID','Parameter data composition exceeds its supported depth.');
    if(string(node)!==null){safe.add(node.start);return;}
    // Mixed templates retain every expression. Only their literal fragments
    // are data, and empty separators do not represent authored blank inputs.
    if(node.type==='TemplateLiteral'){for(const quasi of node.quasis)if(quasi.value.cooked)safe.add(quasi.start);if(parameterExpressions)for(const expression of node.expressions)data(expression,depth+1);return;}
    if(parameterExpressions&&node.type==='BinaryExpression'&&node.operator==='+'){data(node.left,depth+1);data(node.right,depth+1);return;}
    if(parameterExpressions&&node.type==='MemberExpression'&&member(node.object)==='env'&&node.object.object?.name==='process'){safeEnvs.add(node.start);return;}
    if(node.type==='ArrayExpression')for(const child of node.elements)data(child,depth+1);
    if(node.type==='ObjectExpression')for(const property of node.properties)if(property.type==='Property')data(property.value,depth+1);
    if(parameterExpressions&&!['ArrayExpression','ObjectExpression'].includes(node.type)&&unresolvedComposition(node))throw error('AUTOMATION_UPSTREAM_PARAMETER_COMPOSITION_UNSUPPORTED','Computed data must use params members directly. Scoped token strings inside arbitrary expressions are not executable parameter bindings.');
  };
  const properties=(node,names)=>{
    if(node?.type!=='ObjectExpression')return;
    for(const property of node.properties)if(property.type==='Property'&&!property.computed&&names.includes(property.key.name??property.key.value))data(property.value);
  };
  const matcherArgument=new Set(['toHaveValue','toHaveValues','toHaveText','toContainText','toHaveURL','toHaveTitle','toEqual','toStrictEqual','toBe','toContain','toContainEqual','toMatchObject']);
  // A field's accessible name identifies the control, even when an authored
  // input happens to equal that label. Data-bearing option/row/record names
  // still bind independently from these static form-control labels.
  const fieldRoles=new Set(['textbox','searchbox','combobox','listbox','checkbox','radio','radiogroup','switch','slider','spinbutton','scrollbar','progressbar','meter']);
  const markCall=node=>{
    const method=member(node.callee),args=node.arguments;if(!method)return;
    const owner=node.callee.object;
    if(root(node.callee)!=='expect'&&!playwrightNames.has(root(node.callee)))return;
    if(['fill','type','pressSequentially','insertText',...(parameterExpressions?['press']:[])].includes(method)){
      // page.fill(selector, value) and locator.fill(value, options) have
      // different positions. A locator's options are never a string value.
      const direct=['page','playwrightPage'].includes(owner?.name)||args.length>=2&&(string(args[1])!==null||args[1]?.type==='TemplateLiteral');
      data(args[direct&&['fill','type','press'].includes(method)?1:0]);
    }else if(method==='selectOption'){
      const direct=['page','playwrightPage'].includes(owner?.name);
      const option=args[direct?1:0];
      if(option?.type==='ObjectExpression')properties(option,['label','value']);
      else if(option?.type==='ArrayExpression'){
        for(const item of option.elements)if(item?.type==='ObjectExpression')properties(item,['label','value']);else data(item);
      }else data(option);
    }else if(['goto','waitForURL','getByText'].includes(method))data(args[0]);
    else if(method==='getByRole'&&!fieldRoles.has(string(args[0])))properties(args[1],['name']);
    else if(method==='filter')properties(args[0],['hasText','hasNotText']);
    else if(root(node.callee)==='expect'){
      if(matcherArgument.has(method))data(args[0]);
      else if(['toHaveAttribute','toHaveCSS','toHaveJSProperty'].includes(method))data(args[1]);
    }
  };
  const visit=(node,parent)=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression')markCall(node);
    if(node.type==='MemberExpression'&&member(node.object)==='env'&&node.object.object?.name==='process'){
      const env=member(node);
      if(typeof env!=='string')throw error('AUTOMATION_UPSTREAM_SECRET_BINDING_INVALID','Native environment references must use an explicit configured key.');
      if(secrets.has(env)){
        if(parameterExpressions&&!safeEnvs.has(node.start))throw error('AUTOMATION_UPSTREAM_SECRET_BINDING_INVALID','Native secrets may bind only in executable data arguments.');
        if(parent?.type==='AssignmentExpression'&&parent.left===node||parent?.type==='UpdateExpression'||parent?.type==='UnaryExpression'&&parent.operator==='delete')throw error('AUTOMATION_UPSTREAM_SECRET_BINDING_INVALID','Native secret bindings are read-only parameter references.');
        const key=secrets.get(env);record(key,'secret');
        edits.push({start:node.start,end:node.end,replacement:parameterExpressions?`params[${JSON.stringify(key)}]`:JSON.stringify(tokenFor(key))});return;
      }
      if(/^HELLOTEST/i.test(env))throw error('AUTOMATION_UPSTREAM_SECRET_BINDING_MISSING','Native source uses a secret environment key without an exact parameter binding.');
    }
    for(const value of Object.values(node)){
      if(Array.isArray(value)){for(const child of value)visit(child,node);}
      else if(value&&typeof value==='object')visit(value,node);
    }
  };
  visit(tree,null);
  const expressionParts=text=>{
    const tokens=new Map([...text.matchAll(/(?<![A-Za-z0-9_])@[tsr]\.(?:\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi)].map(match=>[match.index,{text:match[0],key:normalizeParameterKey(match[0],'t')}]));
    const parts=[];let at=0,offset=0;
    const add=(key,length)=>{parts.push({literal:text.slice(offset,at)},{key});record(key,'literal');at+=length;offset=at;};
    while(at<text.length){
      const token=tokens.get(at),value=candidates.find(value=>text.startsWith(value,at)&&boundedMatch(text,value,at));
      // A native emitted literal is data first. An exact configured value may
      // itself look like @r.other; explicit params reads express that other key.
      if(value){const keys=byValue.get(value);if(keys.size!==1)throw error('AUTOMATION_UPSTREAM_PARAMETER_AMBIGUOUS','An authored data value matches multiple parameter references. Supply an exact binding before generating source.');add([...keys][0],value.length);continue;}
      if(token){if(!availableKeys.has(token.key))throw error('AUTOMATION_UPSTREAM_PARAMETER_MISSING','Executable data uses an unavailable scoped parameter. Use a configured params member or an authored literal value.');add(token.key,token.text.length);continue;}
      at++;
    }
    if(!text.length&&byValue.has('')){const keys=byValue.get('');if(keys.size!==1)throw error('AUTOMATION_UPSTREAM_PARAMETER_AMBIGUOUS','An empty authored data value matches multiple parameter references.');const key=[...keys][0];record(key,'literal');return [{key}];}
    if(!parts.length)return null;
    parts.push({literal:text.slice(offset)});return parts.filter(part=>part.key!==undefined||part.literal.length);
  };
  const parameterMember=key=>`params[${JSON.stringify(key)}]`;
  const mapText=(text,trailingExpression=false)=>{
    const ranges=tokenRanges(text),chunks=[];let offset=0,at=0;
    while(at<text.length){
      const range=ranges.find(([start,end])=>at>=start&&at<end);if(range){at=range[1];continue;}
      const value=candidates.find(value=>text.startsWith(value,at)&&boundedMatch(text,value,at)&&!ranges.some(([start,end])=>at<end&&at+value.length>start));
      if(!value){at++;continue;}
      const keys=byValue.get(value);
      if(keys.size!==1)throw error('AUTOMATION_UPSTREAM_PARAMETER_AMBIGUOUS','An authored data value matches multiple parameter references. Supply an exact binding before generating source.');
      const key=[...keys][0];chunks.push({literal:text.slice(offset,at)},{key});at+=value.length;offset=at;
    }
    if(!text.length&&byValue.has('')){
      const keys=byValue.get('');if(keys.size!==1)throw error('AUTOMATION_UPSTREAM_PARAMETER_AMBIGUOUS','An empty authored data value matches multiple parameter references.');
      return record([...keys][0],'literal');
    }
    if(!chunks.length)return text;
    chunks.push({literal:text.slice(offset)});
    return chunks.map((part,index)=>{
      if(part.key===undefined)return part.literal;
      const following=chunks.slice(index+1).find(next=>next.key!==undefined||next.literal.length);
      // A bare reference absorbs identifier suffixes, and would hide the next
      // adjacent @reference from the runtime grammar. Close its name explicitly.
      return record(part.key,'literal',following?.key!==undefined||/^[A-Za-z0-9_@-]/.test(following?.literal||'')||!following&&trailingExpression);
    }).join('');
  };
  const rewrite=node=>{
    if(!node||typeof node!=='object')return;
    const text=string(node);
    if(safe.has(node.start)&&text!==null){
      if(parameterExpressions){
        const parts=expressionParts(text);
        if(parts){const expressions=parts.map(part=>part.key!==undefined?parameterMember(part.key):JSON.stringify(part.literal));edits.push({start:node.start,end:node.end,replacement:expressions.length===1?expressions[0]:`(${expressions.join(' + ')})`});}
        return;
      }
      const replacement=mapText(text);if(replacement!==text)edits.push({start:node.start,end:node.end,replacement:JSON.stringify(replacement)});return;
    }
    if(node.type==='TemplateElement'&&safe.has(node.start)&&typeof node.value.cooked==='string'){
      if(parameterExpressions){
        const parts=expressionParts(node.value.cooked);
        if(parts)edits.push({start:node.start,end:node.end,replacement:parts.map(part=>part.key!==undefined?'${'+parameterMember(part.key)+'}':templateFragment(part.literal)).join('')});
        return;
      }
      const text=node.value.cooked,replacement=mapText(text,!node.tail);
      if(replacement!==text)edits.push({start:node.start,end:node.end,replacement:templateFragment(replacement)});
      return;
    }
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(rewrite);else if(value&&typeof value==='object')rewrite(value);
  };
  rewrite(tree);
  edits.sort((a,b)=>b.start-a.start);
  let output=source,lastStart=source.length;
  for(const edit of edits){
    if(edit.end>lastStart)throw error('AUTOMATION_UPSTREAM_SOURCE_BINDING_CONFLICT','Native source contains overlapping parameter binding positions.');
    output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);lastStart=edit.start;
  }
  // A private value outside a data-bearing literal is never copied into the
  // synthesis prompt. Labels, comments and computed source cannot be safely
  // reinterpreted as data, so require a corrected native binding instead.
  const comments=[];let result;
  try{result=parse(output,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true,onComment:comments});}catch{throw error('AUTOMATION_UPSTREAM_SOURCE_INVALID','Native parameter binding did not produce valid JavaScript.');}
  const privateText=text=>{
    const ranges=tokenRanges(text);
    for(const value of privateValues)for(let at=text.indexOf(value);at>=0;at=text.indexOf(value,at+value.length))if(boundedMatch(text,value,at)&&!ranges.some(([start,end])=>at<end&&at+value.length>start))throw error('AUTOMATION_UPSTREAM_PRIVATE_LITERAL','Native source contains private data outside an exact symbolic parameter binding.');
  };
  const inspect=(node,parent)=>{
    if(!node||typeof node!=='object')return;
    if(parent?.type==='MemberExpression'&&parent.property===node&&parent.object?.name==='params')return;
    if(node.type==='Literal'&&typeof node.value==='string')privateText(node.value);
    if(node.type==='TemplateElement')privateText(node.value.cooked??node.value.raw);
    for(const value of Object.values(node)){
      if(Array.isArray(value)){for(const child of value)inspect(child,node);}
      else if(value&&typeof value==='object')inspect(value,node);
    }
  };
  inspect(result);comments.forEach(comment=>privateText(comment.value));
  const marked=sourceComments.some(comment=>comment.type==='Line'&&source.slice(comment.start,comment.end).trimEnd()===PARAMETER_EXPRESSIONS_MARKER&&comment.end<=(tree.body[0]?.start??source.length));
  if(parameterExpressions&&!marked)output=PARAMETER_EXPRESSIONS_MARKER+'\n'+output;
  return {source:output,changed:output!==source,references:[...references],bindings:[...bindings.values()]};
}

/** A small capability boundary for synthesized native code. This is not a
 * locator/action DSL: normal Playwright statements and assertions stay native. */
function validateUpstreamSourceBoundary(source) {
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source,'utf8')>256*1024)throw error('AUTOMATION_UPSTREAM_SOURCE_INVALID','Upstream Playwright source must be bounded JavaScript.');
  let tree;try{tree=parseSource(source);}catch{throw error('AUTOMATION_UPSTREAM_SOURCE_INVALID','Upstream Playwright source contains invalid JavaScript.');}
  const globals=new Set(['fetch','require','process','eval','Function','globalThis','global','XMLHttpRequest','WebSocket','importScripts','browser','context']);
  const capabilities=new Set(['evaluate','evaluateHandle','addInitScript','addScriptTag','route','routeFromHAR','unroute','unrouteAll','request','context','browser','launch','launchPersistentContext','connect','connectOverCDP','newContext','newPage','fetch','require','eval']);
  const denied=name=>{throw error('AUTOMATION_UPSTREAM_SOURCE_CAPABILITY_DENIED',`Generated source cannot access ${name}; use the authorized native Playwright tools and supplied page.`);};
  const visit=(node,parent)=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='ImportExpression'||node.type==='ImportDeclaration')denied('module imports');
    if(node.type==='MemberExpression'&&capabilities.has(member(node)))denied(member(node));
    if(node.type==='Identifier'&&globals.has(node.name)){
      const property=parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed;
      const key=parent?.type==='Property'&&parent.key===node&&!parent.computed&&!parent.shorthand;
      if(!property&&!key)denied(node.name);
    }
    for(const value of Object.values(node)){
      if(Array.isArray(value)){for(const child of value)visit(child,node);}
      else if(value&&typeof value==='object')visit(value,node);
    }
  };
  visit(tree,null);return source;
}

module.exports={bindUpstreamSourceParameters,validateUpstreamSourceBoundary,selectUpstreamSourceParameterValues,PARAMETER_EXPRESSIONS_MARKER};
