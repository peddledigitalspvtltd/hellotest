const {normalizeParameterKey} = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {tokenFor} = require('@hellotest/platform/backend/src/utils/parameterNames');
const {parameterTemplateParts} = require("../parameters/automationParameterTemplates");
const {parseNativeSourceAliases}=require("./automationUpstreamSourceAliases");

function authoredInputValueReferences(action){
 const command=/^(?:(?:given|when|then|and|i|the user|user)\s+)*(fill|type|enter)\b\s*([\s\S]*)$/i.exec(action);
 if(!command)return [];
 // These explicit prose forms identify which references are written values:
 // Fill <target> with <value>, or Type/Enter <value> into/in/to <target>.
 // Unknown phrasing retains all references instead of guessing a value role.
 const clauses=(`${command[1]} ${command[2]}`).split(/(?:[.;]|\b(?:and(?:\s+then)?|then))\s+(?=(?:(?:i|the user|user)\s+)?(?:fill|type|enter)\b)/i);
 const required=new Set();
 const valuesBeforeTargets=text=>{
  // Keep reference spans opaque while locating prose separators. A repeated
  // pair starts after a conjunction/comma in the preceding target phrase;
  // its complete value phrase can itself contain several references.
  const parts=parameterTemplateParts(text),prose=parts?parts.map(part=>part.key?'x'.repeat(part.reference.length):part.literal).join(''):text;
  const targets=[...prose.matchAll(/\s+(?:into|in|to|onto)\s+/gi)];
  if(!targets.length)return [text];
  const values=[text.slice(0,targets[0].index)];
  for(let index=1;index<targets.length;index++){
   const start=targets[index-1].index+targets[index-1][0].length,between=prose.slice(start,targets[index].index);
   const separator=/\s+(?:and(?:\s+then)?|then)\s+|,\s*/i.exec(between);
   if(!separator)return [text]; // Unknown prose retains every reference.
   values.push(text.slice(start+separator.index+separator[0].length,targets[index].index));
  }
  const tailStart=targets.at(-1).index+targets.at(-1)[0].length,tail=text.slice(tailStart);
  const unpaired=/\s+(?:and(?:\s+then)?|then)\s+|,\s*/i.exec(prose.slice(tailStart));
  if(unpaired&&parameterTemplateParts(tail.slice(unpaired.index+unpaired[0].length)))return [text];
  return values;
 };
 for(const clause of clauses){
  const write=/^(?:(?:i|the user|user)\s+)*(fill|type|enter)\b\s*([\s\S]*)$/i.exec(clause);
  if(!write)continue;
  let value=write[2].split(/\s+(?:and(?:\s+then)?|then)\s+(?:click|tap|press|select|verify|assert|check|inspect|open|navigate)\b/i)[0];
  const withValue=/\s+with\s+([\s\S]*)$/i.exec(value);
  const values=write[1].toLowerCase()==='fill'&&withValue?[withValue[1]]:valuesBeforeTargets(value);
  for(const input of values)for(const part of parameterTemplateParts(input)||[])if(part.key)required.add(part.key);
 }
 return [...required];
}

function authoredOptionValueReferences(action){
 const command=/^(?:(?:given|when|then|and|i|the user|user)\s+)*(?:select|choose)\s+([\s\S]+)$/i.exec(action);
 if(!command)return [];
 const parts=parameterTemplateParts(command[1]);
 if(!parts)return [];
 // Keep the parameter syntax opaque while identifying the option/control
 // separator. A label parameter to its right identifies a control, not data.
 const prose=parts.map(part=>part.key?'x'.repeat(part.reference.length):part.literal).join('');
 const separator=/\s+(?:from|in|on|for)\s+[^,;.]*\b(?:drop[ -]?down|combo[ -]?box|select field|list[ -]?box)\b/i.exec(prose);
 if(!separator)return [];
 return [...new Set((parameterTemplateParts(command[1].slice(0,separator.index))||[]).flatMap(part=>part.key?[part.key]:[]))];
}

