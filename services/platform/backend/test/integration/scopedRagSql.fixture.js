const assert = require('node:assert/strict');

// The live sample query compiled hundreds of JIT functions before returning no
// rows. Exercise the real reader and query plans, without a model or network.
exports.verify = async ({ db }) => {
  const rag = require('@hellotest/knowledge/backend/services/knowledgeRag.service');
  const scopedRead = require('../../../../knowledge/backend/services/knowledgeScopedRead.service');
  const rollback = Symbol('scoped-rag-sql-fixture');
  const settings = async () => (await db.query(`SELECT current_setting('jit') AS jit,
    current_setting('jit_above_cost') AS jit_above_cost,
    current_setting('statement_timeout') AS statement_timeout,
    current_setting('lock_timeout') AS lock_timeout`)).rows[0];
  const outside = await settings();
  const observed = [];
  const originalPrepare = db.prepare;
  try {
    await db.transaction(async () => {
      await db.query("SET LOCAL jit = on");
      await db.query("SET LOCAL jit_above_cost = 0");
      await db.query("SET LOCAL statement_timeout = '11s'");
      await db.query("SET LOCAL lock_timeout = '9s'");
      const inherited = await settings();
      await db.query(`INSERT INTO requirement_iterations(id,project_id,name)
        VALUES ('rag-sql-sprint','mcp-p-a','Scoped SQL Sprint'),
               ('rag-sql-other-sprint','mcp-p-a','Other SQL Sprint'),
               ('rag-sql-foreign-sprint','mcp-p-b','Foreign SQL Sprint')`);
      await db.query(`INSERT INTO requirements(id,project_id,title,iteration_id)
        VALUES ('rag-sql-story','mcp-p-a','Scoped refund authorization','rag-sql-sprint'),
               ('rag-sql-other-story','mcp-p-a','Unrelated refund authorization','rag-sql-other-sprint'),
               ('rag-sql-foreign-story','mcp-p-b','Foreign refund authorization','rag-sql-foreign-sprint')`);
      await db.query("UPDATE test_cases SET requirement_id='rag-sql-story' WHERE id='mcp-case-a'");
      for (const [suffix, story] of [['selected', 'rag-sql-story'], ['unrelated', 'rag-sql-other-story']]) {
        await db.prepare(`INSERT INTO ai_knowledge_sources
          (id,project_id,source_kind,source_ref_id,title,extraction_status,required_permission,revision_token)
          VALUES (?,'mcp-p-a','requirement',?,'Refund authorization','ready',NULL,'sql-fixture')`)
          .run(`rag-sql-source-${suffix}`, story);
        await db.prepare(`INSERT INTO ai_knowledge_documents
          (id,project_id,source_id,title,content,checksum_sha256)
          VALUES (?,'mcp-p-a',?,'Refund authorization','Refund authorization contract','sql-fixture')`)
          .run(`rag-sql-doc-${suffix}`, `rag-sql-source-${suffix}`);
        await db.prepare(`INSERT INTO ai_knowledge_chunks
          (id,project_id,document_id,source_id,chunk_index,content,search_vector)
          VALUES (?,'mcp-p-a',?,?,0,'Refund authorization contract',to_tsvector('simple','Refund authorization contract'))`)
          .run(`rag-sql-chunk-${suffix}`, `rag-sql-doc-${suffix}`, `rag-sql-source-${suffix}`);
        await db.prepare(`INSERT INTO ai_knowledge_index_states
          (document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready)
          VALUES (?,'mcp-p-a',?,1,TRUE,'ready','not_configured',TRUE)`)
          .run(`rag-sql-doc-${suffix}`, `rag-sql-source-${suffix}`);
        await db.prepare(`INSERT INTO ai_knowledge_security_bindings
          (id,project_id,source_id,principal_type,principal_id,effect,inherited)
          VALUES (?,'mcp-p-a',?,'PROJECT','mcp-p-a','ALLOW',TRUE)`)
          .run(`rag-sql-acl-${suffix}`, `rag-sql-source-${suffix}`);
      }
      // Observe actual server settings and EXPLAIN the actual native SQL on its
      // current transaction. Results still come from the original real query.
      db.prepare = sql => {
        const statement = originalPrepare(sql);
        if (!sql.includes('scope_source_record')) return statement;
        return { ...statement, all: async (...params) => {
          const current = await settings();
          const plan = await originalPrepare(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`).all(...params);
          observed.push({ settings: current, plan: plan[0]['QUERY PLAN'][0] });
          return statement.all(...params);
        } };
      };
      const search = evidence_scope => rag.search({ projectId: 'mcp-p-a', user: { id: 'mcp-a' },
        query: 'refund authorization', mode: 'keyword', allowedSourcePermissions: [], timeoutMs: 6000,
        filters: { app_type_id: 'mcp-app-a', evidence_scope } });
      const selected = await search({ story_id: 'rag-sql-story', sprint_id: 'rag-sql-sprint' });
      assert.deepEqual(selected.results.map(item => item.source_id), ['rag-sql-source-selected'],
        'Scoped native SQL preserves authorized Story and Sprint evidence');
      assert.deepEqual(await settings(), inherited, 'Successful scoped SQL restores caller transaction settings');
      assert.deepEqual((await search({ story_id: 'rag-sql-story', sprint_id: 'rag-sql-other-sprint' })).results, [],
        'A conflicting Sprint cannot be widened by the performance boundary');
      assert.deepEqual((await search({ story_id: 'rag-sql-foreign-story', sprint_id: 'rag-sql-foreign-sprint' })).results, [],
        'A genuine foreign-project Story and Sprint remain excluded');
      assert.ok(observed.length >= 3, 'The actual scoped lexical SQL was exercised');
      for (const item of observed) {
        assert.equal(item.settings.jit, 'off', 'Complex scoped evidence SQL must not compile JIT functions');
        assert.equal(item.plan.JIT, undefined, 'EXPLAIN ANALYZE confirms compilation was avoided even above a zero JIT threshold');
      }
      assert.deepEqual(await settings(), inherited, 'Repeated scoped reads preserve surrounding write transaction settings');
      const local = await scopedRead.all(`SELECT current_setting('jit') AS jit,
        current_setting('statement_timeout') AS statement_timeout`, [], { timeoutMs: 1000 });
      assert.equal(local[0].jit, 'off');
      const timeout = Number.parseFloat(local[0].statement_timeout) * (/ms$/.test(local[0].statement_timeout) ? 1 : 1000);
      assert.ok(timeout > 0 && timeout <= 1000, 'The server deadline stays within the remaining SQL budget');
      assert.deepEqual(await settings(), inherited, 'Successful SQL-only calls restore settings inside an existing write transaction');
      const concurrent = await Promise.all([1, 2].map(value => scopedRead.all(
        "SELECT ?::integer AS value, current_setting('jit') AS jit, pg_sleep(0.005)", [value], { timeoutMs: 1000 })));
      assert.deepEqual(concurrent.map(rows => [rows[0].value, rows[0].jit]), [[1, 'off'], [2, 'off']],
        'Parallel scoped channels do not invalidate one another\'s nested savepoints');
      assert.deepEqual(await settings(), inherited, 'Concurrent scoped channels restore the caller settings');
      await assert.rejects(scopedRead.all('SELECT 1 / 0 AS unavailable', [], { timeoutMs: 1000 }), { code: '22012' });
      assert.deepEqual(await settings(), inherited, 'Failed SQL rolls back its savepoint and restores surrounding transaction settings');
      await assert.rejects(scopedRead.all('SELECT pg_sleep(0.2)', [], { timeoutMs: 25 }), { code: '57014' });
      assert.deepEqual(await settings(), inherited, 'A server-side deadline also restores settings and leaves the caller transaction usable');
      throw rollback;
    })();
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    db.prepare = originalPrepare;
  }
  assert.deepEqual(await settings(), outside, 'Transaction-local JIT and timeout settings never leak back into the pool');
};
