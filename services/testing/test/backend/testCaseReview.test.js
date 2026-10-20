const { dependencyName } = require("../../../platform/backend/test/helpers/sourceFile");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const initialCase = overrides => ({
  id: 'case', title: 'Checkout', app_type_id: 'app', created_by: 'creator', author_id: 'creator',
  reviewer_id: 'reviewer', review_status: 'pending', review_history: [], status: 'draft',
  updated_at: '2026-09-01T00:00:00.000Z', automated: 'no', test_case_type: 'functional', ...overrides
});

function fixture(overrides = {}) {
  const state = { row: initialCase(overrides), steps: [], sharedGroupSyncs: [], revision: 1, versions: [], deletes: 0, notifications: [], beforeTransaction: null };
  let queue = Promise.resolve();
  let transactionActive = false;
  const db = {
    transaction: callback => async (...args) => {
      if (state.beforeTransaction) {
        const before = state.beforeTransaction;
        state.beforeTransaction = null;
        await before();
      }
      const work = queue.then(async () => {
        const original = clone(state.row), steps = clone(state.steps), revision = state.revision, versions = state.versions.length;
        transactionActive = true;
        try { return await callback(...args); }
        catch (error) { state.row = original; state.steps = steps; state.revision = revision; state.versions.length = versions; throw error; }
        finally { transactionActive = false; }
      });
      queue = work.catch(() => {});
      return work;
    },
    prepare: statement => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      return {
        get: async id => {
          if (/FOR UPDATE/.test(sql)) assert.equal(transactionActive, true, 'Review row locks must be inside a transaction');
          if (/FROM app_types/.test(sql)) return { id: 'app', project_id: 'project' };
          if (/FROM users/.test(sql)) return { id, name: id };
          if (/FROM project_members/.test(sql)) return { user_id: id };
          if (/FROM test_cases/.test(sql)) return state.row
            ? { ...clone(state.row), ...(/AS revision/.test(sql) ? { revision: state.revision } : {}) }
            : null;
          return null;
        },
        all: async () => /FROM test_steps/.test(sql) ? clone(state.steps) : [],
        run: async (...args) => {
          if (/^INSERT INTO test_cases \(/.test(sql)) {
            const columns = sql.match(/^INSERT INTO test_cases \(([^)]+)\)/)[1].split(',').map(x => x.trim());
            state.row = Object.fromEntries(columns.slice(0, args.length).map((column, i) => [column, clone(args[i])]));
            state.row.updated_at = '2026-09-01T00:00:00.000Z';
          } else if (/^UPDATE test_cases SET/.test(sql)) {
            const fields = sql.match(/ SET (.+) WHERE id = \?/)[1].split(',').filter(x => x.includes('?')).map(x => x.split('=')[0].trim());
            fields.forEach((field, i) => { state.row[field] = clone(args[i]); });
            if (/updated_at = CURRENT_TIMESTAMP/.test(sql)) state.row.updated_at = new Date(new Date(state.row.updated_at).getTime() + 1000).toISOString();
          } else if (/^DELETE FROM test_steps WHERE/.test(sql)) {
            state.steps = [];
          } else if (/^INSERT INTO test_steps \(/.test(sql)) {
            const columns = sql.match(/^INSERT INTO test_steps \(([^)]+)\)/)[1].split(',').map(x => x.trim());
            state.steps.push(Object.fromEntries(columns.map((column, i) => [column, clone(args[i])])));
          } else if (/^DELETE FROM test_cases WHERE/.test(sql)) { state.deletes++; state.row = null; }
          return { changes: 1 };
        }
      };
    }
  };
  const hooksModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../backend/services/caseExecutionHooks.service.js'), 'utf8'), {
    module: hooksModule, require: dependency => dependencyName(dependency) === 'db' ? db : require(dependency)
  });
  const service = {};
  const noop = async () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../backend/services/testCase.service.js'), 'utf8'), {
    exports: service, console,
    require: dependency => {
      if (dependencyName(dependency) === "db") return db;
      if (dependency === 'crypto') return require('node:crypto');
      if (dependency.includes('/utils/') || dependencyName(dependency) === "catalog") return require(dependency.startsWith('@hellotest/') ? dependency : path.resolve(__dirname, '../../backend/services', dependency));
      if (dependencyName(dependency) === "displayId.service") return { createDisplayId: async () => 'TC-1' };
      if (dependencyName(dependency) === "dropdownCatalog.service") return { getDefaultValue: async () => 'functional', validateValue: async (_, value) => value };
      if (dependencyName(dependency) === "mobileFeature.service") return { assertAuthoringMobileFeatureEnabled: noop };
      if (dependencyName(dependency) === "notification.service") return { createNotification: async item => state.notifications.push(item) };
      if (dependencyName(dependency) === "caseExecutionHooks.service") return hooksModule.exports;
      if (dependencyName(dependency) === "sharedStepSync.service") return {
        syncSharedGroupFromReference: async (...args) => state.sharedGroupSyncs.push(args)
      };
      if (dependencyName(dependency) === "testCaseVersion.service") return {
        assertExpectedRevision: async (_, expected) => { if (expected !== undefined && expected !== state.revision) throw Object.assign(new Error('Stale revision'), { statusCode: 409 }); },
        capture: async data => { state.versions.push(clone(data)); return { revision: state.revision++ }; },
        buildSnapshot: async row => ({ ...row, steps: [{ action: 'Pay' }] })
      };
      return {};
    }
  });
  return { service, state };
}

