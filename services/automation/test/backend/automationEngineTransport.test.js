const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../../backend/services/aiAutomationBuilder.service');
const localRequire = createRequire(filename);
test('TestEngine requests bypass model governance and never replay engine mutations',async()=>{
 const calls=[],module={exports:{}};
 new Function('require','module','exports',readFileSync(filename,'utf8')+'\nmodule.exports={readEngineJson};')(id=>{
 if (typeof id === 'string' && id.startsWith('./builder/')) return require('node:module').createRequire(require.resolve('@hellotest/automation/build'))(id);
 if (id.endsWith('/automationAuthoringAdmission.service') || id === '@hellotest/automation/authoring-admission') return {withBuild:async(_scope,reserve)=>reserve(),withRecorder:async(_scope,reserve)=>reserve(),assertNoRecorder:async()=>({state:'idle'})};

  if(id.endsWith('/db')||id.endsWith('/obsDb'))return {prepare:()=>({})};
  if(id.endsWith('/llmHttpClient'))return {fetchLlmWithRetry:()=>assert.fail('Engine HTTP is not model generation')};
  if(id.endsWith('/resilientHttpClient'))return {resilientHttpRequest:async(url,init,options)=>{calls.push({url,init,options});return new Response(JSON.stringify({status:'queued',run_id:'native-run'}));}};
  return localRequire(id);
 },module,module.exports);
 const body=JSON.stringify({test_case_id:'case',run_id:'native-run'});
 assert.deepEqual(await module.exports.readEngineJson('https://engine.invalid/runs',{method:'POST',body}),{status:'queued',run_id:'native-run'});
 assert.equal(calls.length,1);assert.equal(calls[0].init.body,body);assert.equal(calls[0].options.dependency,'test-engine');assert.equal(calls[0].options.maxAttempts,1);assert.equal(calls[0].options.idempotent,false);
});
test.after(()=>localRequire('@hellotest/platform/backend/src/db').close());
