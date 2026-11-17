const test=require('node:test');
const assert=require('node:assert/strict');
const {createAdmission,limitsFromEnv}=require('../../backend/admission');

const fakeClock=()=>{let now=1_000_000;const clock=()=>now;clock.advance=ms=>{now+=ms;};return clock;};
const external=(id,project='project',clientId=`client-${id}`)=>({credentialId:id,projectId:project,clientId});
const internal=(id='platform')=>({credentialId:id,projectId:'project',internal:true});

test('total capacity bounds requests in flight and frees on release',()=>{
 const gate=createAdmission({capacity:2,internalReserve:0,burst:100});
 const first=gate.admit(external('a','p1')),second=gate.admit(external('b','p2'));
 assert.ok(first.ok&&second.ok);
 const refused=gate.admit(external('c','p3'));
 assert.deepEqual({ok:refused.ok,status:refused.status,reason:refused.reason,code:refused.code},{ok:false,status:429,reason:'capacity',code:'MCP_CAPACITY'});
 assert.ok(refused.retryAfter>=1&&Number.isInteger(refused.retryAfter));
 first.release();
 assert.ok(gate.admit(external('c','p3')).ok);
});

test('a share of the capacity is reserved for internal callers',()=>{
 const gate=createAdmission({capacity:4,internalReserve:1,projectShare:1,burst:100});
 const held=['a','b','c'].map((id,index)=>gate.admit(external(id,'p'+index)));
 assert.ok(held.every(slot=>slot.ok));
 assert.equal(gate.admit(external('d','p9')).reason,'reserved','external callers stop one short of the total');
 const platform=gate.admit(internal());
 assert.ok(platform.ok,'the reserved slot is there for the platform');
 assert.equal(gate.admit(internal('platform-2')).reason,'capacity','the reserve is part of the total, not extra');
 held[0].release();
 assert.ok(gate.admit(external('d','p9')).ok,'an external slot freed by release can be reused by an external caller');
});

test('the reserve can never leave external callers with no capacity at all',()=>{
 const gate=createAdmission({capacity:1,internalReserve:5});
 assert.equal(gate.snapshot().internal_reserve,0);
 assert.ok(gate.admit(external('a')).ok);
 assert.deepEqual(limitsFromEnv({HELLOTEST_MCP_MAX_CONCURRENT:'3',HELLOTEST_MCP_INTERNAL_RESERVE:'9'}).internalReserve,2);
});

test('one project may hold only its share of the external capacity',()=>{
 const gate=createAdmission({capacity:10,internalReserve:0,projectShare:0.3,burst:100});
 const held=['a','b','c'].map(id=>gate.admit(external(id,'busy')));
 assert.ok(held.every(slot=>slot.ok));
 assert.equal(gate.admit(external('d','busy')).reason,'project');
 assert.ok(gate.admit(external('e','quiet')).ok,'another project is unaffected');
 held[1].release();
 assert.ok(gate.admit(external('d','busy')).ok);
});

test('a credential has a steady rate with a burst, refilling over time up to the burst',()=>{
 const clock=fakeClock(),gate=createAdmission({capacity:50,internalReserve:0,projectShare:1,ratePerSecond:2,burst:4,clock});
 const use=()=>{const slot=gate.admit(external('hot'));if(slot.ok)slot.release();return slot;};
 for(let index=0;index<4;index++)assert.ok(use().ok,'the burst');
 const limited=use();
 assert.deepEqual({ok:limited.ok,reason:limited.reason,code:limited.code,retryAfter:limited.retryAfter},{ok:false,reason:'rate',code:'MCP_RATE_LIMITED',retryAfter:1});
 clock.advance(500);
 assert.ok(use().ok,'half a second at 2 per second is one token');
 assert.equal(use().reason,'rate');
 clock.advance(60_000);
 for(let index=0;index<4;index++)assert.ok(use().ok,'a long pause refills to the burst, not beyond it');
 assert.equal(use().reason,'rate');
});

