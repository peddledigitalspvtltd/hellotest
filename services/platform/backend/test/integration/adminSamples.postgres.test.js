const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

async function verifyHelloTestFeatureSamples(db, actorId) {
  const blueprint = require('../../instance-setup-data/reference/hellotest-feature-blueprint.json');
  const featureIds = blueprint.features.map(feature => `sample-v3-feature-${feature.key}`);
  const stories = await db.prepare("SELECT * FROM requirements WHERE project_id='sample-project' AND id LIKE 'sample-v3-feature-%' ORDER BY id").all();
  const sprints = await db.prepare("SELECT * FROM requirement_iterations WHERE project_id='sample-project' AND id LIKE 'sample-v3-ht-sprint-%' ORDER BY id").all();
  const releases = await db.prepare("SELECT * FROM requirement_releases WHERE project_id='sample-project' AND id LIKE 'sample-v3-ht-release-%' ORDER BY id").all();
  const links = await db.prepare("SELECT * FROM requirement_release_items WHERE requirement_id LIKE 'sample-v3-feature-%'").all();
  const relations = await db.prepare("SELECT * FROM requirement_relations WHERE requirement_id LIKE 'sample-v3-feature-%'").all();
  assert.equal(stories.length, blueprint.features.length);
  assert.equal(sprints.length, 7);
  assert.equal(releases.length, 3);
  assert.equal(stories.filter(story => story.iteration_id === null && story.sprint === null).length, 10, 'Ten stories remain in the unscheduled backlog');
  assert.equal(links.length, stories.length, 'Every feature story has one explicit release scope link');
  assert.deepEqual(stories.map(story => story.id).sort(), featureIds.sort());
  for (const feature of blueprint.features) {
    const story = stories.find(row => row.id === `sample-v3-feature-${feature.key}`);
    const sprint = feature.sprint_key ? sprints.find(row => row.id === `sample-v3-ht-sprint-${feature.sprint_key}`) : null;
    const release = releases.find(row => row.id === `sample-v3-ht-release-${feature.release_key}`);
    assert.equal(story.title, feature.title);
    assert.ok(story.description.includes(feature.user_story), `${feature.key}: user story`);
    assert.ok(story.description.includes(feature.behavior), `${feature.key}: behavior`);
    assert.ok(story.description.includes(feature.boundary), `${feature.key}: failure/scope boundary`);
    for (const criterion of feature.acceptance_criteria) assert.ok(story.description.includes(criterion), `${feature.key}: acceptance criterion`);
    assert.deepEqual(story.labels, feature.labels);
    assert.ok(story.labels.includes('sample') && story.labels.includes('hellotest-core'));
    assert.equal(story.status, feature.status);
    assert.equal(story.priority, feature.priority);
    assert.equal(story.scrum_team, feature.scrum_team);
    assert.equal(story.created_by, actorId);
    assert.equal(story.updated_by, actorId);
    assert.equal(story.additional_fields.assignee_id, actorId);
    assert.equal(story.additional_fields.effort_story_points, feature.effort_story_points);
    assert.equal(story.additional_fields.sample_blueprint_version, blueprint.version);
    assert.equal(story.additional_fields.feature_key, feature.key);
    assert.equal(story.additional_fields.execution_evidence, false, 'Authored requirements are not fabricated execution results');
    assert.deepEqual(story.additional_fields.acceptance_criteria, feature.acceptance_criteria);
    assert.deepEqual(story.additional_fields.source_files, feature.source_files);
    assert.equal(story.specification_format, 'gherkin');
    assert.equal(story.gherkin_scenarios.length, feature.acceptance_criteria.length + 1);
    assert.ok(story.specification_content.startsWith(`Feature: ${feature.title}`));
    assert.equal(story.iteration_id, sprint?.id || null);
    assert.equal(story.sprint, sprint?.name || null);
    assert.equal(story.release, release.name);
    assert.equal(story.fix_version, release.fix_version);
    assert.deepEqual(links.filter(link => link.requirement_id === story.id).map(link => [link.release_id, link.source]), [[release.id, sprint ? 'sprint' : 'manual']]);
    if (sprint) {
      assert.ok(release.sprint_ids.includes(sprint.id), 'Story sprint belongs to the same release');
      assert.equal(new Date(story.qa_completion_target_date).getTime(), new Date(sprint.end_date).getTime());
      assert.ok(new Date(story.dev_completion_target_date) < new Date(story.qa_completion_target_date));
    } else {
      assert.equal(story.dev_completion_target_date, null);
      assert.equal(story.qa_completion_target_date, null);
    }
    assert.deepEqual(relations.filter(link => link.requirement_id === story.id).map(link => [link.related_requirement_id, link.relation]).sort(), feature.depends_on.map(key => [`sample-v3-feature-${key}`, 'depends on']).sort());
  }
  for (const sprint of sprints) {
    assert.equal(Number(sprint.effort_points), stories.filter(story => story.iteration_id === sprint.id).reduce((sum, story) => sum + story.additional_fields.effort_story_points, 0));
    assert.equal(sprint.assignee_id, actorId);
    assert.ok(sprint.goal.length > 30);
    assert.ok(new Date(sprint.start_date) < new Date(sprint.end_date));
  }
  const nativeReleases = await require('../../../../manual/backend/services/requirementRelease.service').listReleases({ project_id: 'sample-project' });
  for (const release of releases) {
    const native = nativeReleases.find(row => row.id === release.id);
    assert.deepEqual(native.requirement_ids.sort(), links.filter(link => link.release_id === release.id).map(link => link.requirement_id).sort(), 'Native release reader includes sprint and unscheduled manual scope');
  }
  const nativeStory = await require('../../../../manual/backend/services/requirement.service').getRequirement(stories[0].id, { includeLinkedRecords: false });
  assert.equal(nativeStory.additional_fields.assignee_id, actorId);
  assert.equal(nativeStory.additional_fields.effort_story_points, stories[0].additional_fields.effort_story_points);

  const document = await db.prepare("SELECT * FROM ai_knowledge_documents WHERE id='sample-v3-document-hellotest'").get();
  const chunks = await db.prepare("SELECT * FROM ai_knowledge_chunks WHERE source_id='sample-v3-source-hellotest' ORDER BY chunk_index").all();
  const indexState = await db.prepare("SELECT * FROM ai_knowledge_index_states WHERE document_id='sample-v3-document-hellotest'").get();
  assert.equal(chunks.length, 7);
  assert.equal(indexState.lexical_state, 'ready');
  assert.equal(indexState.dense_state, 'not_configured');
  assert.equal(indexState.indexed_chunk_count, 7);
  for (const [index, group] of blueprint.groups.entries()) {
    const chunk = chunks[index];
    assert.equal(chunk.id, `sample-v3-chunk-hellotest-${group.key}`);
    assert.equal(chunk.heading, group.name);
    assert.equal(chunk.content, document.content.slice(chunk.char_start, chunk.char_end), 'Chunk offsets identify exact authored document content');
    assert.ok(chunk.search_vector, 'Each feature area has a PostgreSQL lexical index');
    assert.equal(chunk.metadata.execution_evidence, false);
    const search = await require('../../../../knowledge/backend/services/knowledgeRag.service').search({ projectId: 'sample-project', query: group.name, mode: 'keyword', user: { id: actorId, role: 'admin', is_workspace_admin: true }, limit: 12, filters: { source_ids: ['sample-v3-source-hellotest'] } });
    assert.ok(search.results.some(result => result.chunk_id === chunk.id && result.lexical_score > 0 && result.citation.source_id === 'sample-v3-source-hellotest'), `${group.name}: native lexical search returns cited authored content`);
  }
  const transactionService = require('../../services/workspaceTransaction.service');
  const transaction = await transactionService.getTransaction('sample-v3-hellotest-blueprint');
  assert.equal(transaction.project_id, 'sample-project');
  assert.equal(transaction.created_by, actorId);
  assert.equal(transaction.metadata.sample, true);
  assert.equal(transaction.metadata.feature_count, blueprint.features.length);
  const artifactList = await transactionService.listTransactionArtifacts(transaction.id);
  assert.equal(artifactList.length, 2, 'Both reusable artifacts are available through the native activity download service');
  const jsonArtifact = await transactionService.getTransactionArtifact('sample-v3-artifact-hellotest-json');
  const markdownArtifact = await transactionService.getTransactionArtifact('sample-v3-artifact-hellotest-stories');
  assert.equal(jsonArtifact.mime_type, 'application/json');
  assert.equal(markdownArtifact.mime_type, 'text/markdown');
  assert.deepEqual(JSON.parse(jsonArtifact.content), blueprint);
  assert.deepEqual(JSON.parse(jsonArtifact.content), JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/reference/hellotest-feature-blueprint.json'), 'utf8')));
  assert.equal(markdownArtifact.content.trimEnd(), fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/reference/hellotest-feature-stories.md'), 'utf8').trimEnd());
  assert.equal(document.content, markdownArtifact.content, 'The download and knowledge reference share the same reviewed content');
  for (const feature of blueprint.features) assert.ok(markdownArtifact.content.includes(`#### ${feature.key}: ${feature.title}`));
  return { features: stories.length, feature_sprints: sprints.length, feature_releases: releases.length, feature_backlog: 10, lexical_chunks: chunks.length, blueprint_artifacts: artifactList.length };
}

async function verifyJoinedMetricSamples(db) {
  const prefix = 'sample-v4-metrics-';
  const quality = require('../../../../dashboard/backend/services/qualityAnalytics.service');
  const context = await quality.loadContext('sample-project', prefix + 'release', prefix + 'sprint');
  const metrics = quality.calculateMetrics(context);
  const records = Object.values(require('../../services/sampleData').buildRecords('sample-test-admin')).flat();
  const plannedStories = records.filter(record => record.table === 'requirements' && record.values.iteration_id === prefix + 'sprint').map(record => record.values);
  const plannedStoryIds = new Set(plannedStories.map(story => story.id));
  const plannedCaseIds = new Set(records.filter(record => record.table === 'requirement_test_cases' && plannedStoryIds.has(record.values.requirement_id)).map(record => record.values.test_case_id));
  const plannedRuns = records.filter(record => record.table === 'executions' && record.values.release_id === prefix + 'release').map(record => record.values);
  const plannedRunIds = new Set(plannedRuns.map(run => run.id));
  const plannedResults = records.filter(record => record.table === 'execution_results' && plannedRunIds.has(record.values.execution_id)).map(record => record.values);
  const plannedDefects = records.filter(record => record.table === 'feedback' && record.values.release === 'Metric walkthrough · synthetic' && !['closed','resolved','done'].includes(record.values.status));
  assert.equal(context.requirements.length, plannedStories.length, 'Native release/sprint selects every planned metric and data-inheritance Story');
  assert.equal(metrics.devStoryCompletion, plannedStories.filter(story => ['dev_done','qa_ready','qa_in_progress','qa_blocked','qa_done','done'].includes(story.status)).length / plannedStories.length * 100, 'Dev Done and later statuses satisfy development completion');
  assert.equal(metrics.qaStoryCompletion, plannedStories.filter(story => ['qa_done','done'].includes(story.status)).length / plannedStories.length * 100, 'Only QA Done and Done satisfy QA completion');
  assert.equal(metrics.requirementCoverage, 100);
  assert.equal(metrics.testCases, plannedCaseIds.size);
  assert.equal(metrics.testRuns, plannedRuns.length);
  assert.equal(metrics.openDefects, plannedDefects.length);
  assert.equal(metrics.moduleCaseCount, plannedCaseIds.size, 'Story-inherited module links are visible in joined dashboard queries');
  const latestResultsByCase = new Map();
  for (const result of [...plannedResults].sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))) {
    if (!latestResultsByCase.has(result.test_case_id)) latestResultsByCase.set(result.test_case_id, result);
  }
  assert.deepEqual(context.results.map(result => result.id).sort(), [...latestResultsByCase.values()].map(result => result.id).sort(), 'Case-level analytics reads the latest result for each case while stored run evidence retains every data iteration');
  assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM execution_results WHERE execution_id='sample-v5-data-run'").get()).count, 2, 'Both authored data iterations are retained');
  const run = await db.prepare('SELECT release_id,iteration_id FROM executions WHERE id = ?').get(prefix + 'run');
  assert.deepEqual(run, { release_id: prefix + 'release', iteration_id: prefix + 'sprint' });
  const backlog = await db.prepare("SELECT id FROM requirements WHERE id LIKE 'sample-v4-metrics-story-backlog-%' AND iteration_id IS NULL AND release IS NULL").all();
  assert.equal(backlog.length, 2);
  const coverage = await db.prepare("SELECT count(*)::integer AS covered FROM requirements story WHERE id LIKE 'sample-v4-metrics-story-backlog-%' AND EXISTS (SELECT 1 FROM requirement_test_cases link WHERE link.requirement_id = story.id)").get();
  assert.equal(coverage.covered, 1);
  const story = await db.prepare('SELECT * FROM requirements WHERE id = ?').get(prefix + 'story-qa-done');
  const [hydrated] = await require('../../../../manual/backend/services/requirementCatalog.service').withCatalogMetrics([story], { include_execution: true });
  assert.equal(hydrated.catalog_metrics.readiness.score, 100);
  assert.ok(hydrated.catalog_metrics.readiness.checks.filter(check => check.source === 'review').every(check => check.evidence.includes('SYNTHETIC SAMPLE')));
  for (const template of ['traceability', 'delivery', 'triage']) {
    const dashboard = await db.prepare('SELECT gadgets FROM quality_dashboards WHERE id = ?').get('sample-v2-dashboard-' + template);
    assert.equal(dashboard.gadgets.length, 8);
  }
  const displayTables = new Set(['projects','requirements','requirement_iterations','requirement_releases','test_cases','test_suites','test_case_modules','shared_step_groups','feedback']);
  for (const record of records.filter(record => displayTables.has(record.table))) assert.ok(record.values.display_id, `${record.table}:${record.values.id} passes its short ID explicitly`);
}

