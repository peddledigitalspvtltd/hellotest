import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const require=createRequire(new URL('../../../../platform/frontend/package.json',import.meta.url));
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
export const workflowEditorRoot=fileURLToPath(new URL('../../../frontend/workflows/',import.meta.url));
export function workflowEditorFixture({connections=[],tools,testDataSets=[],testEnvironments=[],canRun=true,source}={}){
 const queries=[],patches=[],calls=[],modules=new Map();
 const api={agenticWorkflows:{connections:async(...args)=>{calls.push(['connections',...args]);return connections;},mcpTools:async(...args)=>{calls.push(['mcpTools',...args]);return tools||[];}},workflowTestDataSets:{list:async(...args)=>{calls.push(['datasets',...args]);return testDataSets;}},workflowTestEnvironments:{list:async(...args)=>{calls.push(['environments',...args]);return testEnvironments;}}};
 const useQuery=options=>{queries.push(options);const key=options.queryKey[0];return {data:key==='workflow-connections'?connections:key==='workflow-mcp-tools'?tools:key==='workflow-test-data-sets'?testDataSets:testEnvironments,isFetching:false,isError:false,refetch:async()=>calls.push(['refetch',key])};};
 const dependencies={react:{...React,useId:()=> 'workflow-fixture',useRef:initial=>({current:initial})},'@tanstack/react-query':{useQuery},'@tabler/icons-react':new Proxy({},{get:(_target,name)=>()=>React.createElement('span',{'data-icon':String(name)})}),'react-router-dom':{Link:({to,children,...props})=>React.createElement('a',{href:to,...props},children)}};
 function load(file,override){
  if(modules.has(file)&&!override)return modules.get(file);
  const exports={};if(!override)modules.set(file,exports);
  const body=ts.transpileModule(override||readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',body)(id=>{
   if(Object.hasOwn(dependencies,id))return dependencies[id];
   if(id.endsWith('api.client'))return {agenticApi:api};
   if(id.endsWith('.css'))return {};
   if(!id.startsWith('.'))return require(id);
   const base=resolve(dirname(file),id);
   if(base.endsWith('.json'))return JSON.parse(readFileSync(base,'utf8'));
   const target=['.tsx','.ts','.mjs','.js',''].map(extension=>base+extension).find(existsSync);
   if(!target)throw new Error('Missing editor dependency '+id+' from '+file);
   return load(target);
  },exports);
  return exports;
 }
 const exports=load(resolve(workflowEditorRoot,'WorkflowOperationFields.tsx'),source);
 const props=data=>({data,projectId:'project',appTypeId:'app',canRun,triggerInput:{sprint_id:'sprint',max_cases_per_story:4,authoring_mode:'gherkin'},onChange:patch=>patches.push(patch)});
 const nodes=[];
 const expand=node=>{if(!React.isValidElement(node))return node;if(typeof node.type==='function')return expand(node.type(node.props));nodes.push(node);return React.cloneElement(node,{},React.Children.map(node.props.children,expand));};
 return {queries,patches,calls,load,render(data){queries.length=0;nodes.length=0;const tree=expand(React.createElement(exports.WorkflowOperationFields,props(data)));return {html:renderToStaticMarkup(tree),nodes:[...nodes]};},control(label){const matches=nodes.filter(node=>node.props['aria-label']===label);if(matches.length!==1)throw new Error(`Expected one ${label}; found ${matches.length}`);return matches[0];},registry:()=>load(resolve(workflowEditorRoot,'operationEditors/registry.ts'))};
}
