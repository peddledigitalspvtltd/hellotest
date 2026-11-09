const {parse}=require('acorn');
const {normalizeParameterKey}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {tokenFor}=require('@hellotest/platform/backend/src/utils/parameterNames');

const referencesIn=text=>[...text.matchAll(/(?<![A-Za-z0-9_])@(?:(?:t|s|r)\.)?(?:\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi)].filter(match=>!/^@[tsr]$/i.test(match[0])||text[match.index+match[0].length]!=='.').map(match=>match[0]);
const scopeError=()=>Object.assign(new Error('This private binding is not authorized by the current authored section. Use only its supplied private_parameter_tokens.'),{code:'AUTOMATION_UPSTREAM_PRIVATE_BINDING_SCOPE',statusCode:422,nonRetryable:true});
const staticString=node=>{
 if(node?.type==='Literal'&&typeof node.value==='string')return node.value;
 if(node?.type==='BinaryExpression'&&node.operator==='+'){
  const left=staticString(node.left),right=staticString(node.right);return left!==null&&right!==null?left+right:null;
 }
 if(node?.type==='TemplateLiteral'){
  const expressions=node.expressions.map(staticString);if(expressions.some(value=>value===null))return null;
  return node.quasis.map((part,index)=>(part.value.cooked??part.value.raw)+(expressions[index]??'')).join('');
 }
 return null;
};

/** Authored references authorize private data use, independently of observed
 * locators. All secrets remain in the native runtime for redaction; this view
 * exposes only the current section's opaque bindings, without secret values. */
function createUpstreamPrivateBindingScope({step={},bindings={}}={}){
 const restricted=Object.hasOwn(step,'parameter_references');
 if(restricted&&!Array.isArray(step.parameter_references))throw scopeError();
 const allowed=new Set((step.parameter_references||[]).map(key=>normalizeParameterKey(key,'t')).filter(Boolean));
 const secrets=bindings.secrets||{},allReferences=bindings.references||{},allSecretBindings=bindings.secretBindings||{};
 const envKeys=new Map(Object.entries(allSecretBindings).map(([env,key])=>[env,normalizeParameterKey(key,'t')]));
 for(const [reference,env]of Object.entries(allReferences))if(!envKeys.has(env))envKeys.set(env,normalizeParameterKey(reference,'t'));
 const privateKeys=new Set([...envKeys.values()].filter(Boolean));
 const permitted=key=>!restricted||allowed.has(key);
 const denied=new Set([...privateKeys].filter(key=>!permitted(key)));
 const permittedValues=new Set([...envKeys].filter(([,key])=>permitted(key)).map(([env])=>secrets[env]).filter(value=>typeof value==='string'&&value!==''));
 const references=Object.fromEntries(Object.entries(allReferences).filter(([reference,env])=>permitted(envKeys.get(env)||normalizeParameterKey(reference,'t'))));
 const secretBindings=Object.fromEntries(Object.entries(allSecretBindings).filter(([,key])=>permitted(normalizeParameterKey(key,'t'))));
 const parameterValues=Object.fromEntries(Object.entries(bindings.parameterValues||{}).flatMap(([key,value])=>{
  const normalized=normalizeParameterKey(key,'t');
  if(!privateKeys.has(normalized))return [[key,value]];
  // A reviewed blank is safe; nonblank private values never enter model input.
  return permitted(normalized)?[[key,value===''?'':tokenFor(normalized)]]:[];
 }));
 const availability=Object.fromEntries([...envKeys].filter(([,key])=>permitted(key)).map(([env,key])=>[tokenFor(key),Object.hasOwn(secrets,env)?secrets[env]===''?'reviewed_blank':'configured':'unavailable']));
 const assertText=text=>{
  if(!restricted||!denied.size||typeof text!=='string')return;
  if(referencesIn(text).some(reference=>{
   const key=normalizeParameterKey(reference,'r');
   return denied.has(key)||!/^@[tsr]\./i.test(reference)&&[...denied].some(name=>name.slice(2)===key.slice(2));
  }))throw scopeError();
  for(const match of text.matchAll(/\bparams\s*\[\s*(["'])(?:\\.|[^\\\r\n])*?\1\s*\]/g)){
   let expression;try{expression=parse(match[0],{ecmaVersion:'latest'}).body[0]?.expression;}catch{continue;}
   const key=staticString(expression?.property);if(key!==null&&denied.has(normalizeParameterKey(key,'t')))throw scopeError();
  }
  if(/^(?:@?[tsr]\.)/i.test(text)&&denied.has(normalizeParameterKey(text,'t')))throw scopeError();
  for(const [env,key]of envKeys)if(denied.has(key)&&(text.includes(env)||typeof secrets[env]==='string'&&secrets[env]!==''&&text===secrets[env]&&!permittedValues.has(text)))throw scopeError();
 };
 const assertArguments=value=>{
  if(!restricted||!denied.size)return;
  if(typeof value==='string')assertText(value);
  else if(Array.isArray(value))value.forEach(assertArguments);
  else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assertText(key);assertArguments(item);}
 };
 const assertSource=source=>{
  if(!restricted||!denied.size||typeof source!=='string')return;
  if(Buffer.byteLength(source)>256*1024)throw Object.assign(new Error('Upstream Playwright source must be bounded JavaScript.'),{code:'AUTOMATION_UPSTREAM_SOURCE_INVALID',statusCode:422});
  const comments=[];
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true,onComment:comments});
  const visit=(node,parent)=>{
   if(!node||typeof node!=='object')return;
   const text=staticString(node);if(text!==null)assertText(text);
   if(node.type==='TemplateElement')assertText(node.value.cooked??node.value.raw);
   if(node.type==='MemberExpression'&&node.object?.type==='Identifier'&&node.object.name==='params'){
    const key=node.computed?staticString(node.property):node.property.name;
    // An unknown lookup or escaped params object could select any private key.
    if(key===null||denied.has(normalizeParameterKey(key,'t')))throw scopeError();
   }
   if(node.type==='MemberExpression'&&node.object?.type==='MemberExpression'&&node.object.object?.name==='process'){
    const objectKey=node.object.computed?staticString(node.object.property):node.object.property.name;
    if(objectKey==='env'){
     const env=node.computed?staticString(node.property):node.property.name;
     if(env===null||denied.has(envKeys.get(env)))throw scopeError();
    }
   }
   if(node.type==='Identifier'&&node.name==='params'&&!(parent?.type==='MemberExpression'&&parent.object===node))throw scopeError();
   for(const value of Object.values(node)){
    if(Array.isArray(value))for(const child of value)visit(child,node);
    else if(value&&typeof value==='object')visit(value,node);
   }
  };
  visit(tree);comments.forEach(comment=>assertText(comment.value));
 };
 return {restricted,allowed,privateKeys,references,secretBindings,parameterValues,availability,assertArguments,assertSource};
}

module.exports={createUpstreamPrivateBindingScope};
