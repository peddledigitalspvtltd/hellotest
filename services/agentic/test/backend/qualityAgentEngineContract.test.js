const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const C=require('../../backend/services/qualityAgentContracts');
// Compile the actual runtime input contract in isolation; this exercises both
// owners' validators without booting an unrelated server or database.
function compile(relative,dependencies={}) {
  const filename=path.resolve(__dirname,'../../../../',relative),module=new Module(filename);
  module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));
  const original=module.require.bind(module);module.require=name=>dependencies[name]||original(name);
  module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return module.exports;
}
const canonical=compile('testengine/backend/src/contracts/qualityAgents.ts');
const engine=compile('testengine/backend/src/lib/qualityAgents/contracts.ts',{'../../contracts/qualityAgents.js':canonical});
function envelope(input) {
  const r=C.normalizeLaunch(input),{timeout_ms,max_pages,...options}=r.options;
  return {client_run_id:'client-run-12345678',kind:r.kind,target_url:r.target_url,scope:{project_id:r.project_id,app_type_id:r.app_type_id},options:{...options,...(r.kind==='web'?{approved_steps:r.reviewed_plan?.steps.map(({id,label,...step})=>step)||[]}:{})},limits:{max_pages,max_duration_ms:timeout_ms}};
}
test('all five platform preset envelopes pass the actual engine validator',()=>{
  for(const kind of canonical.QUALITY_AGENT_KINDS) {
    const result=engine.parseQualityInput(envelope({project_id:'project-a',kind,target_url:'https://qa.example.test/search?category=devices'}));
    assert.equal(result.target_url,'https://qa.example.test/search?category=devices');assert.equal(result.scope.app_type_id,null);assert.equal(result.options.viewport.width,1280);
  }
});
test('actual engine accepts twelve reviewed actions and exact configured masks/budgets',()=>{
  const goal='Check saved search summaries',steps=Array.from({length:12},(_,index)=>({action:'assert_text',selector:'.summary',text:`Item ${index}`}));
  const journey=engine.parseQualityInput(envelope({project_id:'project-a',app_type_id:'app-a',kind:'web',target_url:'https://qa.example.test/',goal,reviewed_plan:{reviewed:true,goal,steps},options:{max_pages:5}}));
  assert.equal(journey.options.approved_steps.length,12);assert.equal(journey.limits.max_pages,5);
  const performance=engine.parseQualityInput(envelope({project_id:'project-a',kind:'performance',target_url:'https://qa.example.test/',options:{budgets:{navigation_ms:100,lcp_ms:120000,cls:0,resource_count:250,transfer_bytes:100000000}}}));assert.equal(performance.options.budgets.resource_count,250);
  const visual=engine.parseQualityInput(envelope({project_id:'project-a',kind:'visual',target_url:'https://qa.example.test/',options:{masks:['.timestamp'],pixel_threshold:16,max_diff_ratio:.005}}));assert.deepEqual(visual.options.masks,['.timestamp']);
});
test('both contracts reject embedded credentials, secret query keys and typed secret fills',()=>{
  for(const url of ['https://user:secret@qa.example.test/','https://qa.example.test/?refresh_token=value']){assert.throws(()=>C.targetUrl(url));assert.throws(()=>engine.validQualityUrl(url));}
  const unsafe={action:'fill',selector:'input[name=password]',value:'sensitive'};assert.throws(()=>C.normalizeSteps([unsafe],'https://qa.example.test/'));assert.throws(()=>engine.parseQualityInput({...envelope({project_id:'project-a',kind:'web',target_url:'https://qa.example.test/'}),options:{approved_steps:[unsafe]}}));
});
test('reviewed field clearing and deliberate padding retain exact fill values across both contracts',()=>{
  for(const value of ['', '   ', '  Ada  ']) {
    const goal='Verify a non-secret input field',step={action:'fill',selector:'#name',value};
    const request=envelope({project_id:'project-a',kind:'web',target_url:'https://qa.example.test/',goal,reviewed_plan:{reviewed:true,goal,steps:[step]}});
    assert.equal(request.options.approved_steps[0].value,value);
    assert.equal(engine.parseQualityInput(request).options.approved_steps[0].value,value);
  }
  const unsafe={action:'fill',selector:'#name',value:'control\u0000value'};
  assert.throws(()=>C.normalizeSteps([unsafe],'https://qa.example.test/'));
  assert.throws(()=>engine.parseQualityInput({...envelope({project_id:'project-a',kind:'web',target_url:'https://qa.example.test/'}),options:{approved_steps:[unsafe]}}));
});
