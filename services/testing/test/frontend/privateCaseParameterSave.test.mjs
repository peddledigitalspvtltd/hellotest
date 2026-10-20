import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {casePrivateParameterNames,collectPrivateParameterNames,caseParameterSaveOptions} from '../../../platform/frontend/src/shared/lib/parameterPrivacy.ts';
import {excludeSensitiveStepParameterValues,parseStepParameterName,normalizeStepParameterValues} from '../../../platform/frontend/src/shared/lib/stepParameters.ts';

const source=ts.createSourceFile('TestCasesPage.tsx',readFileSync(new URL('../../frontend/pages/TestCasesPage.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];
const visit=node=>{nodes.push(node);ts.forEachChild(node,visit);};visit(source);
const property=(node,name)=>node.properties.find(item=>ts.isPropertyAssignment(item)&&item.name.getText(source)===name);

function pageBinding(file,name,dependencies) {
  const page=ts.createSourceFile(file,readFileSync(new URL(file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let binding;
  const find=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(page)===name)binding=node.initializer;ts.forEachChild(node,find);};
  find(page);assert.ok(binding,`Find actual ${name} binding`);
  const javascript=ts.transpileModule(`const implementation = ${binding.getText(page)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function(...Object.keys(dependencies),`${javascript}\nreturn implementation;`)(...Object.values(dependencies));
}

test('ordinary case saves preserve own opaque private values and policy while public previews omit them',()=>{
  const selectedTestCase={parameter_values:{'r.opaque_input':'private-own-value','t.alias':'private-own-value','t.public':'Original public','t.empty':''},test_data_options:{private_parameter_names:['r.opaque_input'],parameter_overrides:['r.opaque_input','t.public'],override_suite_data:false}};
  const testCaseParameterValues={'r.opaque_input':'private-own-value','t.alias':'private-own-value','t.public':'Edited public','t.empty':''};
  const before=structuredClone({selectedTestCase,testCaseParameterValues});
  const hidden=collectPrivateParameterNames([testCaseParameterValues],casePrivateParameterNames(selectedTestCase));
  assert.deepEqual(excludeSensitiveStepParameterValues(testCaseParameterValues,hidden),{'t.public':'Edited public','t.empty':''});
  const call=nodes.find(node=>ts.isCallExpression(node)&&node.expression.getText(source)==='updateTestCase.mutateAsync'&&
    node.arguments[0]&&ts.isObjectLiteralExpression(node.arguments[0])&&property(node.arguments[0],'input')&&
    property(property(node.arguments[0],'input').initializer,'parameter_values'));
  assert.ok(call,'use the actual authoring update payload');
  const input=property(call.arguments[0],'input').initializer;
  const valuesExpression=property(input,'parameter_values').initializer.getText(source);
  const policySpread=input.properties.find(item=>ts.isSpreadAssignment(item)&&item.expression.getText(source).includes('test_data_options'));
  assert.ok(policySpread);
  const values=new Function('testCaseParameterValues',`return (${valuesExpression});`)(testCaseParameterValues);
  const payload=new Function('canViewTestData','linkedDataSetDraftIds','selectedTestCase','overrideSharedGroupData','testCaseParameterValues','linkedDataSetSensitiveParameterNames','caseParameterSaveOptions','caseParameterOverrideDraftRef','caseParameterPrivacyScope',`return (${policySpread.expression.getText(source)});`)(true,[],selectedTestCase,false,testCaseParameterValues,hidden,caseParameterSaveOptions,{current:{scope:'',names:new Set()}},'case:manual');
  assert.deepEqual(values,testCaseParameterValues);
  assert.equal(Object.hasOwn(values,'t.inherited'),false,'saving own inputs never copies linked defaults');
  assert.deepEqual(payload,{test_data_set_ids:[],test_data_options:{...selectedTestCase.test_data_options,private_parameter_names:['r.opaque_input','t.alias'],parameter_overrides:['r.opaque_input','t.public'],override_shared_steps:false}});
  assert.deepEqual({selectedTestCase,testCaseParameterValues},before);
});

test('manual private and run-scoped edits save case-owned values, while suite edits retain their separate owner',()=>{
  let own={'t.password':'untouched own secret'},suite={},preview={'r.opaque':'old preview'};
  const sourceDefaults={'r.opaque':'inherited secret'};
  const handler=pageBinding('../../frontend/pages/TestCasesPage.tsx','handleScopedParameterValueChange',{
    parseStepParameterName,linkedDataSetSensitiveParameterNames:new Set(['r.opaque']),caseParameterPrivacyScope:'case:manual',
    caseParameterOverrideDraftRef:{current:{scope:'',names:new Set()}},
    resolveScopedParameterInputState:()=>({}),setPrivateCaseParameterDraft:()=>{},
    setTestCaseParameterValues:update=>{own=update(own);},setSuiteParameterValues:update=>{suite=update(suite);},
    setRunPreviewParameterValues:update=>{preview=update(preview);}
  });
  handler('@r.opaque','replacement secret');
  assert.deepEqual(own,{'t.password':'untouched own secret','r.opaque':'replacement secret'});
  assert.deepEqual(preview,{});
  handler('r.opaque','');assert.equal(own['r.opaque'],'','An explicit blank remains an authored own binding');
  handler('s.region','suite region');assert.deepEqual(suite,{'s.region':'suite region'});
  assert.equal(Object.hasOwn(own,'s.region'),false);
  assert.deepEqual(sourceDefaults,{'r.opaque':'inherited secret'});
});

test('automation permits private run defaults at case level and still respects scoped edit permission',()=>{
  let own={},suite={},disabled=false;
  const handler=pageBinding('../../../automation/frontend/pages/AutomationPage.tsx','handleParameterValueChange',{
    parseStepParameterName,visiblePrivateNames:new Set(['r.opaque']),caseParameterPrivacyScope:'project:automation',
    caseParameterOverrideDraftRef:{current:{scope:'',names:new Set()}},
    resolveParameterInputState:()=>({disabled}),setPrivateCaseParameterDraft:()=>{},
    setTestCaseParameterValues:update=>{own=update(own);},setSuiteParameterValues:update=>{suite=update(suite);}
  });
  handler('r.opaque','replacement secret');assert.deepEqual(own,{'r.opaque':'replacement secret'});
  handler('s.region','shared value');assert.deepEqual(suite,{'s.region':'shared value'});
  disabled=true;handler('r.opaque','disallowed edit');assert.equal(own['r.opaque'],'replacement secret');
  const scopeState=pageBinding('../../../automation/frontend/pages/AutomationPage.tsx','resolveParameterInputState',{
    canUpdateAutomationCase:true,hasPermission:()=>false,session:{},projectId:'project',selectedParameterSuite:{id:'suite'},activeCaseSuiteIds:['suite']
  });
  assert.notEqual(scopeState('r').disabled,true);
  assert.equal(scopeState('s').disabled,true,'Suite changes require suite update permission');
});

test('automation flushes edited or explicitly reselected parameters before build review without copying inherited values',async()=>{
  const activeCase={id:'automation',revision:7,parameter_values:{'r.blank':''},test_data_options:{},inherited_parameter_values:{'t.private_input':'private-manual'}};
  const writes=[],cache=[];
  const dependencies={activeCase,lastAutomationCaseDraftSeedRef:{current:{caseKey:'case:project:automation'}},projectId:'project',
    normalizeAutomationParameterValues:normalizeStepParameterValues,testCaseParameterValues:{'r.blank':''},caseParameterSaveOptions,
    visiblePrivateNames:new Set(['t.private_input']),caseParameterOverrideDraftRef:{current:{scope:'project:automation',names:new Set(['r.blank'])}},caseParameterPrivacyScope:'project:automation',
    canUpdateAutomationCase:true,canViewTestData:true,selectedParameterSuite:null,activeCaseSuiteIds:[],suiteParameterValues:{},hasPermission:()=>false,session:{},
    api:{testCases:{update:async(id,input)=>{writes.push({id,input});return{revision:8};}}},
    automationCaseDetailQueryKey:()=>['case'],queryClient:{setQueriesData:(query,update)=>cache.push(update(activeCase))}};
  const flush=pageBinding('../../../automation/frontend/pages/AutomationPage.tsx','flushAutomationBuildParameters',dependencies);
  await flush(['another-case']);assert.equal(writes.length,0);
  await flush(['automation']);
  assert.deepEqual(writes[0].input.parameter_values,{'r.blank':''});
  assert.deepEqual(writes[0].input.test_data_options.parameter_overrides,['r.blank']);
  assert.equal(writes[0].input.expected_revision,7);
  assert.equal(Object.hasOwn(writes[0].input.parameter_values,'t.private_input'),false);
  assert.equal(cache[0].revision,8);
  assert.deepEqual(activeCase.parameter_values,{'r.blank':''});
  const denied=pageBinding('../../../automation/frontend/pages/AutomationPage.tsx','flushAutomationBuildParameters',{...dependencies,canUpdateAutomationCase:false});
  await assert.rejects(denied(['automation']),/Case update and Test Data access/);assert.equal(writes.length,1);
});