test('successive saves of metadata and steps complete without reporting a failure after committing', async () => {
  const { service, state } = fixture();
  for (let edit = 1; edit <= 3; edit++) {
    const result = await service.updateTestCase('case', {
      title: `Checkout edit ${edit}`,
      description: `Description ${edit}`,
      labels: ['checkout', `edit-${edit}`],
      parameter_values: { account: `customer-${edit}` },
      priority: edit,
      expected_revision: edit,
      updated_by: 'creator',
      steps: [{ step_order: 1, action: `Pay ${edit}`, expected_result: `Receipt ${edit}` }]
    });
    assert.equal(result.updated, true);
    assert.equal(result.revision, edit + 1);
    assert.equal(state.row.title, `Checkout edit ${edit}`);
    assert.equal(state.row.description, `Description ${edit}`);
    assert.deepEqual(state.row.labels, ['checkout', `edit-${edit}`]);
    assert.deepEqual(state.row.parameter_values, { account: `customer-${edit}` });
    assert.equal(state.row.priority, edit);
    assert.equal(state.steps.length, 1);
    assert.equal(state.steps[0].action, `Pay ${edit}`);
    assert.equal(state.steps[0].expected_result, `Receipt ${edit}`);
    assert.equal(state.versions.length, edit);
    assert.equal(state.revision, edit + 1);
  }
  assert.deepEqual(state.sharedGroupSyncs, []);
  const beforeStaleSave = clone(state);
  await assert.rejects(service.updateTestCase('case', {
    title: 'Stale title', expected_revision: 1, steps: [], updated_by: 'creator'
  }), { statusCode: 409 });
  assert.deepEqual(clone(state), beforeStaleSave);
  const cleared = await service.updateTestCase('case', { steps: [], expected_revision: 4, updated_by: 'creator' });
  assert.equal(cleared.updated, true);
  assert.equal(cleared.revision, 5);
  assert.equal(state.steps.length, 0);
  assert.equal(state.revision, 5);
});

test('suite-only saves return the committed revision and preserve authoring content for the next edit', async () => {
  const document = 'Feature: Checkout\n\nScenario: Pay\n  When payment is submitted\n  Then a receipt is shown';
  const { service, state } = fixture({ suite_id: 'old-suite', description: 'Original description', gherkin_document: document, authoring_mode: 'gherkin' });
  state.steps = [{ step_order: 1, action: 'Pay', expected_result: 'Receipt' }];
  const result = await service.updateTestCase('case', { suite_ids: [], expected_revision: 1, updated_by: 'creator' });
  assert.equal(result.updated, true);
  assert.equal(result.revision, 2);
  assert.equal((await service.getTestCase('case')).revision, result.revision);
  assert.equal(state.row.suite_id, null);
  assert.equal(state.row.title, 'Checkout');
  assert.equal(state.row.description, 'Original description');
  assert.equal(state.row.gherkin_document, document);
  assert.deepEqual(state.steps, [{ step_order: 1, action: 'Pay', expected_result: 'Receipt' }]);
  const edited = await service.updateTestCase('case', {
    title: 'Unsaved title now submitted', expected_revision: result.revision, updated_by: 'creator'
  });
  assert.equal(edited.revision, 3);
  assert.equal((await service.getTestCase('case')).revision, edited.revision);
  assert.equal(state.row.title, 'Unsaved title now submitted');
  assert.equal(state.row.gherkin_document, document);
});

