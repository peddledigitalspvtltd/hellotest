const test=require('node:test');
const assert=require('node:assert/strict');

test('publication history polling is read-only when unchanged and late receipts preserve concurrent cancellation and progress',{
  skip:process.env.WORKFLOW_PUBLICATION_POSTGRES!=='1',timeout:120000
},async t=>{
  const target=new URL(process.env.DATABASE_URL);
  assert.match(target.pathname,/^\/agent_verify_workflow_publication_\d+$/);
  assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
  const {Client}=require('node:module').createRequire(require.resolve('@hellotest/platform/backend/src/db'))('pg');
  const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
  const independent=new Client({connectionString:process.env.DATABASE_URL});
  try{
    assert.equal((await db.prepare("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'").get()).count,0);
    await db.query(`CREATE TABLE agentic_workflow_runs(id text PRIMARY KEY,project_id text,status text,
      workflow_snapshot jsonb,input_payload jsonb DEFAULT '{}',node_results jsonb,output_payload jsonb,
      updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,completed_at timestamptz);
      CREATE TABLE workflow_draft_acceptances(run_id text,node_id text,story_id text,case_index integer,kind text,project_id text,receipt jsonb);
      CREATE TABLE fixture_publication_writes(run_id text PRIMARY KEY,writes integer DEFAULT 0);
      CREATE FUNCTION fixture_track_run_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO fixture_publication_writes(run_id,writes) VALUES(NEW.id,1)
          ON CONFLICT(run_id) DO UPDATE SET writes=fixture_publication_writes.writes+1; RETURN NEW; END $$;
      CREATE TRIGGER fixture_track_run_update AFTER UPDATE ON agentic_workflow_runs FOR EACH ROW EXECUTE FUNCTION fixture_track_run_update()`);
    const runtime=require('../../backend/services/agenticWorkflowExecution.service'),store=runtime._internals.store;
    const snapshot={execution_mode:'review',settings:{template_id:'sprint-automator',library_publication_mode:'automatic'}};
    const saved=id=>({id:`manual-${id}`,kind:'manual',saved:true,story_id:'story'});
    const metadata=receipt=>({mode:'automatic',status:'partial',receipts:[receipt],manual_cases_saved:1,automation_cases_saved:0,requires_review:true,approved:false});
    const insertReceipt=async(id,project='project',suffix='')=>db.prepare('INSERT INTO workflow_draft_acceptances VALUES(?,?,?,?,?,?,?)')
      .run(id,'generate',`story${suffix}`,0,'manual',project,{...saved(id),id:`manual-${id}${suffix}`});
    const insertRun=async(id,status='failed',published=true)=>{
      await db.prepare(`INSERT INTO agentic_workflow_runs(id,project_id,status,workflow_snapshot,node_results,output_payload,updated_at,completed_at)
        VALUES(?,'project',?,?,?,?,?::timestamptz,?::timestamptz)`).run(id,status,snapshot,
        [{node_id:'generate',status:'completed',output:published?{library_publication:metadata(saved(id))}:{}},
          {node_id:'automation',status:status==='running'?'running':'failed',progress:{percent:6},output:{marker:'preserve current output'},completed_at:null}],
        published?{project_changes_applied:true,summary:'Saved 1 manual Test Case pending review. The automation failed.'}:{summary:'Cancelled by user.'},
        '2026-11-01T00:00:00Z',status==='running'?null:'2026-11-01T00:00:01Z');
    };
    for(let index=0;index<12;index++){await insertRun(`history-${index}`);await insertReceipt(`history-${index}`);}
    let batchReads=0,updateStatements=0;
    const prepare=db.prepare.bind(db);
    t.mock.method(db,'prepare',sql=>{
      if(sql.includes('jsonb_to_recordset'))batchReads++;
      if(/^UPDATE agentic_workflow_runs/.test(sql))updateStatements++;
      return prepare(sql);
    });
    const history=await Promise.all(Array.from({length:12},(_,index)=>store.get(`history-${index}`)));
    await runtime.reconcileMany(history);await runtime.reconcileMany(history);
    assert.equal(batchReads,4);assert.equal(updateStatements,0);
    assert.equal((await db.prepare('SELECT count(*)::int AS count FROM fixture_publication_writes').get()).count,0,'Repeated history polling must not fire a row update.');
    assert.equal((await store.get('history-0')).updated_at.toISOString(),'2026-11-01T00:00:00.000Z');

    // A later request must observe a new durable receipt rather than retaining
    // the previous request's empty receipt inventory or actor state.
    await insertRun('late','cancelled',false);
    assert.equal((await runtime.reconcileMany([await store.get('late')]))[0].output_payload.project_changes_applied,undefined);
    await insertReceipt('late');await insertReceipt('late','another-project','-foreign');
    const recovered=(await runtime.reconcileMany([await store.get('late')]))[0];
    assert.equal(recovered.status,'cancelled');
    assert.deepEqual(recovered.node_results[0].output.library_publication.receipts,[saved('late')]);
    assert.equal(recovered.output_payload.summary,'Saved 1 manual Test Case pending review. Cancelled by user.');
    const afterRecovery=await store.get('late'),writeCount=(await db.prepare('SELECT writes FROM fixture_publication_writes WHERE run_id=?').get('late')).writes;
    await runtime.reconcileMany([afterRecovery]);
    assert.equal((await db.prepare('SELECT writes FROM fixture_publication_writes WHERE run_id=?').get('late')).writes,writeCount);

    // Exercise the actual PostgreSQL row-lock recheck. Recovery starts with a
    // stale running snapshot while another connection commits cancellation and
    // newer section progress; the metadata merge must preserve both.
    await insertRun('racing','running',false);await insertReceipt('racing');
    const stale=await store.get('racing');
    await independent.connect();await independent.query('BEGIN');
    await independent.query(`UPDATE agentic_workflow_runs SET status='cancelled',completed_at='2026-11-02T00:00:00Z',
      node_results=jsonb_set(node_results,'{1,progress,percent}','72'::jsonb) WHERE id='racing'`);
    let entered;const updating=new Promise(resolve=>{entered=resolve;});
    t.mock.method(db,'prepare',sql=>{
      const statement=prepare(sql);
      if(!sql.startsWith('UPDATE agentic_workflow_runs SET\n      node_results='))return statement;
      return {...statement,get:async(...args)=>{entered();return statement.get(...args);}};
    });
    const merging=store.mergePublication('racing',null,null,{run:stale});
    await updating;await independent.query('COMMIT');
    const raced=await merging;
    assert.equal(raced.status,'cancelled');assert.equal(raced.node_results[1].progress.percent,72);
    assert.deepEqual(raced.node_results[1].output,{marker:'preserve current output'});
    assert.equal(raced.completed_at.toISOString(),'2026-11-02T00:00:00.000Z');
    assert.equal(raced.node_results[0].output.library_publication.status,'partial');
    assert.equal(raced.node_results[0].output.library_publication.receipts[0].id,saved('racing').id);

    // The active publisher still uses explicit node/status recovery. A second
    // identical call reaches the SQL guard and must not rewrite the row.
    const beforeExplicit=await store.get('racing');
    await store.mergePublication('racing','generate','partial');
    const afterExplicit=await store.get('racing');
    assert.equal(afterExplicit.updated_at.getTime(),beforeExplicit.updated_at.getTime());
  }finally{
    await independent.end().catch(()=>{});
    await Promise.all([db.close(),obs.close()]);
  }
});
