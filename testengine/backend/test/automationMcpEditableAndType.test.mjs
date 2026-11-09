import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAutomationBrowserCondition,validateAutomationBrowserAssertion,readEffectiveInputType,automationBrowserTools} from '../dist/lib/automationMcp.js';

const subject=(locator)=>({isClosed:()=>false,url:()=>'https://app.test/login',locator:()=>locator});
const options=(ms=500)=>({deadline:Date.now()+ms,origin:'https://app.test'});

test('typed editability uses native Playwright editability and cannot substitute enabled for it',async()=>{
  let editable=false,reads=0,enabledReads=0;
  const page=subject({count:async()=>1,isEditable:async()=>{reads++;return editable;},isEnabled:async()=>{enabledReads++;return true;}});
  const args={assertion:'editable',locator:'#username'};
  assert.equal(validateAutomationBrowserAssertion(args),true);
  assert.equal(validateAutomationBrowserAssertion({...args,value:''}),false);
  assert.equal(validateAutomationBrowserAssertion({assertion:'editable'}),false);
  await assert.rejects(assertAutomationBrowserCondition(page,args,options(25)),{code:'BROWSER_ASSERTION_NOT_SATISFIED'});
  editable=true;
  const receipt=await assertAutomationBrowserCondition(page,args,options());
  assert.equal(receipt.assertion_outcome,'satisfied');assert.equal(receipt.assertion_subject,'native_editability');
  assert.equal(receipt.validation_scope,'selected_control_only');assert.ok(reads>=2);assert.equal(enabledReads,0);
});

test('editability retries the same read-only native predicate without performing a fill',async()=>{
  let reads=0;
  const page=subject({count:async()=>1,isEditable:async()=>++reads>=3,fill:async()=>{throw Error('An assertion must not fill');}});
  const receipt=await assertAutomationBrowserCondition(page,{assertion:'editable',locator:'#username'},options());
  assert.equal(receipt.assertion_outcome,'satisfied');assert.equal(reads,3);
});

test('input_type reads only a native input effective property, compares exact expected text and withholds both values',async t=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'HTMLInputElement');
  class Input {constructor(type){this.type=type;}get value(){throw Error('No credential reads');}}
  Object.defineProperty(globalThis,'HTMLInputElement',{value:Input,configurable:true});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,'HTMLInputElement',prior);else delete globalThis.HTMLInputElement;});
  let element=new Input('password'),reads=0;
  const page=subject({count:async()=>1,evaluate:async reader=>{reads++;return reader(element);}});
  for(const value of ['password','text'])assert.equal(validateAutomationBrowserAssertion({assertion:'input_type',locator:'#field',value}),true);
  for(const args of[{assertion:'input_type',locator:'#field'},{assertion:'input_type',value:'password'},{assertion:'input_type',locator:'#field',value:''}])assert.equal(validateAutomationBrowserAssertion(args),false);
  const check=value=>assertAutomationBrowserCondition(page,{assertion:'input_type',locator:'#field',value},options(25));
  const receipt=await check('password');
  assert.equal(receipt.assertion_subject,'effective_input_type');assert.equal(receipt.validation_scope,'selected_input_only');
  assert.doesNotMatch(JSON.stringify(receipt),/password|PASSWORD/);
  await assert.rejects(check('PASSWORD'),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED'&&!/password|PASSWORD/.test(error.message));
  element=new Input('text');assert.equal((await check('text')).assertion_outcome,'satisfied');
  element={type:'password'};
  assert.equal(readEffectiveInputType(element),null);
  await assert.rejects(check('password'),{code:'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED'});
  assert.ok(reads>=4);
});

test('new predicates retain unique-target admission and native unsupported subjects fail explicitly',async()=>{
  let reads=0;
  const ambiguous=subject({count:async()=>2,isEditable:async()=>{reads++;return true;},evaluate:async()=>{reads++;return 'password';}});
  for(const assertion of ['editable','input_type'])await assert.rejects(assertAutomationBrowserCondition(ambiguous,{assertion,locator:'.many',...(assertion==='input_type'?{value:'password'}:{})},options()),{code:'BROWSER_ASSERTION_AMBIGUOUS'});
  assert.equal(reads,0);
  const unsupported=subject({count:async()=>1,isEditable:async()=>{throw Error('Element is not an <input>, <textarea>, <select> or [contenteditable]');}});
  await assert.rejects(assertAutomationBrowserCondition(unsupported,{assertion:'editable',locator:'#heading'},options()),{code:'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED'});
  const tool=automationBrowserTools.find(tool=>tool.name==='browser_assert');
  for(const assertion of['editable','input_type'])assert.ok(tool.inputSchema.properties.assertion.enum.includes(assertion));
});
