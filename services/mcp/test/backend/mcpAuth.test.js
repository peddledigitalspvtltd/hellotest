const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHmac}=require('node:crypto');
const {createRequire}=require('node:module');
const memo=require('../../backend/requestMemo');
const root=path.resolve(__dirname,'../../backend');
const load=(name,mocks)=>{const file=path.join(root,name+'.js');const original=createRequire(file);const module={exports:{}};new Function('require','module','exports','__filename','__dirname',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports,file,root);return module.exports;};
const KEY='k'.repeat(48);
const sign=encoded=>createHmac('sha256',KEY).update(encoded).digest('base64url');
const user={id:'user-a'};

// A real auth module over a fake database and fake domain services that count what they are asked.
function setup(t,{flagKeys={}}={}){
 const previous={key:process.env.HELLOTEST_MCP_SIGNING_KEY,age:process.env.HELLOTEST_MCP_REQUEST_CACHE_MS,nodeEnv:process.env.NODE_ENV};
 process.env.HELLOTEST_MCP_SIGNING_KEY=KEY;process.env.NODE_ENV='test';delete process.env.HELLOTEST_MCP_REQUEST_CACHE_MS;
 t.after(()=>{for(const [name,value] of [['HELLOTEST_MCP_SIGNING_KEY',previous.key],['HELLOTEST_MCP_REQUEST_CACHE_MS',previous.age],['NODE_ENV',previous.nodeEnv]])if(value===undefined)delete process.env[name];else process.env[name]=value;});
 const rows=new Map(),calls={getUser:0,getProject:0,permissions:[],flags:[],deletes:0};
 const state={status:'active',allowed:new Set(['project.view','knowledge.view','run.view']),flagsOn:true,failNextUser:false};
 const store={prepare:sql=>({
  run:async(...values)=>{
   if(sql.startsWith('INSERT INTO mcp_credentials'))rows.set(values[0],{user:values[1],project:values[2],client:values[3],expires:values[4],scopes:JSON.parse(values[5]),internal:values[6],tool_names:JSON.parse(values[7]),revoked:false});
   else if(sql.startsWith('DELETE FROM mcp_credentials'))calls.deletes++;
   else if(sql.startsWith('UPDATE mcp_credentials'))rows.get(values[0]).revoked=true;
  },
  get:async(id,owner,project,client)=>{const row=rows.get(id);return row&&!row.revoked&&row.user===owner&&row.project===project&&row.client===client?{id,tool_names:row.tool_names}:undefined;}
 })};
 const auth=load('auth',{
  '@hellotest/platform/backend/src/db':store,
  '@hellotest/platform/backend/src/security/runtimeSecrets':{resolveSessionSecret:()=>'unused-because-the-signing-key-is-set'},
  '@hellotest/platform/backend/public/projectAccess':{getProject:async()=>{calls.getProject++;return {};}},
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async(who,permission)=>{calls.permissions.push(`${who.id}:${permission}`);return state.allowed.has(permission)&&who.id!=='denied-user';}},
  './mcpServer':{tools:{hellotest_project_get:{},hellotest_operation_prepare:{write:true},hellotest_project_update_prepare:{write:true,available:()=>false},hellotest_unclassified:{}}},
  '@hellotest/platform/backend/services/featureFlag.service':{getFeatureKeysForPermission:permission=>flagKeys[permission]||[],areEnabled:async keys=>{calls.flags.push(keys.join());return state.flagsOn;}},
  '@hellotest/platform/backend/services/user.service':{getUser:async id=>{calls.getUser++;if(state.failNextUser){state.failNextUser=false;throw new Error('database unavailable');}return {id,status:state.status};}}
 });
 return {auth,rows,calls,state};
}
const payloadOf=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
const forge=payload=>{const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');return `mcp1.${encoded}.${sign(encoded)}`;};
const claims=(overrides={})=>{const now=Math.floor(Date.now()/1000);return {sub:'user-a',project_id:'project-a',client_id:'host',aud:'hellotest:mcp',iss:'hellotest',jti:'forged-id',iat:now,exp:now+600,...overrides};};

// --- tool sets on credentials ---------------------------------------------------------------------------

test('a credential is read-only unless it was issued for more, and its sets are signed, recorded and enforced',async t=>{
 const {auth,rows}=setup(t);
 const issued=await auth.issue(user,'project-a','host');
 assert.deepEqual(issued.scopes,['knowledge','records']);
 assert.deepEqual(payloadOf(issued.token).scp,['knowledge','records']);
 assert.deepEqual(rows.get(issued.id).scopes,['knowledge','records']);assert.equal(rows.get(issued.id).internal,false);
 const actor=await auth.authenticate(issued.token);
 assert.deepEqual(actor.scopes,['knowledge','records']);assert.equal(actor.credentialId,issued.id);assert.equal(Object.hasOwn(actor,'internal'),false);
});

test('the stable client key is bound into credentials and tampering is rejected',async t=>{
 const {auth}=setup(t),clientKey=auth.clientKeyFor(user.id,'project-a','My Host');
 const issued=await auth.issue(user,'project-a','my-host-token',{clientKey});
 assert.equal(payloadOf(issued.token).client_key,clientKey);assert.equal((await auth.authenticate(issued.token)).clientKey,clientKey);
 assert.equal(auth.clientKeyFor(user.id,'project-a','my host'),clientKey);
 const invalid=forge({...payloadOf(issued.token),client_key:'not-a-digest'});assert.throws(()=>auth.decode(invalid),{code:'MCP_UNAUTHORIZED'});
});

test('writing tool sets must be asked for, and bring discovery with them',async t=>{
 const {auth}=setup(t);
 assert.deepEqual((await auth.issue(user,'project-a','host',{scopes:['actions']})).scopes,['records','actions']);
 assert.deepEqual((await auth.issue(user,'project-a','host',{scopes:['automation','knowledge']})).scopes,['knowledge','records','automation']);
 const actor=await auth.authenticate((await auth.issue(user,'project-a','host',{scopes:['knowledge']})).token);
 assert.deepEqual(actor.scopes,['knowledge'],'a narrower credential stays narrower');
});

test('unknown or empty tool sets are refused at issue and nothing is recorded',async t=>{
 const {auth,rows}=setup(t);
 for(const scopes of [['admin'],[],'*',['actions','everything']])await assert.rejects(auth.issue(user,'project-a','host',{scopes}),{code:'MCP_INVALID_SCOPE',statusCode:400},JSON.stringify(scopes));
 assert.equal(rows.size,0);
});

test('widening the tool sets of a token breaks its signature',async t=>{
 const {auth}=setup(t);
 const issued=await auth.issue(user,'project-a','host',{scopes:['knowledge']});
 const [prefix,encoded,signature]=issued.token.split('.');
 const widened=Buffer.from(JSON.stringify({...payloadOf(issued.token),scp:['knowledge','records','actions','automation']})).toString('base64url');
 await assert.rejects(auth.authenticate(`${prefix}.${widened}.${signature}`),{code:'MCP_UNAUTHORIZED'});
 assert.ok(encoded!==widened);
});

test('a credential from before tool sets is read-only, and malformed claims are not credentials',async t=>{
 const {auth,rows}=setup(t);
 rows.set('forged-id',{user:'user-a',project:'project-a',client:'host',revoked:false});
 const legacy=await auth.authenticate(forge(claims()));
 assert.deepEqual(legacy.scopes,['knowledge','records'],'a live token issued before this change loses no read access and gains no write access');
 for(const bad of [{scp:['bogus']},{scp:[]},{scp:'knowledge'},{int:'yes'},{int:false},{int:1}])assert.throws(()=>auth.decode(forge(claims(bad))),{code:'MCP_UNAUTHORIZED'},JSON.stringify(bad));
 assert.equal(auth.decode(forge(claims({scp:['knowledge'],int:true}))).int,true);
});

test('an internal credential is marked in its signed claim and its row, and its lifetime can only shrink',async t=>{
 const {auth,rows}=setup(t);
 const turn=await auth.issue(user,'project-a','hellotest-internal',{scopes:['knowledge'],internal:true,ttlSeconds:180});
 const payload=payloadOf(turn.token);
 assert.equal(payload.int,true);assert.equal(payload.exp-payload.iat,180);assert.equal(rows.get(turn.id).internal,true);
 const actor=await auth.authenticate(turn.token);
 assert.equal(actor.internal,true);assert.deepEqual(actor.scopes,['knowledge']);
 const lifetime=async ttlSeconds=>{const {token}=await auth.issue(user,'project-a','host',{ttlSeconds});const claimsOf=payloadOf(token);return claimsOf.exp-claimsOf.iat;};
 assert.equal(await lifetime(99_999),3600,'never longer than an hour');
 assert.equal(await lifetime(1),30,'and not so short that a call outlives it');
 assert.equal(await lifetime(undefined),3600);
 assert.equal(Object.hasOwn(payloadOf((await auth.issue(user,'project-a','host')).token),'int'),false,'an ordinary credential is not internal');
});

test('manual exact credentials sign a separate audience and fixed lifetime without embedding tool names',async t=>{
 const {auth,rows}=setup(t);
 const names=['hellotest_project_get','hellotest_operation_prepare'];
 for(const expiresIn of [3600,86400,604800,2592000,7776000]){
  const issued=await auth.issue(user,'project-a','host',{toolNames:names,expiresIn});
  const payload=payloadOf(issued.token);
  assert.equal(payload.aud,'hellotest:mcp:manual-tools','legacy replicas require the legacy audience');
  assert.match(payload.tool_scope_hash,/^[a-f0-9]{64}$/);
  assert.equal(payload.exp-payload.iat,expiresIn);
  assert.equal(Date.parse(issued.expires_at),payload.exp*1000);
  assert.equal(rows.get(issued.id).expires,issued.expires_at);
  assert.deepEqual(payload.scp,['records','actions']);
  assert.ok(!JSON.stringify(payload).includes('hellotest_project_get'));
  assert.deepEqual(rows.get(issued.id).tool_names,[...names].sort());
  assert.deepEqual(issued.tool_names,[...names].sort());
  assert.deepEqual((await auth.authenticate(issued.token)).toolNames,[...names].sort());
 }
 const issued=await auth.issue(user,'project-a','host',{toolNames:names});
 const payload=payloadOf(issued.token);
 assert.throws(()=>auth.decode(forge({...payload,aud:'hellotest:mcp'})),{code:'MCP_UNAUTHORIZED'});
 assert.throws(()=>auth.decode(forge({...payload,tool_scope_hash:undefined})),{code:'MCP_UNAUTHORIZED'});
 assert.throws(()=>auth.decode(forge({...payload,exp:payload.iat+3601})),{code:'MCP_UNAUTHORIZED'});
 assert.throws(()=>auth.decode(forge({...payload,int:true})),{code:'MCP_UNAUTHORIZED'});
 t.mock.method(Date,'now',()=>payload.exp*1000);
 await assert.rejects(auth.authenticate(issued.token),{code:'MCP_UNAUTHORIZED'});
});

test('exact issuance rejects invalid duration, unavailable tools and attempts to combine scopes',async t=>{
 const {auth,rows}=setup(t);
 const toolNames=['hellotest_project_get'];
 for(const expiresIn of [null,3601,3600.1,'3600',0,7776001])await assert.rejects(auth.issue(user,'project-a','host',{toolNames,expiresIn}),{code:'MCP_INVALID_EXPIRY'});
 for(const invalid of [null,[],['hellotest_unknown_get'],['hellotest_project_update_prepare'],['hellotest_unclassified'],['hellotest_project_get','hellotest_project_get'],['constructor'],Array(513).fill('hellotest_project_get')]){
  await assert.rejects(auth.issue(user,'project-a','host',{toolNames:invalid}),{code:'MCP_INVALID_SCOPE'});
 }
 await assert.rejects(auth.issue(user,'project-a','host',{expiresIn:86400}),{code:'MCP_INVALID_SCOPE'});
 await assert.rejects(auth.issue(user,'project-a','host',{toolNames,scopes:['records']}),{code:'MCP_INVALID_SCOPE'});
 await assert.rejects(auth.issue(user,'project-a','host',{toolNames,internal:true}),{code:'MCP_INVALID_SCOPE'});
 assert.equal(rows.size,0);
});

test('authentication rejects missing or changed exact scope and independently enforces deployment policy',async t=>{
 const {auth,rows}=setup(t);
 const issued=await auth.issue(user,'project-a','host',{toolNames:['hellotest_project_get']});
 const original=rows.get(issued.id);
 for(const tool_names of [null,[],['hellotest_operation_prepare'],['hellotest_project_get','hellotest_project_get'],['hellotest_project_get','hellotest_operation_prepare']]){
  rows.set(issued.id,{...original,tool_names});
  await assert.rejects(auth.authenticate(issued.token),{code:'MCP_UNAUTHORIZED'});
 }
 rows.set(issued.id,original);
 process.env.NODE_ENV='production';
 await assert.rejects(auth.authenticate(issued.token),{code:'MCP_OAUTH_REQUIRED',statusCode:401});
});

test('expired credential rows are trimmed occasionally, not on every issue',async t=>{
 const {auth,calls}=setup(t);
 await auth.issue(user,'project-a','host');await auth.issue(user,'project-a','host');await auth.issue(user,'project-a','host');
 assert.equal(calls.deletes,1);
});

// --- one request, one load --------------------------------------------------------------------------------

test('within one request the account, project, flags and permissions are each loaded once',async t=>{
 const {auth,calls}=setup(t,{flagKeys:{'knowledge.view':['knowledge'],'run.view':['runs']}});
 const actor={user,projectId:'project-a',clientId:'host'};
 await memo.open(async()=>{
  await Promise.all([auth.permit(actor,'project.view'),auth.permit(actor,'project.view'),auth.permit(actor,'knowledge.view')]);
  await auth.permit(actor,'knowledge.view');await auth.permit(actor,'run.view');await auth.permit(actor,'project.view');
 });
 assert.equal(calls.getUser,1);assert.equal(calls.getProject,1);
 assert.deepEqual([...new Set(calls.permissions)].sort(),['user-a:knowledge.view','user-a:project.view','user-a:run.view']);
 assert.equal(calls.permissions.length,3,'each permission is asked once');
 assert.deepEqual(calls.flags.sort(),['knowledge','runs'],'each feature-flag set is asked once');
});

test('outside a request scope nothing is shared, exactly as before',async t=>{
 const {auth,calls}=setup(t);
 const actor={user,projectId:'project-a',clientId:'host'};
 for(let index=0;index<3;index++)await auth.permit(actor,'project.view');
 assert.equal(calls.getUser,3);assert.equal(calls.getProject,3);assert.equal(calls.permissions.length,3);
});

test('nothing survives the request: the next one sees a disabled account or a withdrawn permission at once',async t=>{
 const {auth,state}=setup(t);
 const actor={user,projectId:'project-a',clientId:'host'};
 await memo.open(()=>auth.permit(actor,'project.view'));
 state.status='disabled';
 await assert.rejects(memo.open(()=>auth.permit(actor,'project.view')),{message:'This account is unavailable.'});
 state.status='active';state.allowed.delete('project.view');
 await assert.rejects(memo.open(()=>auth.permit(actor,'project.view')),{permission:'project.view',code:'MCP_ACCESS_DENIED'});
});

test('different users in one request never share an answer',async t=>{
 const {auth,calls}=setup(t);
 await memo.open(async()=>{
  await auth.permit({user,projectId:'project-a',clientId:'host'},'project.view');
  await assert.rejects(auth.permit({user:{id:'denied-user'},projectId:'project-a',clientId:'host'},'project.view'),{code:'MCP_ACCESS_DENIED'});
 });
 assert.equal(calls.getUser,2);
});

test('a failed load is not remembered',async t=>{
 const {auth,calls,state}=setup(t);
 const actor={user,projectId:'project-a',clientId:'host'};
 await memo.open(async()=>{
  state.failNextUser=true;
  await assert.rejects(auth.permit(actor,'project.view'),/database unavailable/);
  await auth.permit(actor,'project.view');
 });
 assert.equal(calls.getUser,2);
});

test('a long request reloads after the cache age, and the age can be turned off',async t=>{
 const {auth,calls}=setup(t);
 const actor={user,projectId:'project-a',clientId:'host'};
 process.env.HELLOTEST_MCP_REQUEST_CACHE_MS='40';
 await memo.open(async()=>{await auth.permit(actor,'project.view');await new Promise(resolve=>setTimeout(resolve,80));await auth.permit(actor,'project.view');});
 assert.equal(calls.getUser,2,'an entry older than the age is loaded again, so a revoked membership shows up within seconds');
 calls.getUser=0;process.env.HELLOTEST_MCP_REQUEST_CACHE_MS='0';
 await memo.open(async()=>{await auth.permit(actor,'project.view');await auth.permit(actor,'project.view');});
 assert.equal(calls.getUser,2,'zero disables sharing entirely');
});

test('issuing a credential and its own permission check share one account load',async t=>{
 const {auth,calls}=setup(t);
 await auth.issue(user,'project-a','host');
 assert.equal(calls.getUser,1);assert.equal(calls.getProject,1);
});

test('authentication and the tool call that follows it in the same request share the account load',async t=>{
 const {auth,calls}=setup(t);
 const issued=await auth.issue(user,'project-a','host');
 calls.getUser=0;calls.getProject=0;
 await memo.open(async()=>{const actor=await auth.authenticate(issued.token);await auth.permit(actor,'project.view');await auth.permit(actor,'knowledge.view');});
 assert.equal(calls.getUser,1);assert.equal(calls.getProject,1);
});

// --- the memo itself --------------------------------------------------------------------------------------

test('the request memo shares concurrent loads, nests into the open scope and stays closed outside it',async()=>{
 let loads=0;const load=async()=>{loads++;await new Promise(resolve=>setTimeout(resolve,5));return loads;};
 assert.equal(memo.active(),false);
 await memo.open(async()=>{
  assert.equal(memo.active(),true);
  const [one,two,three]=await Promise.all([memo.remember('key',load),memo.remember('key',load),memo.open(()=>memo.remember('key',load))]);
  assert.deepEqual([one,two,three],[1,1,1],'concurrent callers, including a nested scope, share one load');
  assert.equal(await memo.remember('other',load),2);
 });
 assert.equal(memo.active(),false);
 assert.equal(await memo.remember('key',load),3,'outside a scope every call loads');
});
