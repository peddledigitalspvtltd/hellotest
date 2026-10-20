const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../backend/services/automationAgentActivity.service'),'utf8');
test('agent activity discovery pins application/project/case and paginates actual event records',async()=>{
 const reads=[],rows=Array.from({length:201},(_,i)=>({id:`event-${i}`,message:`Actual section event ${i}`,details:{step_id:`step-${i}`}}));
 const transaction={id:'activity',project_id:'project',app_type_id:'app',event_count:450,metadata:{agent_activity:true}},module={exports:{}};
 vm.runInNewContext(source,{module,require:id=>id.endsWith('/obsDb')?{prepare:sql=>({get:async(...params)=>{reads.push({sql,params});return {id:'activity'};},all:async(...params)=>{reads.push({sql,params});return rows;}})}:{getTransaction:async id=>{assert.equal(id,'activity');return transaction;}}});
 const activity=await module.exports.latest({projectId:'project',appTypeId:'app',caseId:'case'});
 assert.deepEqual(reads[0].params,['project','app','case','case','case']);assert.match(reads[0].sql,/metadata->'input_test_case_ids' @> jsonb_build_array/);assert.match(reads[0].sql,/metadata->'output_test_case_ids'/);
 assert.equal(activity.events.length,200);assert.equal(activity.events[0].message,'Actual section event 0');assert.equal(activity.events_has_more,true);assert.equal(activity.events_next_offset,200);assert.equal(activity.events_total,450);assert.deepEqual(reads[1].params,['activity',201,0]);
 await module.exports.activity(transaction,{events_offset:200,events_limit:100});assert.deepEqual(reads[2].params,['activity',101,200]);
 for(const input of [{events_offset:-1},{events_limit:501},{events_offset:'invalid'},{events_limit:0}])assert.throws(()=>module.exports.page(input),error=>error.statusCode===400);
});

test('history is scoped and cursor-paginated; screenshots enforce activity ownership, image type, bytes and bounds',async()=>{
 const reads=[],rows=Array.from({length:3},(_,i)=>({id:'activity-'+i,created_at:new Date('2026-10-16T10:00:00Z'),metadata:{agent_activity:true}}));
 let artifact={id:'image',transaction_id:'activity',mime_type:'image/jpeg',content:Buffer.from([255,216,255,1,2,3]).toString('base64')};
 const module={exports:{}};
 vm.runInNewContext(source,{module,Buffer,require:id=>id.endsWith('/obsDb')?{prepare:sql=>({all:async(...params)=>{reads.push({sql,params});return rows;}})}:{getTransactionArtifact:async()=>artifact}});
 const first=await module.exports.history({projectId:'p',appTypeId:'a',caseId:'case'},{limit:2});assert.equal(first.items.length,2);assert.ok(first.next_cursor);assert.deepEqual(reads[0].params,['p','a','case','case','case',3]);
 await module.exports.history({projectId:'p',appTypeId:'a',caseId:'case'},{limit:2,cursor:first.next_cursor});assert.match(reads[1].sql,/\(created_at,id\) < \(\?::timestamptz,\?\)/);assert.equal(reads[1].params[6],'activity-1');
 for(const input of [{limit:51},{limit:0},{cursor:'invalid'},{cursor:Buffer.from(JSON.stringify(['bad','id'])).toString('base64url')}])assert.throws(()=>module.exports.historyPage(input),error=>error.statusCode===400);
 const result=await module.exports.screenshot({id:'activity'},'image');assert.match(result.data_url,/^data:image\/jpeg;base64,/);
 for(const patch of [{transaction_id:'other'},{mime_type:'image/svg+xml'},{content:Buffer.from('not an image').toString('base64')},{content:'A'.repeat(200000)}]){const original=artifact;artifact={...artifact,...patch};await assert.rejects(module.exports.screenshot({id:'activity'},'image'),error=>error.statusCode===404);artifact=original;}
});

test('progress reduction and append share an observability transaction row lock',async()=>{
 const calls=[],module={exports:{}},reducer=require('../../backend/lib/automationActivityProgress');
 vm.runInNewContext(source,{module,Buffer,require:id=>id==='../lib/automationProgressDiagnostics'?require('../../backend/lib/automationProgressDiagnostics'):id.endsWith('/llmTraceContext')?{current:()=>({request_id:'request-one',trace_id:'trace-one'})}:id.endsWith('/obsDb')?{transaction:callback=>async()=>{calls.push('begin');await callback();calls.push('commit');},prepare:sql=>({get:async id=>{assert.match(sql,/FOR UPDATE/);assert.equal(id,'activity');calls.push('lock');}})}:id==='../lib/automationActivityProgress'?reducer:{getTransaction:async()=>{calls.push('read');return {metadata:{}};},appendTransactionEvent:async(id,event)=>{calls.push('append');assert.equal(event.metadata.step_progress[0].status,'queued');assert.equal(event.details.correlation.activity_id,'activity');assert.equal(event.details.correlation.request_id,'request-one');assert.equal(event.details.correlation.trace_id,'trace-one');assert.ok(Number.isFinite(Date.parse(event.details.occurred_at)));}}});
 await module.exports.recordProgress('activity',{phase:'automation.agent.plan',details:{test_case_id:'case',steps:[{step_id:'one'}]}});assert.deepEqual(calls,['begin','lock','read','append','commit']);
});

test('persisted browser events and metadata share sanitized receipts and host trace correlation',async()=>{
 const module={exports:{}},events=[];
 let metadata={step_progress:[{test_case_id:'case',step_id:'step'}]};
 const obs={transaction:callback=>callback,prepare:()=>({get:async()=>({id:'activity'})})};
 const transactions={getTransaction:async()=>({id:'activity',metadata}),appendTransactionEvent:async(id,event)=>{events.push(event);metadata={...metadata,...event.metadata};return{metadata};}};
 vm.runInNewContext(source,{module,Buffer,require:id=>id.endsWith('/obsDb')?obs:id.endsWith('/llmTraceContext')?{current:()=>({request_id:'request',trace_id:'trace'})}:id==='../lib/automationProgressDiagnostics'?require('../../backend/lib/automationProgressDiagnostics'):id==='../lib/automationActivityProgress'?require('../../backend/lib/automationActivityProgress'):transactions});
 for(const phase of ['started','failed'])await module.exports.recordProgress('activity',{phase:`automation.agent.action.${phase}`,message:'PRIVATE_PAGE_MESSAGE',metadata:{phase_message:'PRIVATE_PAGE_MESSAGE',parameters:{password:'PRIVATE_INPUT'}},details:{test_case_id:'case',active_step_id:'step',action_id:'operation',tool:'browser_assert',assertion:'field_valid',error_code:'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED',arguments:{value:'PRIVATE_INPUT'},selector:'#PRIVATE_SELECTOR'}});
 assert.equal(events.length,2);
 assert.doesNotMatch(JSON.stringify({events,metadata}),/PRIVATE|arguments|selector|parameters/);
 assert.equal(metadata.step_progress[0].browser_actions[0].error_code,'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
 assert.equal(metadata.step_progress[0].browser_actions[0].assertion,'field_valid');
 assert.equal(typeof metadata.step_progress[0].browser_actions[0].duration_ms,'number');
 assert.equal(events[1].details.correlation.activity_id,'activity');
 assert.equal(events[1].details.correlation.trace_id,'trace');
});
