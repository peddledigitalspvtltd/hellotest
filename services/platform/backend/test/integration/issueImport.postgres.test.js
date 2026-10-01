const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
test('bug imports persist all fields, use stable retry receipts and preserve history in PostgreSQL',{skip:process.env.BUG_IMPORT_POSTGRES!=='1',timeout:120000},async t=>{
  assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_bug_import_[a-z0-9_]+$/);
  const db=require('../../src/db'),obsDb=require('../../src/obsDb');
  const imports=require('../../../../testing/backend/services/issueImport.service'),queue=require('../../../../testing/backend/services/batchProcess.service'),issues=require('../../../../testing/backend/services/issues.service'),transactions=require('../../services/workspaceTransaction.service');
  t.mock.method(queue,'triggerProcessing',()=>{});
  try{
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../instance-setup-data/schema-setup/schema.sql'),'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash,name) VALUES ('author','author@example.test','no-login','Author'),('reporter','reporter@example.test','no-login','Reporter');
      INSERT INTO projects(id,name) VALUES ('project','Bug imports');
      INSERT INTO roles(id,name) VALUES ('import-role','Import fixture');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('membership','project','reporter','import-role');`);
    const rows=[{title:'Cannot check out',message:'Payment fails\nNo order created',user_id:'reporter@example.test',assignee_id:'Reporter',severity:'high',priority:'High',steps_to_reproduce:'Open checkout\nSubmit payment',expected_result:'Confirmed order',actual_result:'Error shown',environment:'Staging',build:'1.2',sprint:'Sprint 1',release:'Release 1',fix_version:'1.2',regression:false,labels:['checkout','a,b']},{title:'Second issue',message:'Something else fails'}];
    const validated=await imports.validateRows({project_id:'project',created_by:'author',rows});assert.deepEqual(validated.errors,[]);
    const input={project_id:'project',created_by:'author',rows:validated.rows,import_id:'postgres-import-request-123'};
    const [receipt,retry]=await Promise.all([queue.queueIssueImport(input),queue.queueIssueImport(input)]);
    assert.equal(receipt.transaction_id,retry.transaction_id);
    await assert.rejects(queue.queueIssueImport({...input,rows:[{...input.rows[0],title:'Different upload'}]}),{statusCode:409});
    assert.equal((await obsDb.prepare('SELECT COUNT(*)::int AS n FROM batch_process_jobs').get()).n,1);
    const result=await imports.run({...input,transaction_id:receipt.transaction_id});
    assert.equal(result.imported,2);
    const bug=await issues.getIssueItem(result.rows[0].id);
    for(const field of ['title','message','priority','severity','steps_to_reproduce','expected_result','actual_result','environment','build','sprint','release','fix_version','regression'])assert.deepEqual(bug[field],rows[0][field],field);
    assert.deepEqual(bug.labels,rows[0].labels);assert.equal(bug.user_id,'reporter');assert.equal(bug.assignee_id,'reporter');
    const history=await issues.getIssueHistory(bug.id);assert.equal(history[0].actor_id,'author');
    await issues.updateIssue(bug.id,{title:'Human edited after import'},{actorId:'author'});
    await imports.run({...input,transaction_id:receipt.transaction_id});
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM feedback').get()).n,2);
    assert.equal((await issues.getIssueItem(bug.id)).title,'Human edited after import');
    assert.equal((await transactions.getTransaction(receipt.transaction_id)).status,'completed');
    assert.equal(JSON.parse((await transactions.getTransactionArtifact(result.artifact_id)).content).rows.length,2);

    await t.test('locator previews stay read-only and reviewed changes survive a real database reload',async()=>{
      const repository=require('../../../../automation/backend/services/aiAutomationBuilder.service');
      await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web')").run();
      const field=await repository.createLearningCacheEntry({app_type_id:'app',project_id:'project',screen_name:'Login',object_name:'Email',locator:'#old',locator_kind:'css',confidence:0.6,metadata:{last_validated_status:'unique',last_validated_at:new Date().toISOString()}});
      const preview=await repository.improveLearningCacheEntry({id:field.id,user_id:'author'});
      assert.equal((await repository.getLearningCacheEntry(field.id)).locator,'#old');
      assert.equal(preview.suggestion.strategy,'css');
      const applied=await repository.applyLearningCacheImprovement({id:field.id,user_id:'author',confirmed:true,locator:'#reviewed',strategy:'css',expected_locator:'#old',request_id:preview.request_id});
      assert.equal(applied.entry.locator,'#reviewed');
      const saved=await repository.getLearningCacheEntry(field.id);
      assert.equal(saved.metadata.fallback_locators[0].locator,'#old');
      assert.equal(saved.metadata.locator_review_history[0].reviewed_by,'author');
      assert.equal(saved.metadata.last_validated_status,'not_validated');
      await assert.rejects(repository.applyLearningCacheImprovement({id:field.id,user_id:'author',confirmed:true,locator:'#stale',strategy:'css',expected_locator:'#old'}),{statusCode:409});
    });
  }finally{await Promise.all([db.close(),obsDb.close()]);}
});
