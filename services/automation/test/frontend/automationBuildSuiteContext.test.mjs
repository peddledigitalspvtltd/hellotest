import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText;
const load = (path, resolve) => {
  const exports={};new Function('require','exports',compile(path))(resolve,exports);return exports;
};
const parameterLib=load('../../frontend/lib/automationBuildParameters.ts',()=>({}));
const pairedAgentLib=load('../../../agentic/frontend/lib/pairedLocalAgent.ts',()=>({}));
const pairedBuildLib=load('../../../testing/frontend/lib/pairedBrowserBuild.ts',id=>id.endsWith('/pairedLocalAgent')?pairedAgentLib:{});
function apiFixture() {
  const requests=[];
  let respond=async(url,input)=>({test_case_id:url.split('/')[2],test_suite_id:input.test_suite_id || (url.includes('/two/')?'suite-two':null),parameter_plan_key:'pin:'+url,parameter_values:{},parameter_references:[],private_parameter_references:[],missing_parameter_references:[],deferred_parameter_references:[]});
  const {testingApi}=load('../../../testing/frontend/api.client.ts',id=>id.endsWith('/httpClient')?{
    request:async(url,options)=>{const input=JSON.parse(options.body);requests.push({url,input});return respond(url,input);},toQueryString:()=>''
  }:id.endsWith('/pairedBrowserBuild')?pairedBuildLib:{});
  return {api:testingApi,requests,setRespond(value){respond=value;}};
}
function hookFixture(api) {
  const slots=[];let cursor=0;
  const react={
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(initial){const i=cursor++;if(!slots[i])slots[i]={current:initial};return slots[i];},
    useEffect(effect,deps){const i=cursor++;if(!slots[i]||deps.some((value,index)=>value!==slots[i].deps[index])){slots[i]?.cleanup?.();slots[i]={deps,cleanup:effect()};}}
  };
  const {useAutomationBuildParameters}=load('../../frontend/hooks/useAutomationBuildParameters.tsx',id=>id==='react'?react:id==='react/jsx-runtime'?{jsx:(type,props,key)=>({type,props,key})}:id.endsWith('/api')?{api}:id.endsWith('/automationBuildParameters')?parameterLib:{AutomationBuildParameterDialog:'ParameterReview'});
  return {render(scope='case:suite'){cursor=0;return useAutomationBuildParameters(scope);}};
}
const plan=(id,suite,extra={})=>({test_case_id:id,test_suite_id:suite,parameter_plan_key:'pin:'+id,parameter_values:{},parameter_references:[],private_parameter_references:[],missing_parameter_references:[],deferred_parameter_references:[],...extra});

test('real parameter-plan and generation API clients retain optional suite IDs and per-case nulls',async()=>{
  const {api,requests}=apiFixture();
  await api.testCases.automationParameterPlan('case /1',{test_suite_id:'suite-one'});
  await api.testCases.buildAutomation('one',{test_suite_id:'suite-one',parameter_plan_key:'reviewed'});
  await api.testCases.queueAutomationGenerator('one',{test_suite_id:'suite-one'});
  await api.testCases.buildAutomationBatch({app_type_id:'app',test_case_ids:['one','two'],test_suite_ids_by_case:{one:'suite-one',two:null},browser_location:'remote'});
  assert.equal(requests.length,4,'Remote build preparation must not create a paired browser bridge.');
  assert.equal(requests[0].url,'/test-cases/case%20%2F1/automation/parameter-plan');
  assert.equal(requests[0].input.test_suite_id,'suite-one');
  assert.equal(requests[1].input.test_suite_id,'suite-one');
  assert.equal(requests[2].input.test_suite_id,'suite-one');
  assert.deepEqual(requests[3].input.test_suite_ids_by_case,{one:'suite-one',two:null});
  assert.equal(Object.hasOwn(requests[3].input,'browser_location'),false,'The actual helper consumes the browser selection before sending the API payload.');
});

