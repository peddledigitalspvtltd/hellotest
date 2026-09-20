const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Story imports preserve existing data, round-trip authoring fields and produce reliable Batch Process traces', {skip:process.env.STORY_IMPORT_POSTGRES !== '1',timeout:120000}, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_story_import_[a-z0-9_]+$/);
  const db = require('../../src/db'), obsDb = require('../../src/obsDb');
  const stories = require('../../src/services/requirement.service');
  const workspace = require('../../src/services/requirementWorkspace.service');
  const queue = require('../../src/services/batchProcess.service');
  const transactions = require('../../src/services/workspaceTransaction.service');
  const read = id => stories.getRequirement(id);
  t.mock.method(queue,'triggerProcessing',()=>{});
  try {
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../../db/schema.sql'),'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash,name) VALUES ('author','author@example.test','no-login','Author');
      INSERT INTO projects(id,name) VALUES ('project','Story imports'),('foreign','Foreign');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web'),('foreign-app','foreign','Other','web');
      INSERT INTO requirement_iterations(id,project_id,name,state) VALUES ('sprint','project','Native Sprint','active');
      INSERT INTO requirement_releases(id,project_id,name,fix_version,state,sprint_ids) VALUES ('release','project','Native Release','v2','planned','["sprint"]');
      INSERT INTO test_cases(id,app_type_id,title) VALUES ('case','app','Check access'),('foreign-case','foreign-app','Private test');`);
    const criteria=['Given an active membership, when I open the project, then Stories appear.'];
    const row={title:'CSV metadata Story',description:'As a member, I want to open my project\nso that I can review progress.',status:'QA Done',priority:2,labels:['smoke, nightly','a|b'],external_references:['ISSUE-20'],acceptance_criteria:criteria,additional_fields:{component:'Payments',risk:2},gherkin_scenarios:['Feature: Project access\nScenario: Open project\n Given membership\n When I open the project\n Then Stories appear'],specification_format:'speckit',specification_content:'## Scope\nOpen assigned projects.',iteration_id:'sprint',release_id:'release',dev_completion_target_date:'2026-10-10',qa_completion_target_date:'2026-10-15',scrum_team:'Delivery',linked_test_cases:['case']};
    let receipt,first;
    await t.test('queue commits receipt and job together before importing full Story metadata',async()=>{
      receipt=await queue.queueRequirementImport({project_id:'project',created_by:'author',rows:[row]});
      assert.equal((await obsDb.prepare('SELECT status FROM batch_process_jobs WHERE transaction_id = ?').get(receipt.transaction_id)).status,'queued');
      first=await stories.bulkImportRequirements({project_id:'project',created_by:'author',rows:[row],transaction_id:receipt.transaction_id});
      assert.equal(first.imported,1,JSON.stringify(first.errors));assert.equal(first.failed,0);
      const item=await read(first.created[0].id);
      assert.deepEqual(item.acceptance_criteria,criteria);assert.equal(item.description,row.description);
      assert.deepEqual(item.labels,row.labels);assert.deepEqual(item.gherkin_scenarios,row.gherkin_scenarios);
      assert.equal(item.additional_fields.component,'Payments');assert.equal(item.specification_format,'speckit');assert.equal(item.specification_content,row.specification_content);
      assert.equal(item.iteration_id,'sprint');assert.equal(item.release,'Native Release');assert.equal(item.status,'qa_done');
      assert.deepEqual(item.test_case_ids,['case']);assert.match(item.display_id,/^Req_\d+$/);
      const trace=JSON.parse((await transactions.getTransactionArtifact(first.artifact_id)).content);
      assert.equal(trace.transaction_id,receipt.transaction_id);assert.equal(trace.created[0].display_id,item.display_id);
      const exported=await workspace.exportRequirements({projectId:'project',requirementIds:[item.id],userId:'author'});
      assert.equal(exported.requirement_records[0].release_id,'release');assert.deepEqual(exported.requirement_records[0].acceptance_criteria,criteria);
    });
    await t.test('retry and ordinary same-title imports preserve later human edits',async()=>{
      const id=first.created[0].id;
      await stories.updateRequirement(id,{description:'Author changed this after import',updated_by:'author'});
      const before=await read(id);
      const replay=await stories.bulkImportRequirements({project_id:'project',created_by:'author',rows:[row],transaction_id:receipt.transaction_id});
      assert.equal(replay.created[0].id,id);assert.deepEqual(await read(id),before);
      const duplicate=await stories.bulkImportRequirements({project_id:'project',created_by:'author',rows:[{...row,description:'Must not overwrite'}]});
      assert.equal(duplicate.skipped,1);assert.equal(duplicate.updated,0);assert.deepEqual(await read(id),before);
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM requirements').get()).count,1);
    });
    await t.test('explicit current-revision updates change only supplied fields and stale revisions fail',async()=>{
      const before=await read(first.created[0].id);
      const patch={story_id:before.display_id,expected_revision:before.revision,title:before.title,acceptance_criteria:['Revised explicit criterion'],additional_fields:{risk:3},external_references:[]};
      const result=await stories.bulkImportRequirements({project_id:'project',created_by:'author',rows:[patch]});
      assert.equal(result.updated,1,JSON.stringify(result.errors));
      const after=await read(before.id);
      assert.equal(after.description,before.description);assert.equal(after.additional_fields.component,'Payments');assert.equal(after.additional_fields.risk,3);
      assert.deepEqual(after.acceptance_criteria,patch.acceptance_criteria);assert.equal(after.revision,before.revision+1);
      assert.deepEqual(after.external_references,[]);
      const stale=await stories.bulkImportRequirements({project_id:'project',created_by:'author',rows:[{...patch,description:'Lost update'}]});
      assert.equal(stale.failed,1);assert.deepEqual(await read(before.id),after);
    });
    await t.test('cross-project links fail the row and roll back the created Story while healthy rows continue',async()=>{
      const result=await stories.bulkImportRequirements({project_id:'project',created_by:'author',rows:[{title:'Foreign link rollback',iteration_id:'sprint',release_id:'release',linked_test_cases:['foreign-case']},{title:'Invalid metadata',priority:8},{title:'Healthy row',acceptance_criteria:criteria}]});
      assert.equal(result.imported,1);assert.equal(result.failed,2);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM requirements WHERE title = 'Foreign link rollback'").get()).count,0);
      const trace=JSON.parse((await transactions.getTransactionArtifact(result.artifact_id)).content);
      assert.deepEqual(trace.errors.map(item=>item.row),[1,2]);assert.equal(trace.created[0].row,3);
    });
    await t.test('failed queue insertion leaves no receipt, events or notification, then retry succeeds',async()=>{
      await obsDb.query(`CREATE FUNCTION reject_story_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'reject_queue'='yes' THEN RAISE EXCEPTION 'transient queue failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_story_queue BEFORE INSERT ON batch_process_jobs FOR EACH ROW EXECUTE FUNCTION reject_story_queue();`);
      const count=async()=>({receipts:(await obsDb.prepare('SELECT COUNT(*)::int AS count FROM workspace_transactions').get()).count,events:(await obsDb.prepare('SELECT COUNT(*)::int AS count FROM workspace_transaction_events').get()).count,notifications:(await db.prepare('SELECT COUNT(*)::int AS count FROM notifications').get()).count});
      const before=await count();
      await assert.rejects(queue.queueBatchJob({project_id:'project',created_by:'author',operation:'requirement_import',title:'Failed import',payload:{reject_queue:'yes'}}),/transient queue failure/);
      assert.deepEqual(await count(),before);
      await obsDb.query('DROP TRIGGER reject_story_queue ON batch_process_jobs; DROP FUNCTION reject_story_queue()');
      const retry=await queue.queueRequirementImport({project_id:'project',created_by:'author',rows:[{title:'After rollback'}]});
      assert.equal((await transactions.getTransaction(retry.transaction_id)).status,'queued');
    });
    await t.test('near-limit custom fields cannot save an unreadable row after adding import metadata',async()=>{
      const result=await stories.bulkImportRequirements({project_id:'project',created_by:'author',rows:[{title:'Boundary row',additional_fields:{large:'x'.repeat(49920)}}]});
      assert.equal(result.failed,1);assert.match(result.errors[0].message,/50,000/);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM requirements WHERE title = 'Boundary row'").get()).count,0);
    });
    await t.test('two workers that read the same queued job execute its handler once',async()=>{
      await obsDb.prepare("UPDATE batch_process_jobs SET status = 'completed'").run();
      const target=await queue.queueRequirementImport({project_id:'project',created_by:'author',rows:[{title:'Concurrent claim'}]});
      let arrivals=0,release;const barrier=new Promise(resolve=>{release=resolve;});
      const originalPrepare=obsDb.prepare.bind(obsDb);
      const prepareMock=t.mock.method(obsDb,'prepare',sql=>{
        const statement=originalPrepare(sql);
        if(/SELECT \*\s+FROM batch_process_jobs\s+WHERE status = 'queued'/m.test(sql)) {
          const all=statement.all.bind(statement);
          statement.all=async(...args)=>{const rows=await all(...args);if(++arrivals===2)release();await barrier;return rows;};
        }
        return statement;
      });
      const modulePath=require.resolve('../../src/services/batchProcess.service');
      delete require.cache[modulePath];const workerA=require(modulePath);
      delete require.cache[modulePath];const workerB=require(modulePath);
      prepareMock.mock.restore();
      let calls=0;
      const handler=t.mock.method(stories,'bulkImportRequirements',async()=>{calls++;return{imported:1,updated:0,failed:0};});
      await Promise.all([workerA.processQueuedJobs(),workerB.processQueuedJobs()]);
      handler.mock.restore();
      assert.equal(arrivals,2);assert.equal(calls,1);
      const saved=await obsDb.prepare('SELECT status,attempts FROM batch_process_jobs WHERE transaction_id = ?').get(target.transaction_id);
      assert.equal(saved.status,'completed');assert.equal(saved.attempts,1);
    });
  } finally {await Promise.all([db.close(),obsDb.close()]);}
});
