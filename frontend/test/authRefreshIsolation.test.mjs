import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../src/auth/AuthContext.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const makeSession=(id,name=id)=>({token:`token-${id}`,user:{id,name,role:'member'}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  let stored=makeSession('original'),cursor=0;
  const hooks=[],effects=[],refreshes=[],logins=[];
  const exports={};
  const react={
    createContext:()=>({Provider:'provider'}),useContext:()=>null,
    useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>hooks[index]=typeof value==='function'?value(hooks[index]):value];},
    useRef(initial){const index=cursor++;return hooks[index]||=( {current:initial} );},
    useMemo:fn=>fn(),
    useEffect(fn){const index=cursor++;if(!hooks[index]){hooks[index]=true;effects.push(fn);}}
  };
  const deferred=queue=>new Promise((resolve,reject)=>queue.push({resolve,reject}));
  const api={auth:{session:()=>deferred(refreshes),login:()=>deferred(logins)}};
  const sessionStorage={read:()=>stored,write:value=>stored=value,clear:()=>stored=null};
  new Function('require','exports',compiled)(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props})}:{api,sessionStorage},exports);
  const render=()=>{cursor=0;return exports.AuthProvider({children:null}).props.value;};
  render();effects.splice(0).forEach(effect=>effect());
  return {render,refreshes,logins,stored:()=>stored,clearStored:()=>sessionStorage.clear()};
}

for(const outcome of ['success','failure']){
  test(`late refresh ${outcome} cannot replace or clear a newer login`,async()=>{
    const view=fixture();assert.equal(view.refreshes.length,1);
    const login=view.render().login({email:'new@example.test',password:'isolated'});
    view.logins[0].resolve(makeSession('new'));await login;
    assert.equal(view.render().session.user.id,'new');assert.equal(view.render().isLoading,false);
    if(outcome==='success')view.refreshes[0].resolve(makeSession('original','Outdated profile'));else view.refreshes[0].reject(new Error('Token expired'));
    await flush();
    assert.equal(view.stored().user.id,'new');assert.equal(view.render().session.user.id,'new');assert.equal(view.render().error,null);assert.equal(view.render().isLoading,false);
  });
}

test('only the latest refresh may update the same authenticated session',async()=>{
  const view=fixture();const newer=view.render().refreshSession();
  view.refreshes[1].resolve(makeSession('original','Latest profile'));await newer;
  view.refreshes[0].resolve(makeSession('original','Old profile'));await flush();
  assert.equal(view.stored().user.name,'Latest profile');assert.equal(view.render().session.user.name,'Latest profile');
});

for(const clearedByApi of [false,true]){
  test(`current-session expiration still clears authentication (API already cleared=${clearedByApi})`,async()=>{
    const view=fixture();if(clearedByApi)view.clearStored();view.refreshes[0].reject(new Error('Token expired'));await flush();
    assert.equal(view.stored(),null);assert.equal(view.render().session,null);assert.equal(view.render().error,'Token expired');assert.equal(view.render().isLoading,false);
  });
}

test('logout cannot be undone by a pending successful session refresh',async()=>{
  const view=fixture();view.render().logout();view.refreshes[0].resolve(makeSession('original'));await flush();
  assert.equal(view.stored(),null);assert.equal(view.render().session,null);assert.equal(view.render().isLoading,false);
});
