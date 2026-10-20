import { parse } from "acorn";

/** Use captured attributes as data; never evaluate a locator or captured HTML. */
export function buildAttributeLocator(tag: string, attributes: Array<[string, string]>, scope = "", index?: number) {
  const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, "\\a ")}"`;
  const element = /^[a-z][a-z0-9-]*$/i.test(tag) ? tag.toLowerCase() : "*";
  const selector = element + attributes.filter(([name]) => /^[a-z_][a-z0-9_-]*$/i.test(name)).map(([name, value]) => `[${name}=${quote(value)}]`).join("");
  const scoped = scope.trim() ? `${scope.trim()} ${selector}` : selector;
  return index !== undefined && Number.isInteger(index) && index >= 0 ? `${scoped} >> nth=${index}` : scoped;
}

type Member = { ref: string; entry: { id: string; test_case_id?: string | null; locator?: string | null;metadata?:{reference_aliases?:unknown;merged_into_entry_id?:unknown;observed_route_sha256?:unknown;instruction_usages?:unknown} } };
type RepositoryStep = {id?:string;automation_source_sha256?:string|null;automation_context_sha256?:string|null;automation_code?:string|null;objectRefs?:string[]};
export type RepositoryStepReferences = {targets:Set<string>;semanticLocators:Set<string>;sourceHashes:Map<string,string>;contextHashes:Map<string,string>};
const normalizeLocatorTree = (node:any,repository=false):any => {
  if (typeof node === "bigint") return String(node);
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(item=>normalizeLocatorTree(item,repository));
  const result=Object.fromEntries(Object.entries(node).filter(([key])=>!["start","end","raw"].includes(key)).map(([key,value])=>[key,normalizeLocatorTree(value,repository)]));
  if(node.type==="TemplateLiteral"&&!node.expressions.length)return {type:"Literal",value:node.quasis.map((part:any)=>part.value.cooked).join("")};
  if(node.type==="ObjectExpression"&&node.properties.every((property:any)=>property.type==="Property"&&property.kind==="init"&&!property.computed&&!property.method&&!property.shorthand)){
    const names=node.properties.map((property:any)=>property.key?.name??property.key?.value);
    if(names.every((name:any)=>typeof name==="string")&&new Set(names).size===names.length)result.properties=result.properties.map((property:any,index:number)=>({...property,key:{type:"Identifier",name:names[index]}})).sort((left:any,right:any)=>left.key.name.localeCompare(right.key.name));
  }
  const method=node.type==="CallExpression"&&!node.optional&&node.callee.type==="MemberExpression"&&!node.callee.computed&&!node.callee.optional?node.callee.property.name:"";
  const semantic=["getByRole","getByLabel","getByPlaceholder","getByText","getByTitle","getByAltText"].includes(method);
  const first=node.arguments?.[0],options=node.arguments?.[1];
  if(["getByTestId","locator"].includes(method)&&node.arguments.length===2&&options?.type==="ObjectExpression"&&!options.properties.length)result.arguments=result.arguments.slice(0,1);
  const propertyName=(property:any)=>property.key?.name??property.key?.value;
  const validOptions=!options||options.type==="ObjectExpression"&&options.properties.every((property:any)=>property.type==="Property"&&property.kind==="init"&&!property.computed&&!property.method&&!property.shorthand
    &&(propertyName(property)==="exact"&&property.value.type==="Literal"&&typeof property.value.value==="boolean"||method==="getByRole"&&propertyName(property)==="name"&&property.value.type==="Literal"&&typeof property.value.value==="string"))
    &&new Set(options.properties.map(propertyName)).size===options.properties.length;
  const firstValue=first?.type==="Literal"&&typeof first.value==="string"?first.value:first?.type==="TemplateLiteral"&&!first.expressions.length?first.quasis.map((part:any)=>part.value.cooked).join(""):undefined;
  if(semantic&&typeof firstValue==="string"&&node.arguments.length<=2&&validOptions){
    const name=options?.properties.find((property:any)=>propertyName(property)==="name")?.value.value;
    const explicitExact=options?.properties.find((property:any)=>propertyName(property)==="exact")?.value.value;
    // Repository semantic expressions default to exact:true. Native Playwright
    // calls default to false, so only explicit matching semantics are joined.
    return {type:"SemanticLocator",receiver:normalizeLocatorTree(node.callee.object,repository),method,value:firstValue,
      ...(method==="getByRole"&&name===undefined?{}:{exact:explicitExact??repository}),...(name!==undefined?{name}:{})};
  }
  return result;
};

