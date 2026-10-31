import ts from 'typescript';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const constants=require('../../services/platform/backend/src/domain/catalog.js');
const schemas={};
function literal(node,bindings={}){
 if(!node)return undefined;
 if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
 if(ts.isNumericLiteral(node))return Number(node.text);
 if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
 if(node.kind===ts.SyntaxKind.NullKeyword)return null;
 if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.MinusToken&&ts.isNumericLiteral(node.operand))return -Number(node.operand.text);
 if(ts.isTemplateExpression(node)){
  let value=node.head.text;
  for(const span of node.templateSpans){const part=literal(span.expression,bindings);if(typeof part!=='string'&&typeof part!=='number')return undefined;value+=String(part)+span.literal.text;}
  return value;
 }
 if(ts.isArrayLiteralExpression(node)){const values=node.elements.map(item=>literal(item,bindings));return values.some(item=>item===undefined)?undefined:values;}
 if(ts.isObjectLiteralExpression(node)){
  const value={};
  for(const property of node.properties){
   if(ts.isSpreadAssignment(property)){const spread=literal(property.expression,bindings);if(spread&&typeof spread==='object'&&!Array.isArray(spread))Object.assign(value,spread);}
   else if(ts.isPropertyAssignment(property)){const item=literal(property.initializer,bindings);if(item!==undefined)value[property.name.text]=item;}
   else if(ts.isShorthandPropertyAssignment(property)){const item=literal(property.name,bindings);if(item!==undefined)value[property.name.text]=item;}
  }
  return value;
 }
 if(ts.isPropertyAccessExpression(node)){const value=literal(node.expression,bindings);return value&&typeof value==='object'&&Object.hasOwn(value,node.name.text)?value[node.name.text]:undefined;}
 if(ts.isIdentifier(node))return Object.hasOwn(bindings,node.text)?bindings[node.text]:constants[node.text];
}
function rulesSchema(rules){const properties={},required=[];for(const [name,rule] of Object.entries(rules||{})){
 if(!rule||typeof rule!=='object')continue;
 const field={};if(rule.type)field.type=rule.type==='number'?'number':rule.type;
 for(const key of ['minLength','maxLength','minItems','minimum','maximum','enum'])if(rule[key]!==undefined)field[key]=rule[key];
 if(rule.items)field.items=typeof rule.items==='string'?{type:rule.items}:rule.items;
 if(rule.maxItems||rule.maxItem)field.maxItems=rule.maxItems||rule.maxItem;
 properties[name]=field;if(rule.required)required.push(name);
}return {type:'object',properties,...(required.length?{required}:{}),additionalProperties:true};}
function validationTarget(node){
 if(!node)return null;
 if(ts.isParenthesizedExpression(node))return validationTarget(node.expression);
 if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind))return validationTarget(node.left);
 // A nested req.body.smart_plan schema describes that object, not the route's
 // whole request body. It must not replace the ordinary execution contract.
 if(ts.isPropertyAccessExpression(node)&&['body','query'].includes(node.name.text))return node.name.text==='body'?'body':'querystring';
 return null;
}
function walk(node,file,bindings={},helpers=new Map(),stack=new Set()){
 if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&helpers.has(node.expression.text)&&!stack.has(node.expression.text)){
  const helper=helpers.get(node.expression.text),values={...bindings};
  helper.parameters.forEach((parameter,index)=>{if(ts.isIdentifier(parameter.name)){const value=literal(node.arguments[index],bindings);if(value!==undefined)values[parameter.name.text]=value;}});
  if(helper.body)walk(helper.body,file,values,helpers,new Set([...stack,node.expression.text]));
 }
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['get','post','put','patch','delete'].includes(node.expression.name.text)&&node.arguments[0]&&typeof literal(node.arguments[0],bindings)==='string'){
  const method=node.expression.name.text.toUpperCase(),path=literal(node.arguments[0],bindings),handler=node.arguments.at(-1);
  if(handler&&(ts.isArrowFunction(handler)||ts.isFunctionExpression(handler))){const options=literal(node.arguments[1],bindings);const schema={...(options?.schema||{})};
   function scan(child){if(ts.isCallExpression(child)&&ts.isPropertyAccessExpression(child.expression)&&child.expression.name.text==='validate'&&child.arguments[0]){const key=validationTarget(child.arguments[1]),rules=literal(child.arguments[0],bindings);if(key&&rules&&typeof rules==='object'&&!Array.isArray(rules))schema[key]=rulesSchema(rules);}ts.forEachChild(child,scan);}
   scan(handler);if(Object.keys(schema).length)schemas[`${method} ${path}`]=schema;
  }
 }
 ts.forEachChild(node,child=>walk(child,file,bindings,helpers,stack));
}
for(const service of readdirSync(resolve(root,'services'),{withFileTypes:true}).filter(item=>item.isDirectory())){
 const directory=resolve(root,'services',service.name,'backend/routes');let names;try{names=readdirSync(directory);}catch{continue;}
 for(const name of names.filter(name=>name.endsWith('.js'))){const source=ts.createSourceFile(name,readFileSync(resolve(directory,name),'utf8'),ts.ScriptTarget.Latest,true);
  const helpers=new Map(source.statements.filter(statement=>ts.isFunctionDeclaration(statement)&&statement.name).map(statement=>[statement.name.text,statement]));
  const bindings={};
  for(const statement of source.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)){
   const value=literal(declaration.initializer,bindings);if(value!==undefined)bindings[declaration.name.text]=value;
  }
  walk(source,source,bindings,helpers);
 }
}
const output=JSON.stringify({version:1,source:'Controller-declared validators; domain services enforce additional business rules.',schemas:Object.fromEntries(Object.entries(schemas).sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n';
const target=resolve(root,'services/mcp/backend/contracts.json');
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==output)throw new Error('MCP contracts are stale. Run node scripts/build/mcp-contracts.mjs.');}else writeFileSync(target,output);
console.log(`MCP contracts: ${Object.keys(schemas).length} validated controller schemas.`);
