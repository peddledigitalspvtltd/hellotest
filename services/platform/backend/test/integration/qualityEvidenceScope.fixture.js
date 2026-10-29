const assert = require('node:assert/strict');

// Runs against the migrated disposable PostgreSQL database used by mcp.postgres.
// Every fixture mutation rolls back, including the temporary result permission.
exports.verify = async ({ db }) => {
  const rollback = Symbol('quality-evidence-fixture-rollback');
  try {
    await db.transaction(async () => {
      await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'mcp-fixture-role',id FROM permissions WHERE code = 'result.view' ON CONFLICT DO NOTHING");
      await db.query("INSERT INTO requirement_iterations(id,project_id,name) VALUES ('quality-sprint-a','mcp-p-a','Quality Sprint A'),('quality-sprint-b','mcp-p-a','Quality Sprint B')");
      await db.query("INSERT INTO requirement_releases(id,project_id,name,fix_version) VALUES ('quality-release-a','mcp-p-a','Quality Release A','quality-a'),('quality-release-b','mcp-p-a','Quality Release B','quality-b')");
      await db.query("INSERT INTO requirement_release_sprints(release_id,iteration_id) VALUES ('quality-release-a','quality-sprint-a'),('quality-release-b','quality-sprint-b')");
      await db.query("INSERT INTO requirements(id,project_id,title,iteration_id,additional_fields) VALUES ('quality-story-a','mcp-p-a','Checkout retry','quality-sprint-a','{\"acceptance_criteria\":[\"Exactly one order remains\"]}'),('quality-story-b','mcp-p-a','Unrelated profile','quality-sprint-b','{}')");
      await db.query("INSERT INTO test_cases(id,app_type_id,title,requirement_id) VALUES ('quality-case-a','mcp-app-a','Retry checkout','quality-story-a'),('quality-case-b','mcp-app-a','Unrelated profile case','quality-story-b')");
      await db.query("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result) VALUES ('quality-step-a','quality-case-a',1,'Repeat checkout','Exactly one order remains')");
      await db.query("INSERT INTO executions(id,project_id,app_type_id,name,release_id,iteration_id,status) VALUES ('quality-run-a','mcp-p-a','mcp-app-a','Checkout regression','quality-release-a','quality-sprint-a','failed'),('quality-run-b','mcp-p-a','mcp-app-a','Unrelated regression','quality-release-b','quality-sprint-b','failed')");
      await db.query("INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES ('quality-run-a','quality-case-a','Retry checkout'),('quality-run-a','quality-case-b','Unrelated profile case'),('quality-run-b','quality-case-b','Unrelated profile case')");
      await db.query("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,action,expected_result,step_type) VALUES ('quality-run-a','quality-case-a','quality-snapshot-a',1,'Repeat checkout','Exactly one order remains','manual')");
      await db.query("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,logs) VALUES ('quality-attempt-a','quality-run-a','quality-case-a','mcp-app-a','failed',''),('quality-attempt-unrelated','quality-run-a','quality-case-b','mcp-app-a','passed',''),('quality-attempt-b','quality-run-b','quality-case-b','mcp-app-a','failed','')");
      await db.query("INSERT INTO feedback(id,project_id,title,user_id,message,linked_test_run_id,linked_requirement_ids,linked_test_case_ids) VALUES ('quality-defect-a','mcp-p-a','Duplicate checkout','mcp-a','Two orders observed','quality-run-a','[\"quality-story-a\"]','[\"quality-case-a\"]'),('quality-defect-shared-run','mcp-p-a','Unrelated profile issue','mcp-a','Profile failure in the same run','quality-run-a','[\"quality-story-b\"]','[\"quality-case-b\"]'),('quality-defect-other-run','mcp-p-a','Checkout in another run','mcp-a','Historical checkout failure','quality-run-b','[\"quality-story-a\"]','[\"quality-case-a\"]')");

      const user = (await require('@hellotest/mcp/backend/auth').principal('mcp-a', 'mcp-p-a', 'quality-scope-fixture')).user;
      const failureLogs = { stepStatuses: { 'quality-snapshot-a': 'failed' }, stepNotes: { 'quality-snapshot-a': 'Observed two orders after retry' }, stepEvidence: { 'quality-snapshot-a': { dataUrl: 'data:image/png;base64,NOT_FOR_MODEL' } } };
      await db.prepare('UPDATE execution_results SET logs = ? WHERE id = ?').run(JSON.stringify(failureLogs), 'quality-attempt-a');
      const orchestrator = require('@hellotest/ai/backend/services/aiContextOrchestrator.service');
      const live = await orchestrator.buildLiveProjectEvidence({ projectId: 'mcp-p-a', appTypeId: 'mcp-app-a', user,
        prompt: 'Draft a defect from this failed checkout run', requestedScopes: ['runs'],
        evidenceScope: { execution_id: 'quality-run-a', story_id: 'quality-story-a' } });
      const failures = live.hits.map(hit => JSON.parse(hit.content)).filter(item => item.evidence_type === 'authoritative_live_execution_failures');
      assert.equal(failures.length, 1);
      assert.equal(failures[0].test_case_id, 'quality-case-a');
      assert.equal(failures[0].title, 'Retry checkout');
      assert.equal(failures[0].steps[0].action, 'Repeat checkout');
      assert.equal(failures[0].steps[0].expected_result, 'Exactly one order remains');
      assert.equal(failures[0].steps[0].observed_status, 'failed');
      assert.equal(failures[0].steps[0].note, 'Observed two orders after retry');
      assert.equal(failures[0].steps[0].evidence_available, true);
      assert.doesNotMatch(JSON.stringify(failures), /NOT_FOR_MODEL|Unrelated profile/);
      const failurePacket = await require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').retrieveSearch({ projectId:'mcp-p-a', appTypeId:'mcp-app-a', user,
        query:'Show failed checkout steps', filters:{agent_id:'bug-reporter',requested_scopes:['runs'],source_kinds:['execution'],evidence_scope:{execution_id:'quality-run-a',story_id:'quality-story-a'}},
        budgets:{max_context_tokens:8000,max_evidence_items:12,deadline_ms:12000} });
      assert.ok(failurePacket.results.some(hit=>JSON.parse(hit.content).evidence_type==='authoritative_live_execution_failures'), 'Failed-step evidence must survive MCP authorization and packet assembly, not just a direct database read.');

      await db.query("UPDATE requirements SET description = repeat('Detailed checkout intent. ', 50) WHERE id = 'quality-story-a'");
      await db.query("UPDATE requirements SET description = 'Profile behaviour supports checkout identity.' WHERE id = 'quality-story-b'");
      await db.query("INSERT INTO requirement_relations(requirement_id,related_requirement_id) VALUES ('quality-story-a','quality-story-b')");
      const storyLive = await orchestrator.buildLiveProjectEvidence({ projectId: 'mcp-p-a', appTypeId: 'mcp-app-a', user,
        prompt: 'Review the selected Story', requestedScopes: ['stories'], evidenceScope: { story_id: 'quality-story-a' } });
      const storySnapshots = storyLive.hits.map(hit => JSON.parse(hit.content));
      const selectedStory = storySnapshots.find(item => item.evidence_type === 'authoritative_live_story_snapshot');
      assert.deepEqual(selectedStory.records.map(item => item.id), ['quality-story-a']);
      assert.ok(selectedStory.records[0].description.length > 600, 'Exact Story context retains detailed intent.');
      const support = storySnapshots.find(item => item.evidence_type === 'authoritative_live_story_support');
      assert.equal(support.related_items[0].id, 'quality-story-b');
      assert.equal(support.related_items[0].description, 'Profile behaviour supports checkout identity.');
      assert.deepEqual(require('../../../../agentic/backend/services/agentArtifacts').storyTargets({ live_project: storyLive.hits }).map(item => item.id), ['quality-story-a'], 'Related context never becomes a mutation target.');
      const quality = require('@hellotest/ai/backend/services/qualityEvidence.service');
      const input = { story_id: 'quality-story-a', test_case_id: 'quality-case-a', execution_id: 'quality-run-a', release_id: 'quality-release-a', sprint_id: 'quality-sprint-a' };
      const read = scopes => quality.collect({ projectId: 'mcp-p-a', appTypeId: 'mcp-app-a', user, input, scopes, existingTransaction: true });
      const ids = rows => rows.map(row => row.id);
      const snapshot = await read(['stories', 'test-cases', 'runs', 'bugs']);
      assert.deepEqual(ids(snapshot.stories), ['quality-story-a'], 'Story evidence intersects every selected identifier');
      assert.deepEqual(ids(snapshot.tests), ['quality-case-a'], 'A case outside the selected Story is excluded even when present in the selected Run');
      assert.deepEqual(ids(snapshot.runs), ['quality-run-a']);
      assert.deepEqual(ids(snapshot.attempts), ['quality-attempt-a'], 'Results from another case or Run cannot enter the scoped quality snapshot');
      assert.deepEqual(ids(snapshot.defects), ['quality-defect-a'], 'Sharing just the selected Run or selected Story cannot admit an unrelated defect');
      assert.deepEqual(snapshot.stories[0].acceptance_criteria, ['Exactly one order remains']);
      assert.deepEqual(snapshot.stories[0].test_case_ids, ['quality-case-a']);
      assert.deepEqual(snapshot.defects[0].requirement_ids, ['quality-story-a']);
      assert.deepEqual(snapshot.defects[0].test_case_ids, ['quality-case-a']);
      assert.equal(snapshot.defects[0].linked_test_run_id, 'quality-run-a');
      assert.equal(snapshot.attempts[0].case_snapshot, undefined, 'Raw snapshot content is removed from the public evidence package');

      const testOnly = await read(['test-cases']);
      assert.deepEqual(ids(testOnly.tests), ['quality-case-a'], 'Disabling the Story source does not discard cases selected through native delivery links');
      assert.deepEqual(testOnly.stories, []);
      assert.deepEqual(testOnly.runs, []);
      assert.deepEqual(testOnly.attempts, []);
      assert.deepEqual(testOnly.defects, []);
      const withoutStories = await read(['test-cases', 'runs']);
      assert.deepEqual(ids(withoutStories.tests), ['quality-case-a']);
      assert.deepEqual(ids(withoutStories.attempts), ['quality-attempt-a'], 'Allowed Run results remain available independently of the Story source');
      assert.deepEqual(withoutStories.stories, []);

      const bugsOnly = await read(['bugs']);
      assert.deepEqual(ids(bugsOnly.defects), ['quality-defect-a'], 'Native application-scoped defects remain available when other source collections are disabled');
      assert.deepEqual(bugsOnly.defects[0].requirement_ids, [], 'Unavailable Story content stays redacted');
      assert.deepEqual(bugsOnly.defects[0].test_case_ids, [], 'Unavailable case content stays redacted');
      assert.equal(bugsOnly.defects[0].linked_test_run_id, undefined);
      await assert.rejects(quality.collect({ projectId: 'mcp-p-a', appTypeId: 'mcp-app-a', user, input: { ...input, sprint_id: 'quality-sprint-b' }, scopes: ['stories', 'test-cases', 'runs', 'bugs'], existingTransaction: true }), { statusCode: 400 }, 'A conflicting Sprint fails closed instead of widening the scope');
      throw rollback;
    })();
  } catch (error) {
    if (error !== rollback) throw error;
  }
};
