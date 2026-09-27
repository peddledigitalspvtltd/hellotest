const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../backend/lib/automationBuildContext'),'utf8');
function fixture(allowed){
 const reads=[];const module={exports:{}};
 vm.runInNewContext(source,{module,require:id=>id.endsWith('/db')?{prepare:sql=>({all:async(...params)=>{reads.push({sql,params});return reads.length===1?[{id:'story',title:'Manual case story',description:'Acceptance flow',additional_fields:{acceptance_criteria:['Saved successfully']},gherkin_scenarios:[{scenario:'Save profile',then:'Saved successfully'}],specification_content:'Use the verified account flow.'}]:[{id:'related',title:'Dependency story',additional_fields:{acceptance_criteria:['Account exists']}}];}})}:{getOptionalEvidenceAccess:async(user,project,codes)=>{assert.equal(user.id,'author');assert.equal(project,'project');assert.deepEqual([...codes],['requirement.view']);return {'requirement.view':allowed};}}});
 return {...module.exports,reads};
}
test('automation context includes linked/manual-source stories and related acceptance criteria within project scope',async()=>{
 const f=fixture(true);const result=await f.loadAutomationStoryContext({caseId:'case',projectId:'project',userId:'author'});
 assert.match(result.stories[0].acceptance_criteria,/Saved successfully/);assert.equal(result.related_stories[0].id,'related');
 assert.match(result.stories[0].gherkin_scenarios,/Save profile/);assert.equal(result.stories[0].specification_content,'Use the verified account flow.');
 assert.match(f.reads[0].sql,/automation_case_links/);assert.deepEqual(f.reads[0].params,['case','case','project']);assert.equal(f.reads[1].params[0],'project');
});
test('disabled or unauthorized story evidence is omitted before database reads',async()=>{
 const f=fixture(false);const result=await f.loadAutomationStoryContext({caseId:'case',projectId:'project',userId:'author'});
 assert.equal(result.stories.length,0);assert.equal(f.reads.length,0);
});
