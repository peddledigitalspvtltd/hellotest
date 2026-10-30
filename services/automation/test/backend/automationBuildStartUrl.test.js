const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {normalizeAutomationStartUrl,requiresAutomationStartUrl}=require('../../../platform/backend/src/utils/automationStartUrl');
function fixture({allowed=true,moved=false,savedUrl='https://old.test/',sourceKey}={}){
 const writes=[],module={exports:{}};
 const current={id:'auto',app_type_id:moved?'other-app':'app',automation_start_url:savedUrl,source_idempotency_key:sourceKey,revision:7};
 const source=fs.readFileSync(require.resolve('../../backend/lib/automationBuildStartUrl'),'utf8');
 new Function('require','module','exports',source)(id=>id.endsWith('/automationCaseType')?require('../../../platform/backend/src/utils/automationCaseType'):id.endsWith('/automationStartUrl')?{normalizeAutomationStartUrl,requiresAutomationStartUrl}:id.endsWith('/optionalEvidenceAccess.service')?{getOptionalEvidenceAccess:async()=>({'testcase.update':allowed})}:{getTestCase:async()=>current,updateTestCase:async(...args)=>writes.push(args)},module,module.exports);
 return {...module.exports,writes};
}
const web={id:'auto',automated:'yes',app_type_id:'app',project_id:'p',app_type_kind:'web',automation_start_url:'https://old.test/'};
test('a reviewed build target overrides the saved target and persists through ordinary versioned case access',async()=>{
 const f=fixture(),result=await f.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'https://new.test/signup?mode=qa',userId:'builder'});
 assert.deepEqual(result,{url:'https://new.test/signup?mode=qa',savedStartUrl:'https://new.test/signup?mode=qa'});assert.deepEqual(f.writes,[['auto',{automation_start_url:result.url,expected_revision:7,updated_by:'builder'},{syncSharedGroups:false,expectedAutomationStartUrl:'https://old.test/'}]]);
});
test('build-only access can use a reviewed request without silently modifying the saved case target',async()=>{
 const f=fixture({allowed:false});assert.deepEqual(await f.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'https://new.test/signup',userId:'builder'}),{url:'https://new.test/signup',savedStartUrl:'https://old.test/'});assert.equal(f.writes.length,0);
 await assert.rejects(f.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'',userId:'builder'}),error=>error.code==='AUTOMATION_START_URL_REQUIRED');
 const moved=fixture({moved:true});await assert.rejects(moved.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'https://new.test',userId:'builder'}),error=>error.code==='AUTOMATION_TARGET_CHANGED');assert.equal(moved.writes.length,0);
});
test('queued target review rejects later URL edits and target replacements before persistence, including build-only callers',async()=>{
 const review={source_test_case_id:'auto',automation_test_case_id:'auto',automation_start_url:'https://old.test/'};
 for(const allowed of [true,false]){
  const f=fixture({allowed,savedUrl:'https://later.test/'});
  await assert.rejects(f.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'https://old.test/',userId:'builder',startUrlReview:review}),error=>error.code==='AUTOMATION_START_URL_CHANGED');assert.equal(f.writes.length,0);
 }
 const f=fixture();await assert.rejects(f.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'https://old.test/',userId:'builder',startUrlReview:{...review,automation_test_case_id:'replaced'}}),error=>error.code==='AUTOMATION_START_URL_CHANGED');assert.equal(f.writes.length,0);
});
test('an unchanged queued target can save an explicit reviewed URL while retaining its exact final-apply baseline',async()=>{
 const f=fixture(),result=await f.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'https://reviewed.test/',userId:'builder',startUrlReview:{source_test_case_id:'auto',automation_test_case_id:'auto',automation_start_url:'https://old.test/'}});
 assert.deepEqual(result,{url:'https://reviewed.test/',savedStartUrl:'https://reviewed.test/'});assert.equal(f.writes.length,1);assert.equal(f.writes[0][2].expectedAutomationStartUrl,'https://old.test/');
 const retry=fixture({savedUrl:'https://reviewed.test/'});
 assert.deepEqual(await retry.resolveBuildStartUrl({testCase:web,steps:[{step_type:'web'}],startUrl:'https://reviewed.test/',userId:'builder',startUrlReview:{source_test_case_id:'auto',automation_test_case_id:'auto',automation_start_url:'https://old.test/'}}),result);assert.equal(retry.writes.length,0,'a durable retry can reuse its already-saved target without writing history again');
});
test('preparing a queued manual target accepts only its matching source and reviewed URL',async()=>{
 const input={testCase:web,steps:[{step_type:'web'}],startUrl:'https://reviewed.test/',userId:'builder',startUrlReview:{source_test_case_id:'manual',automation_test_case_id:null,automation_start_url:null}};
 const f=fixture({savedUrl:'https://reviewed.test/',sourceKey:'automation-builder:manual'});
 assert.deepEqual(await f.resolveBuildStartUrl(input),{url:'https://reviewed.test/',savedStartUrl:'https://reviewed.test/'});assert.equal(f.writes.length,0);
 for(const setup of [{savedUrl:'https://later.test/',sourceKey:'automation-builder:manual'},{savedUrl:'https://reviewed.test/',sourceKey:'automation-builder:other'}]){
  const changed=fixture(setup);await assert.rejects(changed.resolveBuildStartUrl(input),error=>error.code==='AUTOMATION_START_URL_CHANGED');assert.equal(changed.writes.length,0);
 }
});
test('browser targets reject unsafe or unresolved URLs and API/native-only plans retain their runtimes',()=>{
 for(const value of [undefined,'','file:///tmp/data','javascript:alert(1)','https://user:secret@app.test','https://app.test/@t.route','https://app.test/\npath'])assert.throws(()=>normalizeAutomationStartUrl(value,{required:true}));
 assert.equal(normalizeAutomationStartUrl(' https://app.test/signup?mode=qa#account '),'https://app.test/signup?mode=qa#account');
 assert.equal(requiresAutomationStartUrl({appTypeKind:'web',steps:[{step_type:'api'}]}),false);assert.equal(requiresAutomationStartUrl({appTypeKind:'android'}),false);assert.equal(requiresAutomationStartUrl({appTypeKind:'unified',steps:[{step_type:'ios'},{step_type:'web'}]}),true);
});
