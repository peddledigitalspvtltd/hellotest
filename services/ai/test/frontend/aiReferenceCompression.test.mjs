import test from 'node:test';
import assert from 'node:assert/strict';
import {compressImageDataUrl,readImageFiles,mergeAiReferenceImagesWithinBudget} from '../../frontend/lib/aiDesignStudio.ts';

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