function repositoryLocatorTree(locator:string):any {
  const suffix=locator.match(/\.(nth\(\s*\d+\s*\)|first\(\s*\)|last\(\s*\))$/),base=suffix?locator.slice(0,suffix.index):locator;
  const role=base.match(/^role=([^\[]+)(?:\[name=["']?(.+?)["']?\])?$/i);
  const alias=base.match(/^(text|label|placeholder|title|alt|alttext|testid|data-testid)=(.+)$/i);
  const methods:Record<string,string>={text:"getByText",label:"getByLabel",placeholder:"getByPlaceholder",title:"getByTitle",alt:"getByAltText",alttext:"getByAltText",testid:"getByTestId","data-testid":"getByTestId"};
  const expression=role?`page.getByRole(${JSON.stringify(role[1].trim())}${role[2]?`,{name:${JSON.stringify(role[2])}}`:""})`
    :alias?`page.${methods[alias[1].toLowerCase()]}(${JSON.stringify(alias[2].replace(/^["']|["']$/g,""))})`
    :/^(?:page\.)?(?:getBy\w+|locator)\s*\(/.test(base)?base.replace(/^(?=getBy\w+\s*\(|locator\s*\()/,"page."):`page.locator(${JSON.stringify(base)})`;
  return (parse(expression+(suffix?"."+suffix[1]:""),{ecmaVersion:"latest"}) as any).body[0]?.expression;
}

const locatorIdentity=(locator:string)=>{try{return JSON.stringify(normalizeLocatorTree(repositoryLocatorTree(locator),true));}catch{return locator;}};
/** Query/hash routes may reuse identical controls. Compute this set once for
 * the workspace; only explicit references or source-bound usages disambiguate. */
export function collectRouteScopedLocatorKeys(members:Array<Pick<Member,'entry'>>) {
  return new Set(members.filter(member=>/^[a-f0-9]{64}$/.test(String(member.entry.metadata?.observed_route_sha256||""))&&member.entry.locator).map(member=>locatorIdentity(member.entry.locator!)));
}

/** Parse each saved program once, rather than once per repository field. Only
 * selector arguments count; input data and comments are not object bindings. */
export function collectRepositoryStepReferences(steps:RepositoryStep[],parameterValues:Record<string,string> = {}):RepositoryStepReferences {
  const targets=new Set<string>(),semanticLocators=new Set<string>(),sourceHashes=new Map<string,string>(),contextHashes=new Map<string,string>();
  const keyOf=(name:string)=>name.replace(/^@/,"").replace(/^([tsr])\.\[((?:\\.|[^\]\\])+)\]$/i,(_,scope,name)=>scope+"."+name.replace(/\\([\\\]])/g,"$1")).toLowerCase();
  const resolve=(value:string)=>value.replace(/@([tsr]\.(?:\[(?:\\.|[^\]\\])+\]|[A-Za-z_][\w.-]*))/gi,(token,name)=>parameterValues[keyOf(name)] ?? token);
  const literal=(node:any):string|undefined=>node?.type === "Literal" && typeof node.value === "string" ? resolve(node.value)
    : node?.type === "TemplateLiteral" && !node.expressions.length ? resolve(node.quasis.map((part:any)=>part.value.cooked).join(""))
    : node?.type === "MemberExpression" && node.object.name === "params" && node.computed && typeof node.property.value === "string" ? parameterValues[keyOf(node.property.value)] : undefined;
  const add=(node:any)=>{const value=literal(node);if(value)targets.add(value);};
  for(const step of steps) {
    if(step.id&&/^[a-f0-9]{64}$/.test(step.automation_source_sha256||""))sourceHashes.set(step.id,step.automation_source_sha256!);
    if(step.id&&/^[a-f0-9]{64}$/.test(step.automation_context_sha256||""))contextHashes.set(step.id,step.automation_context_sha256!);
    step.objectRefs?.forEach(value=>{if(value)targets.add(resolve(value));});
    try {
      const source=step.automation_code || "",fence=source.trim().match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
      const tree=parse(fence ? fence[1] : source,{ecmaVersion:"latest",sourceType:"module",allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});
      const visit=(node:any):void=>{
        if(!node || typeof node!=="object")return;
        if(node.type === "CallExpression") {
          const method=node.callee.type === "MemberExpression" ? node.callee.property.name : "",namespace=node.callee.object?.name;
          if(/^(?:getBy[A-Z]\w*|locator|nth|first|last)$/.test(method))semanticLocators.add(JSON.stringify(normalizeLocatorTree(node)));
          const locatorCall=["locator","$","$$"].includes(method);
          const targetCall=["web","android","ios","mobile","page","driver"].includes(namespace) && ["click","dblclick","rightClick","hover","fill","type","select","selectOption","check","uncheck","clear","press","tap","doubleTap","longPress","expectVisible","expectHidden","expectEnabled","expectDisplayed","expectNotDisplayed","expectValue","waitForSelector","waitForDisplayed","waitForExist","waitForEnabled","text","value","captureText","captureValue","uploadFile","uploadLocalFile","uploadRemoteFile","drag"].includes(method);
          const textAssertion=["web","android","ios","mobile"].includes(namespace) && method==="expectText" && node.arguments.length>1;
          if(locatorCall || targetCall || textAssertion)add(node.arguments[0]);
          if(targetCall && method==="drag")add(node.arguments[1]);
          if(["web","android","ios","mobile"].includes(namespace) && method==="aiStep")node.arguments[1]?.properties?.filter((property:any)=>["target","selector"].includes(property.key?.name)).forEach((property:any)=>add(property.value));
        }
        for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value && typeof value==="object")visit(value);
      };
      visit(tree);
    } catch { /* A partial source draft does not establish executable bindings. */ }
  }
  return {targets,semanticLocators,sourceHashes,contextHashes};
}

/** Captured ownership is optional; case Objects uses only current instructions. */
export function isRepositoryMemberUsed(member:Member,caseId:string|undefined,steps:RepositoryStep[],{includeCaseOwned=true,parameterValues={},references,canonicalReferences,routeScopedLocatorKeys}: {includeCaseOwned?:boolean;parameterValues?:Record<string,string>;references?:RepositoryStepReferences;canonicalReferences?:Set<string>;routeScopedLocatorKeys?:Set<string>} = {}) {
  if(!caseId)return false;
  if(member.entry.metadata?.merged_into_entry_id)return false;
  const routeSpecific=/^[a-f0-9]{64}$/.test(String(member.entry.metadata?.observed_route_sha256||""));
  if(includeCaseOwned && !routeSpecific && member.entry.test_case_id===caseId)return true;
  const used=references || collectRepositoryStepReferences(steps,parameterValues);
  if(Array.isArray(member.entry.metadata?.reference_aliases)&&member.entry.metadata.reference_aliases.some(value=>typeof value==='string'&&used.targets.has(value)&&(!canonicalReferences?.has(value)||value===member.ref)))return true;
  if(used.targets.has(member.ref))return true;
  if(routeSpecific||member.entry.locator&&routeScopedLocatorKeys?.has(locatorIdentity(member.entry.locator))){
    const usages=member.entry.metadata?.instruction_usages;
    if(!Array.isArray(usages)||!usages.some(row=>row?.test_case_id===caseId&&typeof row.step_id==="string"&&/^[a-f0-9]{64}$/.test(row.source_sha256||"")&&used.sourceHashes.get(row.step_id)===row.source_sha256
      &&/^[a-f0-9]{64}$/.test(row.context_sha256||"")&&used.contextHashes.get(row.step_id)===row.context_sha256))return false;
  }
  if(member.entry.locator && used.targets.has(member.entry.locator))return true;
  if(member.entry.locator) {
    try {
      return used.semanticLocators.has(JSON.stringify(normalizeLocatorTree(repositoryLocatorTree(member.entry.locator),true)));
    } catch { /* Invalid locators remain available through their explicit reference. */ }
  }
  return false;
}
