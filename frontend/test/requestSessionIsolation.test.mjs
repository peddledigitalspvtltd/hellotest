import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
// Execute the production public API methods against deferred HTTP responses.
// Only Vite's build-time environment expression and unrelated imports are adapted.
const source=readFileSync(new URL('../src/lib/api.ts',import.meta.url),'utf8').replaceAll('import.meta.env','({})');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const session=(changes={})=>({token:'fixture-token',user:{id:'user-a',role:'member',status:'active',permissions:['workspace.view'],project_permissions:{project:['project.view']},...changes}});
function fixture(){
  const storage=new Map(),requests=[],redirects=[];
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  const window={localStorage,__HELLOTEST_CONFIG__:{API_BASE_URL:'http://fixture.test/api'},location:{assign:path=>redirects.push(path)}};
  const exports={};
  const fetch=(url,options)=>new Promise((resolve,reject)=>{
    options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
    requests.push({url,options,reply:(body,status=200)=>resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}))});
  });
  const require=name=>name==='./currentScope'?{appendCurrentProjectScope:path=>path,readCurrentProjectId:()=>''}:{consumeKnowledgeAssistantStream:async()=>({}),KnowledgeStreamError:class extends Error{}};
  new Function('require','exports','window','fetch','Headers','Response','AbortSignal',compiled)(require,exports,window,fetch,Headers,Response,AbortSignal);
  return {...exports,requests,redirects,localStorage};
}
const list=view=>view.api.appTypes.list({project_id:'project'});

test('cancelling one screen cannot cancel another caller loading the same resource',async()=>{
  const view=fixture();view.sessionStorage.write(session());
  const controller=new AbortController();
  const cancelled=view.api.appTypes.list({project_id:'project'},{signal:controller.signal});
  const survivor=list(view);
  assert.equal(view.requests.length,2);
  const rejected=assert.rejects(cancelled,error=>error.name==='AbortError');
  controller.abort();await rejected;
  assert.equal(view.requests[1].options.signal.aborted,false);
  view.requests[1].reply([{id:'survivor'}]);assert.deepEqual(await survivor,[{id:'survivor'}]);
});

test('already cancelled callers do not read cached data or start another request',async()=>{
  const view=fixture();view.sessionStorage.write(session());
  const first=list(view);view.requests[0].reply([]);await first;
  await assert.rejects(view.api.appTypes.list({project_id:'project'},{signal:AbortSignal.abort()}),error=>error.name==='AbortError');
  assert.equal(view.requests.length,1);
});

test('same-session requests deduplicate and cache; a successful mutation invalidates the response cache',async()=>{
  const view=fixture();view.sessionStorage.write(session());
  const first=list(view),duplicate=list(view);assert.equal(view.requests.length,1);
  view.requests[0].reply([{id:'first'}]);assert.deepEqual(await first,await duplicate);
  await list(view);assert.equal(view.requests.length,1);
  view.sessionStorage.write(session({name:'Updated display name'}));
  await list(view);assert.equal(view.requests.length,1,'profile-only changes preserve same-access cache reuse');
  const mutation=view.api.appTypes.create({project_id:'project',name:'New',type:'web'});
  assert.equal(view.requests[1].options.method,'POST');view.requests[1].reply({id:'new'});await mutation;
  const after=list(view);assert.equal(view.requests.length,3);view.requests[2].reply([{id:'new'}]);assert.deepEqual(await after,[{id:'new'}]);
});

for(const changed of [{id:'user-b'},{role:'admin'},{role_id:'new-role'},{status:'suspended'},{permissions:[]},{workspace_permissions:['integration.view']},{project_permissions:{project:[]}}]){
  test(`same-token ${Object.keys(changed)[0]} change cannot reuse prior access responses`,async()=>{
    const view=fixture();view.sessionStorage.write(session());const old=list(view);view.requests[0].reply([{id:'private'}]);await old;
    view.sessionStorage.write(session(changed));const next=list(view);assert.equal(view.requests.length,2);view.requests[1].reply([{id:'allowed'}]);assert.deepEqual(await next,[{id:'allowed'}]);
  });
}

test('late old-identity results cannot populate or delete the new session in-flight cache',async()=>{
  const view=fixture();view.sessionStorage.write(session());const old=list(view);
  view.sessionStorage.write({...session({id:'user-b'}),token:'new-token'});const current=list(view);assert.equal(view.requests.length,2);
  view.requests[0].reply([{id:'old-private'}]);await old;
  const deduped=list(view);assert.equal(view.requests.length,2,'old request completion must preserve new pending request');
  view.requests[1].reply([{id:'current'}]);assert.deepEqual(await current,[{id:'current'}]);assert.deepEqual(await deduped,[{id:'current'}]);
  assert.deepEqual(await list(view),[{id:'current'}]);assert.equal(view.requests.length,2);
});

test('cross-tab storage changes isolate requests even without sessionStorage.write',async()=>{
  const view=fixture();view.sessionStorage.write(session());const old=list(view);view.requests[0].reply([{id:'old'}]);await old;
  view.localStorage.setItem('hellotest.session',JSON.stringify(session({id:'other-tab-user'})));
  const next=list(view);assert.equal(view.requests.length,2);view.requests[1].reply([]);await next;
});

test('a late 401 cannot clear or redirect a newer same-token permission context',async()=>{
  const view=fixture();view.sessionStorage.write(session());const old=list(view);
  view.sessionStorage.write(session({project_permissions:{project:['project.view','testcase.view']}}));
  view.requests[0].reply({message:'Invalid token'},401);await assert.rejects(old,/Invalid token/);
  assert.deepEqual(view.sessionStorage.read().user.project_permissions.project,['project.view','testcase.view']);assert.deepEqual(view.redirects,[]);
  const current=list(view);view.requests[1].reply({message:'Token expired'},401);await assert.rejects(current,/Token expired/);
  assert.equal(view.sessionStorage.read(),null);assert.deepEqual(view.redirects,['/auth'],'current-session 401 still clears authentication');
});

test('knowledge stream late 401 also preserves the replacement session',async()=>{
  const view=fixture();view.sessionStorage.write(session());
  const old=view.api.knowledgeRepo.assistant.streamMessage('review',{message:'Explain evidence',client_turn_id:'turn-1'});
  view.sessionStorage.write({...session({id:'user-b'}),token:'replacement'});
  view.requests[0].reply({message:'Token expired'},401);await assert.rejects(old,/Token expired/);
  assert.equal(view.sessionStorage.read().token,'replacement');assert.deepEqual(view.redirects,[]);
});