test('saving reusable steps synchronizes each shared group instance once by default', async () => {
  const { service, state } = fixture();
  const steps = [1, 2].map(step_order => ({
    step_order, action: `Shared action ${step_order}`, group_id: 'group-instance',
    group_name: 'Shared login', group_kind: 'reusable', reusable_group_id: 'shared-login'
  }));
  const result = await service.updateTestCase('case', { steps, expected_revision: 1, updated_by: 'creator' });
  assert.equal(result.updated, true);
  assert.equal(state.steps.length, 2);
  assert.deepEqual(state.sharedGroupSyncs, [['shared-login', 'case', 'group-instance']]);
  await service.updateTestCase('case', { steps, expected_revision: 2, updated_by: 'creator' }, { syncSharedGroups: false });
  assert.equal(state.sharedGroupSyncs.length, 1);
});

for (const source of [null, 'scheduler', 'interactive', 'repository']) {
  for (const decision of ['accepted', 'changes_requested']) {
    test(`${source || 'manual'} review ${decision} is retained, audited and updates both review states`, async () => {
      const { service, state } = fixture({ ai_generation_source: source, ai_generation_review_status: source ? 'pending' : null });
      const result = await service.reviewTestCase('case', { review_status: decision, reviewed_by: 'reviewer', comment: 'Checked', expected_updated_at: state.row.updated_at, expected_revision: 1 });
      assert.equal(result.updated, true);
      assert.equal(state.row.review_status, decision);
      assert.equal(state.row.status, decision === 'accepted' ? 'ready' : 'draft');
      assert.equal(state.row.ai_generation_review_status, source ? decision === 'accepted' ? 'accepted' : 'rejected' : null);
      assert.equal(state.deletes, 0, 'Requesting changes never deletes the test case');
      assert.equal(state.row.review_history.length, 1);
      assert.equal(state.row.review_history[0].user_id, 'reviewer');
      assert.equal(state.row.review_history[0].comment, 'Checked');
      assert.equal(state.versions[0].testCase.review_status, 'pending');
      assert.equal(state.versions[0].nextSnapshot.steps[0].action, 'Pay');
      assert.equal(state.notifications.length, 1);
      await assert.rejects(service.reviewTestCase('case', { review_status: decision, reviewed_by: 'reviewer' }), { statusCode: 409 });
      assert.equal(state.row.review_history.length, 1);
    });
  }
}

test('only assigned reviewer may decide; creator and administrator identities do not override assignment', async () => {
  const { service, state } = fixture({ ai_generation_source: 'scheduler', ai_generation_review_status: 'pending' });
  for (const actor of ['creator', 'administrator', null]) await assert.rejects(service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: actor }), { statusCode: 403 });
  assert.equal(state.versions.length, 0);
  assert.equal(state.row.review_status, 'pending');
});

test('legacy unassigned AI pending case falls back to creator, but unassigned manual or already decided AI does not', async () => {
  const { service, state } = fixture({ reviewer_id: null, review_status: 'not_requested', ai_generation_source: 'scheduler', ai_generation_review_status: 'pending' });
  await assert.rejects(service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'reviewer' }), { statusCode: 403 });
  await service.reviewTestCase('case', { review_status: 'changes_requested', reviewed_by: 'creator' });
  assert.equal(state.row.ai_generation_review_status, 'rejected');
  for (const overrides of [{ reviewer_id: null }, { reviewer_id: null, ai_generation_source: 'scheduler', ai_generation_review_status: 'pending', review_status: 'accepted' }]) {
    const other = fixture(overrides);
    await assert.rejects(other.service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'creator' }), { statusCode: 403 });
  }
});

test('concurrent conflicting decisions save exactly one decision and one historical version', async () => {
  const { service, state } = fixture();
  const results = await Promise.allSettled(['accepted', 'changes_requested'].map(review_status => service.reviewTestCase('case', { review_status, reviewed_by: 'reviewer' })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.statusCode, 409);
  assert.equal(state.row.review_history.length, 1);
  assert.equal(state.versions.length, 1);
});

test('stale timestamps and revisions leave the current review untouched', async () => {
  const { service, state } = fixture();
  for (const guards of [{ expected_updated_at: '2026-08-31T00:00:00Z' }, { expected_revision: 2 }]) await assert.rejects(service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'reviewer', ...guards }), { statusCode: 409 });
  await assert.rejects(service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'reviewer', expected_updated_at: 'invalid' }), { statusCode: 400 });
  assert.equal(state.row.review_status, 'pending');
  assert.equal(state.versions.length, 0);
});

test('ordinary updates cannot inject decisions or erase audit history; unchanged reviewer keeps the prior decision', async () => {
  const { service, state } = fixture();
  await assert.rejects(service.updateTestCase('case', { review_status: 'accepted', updated_by: 'creator' }), { statusCode: 403 });
  await service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'reviewer' });
  await service.updateTestCase('case', { title: 'Updated checkout', reviewer_id: 'reviewer', review_history: [], updated_by: 'creator' });
  assert.equal(state.row.review_status, 'accepted');
  assert.equal(state.row.review_history.length, 1);
  assert.equal(state.row.review_history[0].status, 'accepted');
});

