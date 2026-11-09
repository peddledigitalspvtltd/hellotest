import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=await readFile(new URL('../../frontend/pages/AutomationPage.tsx',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('  const stopLiveInspect ='),source.indexOf('  const highlightRepositoryLocator ='));

test('saving while selection polling has drained the queue waits for that result before pausing',async()=>{
  const calls=[],selected=[];let finishPoll,cancelled=false,complete=false;
  const poll=new Promise(resolve=>{finishPoll=()=>{if(!cancelled)selected.push({locator:'#selected'});resolve();};});
  const context={inspectSessionRef:{current:{id:'session'}},getRecorderEngineBaseUrl:()=>'/engine',selectedInspectTabIdRef:{current:'page'},inspectTabs:[],
    inspectStopInProgressRef:{current:false},inspectPollPromiseRef:{current:poll},browserInspectFields:[],
    setIsInspectingLiveField:value=>{cancelled=!value;},setInspectMessage:()=>{},
    readInspectSessionJson:async(_session,suffix)=>{calls.push(suffix);return null;},persistLiveInspectResult:async result=>selected.push(result)};
  const compiled=ts.transpileModule(declaration+'\nglobalThis.stop=stopLiveInspect;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(compiled,context);
  const stop=context.stop().then(()=>{complete=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['/inspect/stop']);assert.equal(complete,false);assert.equal(cancelled,false);
  finishPoll();await stop;
  assert.deepEqual(selected,[{locator:'#selected'}]);assert.equal(cancelled,true);
  assert.deepEqual(calls,['/inspect/stop','/inspect/result?page_id=page']);assert.equal(context.inspectStopInProgressRef.current,false);
});
