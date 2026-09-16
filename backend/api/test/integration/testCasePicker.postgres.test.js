const assert = require('node:assert/strict');
const test = require('node:test');

test('Test Case pickers page compact scoped choices and resolve explicit Requirement selections without hydration', {
  skip: process.env.TEST_CASE_PICKER_POSTGRES !== '1', timeout: 30000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const catalog = require('../../src/services/testCaseCatalog.service');
  const cases = require('../../src/services/testCase.service');
  const suites = require('../../src/services/testSuite.service');
  const prefix = `picker-${Date.now()}`;
  const id = value => `${prefix}-${value}`;
  const rollback = new Error('ROLLBACK_PICKER_FIXTURE');
  try {
    await db.transaction(async () => {
      for (const project of ['project', 'foreign']) await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(id(project), 'Picker verification');
      for (const [app, project] of [['app', 'project'], ['other-app', 'project'], ['foreign-app', 'foreign']]) await db.prepare('INSERT INTO app_types(id,project_id,name) VALUES(?,?,?)').run(id(app), id(project), app);
      for (const story of ['story-1', 'story-2']) await db.prepare('INSERT INTO requirements(id,project_id,title) VALUES(?,?,?)').run(id(story), id('project'), story);
      for (const suite of ['suite-a', 'suite-b', 'empty']) await db.prepare('INSERT INTO test_suites(id,app_type_id,name,labels,parameter_values) VALUES(?,?,?,?::jsonb,?::jsonb)').run(id(suite), id('app'), suite === 'suite-a' ? 'Named payment suite' : suite, JSON.stringify(suite === 'empty' ? ['empty-label'] : suite === 'suite-a' ? ['core'] : []), JSON.stringify({ region: 'test' }));
      await db.prepare('INSERT INTO test_case_modules(id,app_type_id,name) VALUES(?,?,?)').run(id('module'), id('app'), 'Payments module');
      await db.prepare('INSERT INTO shared_step_groups(id,app_type_id,name) VALUES(?,?,?)').run(id('shared'), id('app'), 'Shared login group');
      for (let n = 1; n <= 70; n++) {
        await db.prepare(`INSERT INTO test_cases(id,app_type_id,title,description,automated,labels,requirement_id,suite_id,gherkin_document,parameter_values,created_at,updated_at)
          VALUES(?,?,?,?,?,?::jsonb,?,?,?,?::jsonb,'2026-01-01 00:00:00.123456+00','2026-01-01 00:00:00.123456+00')`).run(
          id(`case-${String(n).padStart(3, '0')}`), id('app'), n === 70 ? 'Literal 50%_ match' : `Fixture case ${n}`, 'Description '.repeat(150), n <= 10 ? 'yes' : 'no', JSON.stringify(n === 70 ? ['off-page'] : []), n <= 40 ? id('story-1') : null,
          [1, 31].includes(n) ? id('suite-a') : null, 'Feature body '.repeat(1000), JSON.stringify({ payload: 'data'.repeat(2000) }));
      }
      for (const app of ['other-app', 'foreign-app']) await db.prepare('INSERT INTO test_cases(id,app_type_id,title,requirement_id) VALUES(?,?,?,?)').run(id(app), id(app), 'Scoped choice', id('story-1'));
      for (let n = 1; n <= 45; n++) {
        const caseId = id(`case-${String(n).padStart(3, '0')}`);
        if (n <= 30) await db.prepare('INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES(?,?,?)').run(id('suite-a'), caseId, n);
        if (n >= 20) await db.prepare('INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES(?,?,?)').run(id('suite-b'), caseId, n);
        if (n <= 35) await db.prepare('INSERT INTO test_case_module_cases(module_id,test_case_id) VALUES(?,?)').run(id('module'), caseId);
        if (n <= 20) await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES(?,?)').run(id(n <= 10 ? 'story-1' : 'story-2'), caseId);
      }
      await db.prepare('INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES(?,?,?)').run(id('suite-b'), id('case-070'), 70);
      for (const [name, n, group] of [['step-a', 1, 'shared'], ['step-b', 1, 'shared'], ['step-c', 2, null], ['step-d', 70, 'shared']]) await db.prepare('INSERT INTO test_steps(id,test_case_id,step_order,action,reusable_group_id,automation_code) VALUES(?,?,?,?,?,?)').run(id(name), id(`case-${String(n).padStart(3, '0')}`), 1, 'Perform step', group ? id(group) : null, 'code'.repeat(1000));
      const base = { project_id: id('project'), app_type_id: id('app'), projection: 'picker' };
      const started = performance.now();
      const first = await catalog.listPage({ ...base, page_size: 200 });
      assert.equal(first.items.length, 25);
      assert.equal('total' in first, false);
      const found = [...first.items];
      let cursor = first.next_cursor;
      const sizes = [first.items.length];
      while (cursor) { const page = await catalog.listPage({ ...base, cursor }); found.push(...page.items); sizes.push(page.items.length); cursor = page.next_cursor; }
      assert.deepEqual(sizes, [25, 25, 20]);
      assert.equal(new Set(found.map(row => row.id)).size, 70);
      for (const row of found) {
        assert.ok(row.description.length <= 240);
        assert.equal(row.detail_complete, false);
        assert.equal(row.summary_complete, false);
        for (const key of ['gherkin_document', 'parameter_values', 'steps', 'step_count', 'recent_results', 'run_count', 'review_history']) assert.equal(key in row, false, key);
      }
      const one = found.find(row => row.id === id('case-001'));
      assert.deepEqual(one.suite_ids, [id('suite-a')], 'Legacy and mapping sources deduplicate');
      assert.deepEqual(one.requirement_ids, [id('story-1')]);
      assert.deepEqual(one.module_names, ['Payments module']);
      assert.deepEqual(one.shared_step_group_names, ['Shared login group']);
      const pickerPagesMs = Math.round(performance.now() - started);
      const compactBytes = Buffer.byteLength(JSON.stringify(first));
      const fullPage = await cases.getTestCases({ app_type_id: id('app') });
      const fullBytes = Buffer.byteLength(JSON.stringify(fullPage));
      assert.ok(compactBytes < fullBytes / 20, 'A picker page avoids full-library authoring payloads');
      console.log(JSON.stringify({ pickerFirstPageBytes: compactBytes, oldFullLibraryBytes: fullBytes, recordCount: 70, threePickerPagesMs: pickerPagesMs }));
      const ownId = id('case-001'), sameProjectOtherApp = id('other-app'), foreignId = id('foreign-app');
      const ownOnly = await catalog.listPage({ ...base, ids: [ownId, sameProjectOtherApp, foreignId].join(',') });
      assert.deepEqual(ownOnly.items.map(row => row.id), [ownId]);
      const projectOnly = await catalog.listPage({ project_id: id('project'), projection: 'picker', ids: [ownId, sameProjectOtherApp, foreignId].join(',') });
      assert.equal(projectOnly.items.length, 2);
      assert.ok(projectOnly.items.every(row => row.id !== foreignId));
      const matching = async filter => catalog.listPage({ ...base, ...filter, include_total: true });
      assert.equal((await matching({ search: '50%_' })).total, 1);
      assert.equal((await matching({ label: 'off-page' })).total, 1);
      assert.equal((await matching({ search: 'Named payment suite' })).total, 31);
      assert.equal((await matching({ search: 'Shared login group' })).total, 2);
      assert.equal((await matching({ shared_step_group_id: id('shared') })).total, 2);
      assert.equal((await matching({ automated: 'yes' })).total, 10);
      assert.equal((await matching({ suite_ids: [id('suite-a'), id('suite-b')].join(',') })).total, 46);
      assert.equal((await matching({ suite_id: id('suite-a') })).total, 31);
      assert.equal((await matching({ module_id: id('module') })).total, 35);
      assert.equal((await matching({ ids: '' })).total, 0);
      await assert.rejects(catalog.listPage({ ...base, app_type_id: id('other-app'), cursor: first.next_cursor }), { statusCode: 400 });
      const requirementChoices = await cases.getTestCasesForRequirements({ app_type_id: id('app'), requirement_ids: [id('story-1'), id('story-2')] });
      assert.equal(requirementChoices.length, 40);
      assert.equal(new Set(requirementChoices.map(row => row.id)).size, 40);
      assert.deepEqual(requirementChoices.find(row => row.id === id('case-011')).requirement_ids, [id('story-1'), id('story-2')]);
      assert.ok(requirementChoices.every(row => !('description' in row) && !('gherkin_document' in row) && !('steps' in row)));
      const summary = await suites.getTestSuites({ app_type_id: id('app'), projection: 'summary' });
      const a = summary.find(row => row.id === id('suite-a'));
      assert.equal(a.test_case_count, 31);
      assert.equal(a.total_step_count, 3);
      assert.equal(a.automated_case_count, 10);
      assert.equal(a.story_linked_case_count, 31);
      assert.deepEqual(a.parameter_values, { region: 'test' });
      const pickSuites = await suites.getTestSuites({ app_type_id: id('app'), projection: 'picker', case_search: '50%_' });
      assert.deepEqual(pickSuites.map(row => row.id), [id('suite-b')]);
      assert.ok(!('parameter_values' in pickSuites[0]));
      assert.deepEqual((await suites.getTestSuites({ app_type_id: id('app'), projection: 'picker', label: 'empty-label' })).map(row => row.id), [id('empty')]);
      assert.equal((await suites.getTestSuites({ app_type_id: id('app'), projection: 'picker', shared_step_group_id: id('shared') })).length, 2);
      throw rollback;
    })();
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.close(); }
});
