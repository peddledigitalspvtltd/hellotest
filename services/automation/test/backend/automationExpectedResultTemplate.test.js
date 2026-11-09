const test=require('node:test');
const assert=require('node:assert/strict');
const {automationExpectedResultTemplate}=require('../../backend/lib/automationExpectedResultTemplate');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');

test('projected expected-result prose retains its original mutable template',()=>{
  const source={id:'save',step_order:1,step_type:'web',action:'Save @t.item_name',expected_result:'The status displays Saved @t.item_name.'};
  const resolver=createBrowserParameterResolver({testCase:{id:'case'},caseValues:{item_name:'Build-time name'},steps:[source]});
  const section={...resolver.projectSteps([source])[0],...automationExpectedResultTemplate(source,resolver)};
  assert.equal(section.expected_result,'The status displays Saved Build-time name.');
  assert.equal(section.parameterized_expected_result,source.expected_result);
  assert.equal(resolver.promptValues['t.item_name'],'Build-time name');
});

test('original expected templates preserve scoped references and redact separately authored private literals',()=>{
  const source={expected_result:'Saved @t.[item.name]; credential private-fixture is hidden and @s.region remains selected.'};
  const resolver=createBrowserParameterResolver({testCase:{id:'case'},caseValues:{'item.name':'Build-time name',password:'private-fixture'},privateParameterNames:['t.password'],steps:[source]});
  const result=automationExpectedResultTemplate(source,resolver);
  assert.equal(result.parameterized_expected_result,'Saved @t.[item.name]; credential [private parameter value] is hidden and @s.region remains selected.');
  assert.doesNotMatch(JSON.stringify(result),/Build-time name|private-fixture/);
});

test('token-looking inserted data and parameters used only by an action cannot invent an expected-result template',()=>{
  const source={action:'Enter @t.item_name',expected_result:'Saved fixed text.'};
  const resolver=createBrowserParameterResolver({testCase:{id:'case'},caseValues:{item_name:'@s.unrelated'},steps:[source]});
  assert.deepEqual(automationExpectedResultTemplate(source,resolver),{});
  assert.equal(resolver.projectSteps([source])[0].action,'Enter @s.unrelated');
});
