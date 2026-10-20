const test=require('node:test');
const assert=require('node:assert/strict');
const {missionContext,MAX_PACKET_CHARS}=require('../../backend/services/qualityMissionContext');
const request={kind:'web',target_url:'https://app.test/',goal:'Inspect the catalogue and report the visible result.',options:{max_pages:3,timeout_ms:60000,mission:{max_actions:12,allow_form_submission:false}},smart_context:{reviewed_context:'Pinned reviewed data'}};
const observed={sequence:12,url:request.target_url,title:'Catalogue',text:'Current visible facts',elements:[{id:'element-1',tag:'a',label:'Next',type:'',sensitive:false,href:'https://app.test/next'}]};

test('context projection is deterministic, preserves exact brief and receipts, and marks omitted history',()=>{
 const previous=Array.from({length:11},(_,i)=>({...observed,sequence:i+1,text:`Source ${i+1} `+'a'.repeat(9900)}));
 const history=Array.from({length:11},(_,i)=>({sequence:i+1,action:'click',status:'completed',summary:`Observed action ${i+1}`,url:request.target_url,untrusted_extra:'ignored'}));
 const packet=missionContext(request,observed,previous,history);
 assert.deepEqual(packet,missionContext(request,observed,previous,history));assert.equal(packet.task_brief.goal,request.goal);assert.equal(packet.reviewed_context,request.smart_context.reviewed_context);
 assert.deepEqual(packet.observation,observed);assert.equal(packet.history.length,11);assert.equal(packet.history[0].summary,history[0].summary);assert.ok(!JSON.stringify(packet).includes('untrusted_extra'));
 assert.ok(packet.context_manifest.prior_observations_available>packet.context_manifest.prior_observations_included);assert.ok(packet.prior_observations.every(item=>item.excerpt_truncated));assert.ok(JSON.stringify(packet).length<=MAX_PACKET_CHARS);
});

test('large advisory hrefs are omitted before any current target, input brief or action receipt',()=>{
 const elements=Array.from({length:80},(_,i)=>({id:`element-${i+1}`,tag:'a',label:`Catalogue link ${i+1}`,type:'',sensitive:false,href:`https://app.test/${'a'.repeat(1900)}`}));
 const packet=missionContext(request,{...observed,elements});assert.ok(JSON.stringify(packet).length<=MAX_PACKET_CHARS);assert.equal(packet.observation.elements.length,80);
 assert.equal(packet.context_manifest.element_hrefs_omitted,true);assert.equal(packet.observation.elements[79].id,'element-80');assert.equal(packet.observation.elements[79].label,'Catalogue link 80');assert.ok(!packet.observation.elements[0].href);assert.equal(packet.reviewed_context,'Pinned reviewed data');
 assert.equal(elements[0].href.length>1900,true,'The source observation is not mutated');
});

test('an oversized exact task fails instead of silently dropping user intent or current subjects',()=>{
 assert.throws(()=>missionContext({...request,smart_context:{reviewed_context:'x'.repeat(MAX_PACKET_CHARS)}},observed),error=>error.code==='QUALITY_AGENT_CONTEXT_BUDGET');
});
