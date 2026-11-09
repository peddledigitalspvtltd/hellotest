import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_REFERENCE_IMAGE_LIMITS,compressImageDataUrl,readImageFiles,mergeAiReferenceImagesWithinBudget} from '../../frontend/lib/aiDesignStudio.ts';

function imageEnvironment(t,{width=2560,height=1440,lengthForQuality=()=>120000,context=true}={}){
 const old=Object.fromEntries(['Image','FileReader','document'].map(key=>[key,globalThis[key]])),operations=[];
 const canvas={width:0,height:0,getContext:()=>context?{set fillStyle(value){operations.push(['fillStyle',value]);},fillRect:(...args)=>operations.push(['fillRect',...args]),drawImage:(...args)=>operations.push(['drawImage',...args.slice(1)])}:null,toDataURL:(mime,quality)=>{operations.push(['encode',mime,quality]);return 'data:image/jpeg;base64,'+'A'.repeat(lengthForQuality(quality));}};
 globalThis.Image=class{naturalWidth=width;naturalHeight=height;set src(value){this.source=value;queueMicrotask(()=>this.onload());}};
 globalThis.FileReader=class{readAsDataURL(file){this.result='data:'+file.type+';base64,AAAA';queueMicrotask(()=>this.onload());}};
 globalThis.document={createElement:name=>{assert.equal(name,'canvas');return canvas;}};
 t.after(()=>{for(const[key,value]of Object.entries(old))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 return{operations,canvas};
}
test('screenshot compression preserves a readable bounded viewport and handles transparency before JPEG encoding',async t=>{
 const env=imageEnvironment(t);const encoded=await compressImageDataUrl('data:image/png;base64,AAAA');
 assert.equal(env.canvas.width,1280);assert.equal(env.canvas.height,720);assert.deepEqual(env.operations.slice(0,3),[['fillStyle','#fff'],['fillRect',0,0,1280,720],['drawImage',0,0,1280,720]]);
 assert.deepEqual(env.operations[3],['encode','image/jpeg',0.72]);assert.ok(encoded.length<950000/6);
});
test('compression adapts quality inside the per-image budget and rejects an unreadably large screenshot for cropping',async t=>{
 const env=imageEnvironment(t,{lengthForQuality:quality=>quality>0.48?200000:100000});await compressImageDataUrl('data:image/png;base64,AAAA');assert.deepEqual(env.operations.filter(item=>item[0]==='encode').map(item=>item[2]),[0.72,0.6,0.48]);
 env.canvas.toDataURL=()=> 'data:image/jpeg;base64,'+'A'.repeat(200000);await assert.rejects(compressImageDataUrl('data:image/png;base64,AAAA'),/Crop/);
});
test('image intake rejects unsupported types and oversized batches before reading any originals',async()=>{
 await assert.rejects(readImageFiles([{name:'diagram.svg',type:'image/svg+xml',size:100}]),/PNG, JPEG, or WebP/);
 await assert.rejects(readImageFiles(Array.from({length:7},(_,i)=>({name:i+'.png',type:'image/png',size:100}))),/at most 6/);
 await assert.rejects(readImageFiles([{name:'huge.png',type:'image/png',size:8000001}]),/too large/);
});
test('image upload sends compressed pixels only and never falls back to unbounded originals without canvas',async t=>{
 const env=imageEnvironment(t);const images=await readImageFiles([{name:'Reference.png',type:'image/png',size:1000}]);assert.equal(images[0].name,'Reference.png');assert.match(images[0].url,/^data:image\/jpeg;base64,/);assert.equal(mergeAiReferenceImagesWithinBudget([],images).images.length,1);
 env.canvas.getContext=()=>null;await assert.rejects(readImageFiles([{name:'Reference.png',type:'image/png',size:1000}]),/compression is unavailable/);
});

test('image intake enforces the owning four-image limit while legacy case-step input retains six',async t=>{
 const env=imageEnvironment(t);
 for(const limit of [AI_REFERENCE_IMAGE_LIMITS.storyCreation,AI_REFERENCE_IMAGE_LIMITS.testCaseGeneration,AI_REFERENCE_IMAGE_LIMITS.default]){
  const files=Array.from({length:limit},(_,index)=>({name:`Screen-${index}.png`,type:'image/png',size:1000}));
  const images=await readImageFiles(files,limit);
  assert.deepEqual(images.map(image=>image.name),files.map(file=>file.name),'Every accepted original is compressed and retained');
  const reads=env.operations.length;
  await assert.rejects(readImageFiles([...files,{name:'Extra.png',type:'image/png',size:1000}],limit),new RegExp(`at most ${limit}`));
  assert.equal(env.operations.length,reads,'Oversized batches fail before decoding any original');
 }
 assert.equal((await readImageFiles(Array.from({length:6},(_,index)=>({name:`Legacy-${index}.png`,type:'image/png',size:1000})))).length,6);
});

test('accumulated image limits reject the full addition without changing retained evidence and removal restores capacity',()=>{
 for(const limit of [4,6]){
  const current=Array.from({length:limit},(_,index)=>({name:`Screen-${index}.png`,url:`data:image/png;base64,${index}`}));
  const incoming=[{name:'Next.png',url:'data:image/png;base64,NEXT'}],before=structuredClone(current);
  const rejected=mergeAiReferenceImagesWithinBudget(current,incoming,limit);
  assert.equal(rejected.images,current);
  assert.match(rejected.message,new RegExp(`limited to ${limit}`));
  assert.deepEqual(current,before);
  const afterRemoval=mergeAiReferenceImagesWithinBudget(current.slice(1),incoming,limit);
  assert.equal(afterRemoval.message,'');assert.equal(afterRemoval.images.length,limit);
  assert.deepEqual(afterRemoval.images.at(-1),incoming[0]);
  const replaced=mergeAiReferenceImagesWithinBudget([],current,limit);
  assert.equal(replaced.message,'');assert.deepEqual(replaced.images,current);
 }
 const tooLarge=mergeAiReferenceImagesWithinBudget([],[{name:'Oversized.png',url:'A'.repeat(950001)}],4);
 assert.deepEqual(tooLarge.images,[]);assert.match(tooLarge.message,/context budget/);
});
