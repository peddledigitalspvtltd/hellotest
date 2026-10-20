const {parse}=require('acorn');
const member=node=>node?.type==='MemberExpression'?(node.computed?node.property?.value:node.property?.name):null;
function visit(node,callback){if(!node||typeof node!=='object')return;callback(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(item=>visit(item,callback));else if(value&&typeof value==='object')visit(value,callback);}
function navigationOrigins(...sources){
 const origins=new Set(),seen=new Set();
 const add=value=>{try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)origins.add(url.origin);}catch{}};
 const scan=value=>{if(typeof value==='string'){add(value.trim());for(const match of value.matchAll(/https?:\/\/[^\s"'`<>\\)\]}]+/g))add(match[0].replace(/[.,;!?]+$/,''));}else if(value&&typeof value==='object'&&!seen.has(value)){if(value.type==='image')return;seen.add(value);if(Array.isArray(value))value.forEach(scan);else for(const [key,item]of Object.entries(value))if(key!=='screenshot_url'&&key!=='screen_screenshot_url')scan(item);}};
 sources.forEach(scan);return origins;
}
/** Repository evidence is reusable only when it belongs to the selected site. */
function scopeRepositoryToTarget(rows, startUrl) {
 const target=navigationOrigins(startUrl);
 if(!target.size)return rows;
 return rows.filter(row=>{
  const metadata=row.metadata||{};
  if(['android','ios','mobile'].includes(metadata.platform))return true;
  const origins=navigationOrigins(row.page_url,metadata.page_identity,metadata.url_pattern_value);
  return origins.size>0&&[...origins].every(origin=>target.has(origin));
 });
}
/** Reference documents, cached screens and old scripts cannot grant new targets. */
function buildNavigationOrigins({startUrl,additionalContext,observations=[]}){
 const origins=navigationOrigins(startUrl,additionalContext);
 for(const observation of observations){
  if(observation.result?.isError)continue;
  for(const item of observation.result?.content||[])if(item.type==='text')try{
   const payload=JSON.parse(item.text);
   for(const origin of navigationOrigins(payload.url))origins.add(origin);
  }catch{}
 }
 return origins;
}
/** Ground generated navigation without changing execution/MCP origin policy. */
function validateNavigationGrounding(source,knownOrigins,{parameters={},resolveText=value=>value}={}){
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});
 const constants=new Map();
 const literal=(node,seen=new Set())=>{
  if(node?.type==='Literal'&&typeof node.value==='string')return resolveText(node.value);
  if(node?.type==='MemberExpression'&&node.object?.name==='params'&&node.computed&&typeof node.property?.value==='string')return parameters[String(node.property.value).replace(/^@/,'').toLowerCase()]??null;
  if(node?.type==='Identifier'&&constants.has(node.name)&&!seen.has(node.name)){seen.add(node.name);return literal(constants.get(node.name),seen);}
  if(node?.type==='TemplateLiteral'){
   const values=node.expressions.map(value=>literal(value,new Set(seen)));
   if(values.some(value=>value===null))return null;
   return node.quasis.map((part,index)=>resolveText(part.value.cooked)+(index<values.length?values[index]:'')).join('');
  }
  if(node?.type==='BinaryExpression'&&node.operator==='+'){const left=literal(node.left,new Set(seen)),right=literal(node.right,new Set(seen));return left!==null&&right!==null?left+right:null;}
  return null;
 };
 visit(tree,node=>{if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')constants.set(node.id.name,node.init);});
 visit(tree,node=>{
  if(node.type!=='CallExpression'||!['page','playwrightPage','web'].includes(node.callee?.object?.name)||!['goto','openTab'].includes(member(node.callee)))return;
  const target=literal(node.arguments[0]);if(!target||/@(?:t|c|e|r|s|p)\.|\$\{/.test(target))return;
  let url;try{url=new URL(target);}catch{return;}
  if(!['http:','https:'].includes(url.protocol))return;
  if(!knownOrigins.has(url.origin))throw Object.assign(new Error(`Generated navigation to ${url.origin} has no supplied or observed URL evidence. Use a configured source/parameter reference or report the missing external dependency; do not invent an application or mailbox URL.`),{code:'AUTOMATION_UNGROUNDED_NAVIGATION'});
 });
}
module.exports={navigationOrigins,validateNavigationGrounding,scopeRepositoryToTarget,buildNavigationOrigins};
