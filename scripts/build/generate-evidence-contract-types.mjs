import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const contracts=require('../../services/contracts/evidence/index.js');
const target=new URL('../../services/contracts/evidence/index.d.ts',import.meta.url);
const literal=value=>JSON.stringify(value);
function typeOf(schema={}){
 if(Object.hasOwn(schema,'const'))return literal(schema.const);
 if(schema.enum)return schema.enum.map(literal).join(' | ');
 if(schema.anyOf)return schema.anyOf.map(value=>'('+typeOf(value)+')').join(' | ');
 if(schema.type==='string')return 'string';
 if(schema.type==='integer'||schema.type==='number')return 'number';
 if(schema.type==='boolean')return 'boolean';
 if(schema.type==='null')return 'null';
 if(schema.type==='array')return `Array<${typeOf(schema.items)}>`;
 if(schema.type==='object'){
  const required=new Set(schema.required||[]);
  const fields=Object.entries(schema.properties||{}).map(([key,value])=>`${literal(key)}${required.has(key)?'':'?'}: ${typeOf(value)};`);
  if(schema.additionalProperties===true)fields.push('[key:string]: JsonValue;');
  else if(schema.additionalProperties&&typeof schema.additionalProperties==='object')fields.push(`[key:string]: ${typeOf(schema.additionalProperties)};`);
  return fields.length?`{ ${fields.join(' ')} }`:'Record<string,never>';
 }
 return 'JsonValue';
}
const names=Object.keys(contracts.JSON_SCHEMAS);
const result=`// Generated from the canonical runtime JSON schemas. Do not edit by hand.
// Regenerate: node scripts/build/generate-evidence-contract-types.mjs
// Numeric/text limits and witness/claim invariants are enforced at runtime.
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key:string]:JsonValue};
export type JsonSchema = Readonly<Record<string,unknown>>;
export const VERSION: ${literal(contracts.VERSION)};
export const PRESENTATIONS: readonly [${contracts.PRESENTATIONS.map(literal).join(', ')}];
export const STAGES: readonly [${contracts.STAGES.map(literal).join(', ')}];
${names.map(name=>`export type ${name} = ${typeOf(contracts.JSON_SCHEMAS[name])};`).join('\n')}
export type ModelAnswerCandidate = ${typeOf(contracts.MODEL_ANSWER_SCHEMA)};
export type EvidenceContractMap = {${names.map(name=>`${name}:${name}`).join(';')}};
export type ContractType = keyof EvidenceContractMap;
export const JSON_SCHEMAS: Readonly<Record<ContractType,JsonSchema>>;
export const MODEL_ANSWER_SCHEMA: JsonSchema;
/** Validates without normalizing or cloning; legacy objects retain their original shape. */
export function validateContract<T>(value:T, expectedType?:ContractType | \`\${ContractType}.v1\`, options?:{allowLegacyVersion?:boolean}):T;
export function validateNode<T>(value:T,schema:JsonSchema,path?:string,depth?:number):T;
export function contractError(code:string,message:string,path?:string):Error & {code:string;statusCode:number;validation_path:string};
`;
if(process.argv.includes('--check')){
 if(await readFile(target,'utf8')!==result)throw new Error('Portable evidence declaration types are stale. Regenerate them from the canonical schemas.');
}else await writeFile(target,result);
