const {parse}=require('acorn');

const locatorMethods=new Set(['locator','frameLocator','getByRole','getByLabel','getByText','getByPlaceholder','getByTitle','getByAltText','getByTestId','filter','first','last','nth']);
const actionMethods=new Set(['goto','goBack','click','dblclick','fill','type','press','pressSequentially','insertText','selectOption','check','uncheck','setChecked','hover','dragTo','accept','dismiss','switchTab','openTab','closeTab','close']);
const readMethods=new Set(['waitFor','waitForURL','waitForLoadState','textContent','innerText','inputValue','getAttribute','count','isVisible','isHidden','isEnabled','isDisabled','isChecked','title','url']);
const reserved=new Set(['page','playwrightPage','params','web','expect','undefined','String','Number','Boolean']);
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const member=node=>node?.type==='MemberExpression'?(node.computed?node.property?.value:node.property?.name):null;
const root=node=>node?.type==='Identifier'?node.name:node?.type==='MemberExpression'?root(node.object):node?.type==='CallExpression'?root(node.callee):null;
const nativeCall=(node,known,unsafe)=>{
 const origin=root(node.callee);
 if(unsafe?.has(origin))return false;
 return origin==='expect'||(['page','playwrightPage','web'].includes(origin)||known?.has(origin))
  &&(locatorMethods.has(member(node.callee))||actionMethods.has(member(node.callee))||readMethods.has(member(node.callee)));
};
const walk=(node,visit,parent)=>{
 if(!node||typeof node!=='object')return;
 visit(node,parent);
 for(const value of Object.values(node))if(Array.isArray(value))value.forEach(child=>walk(child,visit,node));else if(value&&typeof value==='object')walk(value,visit,node);
};
const names=(node,visit)=>{
 if(!node)return;
 if(node.type==='Identifier')visit(node.name);
 else if(node.type==='RestElement')names(node.argument,visit);
 else if(node.type==='AssignmentPattern')names(node.left,visit);
 else if(node.type==='ArrayPattern')node.elements.forEach(child=>names(child,visit));
 else if(node.type==='ObjectPattern')node.properties.forEach(property=>names(property.type==='RestElement'?property.argument:property.value,visit));
};
const writtenRoots=(node,visit)=>{
 if(!node)return;
 if(node.type==='Identifier'||node.type==='MemberExpression'){const name=root(node);if(name)visit(name);}
 else if(node.type==='RestElement')writtenRoots(node.argument,visit);
 else if(node.type==='AssignmentPattern')writtenRoots(node.left,visit);
 else if(node.type==='ArrayPattern')node.elements.forEach(child=>writtenRoots(child,visit));
 else if(node.type==='ObjectPattern')node.properties.forEach(property=>writtenRoots(property.type==='RestElement'?property.argument:property.value,visit));
};

/** Expand only immutable, earlier top-level scalar/page/locator aliases for
 * static proof. Source is never rewritten or executed. Objects, callbacks,
 * mutable/shadowed/escaped bindings and aliases across a tab change retain
 * their original AST and therefore cannot acquire native action authority. */