test('actual review hook pins each resolved suite and never leaks the active suite into another case',async()=>{
  const {api,requests,setRespond}=apiFixture();
  setRespond(async(url,input)=>plan(url.includes('/one/')?'one':'two',input.test_suite_id || 'suite-two'));
  const harness=hookFixture(api),hook=harness.render();
  const reviewed=await hook.reviewBuildParameters(['one','two','one'],{test_environment_id:'env',test_suite_ids_by_case:{one:'chosen-one'}});
  assert.deepEqual(requests.map(item=>item.input),[{test_environment_id:'env',test_suite_id:'chosen-one'},{test_environment_id:'env'}]);
  assert.deepEqual(reviewed.test_suite_ids_by_case,{one:'chosen-one',two:'suite-two'});
  await api.testCases.buildAutomationBatch({app_type_id:'app',test_case_ids:['one','two'],...reviewed});
  assert.deepEqual(requests.at(-1).input.test_suite_ids_by_case,{one:'chosen-one',two:'suite-two'});
});

test('explicit suite mismatch fails before a reviewed plan can be dispatched',async()=>{
  const {api,setRespond}=apiFixture();setRespond(async()=>plan('one','different'));
  const hook=hookFixture(api).render();
  await assert.rejects(hook.reviewBuildParameters(['one'],{test_suite_id:'chosen'}),/reviewed suite changed/);
});

test('changing suite while a source request is pending invalidates the old review',async()=>{
  const {api,setRespond}=apiFixture();let resolve;
  setRespond(()=>new Promise(done=>{resolve=done;}));
  const harness=hookFixture(api),hook=harness.render('case:suite-one');
  const review=hook.reviewBuildParameters(['one'],{test_suite_id:'suite-one'});
  harness.render('case:suite-two');resolve(plan('one','suite-one'));
  assert.equal(await review,null);
  setRespond(async()=>plan('one','suite-two'));
  assert.deepEqual((await harness.render('case:suite-two').reviewBuildParameters(['one'],{test_suite_id:'suite-two'})).test_suite_ids_by_case,{one:'suite-two'});
});

test('changing suite while the data dialog is open cancels it and keeps the next review isolated',async()=>{
  const {api,setRespond}=apiFixture();setRespond(async()=>plan('one','suite-one',{missing_parameter_references:['s.region'],parameter_references:['s.region']}));
  const harness=hookFixture(api),hook=harness.render('case:suite-one');
  const review=hook.reviewBuildParameters(['one'],{test_suite_id:'suite-one'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(harness.render('case:suite-one').parameterReviewDialog.props.plan.test_suite_id,'suite-one');
  harness.render('case:suite-two');assert.equal(await review,null);
  assert.equal(harness.render('case:suite-two').parameterReviewDialog,null);
});

test('a per-case no-suite selection overrides a scalar without serializing the batch map into a plan request',()=>{
  assert.deepEqual(parameterLib.automationBuildParameterRequest({test_suite_id:'active',test_suite_ids_by_case:{two:null},test_data_set_id:'data'},'two'),{test_suite_id:undefined,test_data_set_id:'data'});
});

test('the actual case suite effect selects a sole suite and requires a choice for multiple suites',()=>{
  const source=readFileSync(new URL('../../frontend/pages/AutomationPage.tsx',import.meta.url),'utf8');
  const start=source.lastIndexOf('  useEffect(() => {',source.indexOf('if (!activeCaseSuiteIds.length)'));
  const end=source.indexOf('  }, [activeCaseSuiteIds, selectedParameterSuiteId]);',start);
  const effect=new Function('activeCaseSuiteIds','selectedParameterSuiteId','setSelectedParameterSuiteId','setSuiteParameterValues',source.slice(start+'  useEffect(() => {'.length,end));
  const run=(ids,selected)=>{let result=selected;effect(ids,selected,value=>{result=value;},()=>{});return result;};
  assert.equal(run(['only'],''),'only');
  assert.equal(run(['first','second'],''),'');
  assert.equal(run(['first','second'],'removed'),'');
  assert.equal(run(['first','second'],'second'),'second');
  assert.equal(run([],'old'),'');
});
