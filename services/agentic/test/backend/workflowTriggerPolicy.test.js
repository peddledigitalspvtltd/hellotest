const test=require('node:test');const assert=require('node:assert/strict');const policy=require('../../backend/workflows/triggerPolicy');
const workflow={id:'workflow',project_id:'project',updated_by:'actor',status:'active',trigger_kind:'schedule',nodes:[],edges:[],settings:{trigger:{interval_minutes:10}},updated_at:'2026-11-17T09:00:00Z'};
test('bounded schedules coalesce missed slots and do not dispatch before their first UTC start',()=>{
 assert.equal(policy.scheduleSlot(workflow,Date.parse('2026-11-17T09:37:00Z')),'2026-11-17T09:30:00.000Z');
 assert.equal(policy.scheduleSlot(workflow,Date.parse('2026-11-17T08:59:00Z')),null);
 for(const value of [0,-1,10081,1.5,'x'])assert.throws(()=>policy.config({...workflow,settings:{trigger:{interval_minutes:value}}}),/interval/);
});
test('webhook signature binds canonical input, event identity and bounded timestamp',()=>{
 const now=Date.parse('2026-11-17T09:00:00Z'),timestamp=String(now/1000),eventId='release-123',secret='fixture-signing-secret';
 const body={z:{b:2,a:1},a:['value']},headers={'x-hellotest-timestamp':timestamp,'x-hellotest-event-id':eventId,'x-hellotest-signature':policy.signature(secret,timestamp,eventId,body)};
 assert.equal(policy.verifySignature(secret,headers,{a:['value'],z:{a:1,b:2}},now),eventId);
 assert.throws(()=>policy.verifySignature(secret,headers,{...body,a:['changed']},now),/signature/);
 assert.throws(()=>policy.verifySignature(secret,{...headers,'x-hellotest-event-id':'another-id'},body,now),/signature/);
 assert.throws(()=>policy.verifySignature(secret,headers,body,now+301000),/expired/);
 assert.throws(()=>policy.verifySignature(secret,{...headers,'x-hellotest-signature':'private'},body,now),/signature/);
});
test('definition identity changes with owner, activation and executable input, while audit timestamps do not change it',()=>{
 const digest=policy.definitionHash(workflow);
 assert.notEqual(policy.definitionHash({...workflow,updated_by:'other'}),digest);
 assert.notEqual(policy.definitionHash({...workflow,status:'paused'}),digest);
 assert.notEqual(policy.definitionHash({...workflow,nodes:[{id:'changed'}]}),digest);
 assert.equal(policy.definitionHash({...workflow,updated_at:'2027-01-01'}),digest);
 assert.throws(()=>policy.config({...workflow,settings:{trigger:{secret:'private',interval_minutes:10}}}),/credentials/);
 for(const event_name of policy.EVENTS)assert.equal(policy.config({...workflow,trigger_kind:'event',settings:{trigger:{event_name}}}).event_name,event_name);
 assert.throws(()=>policy.config({...workflow,trigger_kind:'event',settings:{trigger:{event_name:'unsupported'}}}),/supported/);
});