function parseNativeSourceAliases(source){
 const tree=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true});
 const counts=new Map(),candidates=new Map(),unsafe=new Set();
 const bind=name=>counts.set(name,(counts.get(name)||0)+1);
 walk(tree,node=>{
  if(node.type==='VariableDeclarator')names(node.id,bind);
  if(functions.has(node.type)){if(node.id)bind(node.id.name);node.params.forEach(parameter=>names(parameter,bind));}
  if(node.type==='ClassDeclaration'&&node.id)bind(node.id.name);
  if(node.type==='CatchClause')names(node.param,bind);
  if(node.type==='AssignmentExpression'||node.type==='UpdateExpression'||node.type==='UnaryExpression'&&node.operator==='delete'){
   const target=node.type==='AssignmentExpression'?node.left:node.argument;
   writtenRoots(target,name=>unsafe.add(name));
  }
 });
 for(const statement of tree.body)if(statement.type==='VariableDeclaration'&&statement.kind==='const')for(const declaration of statement.declarations){
  if(declaration.id.type==='Identifier'&&!reserved.has(declaration.id.name)&&counts.get(declaration.id.name)===1)candidates.set(declaration.id.name,declaration.init);
 }
 for(const name of ['page','playwrightPage','params','expect','web'])if(counts.has(name))unsafe.add(name);
 const candidateNames=new Set(candidates.keys());
 // Passing a locator to an unknown helper can mutate the locator object. Do
 // not prove equivalence through an alias that escaped the native grammar.
 walk(tree,(node,parent)=>{
  if(node.type==='Identifier'&&node.name==='params'&&!(parent?.type==='MemberExpression'&&(parent.object===node||parent.property===node&&!parent.computed))
   &&!(parent?.type==='Property'&&parent.key===node&&!parent.computed&&!parent.shorthand))unsafe.add('params');
  if(node.type==='VariableDeclarator'&&!candidates.has(node.id?.name)||node.type==='AssignmentExpression'){
   walk(node.type==='VariableDeclarator'?node.init:node.right,child=>{if(child.type==='Identifier'&&candidates.has(child.name))unsafe.add(child.name);});
  }
  if(node.type==='ReturnStatement'&&node.argument?.type==='Identifier'&&candidates.has(node.argument.name))unsafe.add(node.argument.name);
  if(node.type==='ArrowFunctionExpression'&&node.body?.type==='Identifier'&&candidates.has(node.body.name))unsafe.add(node.body.name);
  if(node.type!=='CallExpression')return;
  const origin=root(node.callee);
  if(nativeCall(node,candidateNames,unsafe))return;
  node.arguments.forEach(argument=>walk(argument,(child,parent)=>{
   if(child.type==='Identifier'&&candidates.has(child.name)&&!(parent?.type==='MemberExpression'&&parent.property===child&&!parent.computed))unsafe.add(child.name);
  }));
  if(candidates.has(origin))unsafe.add(origin);
 });
 // If an escaped alias points to another alias, both refer to the same native
 // object. Neither may be expanded after that escape or a member assignment.
 let changed=true;
 while(changed){changed=false;for(const name of [...unsafe])walk(candidates.get(name),node=>{
  if(node.type==='Identifier'&&(candidates.has(node.name)||['page','playwrightPage','params'].includes(node.name))&&!unsafe.has(node.name)){unsafe.add(node.name);changed=true;}
 });}
 const aliases=new Map();let remaining=50000;
 const resolve=(node,budget={remaining:2000})=>{
  if(!node||--budget.remaining<0)return null;
  if(node.type==='Identifier'){
   if(['page','playwrightPage'].includes(node.name)&&!unsafe.has(node.name))return {node,kind:'page'};
   const alias=aliases.get(node.name);
   if(!alias||unsafe.has(node.name)||(budget.remaining-=alias.size)<0)return null;
   return alias;
  }
  if(node.type==='Literal'&&node.regex)return {node,kind:'options'};
  if(node.type==='Literal'&&[null,'string','number','boolean','bigint'].includes(node.value===null?null:typeof node.value))return {node,kind:'value'};
  if(node.type==='MemberExpression'&&!node.optional&&node.computed&&node.object?.name==='params'&&!unsafe.has('params')&&node.property?.type==='Literal'&&typeof node.property.value==='string')return {node,kind:'value'};
  const children=(items,allowLocator=false)=>{
   const resolved=items.map(item=>resolve(item,budget));
   return resolved.every(item=>item&&(item.kind==='value'||allowLocator&&['locator','page'].includes(item.kind)))?resolved.map(item=>item.node):null;
  };
  if(node.type==='TemplateLiteral'){
   const expressions=children(node.expressions);return expressions?{node:{...node,expressions},kind:'value'}:null;
  }
  if(node.type==='UnaryExpression'&&['!','+','-','~'].includes(node.operator)){
   const argument=resolve(node.argument,budget);return argument?.kind==='value'?{node:{...node,argument:argument.node},kind:'value'}:null;
  }
  if(node.type==='BinaryExpression'&&node.operator==='+'){
   const values=children([node.left,node.right]);return values?{node:{...node,left:values[0],right:values[1]},kind:'value'}:null;
  }
  // Inline locator options may contain another observed locator (filter.has),
  // but mutable object/array declarations are never registered as aliases.
  if(node.type==='ArrayExpression'){
   const elements=children(node.elements);return elements?{node:{...node,elements},kind:'options'}:null;
  }
  if(node.type==='ObjectExpression'){
   const properties=[];
   for(const property of node.properties){
    if(property.type!=='Property'||property.kind!=='init'||property.computed||property.method)return null;
    const value=resolve(property.value,budget);if(!value||!['value','locator','options'].includes(value.kind))return null;
    properties.push({...property,value:value.node,shorthand:false});
   }
   return {node:{...node,properties},kind:'options'};
  }
  if(node.type==='CallExpression'&&!node.optional&&node.callee.type==='MemberExpression'&&!node.callee.computed&&!node.callee.optional&&locatorMethods.has(member(node.callee))){
   const owner=resolve(node.callee.object,budget),args=node.arguments.map(argument=>resolve(argument,budget));
   if(!owner||!['page','locator'].includes(owner.kind)||args.some(argument=>!argument||!['value','locator','options'].includes(argument.kind)))return null;
   return {node:{...node,callee:{...node.callee,object:owner.node},arguments:args.map(argument=>argument.node)},kind:'locator'};
  }
  return null;
 };
 const expand=(node,parent,key)=>{
  if(!node||typeof node!=='object'||functions.has(node.type))return node;
  if(node.type==='Identifier'&&aliases.has(node.name)&&!unsafe.has(node.name)){
   const binding=parent?.type==='VariableDeclarator'&&key==='id';
   const property=parent?.type==='MemberExpression'&&key==='property'&&!parent.computed||parent?.type==='Property'&&key==='key'&&!parent.computed;
   const alias=aliases.get(node.name);
   if(!binding&&!property&&remaining>=alias.size){remaining-=alias.size;return alias.node;}
  }
  const result={...node};
  for(const [field,value]of Object.entries(node))if(Array.isArray(value))result[field]=value.map(child=>expand(child,node,field));else if(value&&typeof value==='object')result[field]=expand(value,node,field);
  if(result.type==='Property'&&result.shorthand&&result.value!==node.value)result.shorthand=false;
  return result;
 };
 const opaque=node=>{
  const known=new Set([...aliases].filter(([,alias])=>['page','locator'].includes(alias.kind)).map(([name])=>name));let found=false;
  walk(node,child=>{if(child.type==='CallExpression'&&!nativeCall(child,known,unsafe))found=true;});return found;
 };
 const body=[];
 for(const statement of tree.body){
  // An opaque helper can change params or the active page. Only statements in
  // the native grammar can preserve an earlier alias's runtime meaning.
  if(statement.type==='VariableDeclaration'){
   const declarations=[];
   for(const declaration of statement.declarations){
    if(opaque(declaration.init))aliases.clear();
    const init=expand(declaration.init),resolved=resolve(declaration.init);
    declarations.push({...declaration,init});
    if(candidates.has(declaration.id.name)&&!unsafe.has(declaration.id.name)&&resolved&&['value','page','locator'].includes(resolved.kind)){
     let size=0;walk(resolved.node,()=>size++);if(size<=2000)aliases.set(declaration.id.name,{...resolved,size});
    }
   }
   body.push({...statement,declarations});
  }else{
   if(opaque(statement))aliases.clear();
   body.push(statement.type==='ExpressionStatement'?expand(statement):statement);
  }
  let switched=false;walk(statement,node=>{if(node.type==='CallExpression'&&['switchTab','openTab','closeTab','close'].includes(member(node.callee)))switched=true;});
  if(switched)for(const [name,alias]of aliases)if(alias.kind!=='value')aliases.delete(name);
 }
 return {...tree,body};
}

module.exports={parseNativeSourceAliases,nativeActionMethods:actionMethods};