test('sample files commit resumable checkpoints and preserve connected metadata and edits across repeat installs', { skip: process.env.ADMIN_SAMPLES_POSTGRES !== '1', timeout: 120000 }, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname.slice(1), /^agent_verify_admin_samples_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  try {
    assert.equal((await db.prepare('SELECT current_database() AS name').get()).name, url.pathname.slice(1), 'Main connection must target this disposable database');
    assert.equal((await obsDb.prepare('SELECT current_database() AS name').get()).name, url.pathname.slice(1), 'Activity connection must target this disposable database');
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS table_name").get()).table_name, null, 'An empty disposable database is required');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.prepare("INSERT INTO roles(id,name) VALUES ('sample-test-role','admin') ON CONFLICT DO NOTHING").run();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES ('sample-test-admin','sample-validation@example.test','not-a-login','Sample validation',TRUE,'active')").run();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES ('sample-other-admin','other-admin@example.test','not-a-login','Other workspace administrator',TRUE,'active')").run();
    const adminRole = await db.prepare("SELECT id FROM roles WHERE LOWER(BTRIM(name))='admin' ORDER BY id LIMIT 1").get();
    await db.prepare(`INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status,default_role_id) VALUES
      ('sample-suspended-admin','suspended-admin@example.test','not-a-login','Suspended administrator',TRUE,'suspended',NULL),
      ('sample-default-admin','default-admin@example.test','not-a-login','Admin default role',FALSE,'active',?),
      ('sample-project-admin','project-admin@example.test','not-a-login','Project administrator',FALSE,'active',NULL),
      ('sample-ordinary-user','ordinary@example.test','not-a-login','Ordinary user',FALSE,'active',NULL)
    `).run(adminRole.id);
    const service = require('../../services/adminPortal.service');
    const input = { actorId: 'sample-test-admin', modules: undefined };
    // Setup must fill missing roles without replacing deliberate custom grants.
    const owner = await db.prepare("SELECT id FROM roles WHERE LOWER(name) = 'product owner'").get();
    assert.ok(owner?.id, 'Runtime setup creates the Product Owner preset');
    await db.prepare("UPDATE roles SET name = 'pRoDuCt OwNeR' WHERE id = ?").run(owner.id);
    await db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(owner.id);
    await db.prepare("DELETE FROM roles WHERE LOWER(name) = 'reporter'").run();
    for (const modules of [[], ['unknown'], 'workspace', [null], Array(65).fill('workspace')]) await assert.rejects(service.seedSampleData({ ...input, modules }), error => error.statusCode === 400);
    assert.equal((await service.getSampleCatalog()).project_id, null);
    await db.query("ALTER TABLE admin_audit_log ADD CONSTRAINT reject_sample_audit CHECK (action <> 'sample_data.seed')");
    let roleCheckpoint, workspaceCheckpoint;
    await assert.rejects(service.seedSampleData({ ...input, modules: ['workspace_roles'], onProgress: value => { roleCheckpoint = structuredClone(value); } }), error => { assert.equal(error.code, '23514', error.stack); return true; });
    const savedReporter = await db.prepare("SELECT * FROM roles WHERE LOWER(name) = 'reporter'").get();
    assert.ok(savedReporter, 'Committed role files survive a later audit failure');
    const savedReporterPermissions = await db.prepare('SELECT * FROM role_permissions WHERE role_id = ? ORDER BY permission_id').all(savedReporter.id);
    assert.ok(roleCheckpoint.files.every(file => file.status === 'completed'), 'Role file checkpoints are complete before final audit');
    await assert.rejects(service.seedSampleData({ ...input, modules: ['workspace'], onProgress: value => { workspaceCheckpoint = structuredClone(value); } }), error => { assert.equal(error.code, '23514', error.stack); return true; });
    assert.equal((await service.getSampleCatalog()).project_id, 'sample-project', 'Earlier committed object files remain available for safe resumption');
    assert.ok(workspaceCheckpoint.files.every(file => file.status === 'completed'));
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM admin_audit_log WHERE action='sample_data.seed'").get()).count, 0, 'Failed finalization never emits a successful setup audit');
    const checkpointProject = await db.prepare("SELECT * FROM projects WHERE id='sample-project'").get();
    const checkpointApplications = await db.prepare("SELECT * FROM app_types WHERE project_id='sample-project' ORDER BY id").all();
    const checkpointMemberships = await db.prepare("SELECT * FROM project_members WHERE project_id='sample-project' ORDER BY user_id").all();
    await db.query('ALTER TABLE admin_audit_log DROP CONSTRAINT reject_sample_audit');
    const resumedWorkspace = await service.seedSampleData({ ...input, modules: ['workspace'], checkpoints: workspaceCheckpoint.files, expectedManifestHash: workspaceCheckpoint.manifest_hash });
    assert.equal(resumedWorkspace.inserted_records, workspaceCheckpoint.files.reduce((count, file) => count + file.inserted_records, 0), 'Resuming the same installation retains its committed insertion counts');
    assert.equal(resumedWorkspace.administrator_memberships, 2, 'Resuming retains the membership count already committed by this installation');
    assert.deepEqual(await db.prepare("SELECT * FROM projects WHERE id='sample-project'").get(), checkpointProject);
    assert.deepEqual(await db.prepare("SELECT * FROM app_types WHERE project_id='sample-project' ORDER BY id").all(), checkpointApplications);
    assert.deepEqual(await db.prepare("SELECT * FROM project_members WHERE project_id='sample-project' ORDER BY user_id").all(), checkpointMemberships, 'Resumption retains existing member IDs, roles and timestamps');
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM admin_audit_log WHERE action='sample_data.seed'").get()).count, 1, 'Only verified, finalized setup emits a successful audit');
    // This database is disposable. Remove only its sample project so the remaining
    // role-only and first-install assertions still start with no content workspace.
    assert.equal((await require('../../services/project.service').deleteProject('sample-project')).deleted, true);
    const roleOnly = await service.seedSampleData({ ...input, modules: ['workspace_roles'], checkpoints: roleCheckpoint.files, expectedManifestHash: roleCheckpoint.manifest_hash });
    assert.deepEqual(await db.prepare('SELECT * FROM roles WHERE id = ?').get(savedReporter.id), savedReporter);
    assert.deepEqual(await db.prepare('SELECT * FROM role_permissions WHERE role_id = ? ORDER BY permission_id').all(savedReporter.id), savedReporterPermissions, 'Role checkpoint resumption preserves the exact saved grants');
    assert.equal(roleOnly.inserted_records, roleCheckpoint.files.reduce((count, file) => count + file.inserted_records, 0));
    assert.deepEqual(roleOnly.installed, ['workspace_roles']);
    assert.equal(roleOnly.project_id, null);
    assert.equal(roleOnly.administrator_memberships, 0);
    for (const table of ['projects', 'app_types', 'project_members']) {
      assert.equal((await db.prepare(`SELECT COUNT(*)::INT AS count FROM ${table}`).get()).count, 0, `Roles-only setup leaves ${table} empty`);
    }
    for (const actorId of ['sample-suspended-admin', 'sample-default-admin', 'sample-project-admin', 'sample-ordinary-user']) {
      await assert.rejects(service.seedSampleData({ ...input, actorId, modules: ['workspace'] }), error => error.statusCode === 403);
      assert.equal((await service.getSampleCatalog()).project_id, null, 'An ineligible actor cannot create a sample project or membership');
    }
    await db.prepare("INSERT INTO projects(id,display_id,name,created_by) VALUES ('unrelated-project','OTHER','Unrelated project','sample-test-admin')").run();
    await db.prepare("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('unrelated-project-admin','unrelated-project','sample-project-admin',?)").run(adminRole.id);
    await db.prepare("DELETE FROM roles WHERE LOWER(name) = 'reporter'").run();
    const subset = await service.seedSampleData({ ...input, modules: ['dashboards'] });
    assert.deepEqual(subset.roles, { created: [], retained: [] }, 'Content modules do not silently install roles');
    assert.equal(await db.prepare("SELECT id FROM roles WHERE LOWER(name) = 'reporter'").get(), undefined);
    assert.equal(subset.administrator_memberships, 2, 'Every active workspace administrator receives a missing membership');
    assert.deepEqual(await db.prepare("SELECT user_id,role_id FROM project_members WHERE project_id='sample-project' ORDER BY user_id").all(), [
      { user_id: 'sample-other-admin', role_id: adminRole.id }, { user_id: 'sample-test-admin', role_id: adminRole.id }
    ], 'Suspended accounts, Admin default roles, project-only administrators and ordinary users are not enrolled');
    const canonicalProject = require('../../services/sampleData').buildRecords(input.actorId).workspace.find(record => record.table === 'projects').values;
    assert.equal((await db.prepare("SELECT description FROM projects WHERE id='sample-project'").get()).description, canonicalProject.description, 'The canonical description is installed before membership setup');
    const projectsBeforeRoles = (await db.prepare('SELECT COUNT(*)::INT AS count FROM projects').get()).count;
    const access = await service.seedSampleData({ ...input, modules: ['workspace_roles'] });
    assert.deepEqual(access.installed, ['workspace_roles']);
    assert.equal(access.project_id, null);
    assert.equal(access.administrator_memberships, 0);
    assert.deepEqual(access.roles.created.map(role => role.name), ['Reporter']);
    assert.ok(access.roles.retained.some(role => role.id === owner.id));
    assert.equal(access.inserted_records, 1, 'Role-aware counts include only the newly created role');
    assert.equal((await db.prepare('SELECT COUNT(*)::INT AS count FROM projects').get()).count, projectsBeforeRoles, 'Roles-only selection does not create projects');
    await db.prepare("UPDATE project_members SET role_id=? WHERE project_id='sample-project' AND user_id='sample-test-admin'").run(owner.id);
    await db.prepare("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('existing-ordinary-membership','sample-project','sample-ordinary-user',?)").run(owner.id);
    const setupRoles = (await service.getSampleCatalog()).roles;
    for (const name of ['Product Owner', 'Automation Engineer', 'AI Engineer', 'Reporter', 'QA Lead', 'QA Member', 'Viewer']) {
      assert.ok(setupRoles.some(role => role.name === name && role.role_id), `${name} is ready after setup`);
    }
    const customizedOwner = setupRoles.find(role => role.name === 'Product Owner');
    assert.equal(customizedOwner.status, 'customized');
    assert.deepEqual(customizedOwner.current_permission_codes, [], 'An intentionally empty role stays empty');
    const reporter = setupRoles.find(role => role.name === 'Reporter');
    assert.ok(reporter.current_permission_codes.includes('feedback.create'));
    assert.ok(!reporter.current_permission_codes.includes('feedback.manage'));
    assert.ok(subset.dependencies_added.includes('execution'));
    assert.ok(subset.dependencies_added.includes('planning'));
    assert.ok(!subset.installed.includes('agents'));
    // Existing v1 demonstrations may have been edited; v2 must not graft new
    // cases/results onto those records or reuse their display IDs.
    await db.query(`INSERT INTO test_cases(id,display_id,app_type_id,title) VALUES ('sample-case-login','DEMO-T1','sample-app-web','Edited original demo');
      INSERT INTO executions(id,project_id,app_type_id,name,trigger,status,execution_mode,duration_ms) VALUES ('sample-run-smoke','sample-project','sample-app-web','Edited original run','manual','completed','remote',1840);
      INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,duration_ms) VALUES ('sample-result-login','sample-run-smoke','sample-case-login','sample-app-web','passed',1840);`);
    const featureService = require('../../services/featureFlag.service');
    await featureService.updateLocalFlags({ 'hellotest.ai.agentic_workflows': false });
    const flagsBefore = (await featureService.getSnapshot()).local_flags;
    const installed = await service.seedSampleData(input);
    assert.deepEqual((await featureService.getSnapshot()).local_flags, flagsBefore, 'Installation does not enable disabled features');
    assert.equal(installed.installed.length, require('../../services/sampleData/repository').loadManifest().manifest.modules.length);
    assert.ok(installed.inserted_records > 0);
    const catalog = await service.getSampleCatalog();
    assert.equal(catalog.version, require('../../instance-setup-data/manifest.json').version);
    assert.equal(catalog.modules.find(module => module.key === 'agents').available, false);
    assert.ok(catalog.modules.every(module => module.status === 'installed' && module.record_count === module.expected_record_count));
    const recordCount = catalog.modules.reduce((sum, module) => sum + module.record_count, 0);
    const expectedContentCount = Object.values(require('../../services/sampleData').buildRecords(input.actorId)).flat().length;
    assert.equal(recordCount, expectedContentCount + catalog.roles.length, 'Catalog counts content records and virtual role presets exactly once');
    const featureMetrics = await verifyHelloTestFeatureSamples(db, input.actorId);
    await verifyJoinedMetricSamples(db);
    assert.equal(catalog.blueprint.story_count, featureMetrics.features);
    assert.equal(catalog.blueprint.backlog_count, featureMetrics.feature_backlog);
    assert.equal(catalog.blueprint.sprint_count, featureMetrics.feature_sprints);
    assert.equal(catalog.blueprint.release_count, featureMetrics.feature_releases);
    await db.prepare("UPDATE test_cases SET title = 'My revised scenario' WHERE id = 'sample-v2-case-login'").run();
    await db.prepare("UPDATE feedback SET message = 'My investigation notes' WHERE id = 'sample-v2-issue-checkout'").run();
    const editedFeatureId = 'sample-v3-feature-project-applications';
    await db.prepare("UPDATE requirements SET description='My revised HelloTest acceptance story', labels=? WHERE id=?").run(['customized-feature'], editedFeatureId);
    const editedFeature = await db.prepare('SELECT description, labels, additional_fields, iteration_id, sprint, release, fix_version, created_at FROM requirements WHERE id=?').get(editedFeatureId);
    await db.prepare("UPDATE projects SET name='My existing launchpad', description='My existing project description', visibility='public' WHERE id='sample-project'").run();
    await db.prepare("UPDATE app_types SET name='My existing customer portal' WHERE id='sample-app-web'").run();
    const editedProject = await db.prepare("SELECT * FROM projects WHERE id='sample-project'").get();
    const editedApplication = await db.prepare("SELECT * FROM app_types WHERE id='sample-app-web'").get();
    const existingMemberships = await db.prepare("SELECT * FROM project_members WHERE project_id='sample-project' ORDER BY user_id").all();
    const repeat = await service.seedSampleData(input);
    assert.equal(repeat.inserted_records, 0);
    assert.equal(repeat.roles.created.length, 0, 'Repeat setup does not duplicate roles');
    assert.equal((await db.prepare("SELECT role_id FROM project_members WHERE project_id='sample-project' AND user_id='sample-test-admin'").get()).role_id, owner.id, 'Repeat setup preserves a customized membership role');
    assert.equal(repeat.administrator_memberships, 0);
    assert.deepEqual(await db.prepare("SELECT * FROM project_members WHERE project_id='sample-project' ORDER BY user_id").all(), existingMemberships, 'Repeat setup preserves every existing membership identity, role and timestamp');
    assert.deepEqual(await db.prepare("SELECT * FROM projects WHERE id='sample-project'").get(), editedProject, 'Repeat setup does not overwrite the existing project');
    assert.deepEqual(await db.prepare("SELECT * FROM app_types WHERE id='sample-app-web'").get(), editedApplication, 'Repeat setup does not overwrite the existing application');
    await db.prepare("UPDATE users SET is_workspace_admin=TRUE WHERE id IN ('sample-default-admin','sample-ordinary-user')").run();
    const reconciled = await service.seedSampleData({ ...input, modules: ['workspace'] });
    assert.equal(reconciled.inserted_records, 0, 'Existing workspace records are skipped during member reconciliation');
    assert.equal(reconciled.administrator_memberships, 1, 'A newly eligible administrator receives only their missing membership');
    assert.equal((await db.prepare("SELECT role_id FROM project_members WHERE project_id='sample-project' AND user_id='sample-default-admin'").get()).role_id, adminRole.id);
    assert.deepEqual(await db.prepare("SELECT * FROM project_members WHERE project_id='sample-project' AND user_id<>'sample-default-admin' ORDER BY user_id").all(), existingMemberships, 'Promoting an existing member to workspace admin does not replace their customized project role');
    assert.deepEqual(await db.prepare("SELECT * FROM projects WHERE id='sample-project'").get(), editedProject);
    assert.deepEqual(await db.prepare("SELECT * FROM app_types WHERE id='sample-app-web'").get(), editedApplication);
    assert.equal((await service.seedSampleData({ ...input, modules: ['workspace'] })).administrator_memberships, 0, 'Reconciled memberships remain idempotent');
    assert.deepEqual(await db.prepare('SELECT description, labels, additional_fields, iteration_id, sprint, release, fix_version, created_at FROM requirements WHERE id=?').get(editedFeatureId), editedFeature, 'Reinstall retains edited feature-story content, metadata and original planning dates');
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM roles WHERE LOWER(BTRIM(name)) = 'product owner'").get()).count, 1, 'Role names are matched without case sensitivity');
    assert.equal((await db.prepare('SELECT COUNT(*)::INT AS count FROM role_permissions WHERE role_id = ?').get(owner.id)).count, 0);
    assert.equal((await db.prepare("SELECT title FROM test_cases WHERE id='sample-case-login'").get()).title, 'Edited original demo');
    assert.equal((await db.prepare("SELECT duration_ms FROM executions WHERE id='sample-run-smoke'").get()).duration_ms, 1840);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM execution_results WHERE execution_id='sample-run-smoke'").get()).count, 1);
    assert.equal(repeat.existing_records, recordCount);
    assert.equal((await db.prepare("SELECT title FROM test_cases WHERE id='sample-v2-case-login'").get()).title, 'My revised scenario');
    assert.equal((await db.prepare("SELECT message FROM feedback WHERE id='sample-v2-issue-checkout'").get()).message, 'My investigation notes');
    await db.prepare("DELETE FROM test_steps WHERE id='sample-v2-step-login-2'").run();
    assert.equal((await service.getSampleCatalog()).modules.find(module => module.key === 'design').status, 'partial');
    const repaired = await service.seedSampleData({ ...input, modules: ['design', 'design'] });
    assert.equal(repaired.inserted_records, 1);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM test_steps WHERE id='sample-v2-step-login-2'").get()).count, 1);
    const scope = await db.prepare(`SELECT COUNT(*)::INT AS count FROM test_cases cases JOIN app_types apps ON apps.id=cases.app_type_id WHERE apps.project_id='sample-project'`).get();
    assert.ok(scope.count >= 13);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM test_cases WHERE source_issue_id='sample-v2-issue-offline'").get()).count, 1);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM execution_results WHERE status='failed'").get()).count, Object.values(require('../../services/sampleData').buildRecords(input.actorId)).flat().filter(record => record.table === 'execution_results' && record.values.status === 'failed').length);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM executions runs WHERE duration_ms <> (SELECT SUM(duration_ms) FROM execution_results WHERE execution_id=runs.id)").get()).count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM execution_case_snapshots snapshots WHERE NOT EXISTS(SELECT 1 FROM execution_step_snapshots steps WHERE steps.execution_id=snapshots.execution_id AND steps.test_case_id=snapshots.test_case_id)").get()).count, 0);
    assert.ok((await db.prepare("SELECT COUNT(*)::INT AS count FROM ai_knowledge_chunks WHERE search_vector @@ plainto_tsquery('simple','idempotency')").get()).count >= 2);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM ai_knowledge_sources sources WHERE NOT EXISTS (SELECT 1 FROM ai_knowledge_security_bindings acl WHERE acl.source_id=sources.id AND acl.principal_id='sample-project')").get()).count, 0);
    assert.equal((await db.prepare('SELECT COUNT(*)::INT AS count FROM integrations WHERE is_active').get()).count, 0);
    assert.equal((await db.prepare('SELECT COUNT(*)::INT AS count FROM execution_schedules WHERE is_active').get()).count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS count FROM agentic_workflows WHERE status <> 'draft'").get()).count, 0);
    const { validateWorkflowGraph } = require('../../src/utils/agenticWorkflowGraph');
    const { AGENT_CATALOG } = require('../../../../agentic/backend/services/agenticAssistant.service');
    for (const workflow of await db.prepare('SELECT nodes,edges FROM agentic_workflows').all()) {
      validateWorkflowGraph(workflow.nodes, workflow.edges, { requireNodes: true });
      assert.ok(workflow.nodes.filter(node => node.data.kind === 'agent').every(node => AGENT_CATALOG[node.data.agentId]));
    }
    const { normalizeApiRequest } = require('../../src/utils/testStepAutomation');
    for (const step of await db.prepare('SELECT api_request FROM test_steps WHERE api_request IS NOT NULL').all()) assert.ok(normalizeApiRequest(step.api_request).validations.length);
    await db.prepare("DELETE FROM ai_knowledge_chunks WHERE id='sample-v2-chunk-api'").run();
    const concurrent = await Promise.all([service.seedSampleData({ ...input, modules: ['knowledge'] }), service.seedSampleData({ ...input, modules: ['knowledge'] })]);
    assert.deepEqual(concurrent.map(result => result.inserted_records).sort(), [0, 1], 'Concurrent installs report one exact repair');
    const detailedRun = await require('../../../../testing/backend/services/execution.service').getExecution('sample-v2-run-smoke');
    assert.ok(detailedRun.case_snapshots?.length || detailedRun.test_case_ids?.length || detailedRun.suite_ids?.length, 'Native run reader hydrates sample scope');
    const structured = require('../../src/domain/executionStepEvidence');
    for (const row of await db.prepare('SELECT results.logs, (SELECT count(*)::integer FROM execution_step_snapshots steps WHERE steps.execution_id = results.execution_id AND steps.test_case_id = results.test_case_id) AS expected_steps FROM execution_results results WHERE results.logs IS NOT NULL').all()) assert.equal(Object.keys(structured.parseStructuredLogs(row.logs).stepStatuses).length, row.expected_steps, 'Every saved synthetic result has observations for its actual frozen steps');
    const user = { id: 'sample-test-admin', role: 'admin', is_workspace_admin: true };
    const search = await require('../../../../knowledge/backend/services/knowledgeRag.service').search({ projectId: 'sample-project', query: 'idempotency payment', mode: 'keyword', user, limit: 5, filters: { source_kinds: ['knowledge_item'] } });
    assert.ok(search.items?.length || search.results?.length || search.hits?.length, 'Native knowledge retrieval returns the seeded sources');
    await db.prepare("UPDATE test_cases SET app_type_id='sample-app-api' WHERE id='sample-v2-case-login'").run();
    await assert.rejects(service.seedSampleData({ ...input, modules: ['design'] }), error => error.statusCode === 409);
    assert.equal((await db.prepare("SELECT app_type_id FROM test_cases WHERE id='sample-v2-case-login'").get()).app_type_id, 'sample-app-api', 'Moved records remain untouched');
    await db.prepare("UPDATE test_cases SET app_type_id='sample-app-web' WHERE id='sample-v2-case-login'").run();
    const roleSnapshot = (await service.getSampleCatalog()).roles;
    const deleted = await require('../../services/project.service').deleteProject('sample-project');
    assert.equal(deleted.deleted, true, 'A complete instance-setup project can be deleted');
    assert.equal((await service.getSampleCatalog()).project_id, null);
    assert.deepEqual((await service.getSampleCatalog()).roles, roleSnapshot, 'Deleting sample content preserves workspace roles');
    const recreated = await service.seedSampleData(input);
    assert.ok(recreated.inserted_records > 0, 'Setup recreates the deleted sample workspace');
    assert.equal(recreated.roles.created.length, 0);
    assert.equal(recreated.administrator_memberships, 4, 'Recreated sample content includes all currently active workspace administrators');
    assert.ok((await service.getSampleCatalog()).modules.every(module => module.status === 'installed'), 'All sample relationships can be recreated after deletion');
    console.log(JSON.stringify({ modules: catalog.modules.length, records: recordCount, ...featureMetrics, initial_admin_memberships: subset.administrator_memberships, reconciled_admin_memberships: reconciled.administrator_memberships, recreated_admin_memberships: recreated.administrator_memberships, repeated_install_new_records: repeat.inserted_records, repaired_records: repaired.inserted_records }));
  } finally { await Promise.all([db.close(), obsDb.close()]); }
});
