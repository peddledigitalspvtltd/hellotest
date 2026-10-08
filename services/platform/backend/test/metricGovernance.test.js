const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../services/metricGovernance.service');
const analytics=require('@hellotest/dashboard/backend/services/portfolioAnalytics.service');
test('all 42 metric defaults validate and calculation parameters share the same catalog',()=>{
 assert.equal(service.catalog.length,42);
 for(const metric of service.catalog){assert.deepEqual(service.validate(service.defaults(metric),metric.key),service.defaults(metric));if(metric.parameters?.length)assert.deepEqual(analytics.DEFAULT_FORMULA_VALUES[metric.key],service.defaults(metric).parameters);}
});
test('portfolio publication rejects invalid totals, numeric strings, bounds and arbitrary formula edits',()=>{
 const id='metric.project.portfolio_health',base=service.defaults(service.catalog.find(item=>item.key===id));
 for(const patch of [{parameters:{...base.parameters,story_weight:36}},{parameters:{...base.parameters,story_weight:'35'}},{parameters:{...base.parameters,story_weight:-1}},{parameters:{...base.parameters,story_weight:34.5}},{formula:'arbitrary expression'},{parameters:{...base.parameters,extra:0}}])assert.throws(()=>service.validate({...base,...patch},id),{statusCode:400});
 assert.deepEqual(service.validate({...base,parameters:{story_weight:40,automation_weight:30,pass_weight:30}},id).parameters,{story_weight:40,automation_weight:30,pass_weight:30});
});
test('fixed formulas accept bounded organization criteria and cannot gain numeric parameters',()=>{
 const id='metric.story.coverage',base=service.defaults(service.catalog.find(item=>item.key===id));
 assert.equal(service.validate({...base,criteria:'  Use exact current Story relationships.  '},id).criteria,'Use exact current Story relationships.');
 for(const patch of [{criteria:''},{criteria:'x'.repeat(8001)},{parameters:{denominator:1}},{parameters:[]}])assert.throws(()=>service.validate({...base,...patch},id),{statusCode:400});
 assert.throws(()=>service.validate(base,'metric.arbitrary'),{statusCode:404});
});
test.after(()=>require('../src/db').close());
