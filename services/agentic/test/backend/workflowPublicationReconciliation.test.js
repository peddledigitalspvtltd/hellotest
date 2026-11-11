const test=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('../../backend/services/agenticWorkflowExecution.service');
const db=require('@hellotest/platform/backend/src/db');
const obs=require('@hellotest/platform/backend/src/obsDb');
test.after(()=>Promise.all([db.close(),obs.close()]));

const receipt=id=>({id:`manual-${id}`,kind:'manual',saved:true,story_id:'story',requires_review:true});
const publication=value=>({mode:'automatic',status:'partial',receipts:[value],manual_cases_saved:1,automation_cases_saved:0,requires_review:true,approved:false});
function run(id='run') {
  const saved=receipt(id),copy={library_publication:publication(saved)};
  return {id,project_id:'project',execution_mode:'review',status:'failed',updated_at:'revision-1',
    workflow_snapshot:{execution_mode:'review',settings:{template_id:'sprint-automator',library_publication_mode:'automatic'}},
    node_results:[{node_id:'generate',status:'completed',output:copy,
      iterations:Array.from({length:20},()=>({output:structuredClone(copy)})),progress:{completed_items:Array.from({length:20},()=>structuredClone(copy))}},
      {node_id:'automation',status:'failed',output:null}],
    output_payload:{project_changes_applied:true,summary:'Saved 1 manual Test Case pending review. The automation failed.'}};
}

test('200 historical runs read committed receipts in bounded batches without rewriting identical projections or following duplicate copies',async t=>{
  const values=Array.from({length:200},(_,index)=>run(String(index))),batches=[];
  t.mock.method(runtime._internals.store,'publicationRows',async batch=>{
    batches.push(batch.map(value=>value.id));
    return batch.map(value=>({run_id:value.id,node_id:'generate',receipt:receipt(value.id)}));
  });
  t.mock.method(db,'prepare',()=>assert.fail('An unchanged publication must not issue an UPDATE or another receipt read.'));
  const result=await runtime.reconcileMany(values);
  assert.equal(batches.length,25);assert.ok(batches.every(batch=>batch.length===8));
  assert.deepEqual(result.map(value=>value.id),values.map(value=>value.id));
  assert.ok(result.every((value,index)=>value===values[index]));
  await runtime.reconcileMany(values);
  assert.equal(batches.length,50,'A later request rereads committed receipts; it cannot reuse a process cache.');
});

test('receipt reads coalesce duplicate run identities only within the current request and preserve newer run revisions',async t=>{
  const before=run(),after=structuredClone(before);after.updated_at='revision-2';after.node_results[1].progress={percent:72};
  let reads=0;
  t.mock.method(runtime._internals.store,'publicationRows',async batch=>{
    reads++;assert.equal(batch.length,1);
    return [{run_id:'run',node_id:'generate',receipt:receipt('run')}];
  });
  t.mock.method(db,'prepare',()=>assert.fail('Identical durable publication metadata needs no write.'));
  const values=await runtime.reconcileMany([before,...Array.from({length:15},()=>after)]);
  assert.equal(reads,1);assert.equal(values[0].updated_at,'revision-1');
  assert.ok(values.slice(1).every(value=>value.updated_at==='revision-2'&&value.node_results[1].progress.percent===72));
  await runtime.reconcileMany([after]);assert.equal(reads,2);
});

test('running and unrelated workflows do not query publication history',async t=>{
  const running={...run(),status:'running',workflow_snapshot:{runtime_contract:{orchestrator:'temporal'}}};
  const preview={...run('preview'),execution_mode:'preview'},manual={...run('manual'),workflow_snapshot:{settings:{library_publication_mode:'manual'}}};
  t.mock.method(runtime._internals.store,'publicationRows',()=>assert.fail('No terminal automatic publication needs recovery.'));
  assert.deepEqual(await runtime.reconcileMany([running,preview,manual]),[running,preview,manual]);
});

test('a disconnected list stops after its in-flight receipt read without issuing publication writes or later batches',async t=>{
  const controller=new AbortController();let reads=0;
  t.mock.method(runtime._internals.store,'publicationRows',async()=>{reads++;controller.abort();return [];});
  t.mock.method(runtime._internals.store,'mergePublication',()=>assert.fail('Cancelled reads cannot begin metadata writes.'));
  await assert.rejects(runtime.reconcileMany(Array.from({length:20},(_,index)=>run(String(index))),{signal:controller.signal}),{name:'AbortError',code:'REQUEST_CANCELLED'});
  assert.equal(reads,1);
});

test('reconciliation drains at most two metadata operations and does not start queued work after failure',async t=>{
  let active=0,peak=0,started=0,finished=0;
  t.mock.method(runtime._internals.store,'publicationRows',async()=>[]);
  t.mock.method(runtime._internals.store,'mergePublication',async()=>{
    started++;active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setImmediate(resolve));active--;finished++;
    if(started<=2)throw Object.assign(new Error('Database unavailable'),{code:'DATABASE_UNAVAILABLE'});
    return null;
  });
  await assert.rejects(runtime.reconcileMany(Array.from({length:20},(_,index)=>run(String(index)))),{code:'DATABASE_UNAVAILABLE'});
  assert.equal(peak,2);assert.equal(started,2);assert.equal(finished,2);assert.equal(active,0);
});

test('an oversized committed receipt set fails before writing or returning a successful prefix',async t=>{
  t.mock.method(runtime._internals.store,'publicationRows',async()=>Array.from({length:2001},()=>({run_id:'run',node_id:'generate',receipt:receipt('run')})));
  t.mock.method(runtime._internals.store,'mergePublication',()=>assert.fail('Oversized history must not be partially reconciled.'));
  await assert.rejects(runtime.reconcileMany([run()]),error=>error.statusCode===409&&/receipts exceed/.test(error.message));
});
