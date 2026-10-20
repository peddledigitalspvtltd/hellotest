const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {normalizeDataOptions}=require('../../../platform/backend/src/utils/scopedTestData');
const {normalizeParameterLayer}=require('../../../platform/backend/src/utils/stepParameterResolution');
const source=fs.readFileSync(require.resolve('../../backend/services/testCase.service'),'utf8');
const body=source.slice(source.indexOf('const caseDataOptions ='),source.indexOf('const DEFAULT_PRIORITY'));
const optionsFor=new Function('normalizeDataOptions','normalizeParameterLayer',body+'return caseDataOptions;')(normalizeDataOptions,normalizeParameterLayer);
test('removing an own override restores inherited precedence while explicit blank continues to override',()=>{
 const input={override_shared_steps:false,parameter_overrides:['t.name','r.optional','r.removed']},before=JSON.stringify(input);
 const result=optionsFor(input,{'t.name':'Reader','r.optional':''});
 assert.deepEqual(result.parameter_overrides,['r.optional','t.name']);assert.equal(result.override_shared_steps,false);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(optionsFor({parameter_overrides:['t.name']},{name:'Legacy own binding'}).parameter_overrides,['t.name']);
 assert.equal(optionsFor(input,{}).parameter_overrides,undefined);
});
test('private own-name markers survive ordinary value edits and are removed only when their own binding is removed',()=>{
 const input={private_parameter_names:['@R.Mode','r.empty','r.removed'],parameter_overrides:['r.mode']};
 const result=optionsFor(input,{'r.mode':'changed-private-own-value','r.empty':''});
 assert.deepEqual(result.private_parameter_names,['r.empty','r.mode']);assert.deepEqual(result.parameter_overrides,['r.mode']);
 assert.doesNotMatch(JSON.stringify(result),/changed-private-own-value/);
 assert.equal(optionsFor(result,{'r.empty':''}).private_parameter_names.includes('r.mode'),false);
 assert.equal(optionsFor(result,{}).private_parameter_names,undefined);
 assert.deepEqual(optionsFor({override_shared_steps:true},{'r.mode':'another-private-edit'},result).private_parameter_names,['r.mode'],'unrelated options edits cannot silently remove a bound private classification');
});
test('private marker metadata rejects raw objects, oversized lists and control characters while canonicalizing only names',()=>{
 assert.deepEqual(normalizeDataOptions({private_parameter_names:['@R.Mode','@r.[Other input]','r.mode']}).private_parameter_names,['r.mode','r.other input']);
 for(const value of [{key:'r.mode',value:'must-not-store'},['r.mode\nvalue'],Array.from({length:257},(_,i)=>`r.key${i}`)])assert.throws(()=>normalizeDataOptions({private_parameter_names:value}),error=>error.statusCode===400);
});
