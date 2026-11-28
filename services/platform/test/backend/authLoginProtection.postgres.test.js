const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');

test('authentication HTTP and PostgreSQL enforce private Signup acknowledgement and durable bounded sign-in protection',{
 skip:process.env.AUTH_LOGIN_POSTGRES!=='1',timeout:120000
},async t=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_auth_login_[a-z0-9_]+$/);
 assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
 const db=require('../../backend/src/db'),obs=require('../../backend/src/obsDb');
 let app;
 try{
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
  await require('../../backend/src/db/bootstrap').ensureRuntimeSchema();
  await require('../../backend/src/obsDb/bootstrap').ensureRuntimeSchema();
  await t.test('schema25 verification checks actual additive contracts and rejects a forged current receipt',async()=>{
   const readiness=require('../../backend/src/db/schemaReadiness');assert.ok(readiness.REQUIRED_SCHEMA_VERSION>=25);await readiness.verifySchema(db,'main');
   const rollback=new Error('fixture-schema-rollback');
   for (const column of ['ai_requirement_generation_jobs.error_code', 'ai_test_case_generation_jobs.processing_payload']) {
     const [table, field] = column.split('.');
     await assert.rejects(db.transaction(async()=>{await db.query(`ALTER TABLE ${table} DROP COLUMN ${field}`);await assert.rejects(readiness.verifySchema(db,'main'),{code:'SCHEMA_MIGRATION_REQUIRED'});throw rollback;})(),error=>error===rollback);
   }
   await readiness.verifySchema(db,'main');
  });
  // Only the SMTP boundary is replaced. Routes, validation, password hashing,
  // verification-code storage, transactions, sessions and ACLs are production.
  const outbox=[];let emailEnabled=true;
  const mail=require('../../backend/src/services/email.service');
  t.mock.method(mail,'getEmailSenderProfile',async()=>({enabled:emailEnabled,senderName:'Fixture outbox'}));
  t.mock.method(mail,'sendMail',async envelope=>{outbox.push(structuredClone(envelope));return{accepted:[envelope.to]};});
  const auth=require('../../backend/services/auth.service'),guard=require('../../backend/services/loginProtection.service'),tokens=require('../../backend/src/utils/token');
  const password='Fixture-long-password!',legacyPassword='old123';
  const hash=await tokens.hashPasswordAsync(password),legacyHash=await tokens.hashPasswordAsync(legacyPassword);
  const createUser=async(name,{admin=false,lastLogin='2026-01-01T00:00:00Z',credential=hash}={})=>{
   const id=randomUUID(),email=`${name}-${id}@example.test`;
   await db.prepare("INSERT INTO users(id,email,password_hash,name,status,is_workspace_admin,last_login_at,email_verified) VALUES(?,?,?,?,'active',?,?,TRUE)").run(id,email,credential,name,admin,lastLogin);
   return{id,email,name,role:admin?'admin':'member'};
  };
  const admin=await createUser('admin',{admin:true}),member=await createUser('member'),legacy=await createUser('legacy',{credential:legacyHash});
  app=require('fastify')({logger:false});
  await app.register(require('../../backend/src/plugins/errorHandler'));
  await app.register(require('../../backend/src/plugins/validator'));
  await app.register(require('../../backend/src/plugins/accessControl'));
  await app.register(require('../../backend/routes/auth.routes'));
  await app.register(require('../../backend/routes/users.routes'));
  await app.listen({host:'127.0.0.1',port:0});
  const base=app.listeningOrigin;
  const request=async(url,payload,{user,method='POST'}={})=>{
   const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${tokens.createToken(user)}`}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
   return{status:response.status,body:await response.json(),retryAfter:response.headers.get('Retry-After')};
  };
  const login=(email,secret=password)=>request('/auth/login',{email,password:secret});
  const protection=email=>db.prepare('SELECT * FROM auth_login_protection WHERE email=?').get(email);
  const pending=()=>db.prepare('SELECT count(*)::int AS count FROM auth_verification_codes').get();
  const countUsers=()=>db.prepare('SELECT count(*)::int AS count FROM users').get();
  const codeFor=email=>{const envelope=outbox.findLast(message=>message.to===email&&/(?:verification|reset) code/.test(message.subject));assert.ok(envelope,'A code must come only from the controlled outbox.');const code=envelope.text.match(/:\s*(\d{6})/);assert.ok(code);return code[1];};

  await t.test('shared input policy blocks malformed email and short new passwords before account, OTP or mail side effects',async()=>{
   const before={users:(await countUsers()).count,codes:(await pending()).count,mails:outbox.length};
   for(const email of ['not-an-email','a@b','a@@example.test','bad address@example.test']){
    const response=await request('/auth/signup/request-code',{email,password});assert.equal(response.status,400,JSON.stringify(response.body));
    const reset=await request('/auth/forgot-password/request-code',{email,newPassword:password});assert.equal(reset.status,400);
   }
   const weak=await request('/auth/signup/request-code',{email:'weak@example.test',password:'short1234'});assert.equal(weak.status,400);assert.match(weak.body.message,/10/);
   assert.deepEqual({users:(await countUsers()).count,codes:(await pending()).count,mails:outbox.length},before);
   assert.equal((await login(legacy.email,legacyPassword)).status,200,'Existing six-character credentials remain valid.');
  });

  await t.test('existing and new Signup return identical generic acknowledgement and expiry while instructions remain private',async()=>{
   const fresh=`signup-${randomUUID()}@example.test`,fixed=Date.now(),clock=t.mock.method(Date,'now',()=>fixed);
   let existing,newAccount,repeated;
   try{existing=await request('/auth/signup/request-code',{email:member.email,password});newAccount=await request('/auth/signup/request-code',{email:fresh,password,name:'Controlled Signup'});repeated=await request('/auth/signup/request-code',{email:member.email,password});}finally{clock.mock.restore();}
   assert.equal(existing.status,200);assert.equal(newAccount.status,200);assert.deepEqual(existing.body,newAccount.body);assert.deepEqual(repeated.body,existing.body);
   assert.doesNotMatch(JSON.stringify(existing.body),/already|exists|token|user_id/i);
   assert.equal((await db.prepare("SELECT count(*)::int AS count FROM auth_verification_codes WHERE email=? AND purpose='signup'").get(member.email)).count,0);
   assert.equal(outbox.filter(message=>message.to===member.email).length,1,'Owner guidance has a durable resend limit.');
   assert.match(outbox.find(message=>message.to===member.email).text,/already have/);
   const code=codeFor(fresh),verify=await request('/auth/signup/verify',{email:fresh,code});assert.equal(verify.status,200,JSON.stringify(verify.body));
   const saved=await db.prepare('SELECT email_verified,password_hash FROM users WHERE email=?').get(fresh);assert.equal(saved.email_verified,true);assert.notEqual(saved.password_hash,password);
   assert.equal((await login(fresh)).status,200,'Real OTP verification creates a usable local account.');
   assert.equal((await request('/auth/signup/verify',{email:fresh,code})).status,400,'A consumed verification code cannot be replayed.');
  });

  await t.test('password reset returns the same acknowledgement and setup error for existing and unknown addresses',async()=>{
   const unknown=`reset-unknown-${randomUUID()}@example.test`,fixed=Date.now(),clock=t.mock.method(Date,'now',()=>fixed);
   let known,absent;
   try{known=await request('/auth/forgot-password/request-code',{email:member.email,newPassword:password});absent=await request('/auth/forgot-password/request-code',{email:unknown,newPassword:password});}finally{clock.mock.restore();}
   assert.equal(known.status,200);assert.equal(absent.status,200);assert.deepEqual(known.body,absent.body);
   assert.equal((await db.prepare("SELECT count(*)::integer AS count FROM auth_verification_codes WHERE email=?").get(unknown)).count,0);
   const delivered=outbox.length;emailEnabled=false;
   try{const deniedKnown=await request('/auth/forgot-password/request-code',{email:member.email,newPassword:password}),deniedUnknown=await request('/auth/forgot-password/request-code',{email:unknown,newPassword:password});assert.equal(deniedKnown.status,503);assert.equal(deniedUnknown.status,503);assert.equal(deniedKnown.body.message,deniedUnknown.body.message);assert.equal(deniedKnown.body.code,deniedUnknown.body.code);assert.equal(outbox.length,delivered);}finally{emailEnabled=true;}
  });

  await t.test('concurrent wrong-password attempts atomically lock at five and locked requests cannot extend the deadline',async()=>{
   await guard.clear(member.email);
   const responses=await Promise.all(Array.from({length:8},()=>login(member.email,'wrong-password')));
   assert.equal(responses.filter(row=>row.status===401).length,4);assert.equal(responses.filter(row=>row.status===429).length,4);
   const locked=await protection(member.email);assert.equal(locked.failure_count,5);assert.ok(locked.locked_until);
   const deadline=new Date(locked.locked_until).getTime();assert.ok(deadline>Date.now()&&deadline<=Date.now()+901000);
   const validButLocked=await login(member.email);assert.equal(validButLocked.status,429);assert.equal(validButLocked.body.code,'AUTH_LOGIN_LOCKED');assert.ok(Number(validButLocked.retryAfter)>0&&Number(validButLocked.retryAfter)<=900);
   const again=await protection(member.email);assert.equal(new Date(again.locked_until).getTime(),deadline);assert.equal(again.failure_count,5);
   const unknown=`unknown-${randomUUID()}@example.test`;
   for(let i=0;i<5;i++)assert.equal((await login(unknown,'wrong-password')).status,i===4?429:401);
   assert.equal((await protection(unknown)).user_id,null,'Unknown identities have the same public lock behavior without dummy users.');
  });

  await t.test('expired locks and failure windows restart cleanly; a successful login clears only its own guard',async()=>{
   await db.prepare("UPDATE auth_login_protection SET locked_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE email=?").run(member.email);
   assert.equal((await login(member.email)).status,200);
   let row=await protection(member.email);assert.equal(row.failure_count,0);assert.equal(row.locked_until,null);
   await db.prepare("UPDATE auth_login_protection SET failure_count=4,last_failure_at=CURRENT_TIMESTAMP-INTERVAL '16 minutes' WHERE email=?").run(member.email);
   assert.equal((await login(member.email,'wrong-password')).status,401);row=await protection(member.email);assert.equal(row.failure_count,1);assert.equal(row.locked_until,null);
   await guard.recordFailure(legacy.email,legacy.id);assert.equal((await login(member.email)).status,200);assert.equal((await protection(legacy.email)).failure_count,1);
  });

  await t.test('a lock committed after admission still prevents token issuance and rolls back the login write',async()=>{
   const race=await createUser('race'),admitted={};admitted.promise=new Promise(resolve=>admitted.resolve=resolve);let release;const gate=new Promise(resolve=>release=resolve);
   const original=guard.assertAllowed;
   const hook=t.mock.method(guard,'assertAllowed',async email=>{await original(email);if(email===race.email){admitted.resolve();await gate;}});
   const pendingLogin=login(race.email);
   try{await admitted.promise;for(let i=0;i<5;i++)await guard.recordFailure(race.email,race.id);release();const rejected=await pendingLogin;assert.equal(rejected.status,429);assert.equal((await protection(race.email)).failure_count,5);}finally{release();hook.mock.restore();}
   assert.equal(new Date((await db.prepare('SELECT last_login_at FROM users WHERE id=?').get(race.id)).last_login_at).toISOString(),'2026-01-01T00:00:00.000Z');
  });

  await t.test('unexpected first-login failure rolls back guard clearing and account mutation together',async()=>{
   const first=await createUser('first-login',{lastLogin:null});for(let i=0;i<3;i++)await guard.recordFailure(first.email,first.id);
   const membership=require('../../backend/services/defaultProjectMembership.service');const fail=t.mock.method(membership,'assign',async()=>{throw new Error('Injected membership rollback');});
   try{assert.equal((await login(first.email)).status,500);}finally{fail.mock.restore();}
   assert.equal((await protection(first.email)).failure_count,3);assert.equal((await db.prepare('SELECT last_login_at FROM users WHERE id=?').get(first.id)).last_login_at,null);
   assert.equal((await login(first.email)).status,200);assert.equal((await protection(first.email)).failure_count,0);
  });

  await t.test('admin unlock requires user.manage and password-reset verification clears the lock transactionally',async()=>{
   for(let i=0;i<5;i++)await guard.recordFailure(member.email,member.id);
   const visibility=await request(`/users/${member.id}`,undefined,{user:admin,method:'GET'});assert.equal(visibility.status,200);assert.equal(visibility.body.login_failed_attempts,5);assert.ok(visibility.body.login_locked_until);
   const forbidden=await request(`/users/${member.id}/unlock-login`,{},{user:legacy});assert.equal(forbidden.status,403);assert.ok((await protection(member.email)).locked_until);
   const granted=await request(`/users/${member.id}/unlock-login`,{},{user:admin});assert.equal(granted.status,200,JSON.stringify(granted.body));assert.equal((await protection(member.email)).failure_count,0);
   for(let i=0;i<5;i++)await guard.recordFailure(member.email,member.id);
   const nextPassword='Reset password 12345!';assert.equal((await request('/auth/forgot-password/request-code',{email:member.email,newPassword:nextPassword})).status,200);
   const code=codeFor(member.email);assert.equal((await request('/auth/forgot-password/verify',{email:member.email,code})).status,200);
   assert.equal((await protection(member.email)).failure_count,0);assert.equal((await protection(member.email)).locked_until,null);
   assert.equal((await login(member.email)).status,401);assert.equal((await login(member.email,nextPassword)).status,200);
  });
 }finally{if(app)await app.close();await Promise.all([db.close(),obs.close()]);}
});
