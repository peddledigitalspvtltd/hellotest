import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { createRequire } from 'node:module';
function load(path, imports={}) { const file = new URL(path, import.meta.url); const source = fs.readFileSync(file,'utf8'); const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText; const exports={};vm.runInNewContext(code,{exports,require:id=>{if(imports[id])return imports[id];throw new Error(id)},Set,Map,Date});return exports; }
const signals=load('../../frontend/lib/caseLibrarySignals.ts');
const results=load('../../frontend/lib/executionResultMetrics.ts');
const receipts=load('../../frontend/lib/executionRunSummary.ts',{'./executionResultMetrics':results});

test('no stability advice is invented before the first observation',()=>{
 const value=signals.caseExecutionGuidance({hasRuns:false,failed:false,unlinked:false,automationCandidate:false});
 assert.equal(value.tone,'neutral');assert.match(value.text,/No execution evidence/);assert.doesNotMatch(value.text,/stable|passing/i);
});
test('manual failures and newer passing automation remain independently visible',()=>{
 const manual={id:'manual',status:'failed',created_at:'2026-11-17T01:00:00Z'};
 const automation={id:'auto',status:'passed',created_at:'2026-11-17T02:00:00Z',derived:true,source_display_id:'AT-79'};
 const value=signals.caseEvidenceLineage([manual,automation]);assert.equal(value.manual,manual);assert.equal(value.automation,automation);assert.equal(value.latest,automation);
});
test('module snapshot preserves visible explicit order and suppresses overlapping members',()=>{
 assert.equal(JSON.stringify(signals.mergeModuleCaseOrder(['case-b','case-a'],[['case-c','case-a'],['case-c','case-d']])),JSON.stringify(['case-b','case-a','case-c','case-d']));
});
test('authoritative run instance receipt excludes derived lineage from aggregate counts',()=>{
 const instance_summary={total:4,passed:4,failed:0,blocked:0,running:0,pending:0,paused:0,skipped:0,aborted:0,pass_rate:100,distinct_cases:4};
 assert.equal(receipts.canonicalRunSummary({id:'run',instance_summary},Array.from({length:8},(_,i)=>({id:String(i),execution_id:'run',test_case_id:String(i),status:'passed'}))),instance_summary);
});
test('legacy fallback scopes projections to frozen identities and latest row attempts',()=>{
 const row=(id,test_case_id,status,created_at,data_set_iteration_index=0)=>({id,execution_id:'run',test_case_id,status,created_at,data_set_iteration_index});
 const value=receipts.canonicalRunSummary({id:'run',test_case_ids:['native']},[row('1','native','failed','2026-11-17T00:00:00Z'),row('2','native','passed','2026-11-17T01:00:00Z'),row('3','native','blocked','2026-11-17T01:00:00Z',1),row('4','manual-projection','passed','2026-11-17T01:00:00Z')]);
 assert.equal(value.total,2);assert.equal(value.passed,1);assert.equal(value.blocked,1);assert.equal(value.distinct_cases,1);assert.equal(value.pass_rate,50);
});
test('effective data names inherited frozen case datasets without inventing a run override',()=>{
 const value=receipts.effectiveDataSummary({case_snapshots:[{test_data_set_id:'data',test_data_set_name:'Sanity',test_data_set_snapshot:{mode:'table',rows:[{},{}]}},{test_data_set_id:'data',test_data_set_name:'Sanity',test_data_set_snapshot:{mode:'table',rows:[{},{}]}}]});
 assert.equal(value.length,1);assert.equal(value[0].name,'Sanity');assert.equal(value[0].cases,2);assert.equal(value[0].rows,2);
});


test('the real data editor serializer retains an intentionally empty negative-test row',()=>{
 const source=fs.readFileSync(new URL('../../frontend/pages/TestEnvironmentPage.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('editor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name?.text==='normalizeTableRows'));
 assert.ok(declaration);const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const serialize=new Function('sanitizeDataSetText',code+';return normalizeTableRows;')(value=>String(value??''));
 const result=serialize([{email:'',password:''},{email:'valid@example.test',password:''}],['email','password']);
 assert.equal(result.length,2);assert.deepEqual(result[0],{email:'',password:''});
});


test('per-channel latest receipt keeps an older manual failure visible outside the bounded history window',()=>{
 const manual={id:'old-manual',status:'failed',created_at:'2026-11-01T00:00:00Z'};
 const automation={id:'new-auto',status:'passed',derived:true,created_at:'2026-11-17T00:00:00Z'};
 const value=signals.caseEvidenceLineage([automation],{manual,automation});assert.equal(value.manual,manual);assert.equal(value.automation,automation);assert.equal(value.latest,automation);
});


test('pending Defect progress shares the backend stage contract and never invents completed server work',()=>{
 const source=fs.readFileSync(new URL('../../frontend/pages/IssuesPage.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('issues.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name?.text==='AI_BUG_DRAFT_PENDING_PROCESSING'));
 assert.ok(declaration);const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const pending=new Function(code+';return AI_BUG_DRAFT_PENDING_PROCESSING;')();
 const backend=createRequire(import.meta.url)('../../../ai/backend/services/generationLifecycle.js').processing();
 assert.deepEqual(pending.stages.map(item=>item.id),backend.stages.map(item=>item.id));
 assert.equal(pending.completed_stage_count,0);assert.equal(pending.progress_mode,'indeterminate');assert.equal(pending.active_stage_id,'intake');assert.equal(pending.stages.filter(item=>item.status==='complete').length,0);
 assert.match(pending.status_label,/awaiting server-reported stages/);assert.ok(pending.stages.every(item=>!item.evidence));
});

test('direct case authoring displays confirmed response or failure stages and keeps pending work unconfirmed',()=>{
 const source=fs.readFileSync(new URL('../../frontend/pages/TestCasesPage.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('case-authoring.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 for(const [component,mutation] of [['AiCaseAuthoringModal','previewCaseAuthoring'],['AiDesignStudioModal','previewDesignedCases']]){
  let element;const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)===component)element=node;ts.forEachChild(node,visit);};visit(ast);
  assert.ok(element,component+' is connected to the route');
  const attr=element.attributes.properties.find(attribute=>attribute.name?.getText(ast)==='processing');
  assert.ok(attr?.initializer?.expression,component+' has the actual processing binding');
  const resolve=new Function(mutation,'pendingAuthoringProcessing','getAiFailureProcessing',`return (${attr.initializer.expression.getText(ast)});`);
  const pending={active_stage_id:'intake',completed_stage_count:0,progress_mode:'indeterminate'};
  const confirmed={active_stage_id:'review',completed_stage_count:7,progress_mode:'complete'};
  const failure={active_stage_id:'guardrails',completed_stage_count:2};
  assert.equal(resolve({isPending:true,data:{processing:confirmed}},()=>pending,error=>error?.processing),pending,'old completed output is never presented as current pending progress');
  assert.equal(resolve({isPending:false,data:{processing:confirmed}},()=>pending,error=>error?.processing),confirmed,'use the server response without re-deriving stages');
  assert.equal(resolve({isPending:false,error:{processing:failure}},()=>pending,error=>error?.processing),failure,'retain the exact confirmed failure stage');
  assert.equal(resolve({isPending:false},()=>pending,error=>error?.processing),undefined,'absence of telemetry does not invent completion');
 }
});
