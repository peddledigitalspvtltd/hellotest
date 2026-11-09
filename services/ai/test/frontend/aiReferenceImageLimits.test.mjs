import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {AI_REFERENCE_IMAGE_LIMITS,mergeAiReferenceImagesWithinBudget} from '../../frontend/lib/aiDesignStudio.ts';

const sources=new Map();
function sourceFor(file){
 if(!sources.has(file))sources.set(file,ts.createSourceFile(file,readFileSync(new URL(file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX));
 return sources.get(file);
}
function nodesFor(file){const nodes=[],visit=node=>{nodes.push(node);ts.forEachChild(node,visit);};visit(sourceFor(file));return nodes;}
function binding(file,name,dependencies){
 const source=sourceFor(file),node=nodesFor(file).find(node=>ts.isVariableDeclaration(node)&&node.name.getText(source)===name);
 assert.ok(node?.initializer,`Use actual ${name} handler`);
 const script=ts.transpileModule(`return (${node.initializer.getText(source)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function(...Object.keys(dependencies),script)(...Object.values(dependencies));
}
function handlerFixture(file,name,mode){
 let images=[],message='';const limits=[];
 const update=value=>{images=typeof value==='function'?value(images):value;};
 const request={current:{}},noop=()=>{};
 const dependencies={
  AI_REFERENCE_IMAGE_LIMITS,requirementAiMode:mode,
  readImageFiles:async(files,limit)=>{limits.push(limit??AI_REFERENCE_IMAGE_LIMITS.default);return files;},
  mergeAiReferenceImagesWithinBudget,
  aiImageReadGenerationRef:{current:1},aiOriginalImagesRef:{current:new Map()},storyOriginalImagesRef:{current:new Map()},
  storyAiRequestRef:request,isCurrentStoryAiRequest:value=>value===request.current,invalidateRequirementAiDraft:()=>{message='';},
  setAiReferenceImages:update,setOptimizeReferenceImages:update,setAiCaseAuthoringReferenceImages:update,
  setPreviewMessage:value=>{message=value;},setAiPreviewMessage:value=>{message=value;},setAiCaseAuthoringMessage:value=>{message=value;},
  setPreviewCases:noop,setAiPreviewCases:noop,setAiCaseAuthoringPreview:noop,setPreviewTone:noop,setAiPreviewTone:noop,setAiCaseAuthoringTone:noop,setIsRequirementAiReferenceBusy:noop
 };
 return {add:binding(file,name,dependencies),limits,get images(){return images;},get message(){return message;},removeFirst:()=>{images=images.slice(1);}};
}
const requirements='../../../manual/frontend/pages/RequirementsPage.tsx',cases='../../../testing/frontend/pages/TestCasesPage.tsx';

test('owning Story and Test Case UI limits match unchanged feature policies',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../../../platform/shared/aiFeatureCatalog.json',import.meta.url),'utf8'));
 for(const [feature,limit]of [['ai.requirement.creation',AI_REFERENCE_IMAGE_LIMITS.storyCreation],['ai.test_case.design',AI_REFERENCE_IMAGE_LIMITS.testCaseGeneration],['ai.case_authoring.full_case',AI_REFERENCE_IMAGE_LIMITS.default]]){
  assert.equal(catalog.find(item=>item.id===feature).defaults.reference_images.max_images,limit);
 }
 for(const file of [requirements,cases]){
  const source=sourceFor(file),modal=nodesFor(file).find(node=>(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(source)==='AiDesignStudioModal');
  assert.ok(modal);assert.equal(modal.attributes.properties.find(property=>property.name?.getText(source)==='imageLimit')?.initializer?.expression?.getText(source),'AI_REFERENCE_IMAGE_LIMITS.testCaseGeneration');
 }
 const source=sourceFor(requirements),panels=nodesFor(requirements).filter(node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='AiPromptContextPanel');
 assert.equal(panels.length,2);
 for(const panel of panels)assert.equal(panel.attributes.properties.find(property=>property.name?.getText(source)==='imageLimit')?.initializer?.expression?.getText(source),'requirementAiMode === "create" ? AI_REFERENCE_IMAGE_LIMITS.storyCreation : AI_REFERENCE_IMAGE_LIMITS.default');
});

for(const [file,name,mode,limit]of [[requirements,'handleAddAiReferenceImages',undefined,4],[cases,'handleAddAiReferenceImages',undefined,4],[requirements,'handleAddOptimizeReferenceImages','create',4],[requirements,'handleAddOptimizeReferenceImages','improve',6],[cases,'handleAddAiCaseAuthoringReferenceImages',undefined,6]]){
 test(`${file.includes('/manual/')?'Story':'Test Case'} ${name} ${mode||''} applies its own ${limit}-image limit to accumulated uploads`,async()=>{
  const fixture=handlerFixture(file,name,mode),images=Array.from({length:limit},(_,index)=>({name:`Screen-${index}.png`,url:`data:image/png;base64,${index}`}));
  await fixture.add(images);assert.equal(fixture.images.length,limit);assert.equal(fixture.message,'');
  const next=[{name:'Next.png',url:'data:image/png;base64,NEXT'}];
  await fixture.add(next);assert.deepEqual(fixture.images,images);assert.match(fixture.message,new RegExp(`limited to ${limit}`));
  fixture.removeFirst();await fixture.add(next);assert.equal(fixture.images.length,limit);assert.deepEqual(fixture.images.at(-1),next[0]);assert.equal(fixture.message,'');
  assert.deepEqual(fixture.limits,[limit,limit,limit]);
 });
}
