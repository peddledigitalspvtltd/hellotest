const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {parse}=require('acorn');
const {browserReceipt}=require('../../backend/lib/automationInteractiveEvidence');
const {validFramePath,framePathKey}=require('../../backend/lib/automationFrameScope');
const source=fs.readFileSync(require.resolve('../../backend/lib/automationBrowserAgent'),'utf8'),nodes=[];
const visit=node=>{if(!node||typeof node!=='object')return;nodes.push(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);};
visit(parse(source,{ecmaVersion:'latest',sourceType:'script'}));
const binding=nodes.find(node=>node.type==='VariableDeclarator'&&node.id.name==='captureCurrentSnapshot').init;
const code=source.slice(binding.start,binding.end),frame=['#outer','#inner'];
const receipt=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});
const stale=()=>receipt({code:'BROWSER_FRAME_STALE',action_outcome:'not_attempted',retry_safe:true},true);
const root=(path=frame)=>receipt({frames:path?[{path,frame_url:'https://app.test/child',frame_document_id:'new-document'}]:[]});
const child=()=>receipt({frame_path:frame,frame_url:'https://app.test/child',frame_document_id:'new-document',elements:[]});
function fixture(results,{maxCalls=12,allowed=true,deadline=1000}={}){
 let clock=0;const dispatched=[],observations=[];
 const dependencies={allowed:new Set(allowed?['browser_snapshot']:[]),maxCalls,deadline,Date:{now:()=>clock},validFramePath,framePathKey,browserReceipt,
  dispatchBrowser:async(name,args)=>{dispatched.push({name,args:structuredClone(args)});const result=results[dispatched.length-1];if(typeof result==='function')return result(()=>{clock=deadline;});if(result instanceof Error)throw result;assert.ok(result,'No extra MCP call is allowed');return result;},observe:async row=>observations.push(row)};
 return {...new Function(...Object.keys(dependencies),`let calls=0;const capture=${code};return {capture,count:()=>calls};`)(...Object.values(dependencies)),
  dispatched,observations};
}

test('stable observed child snapshots use one scoped MCP read while main snapshots stay explicit',async()=>{
 const f=fixture([child()]);assert.equal((await f.capture(frame)).isError,false);
 assert.deepEqual(f.dispatched,[{name:'browser_snapshot',args:{frame}}]);assert.equal(f.observations.length,1);
 const main=fixture([root()]);await main.capture([]);assert.deepEqual(main.dispatched,[{name:'browser_snapshot',args:{}}]);
});

test('only a safe stale read refreshes root inventory and the exact existing frame once',async()=>{
 const f=fixture([stale(),root(),child()]);const result=await f.capture(frame);
 assert.equal(browserReceipt({result}).frame_document_id,'new-document');
 assert.deepEqual(f.dispatched.map(call=>call.args),[{frame},{},{frame}]);assert.equal(f.observations.length,3);
 assert.equal(f.observations[0].result.isError,true,'The failed read remains visible and counted');
 for(const path of [null,['#sibling']]){
  const missing=fixture([stale(),root(path)]);await missing.capture(frame);assert.equal(missing.dispatched.length,2,'A fresh root which omits this path grants no child read');
 }
 const raced=fixture([stale(),root(),stale()]);assert.equal((await raced.capture(frame)).isError,true);assert.equal(raced.dispatched.length,3,'A second stale document cannot recursively retry');
});

test('unobserved frames, unsafe outcomes, transport/context/deadline errors never activate root fallback',async()=>{
 for(const value of [{code:'BROWSER_FRAME_NOT_OBSERVED',action_outcome:'not_attempted',retry_safe:true},
  {code:'BROWSER_CONTEXT_LOST',action_outcome:'not_attempted',retry_safe:true},{code:'BROWSER_TOOL_DEADLINE',action_outcome:'not_attempted',retry_safe:true},
  {code:'BROWSER_FRAME_STALE',action_outcome:'unknown',retry_safe:true},{code:'BROWSER_FRAME_STALE',action_outcome:'not_attempted',retry_safe:false},
  {code:'BROWSER_FRAME_STALE',action_outcome:'not_attempted'},{code:'BROWSER_FRAME_STALE',retry_safe:true}]){
  const f=fixture([receipt(value,true)]);await f.capture(frame);assert.equal(f.dispatched.length,1,JSON.stringify(value));
 }
 for(const error of [Object.assign(new Error('Closed deadline'),{code:'AUTOMATION_BUILD_DEADLINE'}),Object.assign(new Error('Transport denied'),{statusCode:403})]){
  const f=fixture([error]);await assert.rejects(f.capture(frame),cause=>cause===error);assert.equal(f.dispatched.length,1);
 }
 for(const result of [receipt({code:'BROWSER_FRAME_STALE',action_outcome:'not_attempted',retry_safe:true}),
  {isError:true,content:[{type:'text',text:'not valid JSON'}]},
  {isError:true,content:[{type:'text',text:JSON.stringify({source:'untrusted',code:'BROWSER_FRAME_STALE',action_outcome:'not_attempted',retry_safe:true})}]}]){
  const f=fixture([result]);await f.capture(frame);assert.equal(f.dispatched.length,1,'Only the structured native failure grants recovery');
 }
});

test('failed scope, root and child reads consume the unchanged call allowance and deadline',async()=>{
 for(const maxCalls of [0,1,2,3]){
  const f=fixture([stale(),root(),child()],{maxCalls});await f.capture(frame);assert.equal(f.dispatched.length,maxCalls);assert.equal(f.count(),maxCalls,'Failed and recovery reads all consume the existing counter');
 }
 const closed=fixture([child()],{allowed:false});assert.equal(await closed.capture(frame),null);assert.equal(closed.dispatched.length,0);
 const expired=fixture([()=>{throw new Error('No dispatch after deadline');}],{deadline:0});assert.equal(await expired.capture(frame),null);assert.equal(expired.dispatched.length,0);
 const expiresDuringRead=fixture([expire=>{expire();return stale();}]);await expiresDuringRead.capture(frame);assert.equal(expiresDuringRead.dispatched.length,1);
});
