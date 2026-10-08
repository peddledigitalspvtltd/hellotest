import ts from 'typescript';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const constants=require('../../services/platform/backend/src/domain/catalog.js');
const schemas={};
function literal(node){
 if(!node)return undefined;
 if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
 if(ts.isNumericLiteral(node))return Number(node.text);
 if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
 if(ts.isArrayLiteralExpression(node)){const values=node.elements.map(literal);return values.some(item=>item===undefined)?undefined:values;}
 if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(property=>[property.name.text,literal(property.initializer)]).filter(([,value])=>value!==undefined));
 if(ts.isIdentifier(node))return constants[node.text];
}
function rulesSchema(rules){const properties={},required=[];for(const [name,rule] of Object.entries(rules||{})){
 if(!rule||typeof rule!=='object')continue;
 const field={};if(rule.type)field.type=rule.type==='number'?'number':rule.type;
 for(const key of ['minLength','maxLength','minItems','minimum','maximum','enum'])if(rule[key]!==undefined)field[key]=rule[key];
 if(rule.items)field.items=typeof rule.items==='string'?{type:rule.items}:rule.items;
 if(rule.maxItems||rule.maxItem)field.maxItems=rule.maxItems||rule.maxItem;
 properties[name]=field;if(rule.required)required.push(name);
}return {type:'object',properties,...(required.length?{required}:{}),additionalProperties:true};}
function walk(node,file){
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['get','post','put','patch','delete'].includes(node.expression.name.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
  const method=node.expression.name.text.toUpperCase(),path=node.arguments[0].text,handler=node.arguments.at(-1);
  if(handler&&(ts.isArrowFunction(handler)||ts.isFunctionExpression(handler))){const options=literal(node.arguments[1]);const schema={...(options?.schema||{})};
   function scan(child){if(ts.isCallExpression(child)&&ts.isPropertyAccessExpression(child.expression)&&child.expression.name.text==='validate'&&child.arguments[0]&&ts.isObjectLiteralExpression(child.arguments[0])){const target=child.arguments[1]?.getText(file)||'';const key=/\.body\b/.test(target)?'body':/\.query\b/.test(target)?'querystring':null;if(key)schema[key]=rulesSchema(literal(child.arguments[0]));}ts.forEachChild(child,scan);}
   scan(handler);if(Object.keys(schema).length)schemas[`${method} ${path}`]=schema;
  }
 }
 ts.forEachChild(node,child=>walk(child,file));
}
for(const service of readdirSync(resolve(root,'services'),{withFileTypes:true}).filter(item=>item.isDirectory())){
 const directory=resolve(root,'services',service.name,'backend/routes');let names;try{names=readdirSync(directory);}catch{continue;}
 for(const name of names.filter(name=>name.endsWith('.js'))){const source=ts.createSourceFile(name,readFileSync(resolve(directory,name),'utf8'),ts.ScriptTarget.Latest,true);walk(source,source);}
}
const output=JSON.stringify({version:1,source:'Controller-declared validators; domain services enforce additional business rules.',schemas:Object.fromEntries(Object.entries(schemas).sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n';
const target=resolve(root,'services/mcp/backend/contracts.json');
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==output)throw new Error('MCP contracts are stale. Run node scripts/build/mcp-contracts.mjs.');}else writeFileSync(target,output);
console.log(`MCP contracts: ${Object.keys(schemas).length} validated controller schemas.`);
