const { randomUUID } = require('node:crypto');

// Build concurrently on a dedicated connection before starting the deletion
// transaction. Foreign-key actions execute once per deleted parent; without a
// leading index the self reference turns bulk case deletion into quadratic work.
const PROJECT_DELETION_INDEXES = [
  ['test_cases', 'manual_test_case_id'], ['test_cases', 'requirement_id'], ['test_cases', 'suite_id'],
  ['test_suites', 'app_type_id'], ['test_suites', 'parent_id'],
  ['automation_learning_cache', 'test_case_id'], ['test_engine_jobs', 'test_case_id'],
  ['test_engine_jobs', 'project_id'], ['test_engine_jobs', 'app_type_id'],
  ['workspace_transactions', 'app_type_id'], ['executions', 'app_type_id'],
  ['notifications', 'project_id'], ['notifications', 'run_id'], ['step_runs', 'run_id'],
  ['test_case_module_requirements', 'requirement_id'],
  ['test_configurations', 'app_type_id'], ['test_data_sets', 'app_type_id'], ['test_environments', 'app_type_id'],
  ['ai_knowledge_repo', 'app_type_id'], ['ai_knowledge_sources', 'app_type_id'],
  ['ai_knowledge_assistant_sessions', 'app_type_id'], ['ai_knowledge_collections', 'app_type_id'],
  ['repository_agent_runs', 'app_type_id'], ['ai_knowledge_assistant_messages', 'project_id'],
  ['entity_comments', 'project_id'], ['automation_generator_jobs', 'project_id']
].map(([table, column]) => Object.freeze({
  name: `idx_delete_${table}_${column}`,
  table,
  columns: [column],
  sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_delete_${table}_${column}" ON "${table}" ("${column}")`
}));

const deletionError = (message, code, statusCode) => Object.assign(new Error(message), { code, statusCode });

