const test=require('node:test'),assert=require('node:assert/strict');
const {recordedLocatorSource,compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../backend/lib/automationProgramTools');
const {projectModelSnapshot,resolveModelToolRequest,browserObservedTargetFeedback}=require('../../backend/lib/automationBrowserModelTargets');

test('one terminal semicolon normalizes only a complete supported locator expression',()=>{
 for(const source of ['page.getByText("Log Out", {exact:true})','getByRole("link",{name:"Log Out"})',
  'page.getByLabel("Name").first()','getByText("a;b").nth(0)','locator("[data-value=\\"a;b\\"]")']){
  const canonical=recordedLocatorSource(source);assert.ok(canonical,source);
  assert.equal(recordedLocatorSource(source+';'),canonical);assert.equal(recordedLocatorSource(source+'; \n'),canonical);
 }
 for(const source of ['getByText("Log Out");;','getByText("Log Out"); globalThis.bad = true;',
  'getByText("Log Out").click();','getByText(/Log Out/);','getByText(variable);','getByText("Log Out", {...options});',
  'getByText("Log Out"); /* extra */','page.locator("getByText(\\"Log Out\\")");'])assert.equal(recordedLocatorSource(source),null,source);
 for(const css of ['[data-value="a;b"]','.escaped\\;'])assert.equal(recordedLocatorSource(css),`page.locator(${JSON.stringify(css)})`);
});

test('semicolon discovery candidates and plain semantic proposals resolve to the same observed target and native source',()=>{
 const scoped='page.getByText("Log Out", {exact:true});',plain='getByText("Log Out", {exact:true})';
 const observation={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',observation_id:'scoped',url:'https://app.test/',scope:scoped,
  elements:[{tag:'span',text:'Log Out',displayed:true,locators_validated:true,locator_candidates:[scoped]}]})}]}};
 const model=projectModelSnapshot(observation);assert.equal(model.targets.length,1);
 const request=resolveModelToolRequest({name:'browser_assert',arguments:{assertion:'visible',locator:plain}},observation);
 assert.equal(request.arguments.locator,scoped);assert.equal(browserObservedTargetFeedback({request,snapshot:observation,execution:{step_id:'current'}}),null);
 const compiled=compileRecordedProgram([request]);assert.ok(compiled);assert.match(compiled.source,/page\.getByText\(/);
 assert.doesNotMatch(compiled.source,/locator\("page|getByText.*;"/);
 const lowered=deriveProgramTools({payload:{steps:[{step_id:'current',automation_code:compiled.source}]},execution:{required:true,step_id:'current'}});
 assert.equal(compileRecordedProgram(lowered).source,compiled.source);
});
