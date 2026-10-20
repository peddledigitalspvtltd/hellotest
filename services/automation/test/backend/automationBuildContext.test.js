const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../backend/lib/automationBuildContext'),'utf8');
const {resolveAutomationStartUrl}=require('../../backend/lib/automationBuildContext');

test('browser entry resolves only selected environment or saved explicit web navigation',()=>{
 const steps=[{id:'api',step_type:'api',automation_code:'await page.goto("https://api.test");'},{id:'entry',step_type:'web',automation_code:'await page.goto("https://app.test/signup");'}];
 assert.equal(resolveAutomationStartUrl({startUrl:'https://chosen.test',environmentUrl:'https://environment.test',steps}).source,'selected_url');
 assert.equal(resolveAutomationStartUrl({environmentUrl:'https://environment.test',steps}).url,'https://environment.test/');
 assert.deepEqual(resolveAutomationStartUrl({steps}),{url:'https://app.test/signup',source:'saved_navigation',step_id:'entry'});
 assert.equal(resolveAutomationStartUrl({steps:[{id:'manual',action:'Navigate to https://app.test/login'}]}).source,'case_navigation');
 for(const step of [{action:'See requirement https://tracker.test/ST_12'},{automation_code:'await page.goto(`https://app.test/${params.route}`);'},{automation_code:'await page.goto("https://user:password@app.test");'},{automation_code:'await page.goto("https://app.test/@e.route");'}])assert.equal(resolveAutomationStartUrl({steps:[step]}).url,null);
 assert.equal(resolveAutomationStartUrl({startUrl:'file:///private/config',steps}).url,null);
});
test('required browser generation uses only reviewed request or saved case URLs',()=>{
 const steps=[{id:'entry',automation_code:'await page.goto("https://old-example.test/signup");'}];
 assert.deepEqual(resolveAutomationStartUrl({startUrl:'https://chosen.test/signup?mode=qa',caseUrl:'https://saved.test',environmentUrl:'https://environment.test',steps,required:true}),{url:'https://chosen.test/signup?mode=qa',source:'selected_url'});
 assert.equal(resolveAutomationStartUrl({caseUrl:'https://saved.test/signup',environmentUrl:'https://environment.test',steps,required:true}).url,'https://saved.test/signup');
 assert.throws(()=>resolveAutomationStartUrl({environmentUrl:'https://environment.test',steps,required:true}),error=>error.code==='AUTOMATION_START_URL_REQUIRED');
 for(const startUrl of ['', 'javascript:alert(1)', 'https://user:secret@example.test', '@t.url'])assert.throws(()=>resolveAutomationStartUrl({startUrl,caseUrl:'https://saved.test',required:true}));
});
function fixture(allowed){
 const reads=[];const module={exports:{}};
 vm.runInNewContext(source,{module,require:id=>id.endsWith('/db')?{prepare:sql=>({all:async(...params)=>{reads.push({sql,params});return reads.length===1?[{id:'story',title:'Manual case story',description:'Acceptance flow',additional_fields:{acceptance_criteria:['Saved successfully']},gherkin_scenarios:[{scenario:'Save profile',then:'Saved successfully'}],specification_content:'Use the verified account flow.'}]:[{id:'related',title:'Dependency story',additional_fields:{acceptance_criteria:['Account exists']}}];}})}:{getOptionalEvidenceAccess:async(user,project,codes)=>{assert.equal(user.id,'author');assert.equal(project,'project');assert.deepEqual([...codes],['requirement.view']);return {'requirement.view':allowed};}}});
 return {...module.exports,reads};
}
test('automation context includes linked/manual-source stories and related acceptance criteria within project scope',async()=>{
 const f=fixture(true);const result=await f.loadAutomationStoryContext({caseId:'case',projectId:'project',userId:'author'});
 assert.match(result.stories[0].acceptance_criteria,/Saved successfully/);assert.equal(result.related_stories[0].id,'related');
 assert.match(result.stories[0].gherkin_scenarios,/Save profile/);assert.equal(result.stories[0].specification_content,'Use the verified account flow.');
 assert.match(f.reads[0].sql,/automation_case_links/);assert.deepEqual(f.reads[0].params,['case','case','case','case','project']);assert.equal(f.reads[1].params[0],'project');
});
test('disabled or unauthorized story evidence is omitted before database reads',async()=>{
 const f=fixture(false);const result=await f.loadAutomationStoryContext({caseId:'case',projectId:'project',userId:'author'});
 assert.equal(result.stories.length,0);assert.equal(f.reads.length,0);
});
test('linked manual context preserves complete actions and expectations and scopes reads',async()=>{
 const reads=[];const module={exports:{}};let allowed=true;
 vm.runInNewContext(source,{module,require:id=>id.endsWith('/db')?{prepare:sql=>({all:async(...params)=>{reads.push({sql,params});return sql.includes('automation_case_links')?[{id:'manual',title:'Checkout',description:'Complete flow'}]:[{id:'step',step_order:1,action:'Submit checkout',expected_result:'Order confirmed'}];}})}:{getOptionalEvidenceAccess:async()=>({'testcase.view':allowed})}});
 const result=await module.exports.loadAutomationManualContext({caseId:'automation',projectId:'project',userId:'author'});
 assert.equal(result[0].steps[0].expected_result,'Order confirmed');assert.deepEqual(reads[0].params,['automation','project']);assert.match(reads[0].sql,/app.project_id = \?/);assert.match(reads[0].sql,/tc\.app_type_id=target\.app_type_id/);assert.match(reads[0].sql,/target\.automated='yes'/);assert.match(reads[0].sql,/tc\.automated,'no'\)='no'/);
 allowed=false;reads.length=0;assert.equal((await module.exports.loadAutomationManualContext({caseId:'automation',projectId:'project',userId:'author'})).length,0);assert.equal(reads.length,0);
});

test('automation prompt parameters enforce data access and preserve private references without values',()=>{
 const f=fixture(true);
 const values={'t.username':'reader','t.password':'private','t.api_key':'private','t.otp':'private','t.verification_code':'private','t.one_time_code':'private','r.mode':'opaque-private'};
 assert.equal(Object.keys(f.automationPromptParameters(values,false)).length,0);
 const result=f.automationPromptParameters(values,true,['r.mode']);
 assert.equal(result['t.username'],'reader');assert.equal(result['t.password'],'[private parameter reference]');
 assert.ok(!JSON.stringify(result).includes(':"private"'));assert.equal(result['t.otp'],'[private parameter reference]');
 assert.equal(result['t.verification_code'],'[private parameter reference]');assert.equal(result['t.one_time_code'],'[private parameter reference]');
 assert.equal(result['r.mode'],'[private parameter reference]');assert.doesNotMatch(JSON.stringify(result),/opaque-private/);
});