/** Prove explicit, parameterized text/option writes from unconditional
 * awaited native Playwright statements. Assertions cannot establish writes. */
function auditAuthoredInputWrites({step = {}, source = ';'} = {}) {
  const action = String(step.action || '').replace(/<[^>]*>/g, ' ').trim();
 const textReferences = authoredInputValueReferences(action);
 const optionReferences = authoredOptionValueReferences(action);
 const result = {
  required_parameter_references: [...textReferences, ...optionReferences].map(tokenFor),
  missing_parameter_references: [], text_write_count: 0, option_write_count: 0
 };
 if (!result.required_parameter_references.length) return result;
  const tree = parseNativeSourceAliases(source);
  const member = node => node?.type === 'MemberExpression' ? node.computed ? node.property?.value : node.property?.name : null;
  const root = node => node?.type === 'Identifier' ? node.name : node?.type === 'CallExpression' ? root(node.callee)
    : node?.type === 'MemberExpression' ? root(node.object) : null;
  const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  };
  const playwrightNames = new Set(['page', 'playwrightPage']);
  const declarations = tree.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  for (let pass = 0; pass < declarations.length + 1; pass++) {
    for (const declaration of declarations) if (declaration.id?.type === 'Identifier' && playwrightNames.has(root(declaration.init))) playwrightNames.add(declaration.id.name);
  }
 const textMethods = new Set(['fill', 'type', 'pressSequentially', 'insertText']);
 const choiceName = locator => {
  if (locator?.type !== 'CallExpression') return null;
  if (member(locator.callee) === 'getByRole' && locator.arguments[0]?.value === 'option') {
   return locator.arguments[1]?.properties?.find(property => !property.computed && (property.key?.name ?? property.key?.value) === 'name')?.value;
  }
  return choiceName(locator.callee.object);
 };
 const writeType = node => {
  if (node?.type !== 'CallExpression' || !playwrightNames.has(root(node.callee))) return null;
  const method = member(node.callee);
  if (textMethods.has(method)) return 'text';
  if (method === 'selectOption' || method === 'click' && choiceName(node.callee.object)) return 'option';
  return null;
 };
  // Count every emitted write, including an unsupported conditional/computed
  // shape. Missing proof after any such write must stop instead of replaying it.
 walk(tree, node => {
  const type = writeType(node);
  if (type) result[`${type}_write_count`]++;
 });
 const written = {text:new Set(),option:new Set()};
 const optionValues = value => {
  if(value?.type==='ArrayExpression')return value.elements.flatMap(optionValues);
  if(value?.type==='ObjectExpression')return value.properties.filter(property=>!property.computed&&['label','value'].includes(property.key?.name??property.key?.value)).map(property=>property.value);
  return [value];
 };
  for (const statement of tree.body) {
    const call = statement.type === 'ExpressionStatement' && statement.expression?.type === 'AwaitExpression' ? statement.expression.argument : null;
    const type = writeType(call);
    if (!type) continue;
    const method = member(call.callee);
    const direct = ['page', 'playwrightPage'].includes(call.callee.object?.name) && ['fill', 'type', 'selectOption'].includes(method);
    const value = method === 'click' ? choiceName(call.callee.object) : call.arguments[direct ? 1 : 0];
    for(const input of type==='option'?optionValues(value):[value])walk(input, node => {
      if (node.type === 'Literal' && typeof node.value === 'string') for (const part of parameterTemplateParts(node.value) || []) if (part.key) written[type].add(part.key);
      if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' && node.object.name === 'params') {
        const key = normalizeParameterKey(node.computed ? node.property?.value : node.property?.name, 't');
        if (key) written[type].add(key);
      }
    });
  }
 result.missing_parameter_references = [
  ...textReferences.filter(key => !written.text.has(key)),
  ...optionReferences.filter(key => !written.option.has(key))
 ].map(tokenFor);
 if(optionReferences.length)result.input_kind='option';
  return result;
}

module.exports = {auditAuthoredInputWrites,authoredInputValueReferences,authoredOptionValueReferences};
