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
  const state = { row: initialCase(overrides), revision: 1, versions: [], deletes: 0, notifications: [], beforeTransaction: null };
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
        const original = clone(state.row), revision = state.revision, versions = state.versions.length;
        transactionActive = true;
        try { return await callback(...args); }
        catch (error) { state.row = original; state.revision = revision; state.versions.length = versions; throw error; }
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
          if (/FROM test_cases/.test(sql)) return clone(state.row);
          return null;
        },
        all: async () => [],
        run: async (...args) => {
          if (/^INSERT INTO test_cases \(/.test(sql)) {
            const columns = sql.match(/^INSERT INTO test_cases \(([^)]+)\)/)[1].split(',').map(x => x.trim());
            state.row = Object.fromEntries(columns.slice(0, args.length).map((column, i) => [column, clone(args[i])]));
            state.row.updated_at = '2026-09-01T00:00:00.000Z';
          } else if (/^UPDATE test_cases SET/.test(sql)) {
            const fields = sql.match(/ SET (.+) WHERE id = \?/)[1].split(',').filter(x => x.includes('?')).map(x => x.split('=')[0].trim());
            fields.forEach((field, i) => { state.row[field] = clone(args[i]); });
            if (/updated_at = CURRENT_TIMESTAMP/.test(sql)) state.row.updated_at = new Date(new Date(state.row.updated_at).getTime() + 1000).toISOString();
          } else if (/^DELETE FROM test_cases WHERE/.test(sql)) { state.deletes++; state.row = null; }
          return { changes: 1 };
        }
      };
    }
  };
  const service = {};
  const noop = async () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/testCase.service.js'), 'utf8'), {
    exports: service, console,
    require: dependency => {
      if (dependency === '../db') return db;
      if (dependency === 'crypto') return require('node:crypto');
      if (dependency.startsWith('../utils/') || dependency === '../domain/catalog') return require(path.join(__dirname, '../src/services', dependency));
      if (dependency === './displayId.service') return { createDisplayId: async () => 'TC-1' };
      if (dependency === './dropdownCatalog.service') return { getDefaultValue: async () => 'functional', validateValue: async (_, value) => value };
      if (dependency === './mobileFeature.service') return { assertAuthoringMobileFeatureEnabled: noop };
      if (dependency === './notification.service') return { createNotification: async item => state.notifications.push(item) };
      if (dependency === './testCaseVersion.service') return {
        assertExpectedRevision: async (_, expected) => { if (expected !== undefined && expected !== state.revision) throw Object.assign(new Error('Stale revision'), { statusCode: 409 }); },
        capture: async data => { state.versions.push(clone(data)); state.revision++; },
        buildSnapshot: async row => ({ ...row, steps: [{ action: 'Pay' }] })
      };
      return {};
    }
  });
  return { service, state };
}

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
