const test=require('node:test');
const assert=require('node:assert/strict');
const {projectModelSnapshot,resolveModelToolRequest,repositoryTargetEvidence}=require('../../backend/lib/automationBrowserModelTargets');
const {recordBrowserOperation,recordedSectionRequests}=require('../../backend/lib/automationBrowserRecording');
const {createBrowserBatchTargetResolver}=require('../../backend/lib/automationBrowserBatchTargets');
const {captureBrowserBatchState,browserBatchBoundary}=require('../../backend/lib/automationBrowserBatchState');
const {projectBrowserModelTool}=require('../../backend/lib/automationBrowserModelContext');
const path=['#embedded'];
const receipt=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/work',...value})}]});
const snapshot=(extra={})=>({tool:'browser_snapshot',result:receipt({observation_id:'observed',target_id:'actual-page',scope:'body',elements:[{tag:'input',accessible_role:'textbox',accessible_name:'Name',displayed:true,disabled:false,attributes:{id:'name'},locators_validated:true,locator_candidates:['#name']}],...extra})});
const framed=(id='document-a',other={})=>snapshot({frame_path:path,frame_url:'https://app.test/embedded',frame_document_id:id,...other});

test('current child refs bind element calls to their exact frame while URL checks remain top-level',()=>{
 const current=framed(),target=projectModelSnapshot(current).targets[0];
 assert.deepEqual(resolveModelToolRequest({name:'browser_fill',arguments:{locator:target.ref,value:'@r.name'}},current).arguments,{locator:'#name',value:'@r.name',frame:path});
 assert.deepEqual(resolveModelToolRequest({name:'browser_assert',arguments:{assertion:'url',value:'@r.url'}},current).arguments,{assertion:'url',value:'@r.url'});
 for(const request of [
  {name:'browser_click',arguments:{locator:target.ref,frame:['#sibling']}},
  {name:'browser_assert',arguments:{assertion:'url',value:'@r.url',frame:path}},
  {name:'browser_navigate',arguments:{url:'https://app.test/work',frame:path}}
 ])assert.throws(()=>resolveModelToolRequest(request,current),{code:'AUTOMATION_BROWSER_FRAME_SCOPE_INVALID'});
 assert.equal(repositoryTargetEvidence('#name',current),null,'learning a repository object without frame storage must fail closed');
});

test('read-only frame selection uses current advertised inventory, never a parent ref moved into a child',()=>{
 const current=snapshot({frames:[{path,url:'https://app.test/embedded',title:'Form',frame_document_id:'document-a'}]});
 const projected=projectModelSnapshot(current),ref=projected.targets[0].ref;
 assert.deepEqual(projected.frames[0].path,path);
 assert.deepEqual(resolveModelToolRequest({name:'browser_snapshot',arguments:{frame:path}},current).arguments,{frame:path});
 assert.throws(()=>resolveModelToolRequest({name:'browser_snapshot',arguments:{frame:['#invented']}},current),{code:'AUTOMATION_BROWSER_FRAME_SCOPE_INVALID'});
 assert.throws(()=>resolveModelToolRequest({name:'browser_snapshot',arguments:{locator:ref,frame:path}},current),{code:'AUTOMATION_BROWSER_FRAME_SCOPE_INVALID'});
 assert.deepEqual(resolveModelToolRequest({name:'browser_snapshot',arguments:{locator:'#section',frame:path}},current).arguments,{locator:'#section',frame:path});
 assert.equal(projectModelSnapshot(framed(undefined,{frame_document_id:undefined})),null,'unknown child document cannot grant target identity');
});

test('confirmed framed recording requires the exact pre-action document and deep freezes the scope',()=>{
 const current=framed();projectModelSnapshot(current);
 for(const metadata of [{frame_path:['#other'],frame_document_id:'document-a'},{frame_path:path,frame_document_id:'document-b'},{frame_path:undefined,frame_document_id:undefined}]){
  const observation={tool:'browser_fill',execution_step_id:'step',result:receipt({action_outcome:'completed',...metadata})};
  recordBrowserOperation(observation,{name:'browser_fill',arguments:{locator:'#name',value:'@r.name',frame:path}},{snapshot:current});
  assert.deepEqual(recordedSectionRequests([observation],'step'),[]);
 }
 const mutable=['#embedded'],observation={tool:'browser_fill',execution_step_id:'step',result:receipt({action_outcome:'completed',frame_path:path,frame_document_id:'document-a'})};
 recordBrowserOperation(observation,{name:'browser_fill',arguments:{locator:'#name',value:'@r.name',frame:mutable}},{snapshot:current});
 mutable[0]='#sibling';
 const [saved]=recordedSectionRequests([observation],'step');
 assert.deepEqual(saved.arguments.frame,path);assert.ok(Object.isFrozen(saved.arguments.frame));
});

test('identical controls in a new child document or parent cannot reconcile old refs',()=>{
 const initial=framed(),ref=projectModelSnapshot(initial).targets[0].ref,resolver=createBrowserBatchTargetResolver({snapshot:initial});
 for(const next of [framed('document-b'),snapshot(),framed('document-a',{frame_path:['#sibling']})]){
  projectModelSnapshot(next);
  assert.throws(()=>resolver.resolve({name:'browser_fill',arguments:{locator:ref,value:'input'}},next,{unchangedControls:true}),{code:'AUTOMATION_BROWSER_TARGET_REF_STALE'});
 }
 const before=captureBrowserBatchState(JSON.parse(initial.result.content[0].text));
 const after=captureBrowserBatchState(JSON.parse(framed('document-b').result.content[0].text));
 assert.equal(browserBatchBoundary({tool:'browser_click',before,after,remainingTools:[{name:'browser_fill',arguments:{locator:'#name'}}],inspected:true}).reason,'frame_document_changed');
});

test('reviewed frame-capable native assertion schema keeps every discovered mode while reducing only prose',()=>{
 const native=require('../fixtures/automationBrowserAssert.v3.json').tool,projected=projectBrowserModelTool(native);
 assert.deepEqual({...projected,description:native.description},native);
 assert.ok(projected.description.length<native.description.length);
 assert.match(projected.description,/same-origin iframe path/);
 assert.match(projected.description,/URL\/title predicates always use the top page/);
 const foreign={...native,annotations:{readOnlyHint:false}};
 assert.deepEqual(projectBrowserModelTool(foreign),foreign,'an updated or external schema cannot inherit reviewed native authority');
});
