import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../src/auth/AuthContext.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const makeSession=(id,name=id)=>({token:`token-${id}`,user:{id,name,role:'member'}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({browser=false}={}){
  let stored=makeSession('original'),cursor=0;
  const hooks=[],effects=[],refreshes=[],logins=[];
  const exports={};
  const windowListeners=new Map(),documentListeners=new Map(),intervals=[];
  const document=browser?{visibilityState:'visible',addEventListener:(name,handler)=>documentListeners.set(name,handler),removeEventListener:name=>documentListeners.delete(name)}:undefined;
  const window=browser?{setInterval:(handler,ms)=>{intervals.push({handler,ms});return intervals.length;},clearInterval:()=>{},addEventListener:(name,handler)=>windowListeners.set(name,handler),removeEventListener:name=>windowListeners.delete(name)}:undefined;
  const react={
    createContext:()=>({Provider:'provider'}),useContext:()=>null,
    useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>hooks[index]=typeof value==='function'?value(hooks[index]):value];},
    useRef(initial){const index=cursor++;return hooks[index]||=( {current:initial} );},
    useMemo:fn=>fn(),
    useEffect(fn){const index=cursor++;if(!hooks[index]){hooks[index]=true;effects.push(fn);}}
  };
  const deferred=queue=>new Promise((resolve,reject)=>queue.push({resolve,reject}));
  const api={auth:{session:()=>deferred(refreshes),login:()=>deferred(logins)},opsTelemetry:{endGrafanaSession:async()=>({closed:true})}};
  const sessionStorage={read:()=>stored,write:value=>stored=value,clear:()=>stored=null};
  new Function('require','exports','window','document',compiled)(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props})}:{api,sessionStorage},exports,window,document);
  const render=()=>{cursor=0;return exports.AuthProvider({children:null}).props.value;};
  render();effects.splice(0).forEach(effect=>effect());
  return {render,refreshes,logins,stored:()=>stored,clearStored:()=>sessionStorage.clear(),focus:()=>windowListeners.get('focus')?.(),setVisible:value=>{document.visibilityState=value?'visible':'hidden';documentListeners.get('visibilitychange')?.();},tick:()=>intervals.forEach(item=>item.handler()),intervals};
}

for(const outcome of ['success','failure']){
  test(`late refresh ${outcome} cannot replace or clear a newer login`,async()=>{
    const view=fixture();assert.equal(view.refreshes.length,1);
    const login=view.render().login({email:'new@example.test',password:'isolated'});
    view.logins[0].resolve(makeSession('new'));await login;
    assert.equal(view.render().session.user.id,'new');assert.equal(view.render().isLoading,false);
    if(outcome==='success')view.refreshes[0].resolve(makeSession('original','Outdated profile'));else view.refreshes[0].reject(Object.assign(new Error('Token expired'), {status:401}));
    await flush();
    assert.equal(view.stored().user.id,'new');assert.equal(view.render().session.user.id,'new');assert.equal(view.render().error,null);assert.equal(view.render().isLoading,false);
  });
}

test('overlapping refreshes share one request for the same authenticated session',async()=>{
  const view=fixture();const newer=view.render().refreshSession();
  assert.equal(view.refreshes.length,1);
  view.refreshes[0].resolve(makeSession('original','Latest profile'));await newer;
  assert.equal(view.stored().user.name,'Latest profile');assert.equal(view.render().session.user.name,'Latest profile');
});

test('focus and visibility events share the pending refresh instead of flooding session verification',async()=>{
  const view=fixture({browser:true});
  view.focus();view.setVisible(true);view.tick();
  assert.equal(view.refreshes.length,1);
  view.refreshes[0].resolve(makeSession('original'));await flush();
  view.focus();view.setVisible(true);view.tick();
  assert.equal(view.refreshes.length,2);
  view.refreshes[1].resolve(makeSession('original'));await flush();
});

for(const clearedByApi of [false,true]){
  test(`current-session expiration still clears authentication (API already cleared=${clearedByApi})`,async()=>{
    const view=fixture();if(clearedByApi)view.clearStored();view.refreshes[0].reject(Object.assign(new Error('Token expired'), {status:401}));await flush();
    assert.equal(view.stored(),null);assert.equal(view.render().session,null);assert.equal(view.render().error,'Token expired');assert.equal(view.render().isLoading,false);
  });
}

test('logout cannot be undone by a pending successful session refresh',async()=>{
  const view=fixture();view.render().logout();view.refreshes[0].resolve(makeSession('original'));await flush();
  assert.equal(view.stored(),null);assert.equal(view.render().session,null);assert.equal(view.render().isLoading,false);
});

for (const status of [undefined, 408, 429, 500, 503]) {
  test(`temporary session refresh failure keeps the current session and open work (status=${status})`, async () => {
    const view=fixture();
    view.refreshes[0].reject(Object.assign(new Error('Temporarily unavailable'), {status}));
    await flush();
    assert.equal(view.stored().user.id,'original');
    assert.equal(view.render().session.user.id,'original');
    assert.equal(view.render().isLoading,false);
    const recovered=view.render().refreshSession();
    view.refreshes[1].resolve({...makeSession('original'),user:{id:'original',role:'member',project_permissions:{project:['feedback.create']}}});
    await recovered;
    assert.deepEqual(view.render().session.user.project_permissions,{project:['feedback.create']});
    assert.equal(view.render().error,null);
  });
}

test('a deleted account ends only its own current session', async () => {
  const view=fixture();
  view.refreshes[0].reject(Object.assign(new Error('User not found'),{status:404}));
  await flush();
  assert.equal(view.stored(),null);
  assert.equal(view.render().session,null);
});

test('a confirmed suspended account ends its session instead of keeping stale grants',async()=>{
  const view=fixture();
  view.refreshes[0].reject(Object.assign(new Error('This account is suspended'),{status:403}));await flush();
  assert.equal(view.stored(),null);assert.equal(view.render().session,null);
});

test('unchanged session refresh preserves object identity and never reopens the initial loading state', async () => {
  const view=fixture();const initial=view.render().session;
  view.refreshes[0].resolve(makeSession('original'));await flush();
  assert.equal(view.render().session,initial);
  const refresh=view.render().refreshSession();
  assert.equal(view.render().isLoading,false);
  view.refreshes[1].resolve(makeSession('original'));await refresh;
  assert.equal(view.render().session,initial);
});

test('focus and the visible polling interval refresh actual grants without a loading flicker', async () => {
  const view=fixture({browser:true});
  assert.equal(view.intervals[0].ms,60000);
  view.refreshes[0].resolve(makeSession('original'));await flush();
  view.focus();assert.equal(view.refreshes.length,2);assert.equal(view.render().isLoading,false);
  view.refreshes[1].resolve(makeSession('original'));await flush();
  view.setVisible(false);view.focus();view.tick();assert.equal(view.refreshes.length,2);
  view.setVisible(true);assert.equal(view.refreshes.length,3);
  view.refreshes[2].resolve({...makeSession('original'),user:{id:'original',role:'member',project_permissions:{project:['feedback.view']}}});await flush();
  assert.deepEqual(view.render().session.user.project_permissions,{project:['feedback.view']});
  view.tick();assert.equal(view.refreshes.length,4);assert.equal(view.render().isLoading,false);
  view.refreshes[3].resolve(view.render().session);await flush();
});
