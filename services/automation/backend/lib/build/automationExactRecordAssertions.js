const {parse}=require('acorn');

const member=node=>node?.type==='MemberExpression'?(node.computed?node.property?.value:node.property?.name):null;
const root=node=>node?.type==='Identifier'?node.name:node?.type==='CallExpression'?root(node.callee):node?.type==='MemberExpression'?root(node.object):null;
function walk(node,visit){
 if(!node||typeof node!=='object')return;
 visit(node);
 for(const value of Object.values(node))if(Array.isArray(value))value.forEach(item=>walk(item,visit));else if(value&&typeof value==='object')walk(value,visit);
}

/** A generated exact record check must not hide ambiguous matches by indexing.
 * This is source feedback only; it does not discover targets or execute actions. */
function assertExactRecordAssertions(source,step){
 const expected=String(step?.expected_result||'');
 const tree=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}),declarations=new Map();
 walk(tree,node=>{
  if(node.type!=='CallExpression'||member(node.callee)!=='getByRole')return;
  const misplaced=(node.arguments?.[1]?.properties||[]).find(property=>['has','hasNot','hasText','hasNotText'].includes(property.key?.name||property.key?.value));
  if(misplaced)throw Object.assign(new Error('getByRole() does not support has/hasNot/hasText/hasNotText options; Playwright can silently ignore them and select every row. Use getByRole("row").filter({ hasText: fullParameterizedIdentity }), then exact named cells within that filtered row. Keep native mutations unchanged and correct source only without replaying browser actions.'),{code:'AUTOMATION_UPSTREAM_LOCATOR_OPTION_INVALID',statusCode:422,nonRetryable:true});
 });
 const references=new Set(expected.match(/@[A-Za-z][\w-]*\.[A-Za-z][\w.-]*/g)||[]);
 if(!/\bexact\s+(?:name|record|row|item)\b/i.test(expected)||references.size<2)return;
 walk(tree,node=>{if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier'&&node.init)declarations.set(node.id.name,node.init);});
 const contains=(node,predicate,seen=new Set())=>{
  let found=false;
  walk(node,child=>{
   if(predicate(child))found=true;
   if(child.type==='Identifier'&&declarations.has(child.name)&&!seen.has(child.name)){
    const next=new Set(seen);next.add(child.name);if(contains(declarations.get(child.name),predicate,next))found=true;
   }
  });
  return found;
 };
 walk(tree,node=>{
  if(node.type!=='CallExpression'||root(node.callee)!=='expect'||!/^to[A-Z]/.test(member(node.callee)||''))return;
  const indexed=contains(node,child=>child.type==='CallExpression'&&['first','last','nth'].includes(member(child.callee)));
  const partial=contains(node,child=>{
   if(child.type!=='CallExpression'||member(child.callee)!=='getByRole'||!['cell','link','row','listitem','option'].includes(child.arguments?.[0]?.value))return false;
   const properties=child.arguments?.[1]?.properties||[],name=properties.find(property=>(property.key?.name||property.key?.value)==='name');
   if(!name||name.value?.regex&&name.value.regex.pattern.startsWith('^')&&name.value.regex.pattern.endsWith('$'))return false;
   return !properties.some(property=>(property.key?.name||property.key?.value)==='exact'&&property.value?.value===true);
  });
  if(indexed||partial)throw Object.assign(new Error('An exact named-record expectation needs exact:true on named record/metadata role locators, or an anchored exact-name regular expression. Partial cell names can also match the record-name cell. Do not use .first(), .last() or .nth() to hide ambiguity. Preserve all native mutations exactly once and in order. Replace native intermediate assertions with final-result checks after the final action. Select the unique row using its full parameterized identity, then assert type and status within that same row. Correct source only, without replaying browser actions.'),{code:'AUTOMATION_UPSTREAM_EXACT_RECORD_ASSERTION',statusCode:422,nonRetryable:true});
 });
}
module.exports={assertExactRecordAssertions};