// SQL-only repository: the caller owns BEGIN/COMMIT/ROLLBACK and durable object
// cleanup. No database rows or external files are committed independently here.
const deleteProjectData = async ({ client, projectId, onProgress, batchSize = 1000 }) => {
  if (!client || typeof client.query !== 'function') throw new TypeError('A PostgreSQL transaction client is required');
  if (typeof projectId !== 'string' || !projectId.trim()) throw deletionError('Project id is required', 'INVALID_PROJECT_ID', 400);
  const size = Number.isSafeInteger(batchSize) && batchSize > 0 ? Math.min(batchSize, 10000) : 1000;
  const project = await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
  if (!project.rows.length) throw deletionError('Project not found', 'PROJECT_NOT_FOUND', 404);

  const suffix = randomUUID().replaceAll('-', '');
  const identities = Object.fromEntries(['apps', 'suites', 'stories', 'cases', 'runs', 'transactions'].map(kind => [kind, `project_delete_${kind}_${suffix}`]));
  const inSet = (column, kind) => `${column} IN (SELECT id FROM ${identities[kind]})`;
  const counts = {};
  let totalRows = 0, batches = 0;
  const notify = async (phase, table, rows = 0) => {
    if (onProgress) await onProgress({ phase, table, rows, totalRows, batches });
  };
  const snapshot = async (kind, select) => {
    const table = identities[kind];
    await client.query(`CREATE TEMP TABLE ${table} (id text PRIMARY KEY) ON COMMIT DROP`);
    await client.query(`INSERT INTO ${table} (id) ${select}`, [projectId]);
    await client.query(`ANALYZE ${table}`);
  };
  await notify('scoping', 'projects');
  await snapshot('apps', 'SELECT id FROM app_types WHERE project_id = $1');
  await snapshot('suites', `SELECT id FROM test_suites WHERE ${inSet('app_type_id', 'apps')} AND $1::text IS NOT NULL`);
  await snapshot('stories', 'SELECT id FROM requirements WHERE project_id = $1');
  await snapshot('runs', 'SELECT id FROM executions WHERE project_id = $1');
  await snapshot('transactions', 'SELECT id FROM workspace_transactions WHERE project_id = $1');
  await snapshot('cases', `
    SELECT id FROM test_cases WHERE ${inSet('app_type_id', 'apps')}
    UNION
    SELECT id FROM (
      SELECT tc.id, r.project_id FROM test_cases tc JOIN requirements r ON r.id = tc.requirement_id WHERE tc.app_type_id IS NULL
      UNION ALL
      SELECT tc.id, r.project_id FROM test_cases tc JOIN requirement_test_cases link ON link.test_case_id = tc.id
        JOIN requirements r ON r.id = link.requirement_id WHERE tc.app_type_id IS NULL
      UNION ALL
      SELECT tc.id, a.project_id FROM test_cases tc JOIN test_suites suite ON suite.id = tc.suite_id
        JOIN app_types a ON a.id = suite.app_type_id WHERE tc.app_type_id IS NULL
      UNION ALL
      SELECT tc.id, a.project_id FROM test_cases tc JOIN suite_test_cases link ON link.test_case_id = tc.id
        JOIN test_suites suite ON suite.id = link.suite_id JOIN app_types a ON a.id = suite.app_type_id WHERE tc.app_type_id IS NULL
    ) legacy_scopes GROUP BY id HAVING BOOL_AND(project_id = $1)
  `);

  // A corrupt foreign project's mandatory application reference must not cause
  // us to erase its records through a cascade or broad app-based DELETE.
  const guardedTables = ['executions', 'workspace_transactions', 'ai_knowledge_repo', 'test_environments',
    'test_configurations', 'test_data_sets', 'automation_learning_cache', 'test_engine_jobs'];
  for (const table of guardedTables) {
    const conflict = await client.query(`SELECT 1 FROM ${table} WHERE project_id <> $1 AND ${inSet('app_type_id', 'apps')} LIMIT 1`, [projectId]);
    if (conflict.rows.length) throw deletionError('Another project contains records referencing this project. Repair the conflicting relationship before deleting.', 'PROJECT_DELETION_SCOPE_CONFLICT', 409);
  }
  const foreignResults = await client.query(`
    SELECT 1 FROM execution_results result JOIN executions run ON run.id = result.execution_id
    WHERE run.project_id <> $1 AND ${inSet('result.app_type_id', 'apps')} LIMIT 1
  `, [projectId]);
  if (foreignResults.rows.length) throw deletionError('Another project has execution results referencing this application.', 'PROJECT_DELETION_SCOPE_CONFLICT', 409);
  const foreignJobs = await client.query(`SELECT 1 FROM test_engine_jobs WHERE project_id <> $1
    AND (${inSet('test_case_id', 'cases')} OR ${inSet('execution_id', 'runs')}) LIMIT 1`, [projectId]);
  if (foreignJobs.rows.length) throw deletionError('Another project has engine work referencing this project.', 'PROJECT_DELETION_SCOPE_CONFLICT', 409);
  const foreignNotifications = await client.query(`SELECT 1 FROM notifications WHERE project_id <> $1
    AND ${inSet('run_id', 'runs')} LIMIT 1`, [projectId]);
  if (foreignNotifications.rows.length) throw deletionError('Another project has notifications referencing this project.', 'PROJECT_DELETION_SCOPE_CONFLICT', 409);

  // Bounded statements keep cancellation/progress responsive without sacrificing
  // the all-or-nothing transaction. CTIDs support tables with composite keys too.
  const mutate = async (table, where, set = null) => {
    await notify(set ? 'detaching' : 'deleting', table);
    let affected;
    do {
      const result = await client.query(`
        WITH batch AS MATERIALIZED (
          SELECT target.ctid FROM ${table} target
          WHERE $1::text IS NOT NULL AND (${where}) LIMIT $2
        )
        ${set ? `UPDATE ${table} target SET ${set}` : `DELETE FROM ${table} target`}
        ${set ? 'FROM' : 'USING'} batch WHERE target.ctid = batch.ctid
      `, [projectId, size]);
      affected = Number(result.rowCount || 0);
      if (affected) {
        const key = `${set ? 'updated' : 'deleted'}.${table}`;
        counts[key] = (counts[key] || 0) + affected;
        totalRows += affected;
        batches++;
        await notify(set ? 'detaching' : 'deleting', table, affected);
      }
    } while (affected === size);
  };
  const owned = table => mutate(table, 'target.project_id = $1');
  const caseScope = inSet('target.test_case_id', 'cases');
  const runScope = inSet('target.execution_id', 'runs');
  const storyScope = inSet('target.requirement_id', 'stories');
  const appScope = inSet('target.app_type_id', 'apps');
  const issueScope = 'target.issue_id IN (SELECT id FROM feedback WHERE project_id = $1)';
  const moduleScope = `target.module_id IN (SELECT id FROM test_case_modules WHERE ${inSet('app_type_id', 'apps')})`;

  await mutate('automation_generator_jobs', `target.project_id = $1 OR (target.project_id IS NULL AND (${appScope} OR ${caseScope} OR ${inSet('target.transaction_id', 'transactions')}))`);
  await owned('ai_test_case_generation_jobs');
  await owned('ai_requirement_generation_jobs');
  await owned('agentic_workflow_runs');
  await owned('agentic_workflows');
  await owned('execution_schedules');
  await owned('test_engine_jobs');
  for (const table of ['workspace_transaction_events', 'workspace_transaction_artifacts', 'batch_process_jobs']) {
    await mutate(table, inSet('target.transaction_id', 'transactions'));
  }
  await owned('workspace_transactions');

  await mutate('execution_results', runScope);
  for (const table of ['execution_step_snapshots', 'execution_case_snapshots', 'execution_suites']) await mutate(table, runScope);
  for (const table of ['step_runs', 'test_case_runs', 'suite_runs']) await mutate(table, inSet('target.run_id', 'runs'));
  await mutate('notifications', `target.project_id = $1 OR (target.project_id IS NULL AND ${inSet('target.run_id', 'runs')})`);
  await owned('executions');

  await mutate('test_steps', caseScope);
  await mutate('automation_case_links', `${inSet('target.automation_test_case_id', 'cases')} OR ${inSet('target.manual_test_case_id', 'cases')}`);
  await mutate('test_case_versions', caseScope);
  await mutate('test_case_data_sets', `${caseScope} OR target.test_data_set_id IN (SELECT id FROM test_data_sets WHERE project_id = $1)`);
  await mutate('test_case_data_set_link_archive', `${caseScope} OR target.test_data_set_id IN (SELECT id FROM test_data_sets WHERE project_id = $1)`);
  await mutate('test_case_defects', `${caseScope} OR ${issueScope}`);
  await mutate('requirement_defects', `${storyScope} OR ${issueScope}`);
  await mutate('issue_history', issueScope);
  await mutate('suite_test_cases', `${caseScope} OR ${inSet('target.suite_id', 'suites')}`);
  await mutate('requirement_test_cases', `${caseScope} OR ${storyScope}`);
  await mutate('test_case_module_cases', `${caseScope} OR ${moduleScope}`);
  await mutate('test_case_module_requirements', `${storyScope} OR ${moduleScope}`);
  await mutate('test_cases', inSet('target.manual_test_case_id', 'cases'), 'manual_test_case_id = NULL');
  await owned('automation_learning_cache');
  await mutate('automation_learning_cache', caseScope, 'test_case_id = NULL');
  await mutate('test_cases', inSet('target.id', 'cases'));
  await mutate('test_cases', inSet('target.suite_id', 'suites'), 'suite_id = NULL');
  await mutate('test_cases', inSet('target.requirement_id', 'stories'), 'requirement_id = NULL');
  await mutate('test_suites', inSet('target.parent_id', 'suites'), 'parent_id = NULL');
  await mutate('test_suites', inSet('target.id', 'suites'));
  await mutate('test_case_modules', appScope);
  await mutate('requirement_release_items', `${storyScope} OR target.release_id IN (SELECT id FROM requirement_releases WHERE project_id = $1)`);
  await mutate('requirement_relations', `${storyScope} OR ${inSet('target.related_requirement_id', 'stories')}`);
  await owned('requirement_backlog_events');
  await owned('requirement_backlog_current_state');
  await owned('requirements');
  await owned('requirement_releases');
  await owned('requirement_iterations');
  await owned('feedback');
  await mutate('shared_step_groups', appScope);
  await owned('test_environments');
  await owned('test_configurations');
  await owned('test_data_sets');

  for (const table of ['ai_knowledge_ingestion_inputs', 'ai_knowledge_ingestion_results']) {
    await mutate(table, 'target.job_id IN (SELECT id FROM ai_knowledge_ingestion_jobs WHERE project_id = $1)');
  }
  await mutate('ai_knowledge_collection_sources', `target.collection_id IN (SELECT id FROM ai_knowledge_collections WHERE project_id = $1)
    OR target.source_id IN (SELECT id FROM ai_knowledge_sources WHERE project_id = $1)`);
  for (const table of ['ai_knowledge_security_bindings', 'ai_knowledge_relations', 'ai_knowledge_index_states', 'ai_knowledge_chunks',
    'ai_knowledge_documents', 'ai_knowledge_ingestion_jobs', 'ai_knowledge_sources', 'ai_knowledge_collections',
    'ai_knowledge_sync_outbox', 'ai_knowledge_assistant_messages', 'ai_knowledge_assistant_sessions', 'ai_knowledge_repo',
    'ai_prompt_templates', 'repository_agent_runs', 'quality_dashboards', 'entity_comments', 'attachments', 'project_favorites']) await owned(table);

  await mutate('integrations', "target.config->>'project_id' = $1 OR target.project_key = $1", `
    config = CASE WHEN target.config->>'project_id' = $1 THEN target.config - 'project_id' ELSE target.config END,
    project_key = CASE WHEN target.project_key = $1 THEN NULL ELSE target.project_key END,
    updated_at = CURRENT_TIMESTAMP`);
  await owned('app_types');
  await owned('project_members');
  await mutate('projects', 'target.id = $1');
  // Release temporary relation storage now, including when called as a nested
  // transaction by tests/import tooling; ON COMMIT DROP remains the safety net.
  for (const table of Object.values(identities)) await client.query(`DROP TABLE ${table}`);
  await notify('data_deleted', 'projects');
  return { deleted: true, deleted_rows: totalRows, counts };
};

module.exports = { deleteProjectData, PROJECT_DELETION_INDEXES };