test('reassignment reopens review and prevents the previous reviewer deciding', async () => {
  const { service, state } = fixture({ ai_generation_source: 'interactive', ai_generation_review_status: 'accepted', review_status: 'accepted' });
  await service.updateTestCase('case', { reviewer_id: 'replacement', review_status: 'accepted', updated_by: 'creator' });
  assert.equal(state.row.review_status, 'pending');
  assert.equal(state.row.ai_generation_review_status, 'pending');
  await assert.rejects(service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'reviewer' }), { statusCode: 403 });
  await service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'replacement' });
});

test('an edit that loaded before a concurrent review cannot overwrite the decision', async () => {
  const { service, state } = fixture();
  state.beforeTransaction = () => service.reviewTestCase('case', { review_status: 'accepted', reviewed_by: 'reviewer' });
  await assert.rejects(service.updateTestCase('case', { title: 'Stale edit', updated_by: 'creator' }), { statusCode: 409 });
  assert.equal(state.row.review_status, 'accepted');
  assert.equal(state.row.review_history.length, 1);
  assert.equal(state.row.title, 'Checkout');
});

test('legacy generated endpoints enforce owner and synchronize accepted review; delete requires pending state', async () => {
  const { service, state } = fixture({ ai_generation_source: 'scheduler', ai_generation_review_status: 'pending' });
  await assert.rejects(service.acceptGeneratedTestCase('case', { reviewed_by: 'creator' }), { statusCode: 403 });
  await assert.rejects(service.rejectGeneratedTestCase('case', { reviewed_by: 'creator' }), { statusCode: 403 });
  await service.acceptGeneratedTestCase('case', { reviewed_by: 'reviewer' });
  assert.equal(state.row.review_status, 'accepted');
  assert.equal(state.row.review_history.length, 1);
  await assert.rejects(service.rejectGeneratedTestCase('case', { reviewed_by: 'reviewer' }), { statusCode: 409 });
  assert.equal(state.deletes, 0);
});

for (const source of ['scheduler', 'interactive', 'repository']) {
  test(`${source} creation defaults to creator review and preserves an idempotently saved decision`, async () => {
    const { service, state } = fixture();
    state.row = null;
    const payload = { app_type_id: 'app', title: 'Generated checkout', created_by: 'creator', ai_generation_source: source, source_idempotency_key: 'stable-key', review_status: 'not_requested' };
    await service.createTestCase(payload);
    assert.equal(state.row.reviewer_id, 'creator');
    assert.equal(state.row.review_status, 'pending');
    assert.equal(state.row.ai_generation_review_status, 'pending');
    await service.reviewTestCase(state.row.id, { review_status: 'accepted', reviewed_by: 'creator' });
    const replay = await service.createTestCase(payload);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(state.row.review_status, 'accepted');
    assert.equal(state.row.ai_generation_review_status, 'accepted');
  });
}

test('editing an already accepted legacy AI case preserves its completed review', async () => {
  const { service, state } = fixture({ reviewer_id: null, review_status: 'not_requested', ai_generation_source: 'scheduler', ai_generation_review_status: 'accepted', status: 'ready' });
  await service.updateTestCase('case', { title: 'Clarified accepted case', review_status: 'not_requested', updated_by: 'creator' });
  assert.equal(state.row.ai_generation_review_status, 'accepted');
  assert.equal(state.row.review_status, 'not_requested');
  assert.equal(state.row.status, 'ready');
  await assert.rejects(service.reviewTestCase('case', { review_status: 'changes_requested', reviewed_by: 'creator' }), { statusCode: 403 });
});

test('internal restore audit appends to prior decisions and explicitly reopens AI review', async () => {
  const { service, state } = fixture({ ai_generation_source: 'scheduler', ai_generation_review_status: 'accepted', review_status: 'accepted', review_history: [{ id: 'old', status: 'accepted', user_id: 'reviewer', created_at: '2026-09-01T00:00:00Z' }] });
  await service.updateTestCase('case', { title: 'Restored content', review_status: 'pending', updated_by: 'creator' }, { reviewHistoryEntry: { id: 'restore', status: 'pending', comment: 'Human review is required', user_id: 'creator', created_at: '2026-09-02T00:00:00Z' } });
  assert.equal(state.row.review_status, 'pending');
  assert.equal(state.row.ai_generation_review_status, 'pending');
  assert.equal(state.row.review_history.length, 2);
  assert.equal(state.row.review_history[0].status, 'accepted');
  assert.equal(state.row.review_history[1].comment, 'Human review is required');
});