test('credentials from the same client share a second rate bucket',()=>{
 const gate=createAdmission({capacity:50,internalReserve:0,projectShare:1,ratePerSecond:100,burst:100,clientRatePerSecond:2,clientBurst:2});
 const use=id=>{const slot=gate.admit(external(id,'project','shared-host'));if(slot.ok)slot.release();return slot;};
 assert.ok(use('credential-a').ok);assert.ok(use('credential-b').ok);
 const limited=use('credential-c');assert.equal(limited.reason,'client_rate');assert.equal(limited.code,'MCP_CLIENT_RATE_LIMITED');
});

test('retry-after tells a slow credential when a token will exist',()=>{
 const clock=fakeClock(),gate=createAdmission({capacity:50,internalReserve:0,ratePerSecond:0.25,burst:1,clock});
 gate.admit(external('slow')).release();
 const limited=gate.admit(external('slow'));
 assert.equal(limited.retryAfter,4,'one token every four seconds');
 clock.advance(3_000);assert.equal(gate.admit(external('slow')).retryAfter,1);
 clock.advance(1_000);assert.ok(gate.admit(external('slow')).ok);
});

test('a refused request takes no slot and spends no token',()=>{
 const clock=fakeClock(),gate=createAdmission({capacity:1,internalReserve:0,projectShare:1,ratePerSecond:0.1,burst:2,clock});
 const holder=gate.admit(external('hot'));   // spends 1 of 2 tokens
 for(let index=0;index<10;index++)assert.equal(gate.admit(external('hot')).reason,'capacity');
 holder.release();
 const next=gate.admit(external('hot'));     // would be rate-limited if the refusals had spent tokens
 assert.ok(next.ok,'the ten refusals cost nothing');
 next.release();
 assert.equal(gate.admit(external('hot')).reason,'rate','the two real requests did');
});

test('internal calls are not rate or project limited and are not tracked',()=>{
 const gate=createAdmission({capacity:4,internalReserve:1,projectShare:0.1,ratePerSecond:0.1,burst:1});
 for(let index=0;index<100;index++){const slot=gate.admit(internal());assert.ok(slot.ok);slot.release();}
 assert.equal(gate.snapshot().tracked_credentials,0);
});

test('releasing twice frees one slot, not two',()=>{
 const gate=createAdmission({capacity:1,internalReserve:0,burst:100});
 const slot=gate.admit(external('a'));
 slot.release();slot.release();
 assert.ok(gate.admit(external('b')).ok);
 assert.equal(gate.admit(external('c')).reason,'capacity','a second release must not have opened a second slot');
});

test('the per-credential table is bounded',()=>{
 const clock=fakeClock(),gate=createAdmission({capacity:50,internalReserve:0,projectShare:1,burst:5,clock,maxBuckets:3});
 for(let index=0;index<40;index++){gate.admit(external('credential-'+index,'p'+index)).release();clock.advance(10);}
 assert.ok(gate.snapshot().tracked_credentials<=3);
 assert.ok(gate.admit(external('credential-0')).ok,'an evicted credential simply starts a new bucket');
});

test('limits come from the environment, and a bad value never disables a limit',()=>{
 assert.deepEqual(limitsFromEnv({}),{capacity:16,internalReserve:4,projectShare:0.5,ratePerSecond:10,burst:30,clientRatePerSecond:10,clientBurst:30});
 assert.equal(limitsFromEnv({HELLOTEST_MCP_MAX_CONCURRENT:'0'}).capacity,16,'zero concurrency means the default, as before');
 assert.equal(limitsFromEnv({HELLOTEST_MCP_MAX_CONCURRENT:''}).capacity,16);
 assert.equal(limitsFromEnv({HELLOTEST_MCP_MAX_CONCURRENT:'500'}).capacity,64);
 assert.equal(limitsFromEnv({HELLOTEST_MCP_MAX_CONCURRENT:'8'}).internalReserve,2);
 assert.equal(limitsFromEnv({HELLOTEST_MCP_MAX_CONCURRENT:'8',HELLOTEST_MCP_INTERNAL_RESERVE:'0'}).internalReserve,0,'zero is a real choice for the reserve');
 const garbage=limitsFromEnv({HELLOTEST_MCP_PROJECT_SHARE:'lots',HELLOTEST_MCP_RATE_PER_SECOND:'fast',HELLOTEST_MCP_RATE_BURST:'-5'});
 assert.deepEqual([garbage.projectShare,garbage.ratePerSecond,garbage.burst],[0.5,10,1]);
});
