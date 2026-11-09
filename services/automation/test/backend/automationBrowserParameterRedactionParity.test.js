const test=require('node:test');
const assert=require('node:assert/strict');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {snapshotFrameScope}=require('../../backend/lib/automationFrameScope');
const {projectModelSnapshot,resolveModelToolRequest}=require('../../backend/lib/automationBrowserModelTargets');
const base='https://app.test/';
const read=(resolver,payload)=>JSON.parse(resolver.redactResult({content:[{type:'text',text:JSON.stringify(payload)}]}).content[0].text);
const observation=payload=>({tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify(payload)}]}});
const element={tag:'input',attributes:{type:'text'},accessible_name:'Employee name',displayed:true,locators_validated:true,locator_candidates:['#name']};

test('public navigation preserves real same-origin frame inventory, document scope and target bindings after input resolution',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'r.url':base,'r.employee_first_name':'GENERATED_NAME_SAMPLE','r.photo_url':base+'photo.png','r.password':'PRIVATE_CANARY'},privateParameterNames:['r.password']});
 resolver.resolve('browser_navigate',{url:'@r.url'});resolver.resolve('browser_fill',{value:'@r.employee_first_name'});resolver.resolve('browser_fill',{value:'@r.photo_url'});
 const top={source:'playwright',observation_id:'parent',url:base+'client/#/pim/employees',scope:'body',elements:[element],
  frames:[{path:['#onboarding'],url:base+'onboarding',title:'Onboarding',frame_document_id:'child-document'}],
  public_name:'GENERATED_NAME_SAMPLE',photo_url:base+'photo.png'};
 const projected=read(resolver,top);assert.equal(projected.url,top.url);assert.equal(projected.frames[0].url,top.frames[0].url);
 assert.equal(projected.public_name,'GENERATED_NAME_SAMPLE');assert.equal(projected.photo_url,base+'photo.png');
 const parent=observation(projected),model=projectModelSnapshot(parent);assert.equal(model.frames.length,1);
 assert.deepEqual(resolveModelToolRequest({name:'browser_snapshot',arguments:{frame:['#onboarding']}},parent).arguments.frame,['#onboarding']);
 const framed={source:'playwright',observation_id:'child',url:top.url,frame_path:['#onboarding'],frame_url:base+'onboarding',frame_document_id:'child-document',scope:'body',elements:[element]};
 const scoped=read(resolver,framed);assert.equal(snapshotFrameScope(scoped).identity,snapshotFrameScope(framed).identity);
 const child=observation(scoped),target=projectModelSnapshot(child).targets[0];
 const request=resolveModelToolRequest({name:'browser_fill',arguments:{locator:target.ref,value:'@r.employee_first_name'}},child);
 assert.deepEqual(request.arguments.frame,['#onboarding']);assert.equal(request.arguments.locator,'#name');
 const image={type:'image',mimeType:'image/png',data:'PUBLIC_PHOTO_BLOB'};assert.deepEqual(resolver.redactResult({content:[image]}).content[0],image);
});

test('actual private raw, JSON escaped and URI encoded variants remain masked in receipts and errors',()=>{
 const secret='PRIVATE "escaped" \\ value / + é';
 const resolver=createBrowserParameterResolver({caseValues:{'r.url':base,'r.password':secret},privateParameterNames:['r.password']});
 resolver.resolve('browser_navigate',{url:'@r.url'});resolver.resolve('browser_fill',{value:'@r.password'});
 const variants=[secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret)];
 const payload=read(resolver,{source:'playwright',url:base+'client/',raw:variants[0],escaped:variants[1],encoded:variants[2]});
 assert.equal(payload.url,base+'client/');for(const key of['raw','escaped','encoded'])assert.equal(payload[key],'[private parameter value]');
 for(const value of variants)assert.equal(resolver.redactError(new Error('Failure '+value)).message.includes(value),false);
});

test('private/public collisions never downgrade known private values, and private URL flags supply no frame authority',()=>{
 for(const options of[{privateParameterNames:['r.url']},{caseValues:{'r.password':base},privateParameterNames:['r.password']}]){
  const resolver=createBrowserParameterResolver({caseValues:{'r.url':base,...options.caseValues},privateParameterNames:options.privateParameterNames});
  resolver.resolve('browser_navigate',{url:'@r.url'});resolver.resolve('browser_assert',{assertion:'url',value:'@r.url'});
  assert.ok(resolver.privateParameterNames.includes('r.url'));
  const payload=read(resolver,{source:'playwright',observation_id:'private-frame',url:base+'client/',frame_path:['#child'],frame_url:base+'child',frame_document_id:'document',elements:[element]});
  assert.equal(JSON.stringify(payload).includes(base),false);assert.equal(snapshotFrameScope(payload),null);
  assert.equal(projectModelSnapshot(observation(payload)),null);
 }
});
