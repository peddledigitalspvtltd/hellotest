const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const {parse}=require('acorn');
const generators=require('../../../platform/backend/src/utils/testDataGenerators');
const linked=require('../../../platform/backend/src/utils/linkedManualParameters');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');

test('every Build snapshot receives the original reviewed parameter templates',()=>{
 const source=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}),calls=[];
 const visit=node=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&node.callee.property?.name==='prepareBuildDataSnapshot')calls.push(node);
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
 };
 visit(ast);assert.ok(calls.length>0,'the builder prepares a Build data snapshot');
 for(const call of calls){
  const property=call.arguments[0].properties.find(property=>property.key?.name==='authoredTemplates');
  assert.equal(property?.value?.name,'buildParameterValues','Forward raw reviewed templates rather than generated sample values');
 }
});

function dataPersistence(record){
 const file=require.resolve('../../backend/lib/automationBuildDataSnapshot'),local=createRequire(file),module={exports:{}};
 new Function('require','module',fs.readFileSync(file,'utf8'))(id=>{
  if(id.endsWith('optionalEvidenceAccess.service'))return {getOptionalEvidenceAccess:async()=>({'testcase.update':true,'data.view':true})};
  if(id.endsWith('testCase.service'))return {getTestCase:async()=>structuredClone(record),updateTestCase:async(_id,input)=>{
   assert.equal(input.expected_revision,record.revision);Object.assign(record,structuredClone(input),{revision:record.revision+1});
  }};
  return local(id);
 },module);
 return module.exports;
}

function actualRunSnapshot(record,steps,manual,now){
 const source=fs.readFileSync(require.resolve('../../../testing/backend/services/execution.service'),'utf8');
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'});
 const declarations=['parseJsonValue','normalizeText','normalizeTextList','normalizeParameterValues','buildSnapshotPayload'].map(name=>{
  const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);assert.ok(node,`Use actual Run ${name}`);return source.slice(node.start,node.end);
 }).join('\n');
 const dependencies={
  loadSuiteContexts:async()=>new Map([['suite',{parameters:{'s.tenant':'Scoped tenant'}}]]),
  db:{prepare:()=>({all:async()=>[{id:'suite',parallel_enabled:false,parallel_count:1}]})},placeholdersFor:values=>values.map(()=>'?').join(','),
  selectCasesForSuite:{all:async()=>[record]},
  materializeParameterValues:values=>generators.materializeParameterValues(values,now),
  freezeReferencedParameterGenerators:(snapshot,sourceSteps)=>generators.freezeReferencedParameterGenerators(snapshot,sourceSteps,now),
  normalizeStoredReferenceList:require('../../../platform/backend/src/utils/externalReferences').normalizeStoredReferenceList,
  uuid:()=> 'run-step',attachCaseDataSetSnapshots:async snapshots=>snapshots,
  require:id=>{
   if(id.endsWith('linkedManualParameters'))return linked;
   if(id==='./linkedManualParameters.service')return {resolveForCases:async()=>new Map([[record.test_case_id,linked.resolveLinkedManualParameters(record,manual)]])};
   if(id==='./executionSnapshot.repository')return {loadSteps:async()=>new Map([[record.test_case_id,steps]])};
   if(id==='./caseExecutionHooks.service')return {snapshotCaseExecutionHooks:async()=>[]};
   throw new Error(`Unexpected Run dependency ${id}`);
  }
 };
 return new Function(...Object.keys(dependencies),`${declarations}\nreturn buildSnapshotPayload;`)(...Object.values(dependencies));
}

for(const ownership of ['own','linked manual'])for(const selection of ['suite','direct']){
 test(`${ownership} generator templates survive Build and ${selection} Run freezes fresh values shared by all saved actions`,async()=>{
  const templates={'r.employeeid':'EMP-{{date:YYYYMMDDHHmmss}}-{{randomString:16}}','r.employeename':'Employee{{randomString:24}}','r.eventname':'Onboard{{randomString:24}}'};
  const record={id:'automation',test_case_id:'automation',test_case_title:'Create employee and onboarding event',automated:'yes',revision:3,
   parameter_values:{...(ownership==='own'?templates:{}),'r.mode':'Constant','r.password':'PRIVATE_FIXTURE_CREDENTIAL'},test_data_options:{private_parameter_names:['r.password']}};
  const manual=ownership==='linked manual'?[{manual_test_case_id:'manual',is_primary:true,parameter_values:templates,test_data_options:{parameter_overrides:['r.employeeid']}}]:[];
  const original=structuredClone({record,manual});
  const inherited=linked.resolveLinkedManualParameters(record,manual);
  const steps=[{id:'step',step_order:1,step_type:'web',action:'Create @r.employeeid named @r.employeename then event @r.eventname',expected_result:'@r.eventname belongs to @r.employeeid named @r.employeename',automation_code:''}];
  const resolver=createBrowserParameterResolver({caseValues:inherited.effective_parameter_values,caseOptions:linked.effectiveLinkedDataOptions(record,inherited),steps});
  const buildValues=Object.fromEntries(Object.keys(templates).map(name=>[name,resolver.resolve('browser_fill',{value:`@${name}`}).value]));
  const tools=Object.keys(buildValues).flatMap(name=>[
   {name:'browser_fill',arguments:{locator:`getByLabel("${name}")`,value:`@${name}`}},
   {name:'browser_assert',arguments:{locator:`getByLabel("${name}")`,assertion:'value',value:`@${name}`}}
  ]);
  const compiled=compileRecordedProgram(tools);assert.ok(compiled);steps[0].automation_code=compiled.source;
  const persistence=dataPersistence(record);
  const snapshot=await persistence.prepareBuildDataSnapshot({testCase:record,projectId:'project',userId:'builder',generatedValues:resolver.generatedCaseValues});
  assert.deepEqual(snapshot.values,buildValues);
  await persistence.persistBuildDataSnapshot({testCase:record,projectId:'project',userId:'builder',snapshot});
  assert.deepEqual(record.parameter_values,original.record.parameter_values,'Build samples never replace templates or take ownership of manual inputs');
  assert.deepEqual(manual,original.manual);assert.deepEqual(record.test_data_options.private_parameter_names,['r.password']);
  const freeze=actualRunSnapshot(record,steps,manual,new Date('2040-11-06T03:04:05Z'));
  const options={projectId:'project',appTypeId:'app',userId:'builder',persisted:false,...(selection==='direct'?{directCases:[record]}:{})};
  const run=await freeze('run-one',selection==='suite'?[{suite_id:'suite',suite_name:'Employee suite'}]:[],options);
  const frozen=run.caseSnapshots[0];assert.equal(run.caseSnapshots.length,1);assert.equal(run.stepSnapshots.length,1);
  for(const [name,template]of Object.entries(templates)){
   assert.equal(frozen.parameter_template_values[name],template);
   assert.notEqual(frozen.parameter_values[name],buildValues[name],'A new Run materializes fresh data');
   assert.equal(snapshot.values[name],buildValues[name],'Build evidence retains its fixed original value');
   assert.equal(resolver.resolve('browser_fill',{value:`@${name}`}).value,buildValues[name],'Remaining build actions share their original sample');
   assert.ok(compiled.source.includes(`@${name}`));assert.ok(!compiled.source.includes(buildValues[name]));
  }
  const runResolver=createBrowserParameterResolver({caseValues:frozen.parameter_values,materialize:false});
  const writes=[],values=new Map(),page={getByLabel:name=>({fill:async input=>{const value=runResolver.resolve('browser_fill',{value:input}).value;values.set(name,value);writes.push([name,value]);},name})};
  const expect=locator=>({toHaveValue:async expected=>assert.equal(values.get(locator.name),runResolver.resolve('browser_assert',{value:expected}).value)});
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('page','expect','params',run.stepSnapshots[0].automation_code)(page,expect,frozen.parameter_values);
  assert.deepEqual(writes,Object.keys(templates).map(name=>[name,frozen.parameter_values[name]]),'Compiled fill and assertion instructions use the same Run snapshot data');
  const rerun=await freeze('run-two',selection==='suite'?[{suite_id:'suite',suite_name:'Employee suite'}]:[],options);
  assert.notEqual(rerun.caseSnapshots[0].parameter_values['r.employeeid'],frozen.parameter_values['r.employeeid']);
  assert.deepEqual(record.parameter_values,original.record.parameter_values);
 });
}
