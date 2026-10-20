const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { dependencyName } = require('../../../platform/backend/test/helpers/sourceFile');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function fixture({ appKind = 'web', row = null } = {}) {
  const state = { row: clone(row), steps: [], revision: 1, versions: [] };
  const db = {
    transaction: callback => async (...args) => {
      if (state.beforeTransaction) { const commit = state.beforeTransaction; state.beforeTransaction = null; commit(); }
      const before = clone(state);
      try { return await callback(...args); }
      catch (error) { Object.assign(state, before); throw error; }
    },
    prepare: statement => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      return {
        get: async id => {
          if (/FROM app_types/.test(sql)) return { id: 'app', project_id: 'project', type: appKind };
          if (/FROM users/.test(sql)) return { id, name: 'Author' };
          if (/FROM project_members/.test(sql)) return { user_id: 'author' };
          if (/FROM test_cases/.test(sql)) return clone(state.row);
          return null;
        },
        all: async () => /FROM test_steps/.test(sql) ? clone(state.steps) : [],
        run: async (...args) => {
          if (/^INSERT INTO test_cases \(/.test(sql)) {
            const fields = sql.match(/^INSERT INTO test_cases \(([^)]+)\)/)[1].split(',').map(value => value.trim());
            assert.equal((sql.match(/\?/g) || []).length, args.length);
            state.row = Object.fromEntries(args.map((value, index) => [fields[index], clone(value)]));
          } else if (/^UPDATE test_cases SET app_type_id/.test(sql)) {
            const fields = sql.match(/ SET (.+) WHERE id = \?/)[1].split(',').filter(value => value.includes('?')).map(value => value.split('=')[0].trim());
            assert.equal(fields.length + 1, args.length);
            fields.forEach((field, index) => { state.row[field] = clone(args[index]); });
          } else if (/^INSERT INTO test_steps \(/.test(sql)) {
            const fields = sql.match(/^INSERT INTO test_steps \(([^)]+)\)/)[1].split(',').map(value => value.trim());
            state.steps.push(Object.fromEntries(args.map((value, index) => [fields[index], clone(value)])));
          } else if (/^DELETE FROM test_steps/.test(sql)) state.steps = [];
          return { changes: 1 };
        }
      };
    }
  };
  const hooksModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../backend/services/caseExecutionHooks.service.js'), 'utf8'), {
    module: hooksModule, require: dependency => dependencyName(dependency) === 'db' ? db : require(dependency)
  });
  const versionsModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../backend/services/testCaseVersion.service.js'), 'utf8'), {
    module: versionsModule, require: dependency => dependencyName(dependency) === 'db' ? db : require(dependency)
  });
  const versions = {
    buildSnapshot: versionsModule.exports.buildSnapshot,
    assertExpectedRevision: async (_, expected) => {
      if (expected !== undefined && expected !== state.revision) throw Object.assign(new Error('Stale revision'), { code: 'REVISION_CONFLICT', statusCode: 409 });
    },
    capture: async input => {
      state.versions.push(await versionsModule.exports.buildSnapshot(input.testCase));
      return { revision: state.revision++ };
    }
  };
  const service = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../backend/services/testCase.service.js'), 'utf8'), {
    exports: service, console,
    require: dependency => {
      const name = dependencyName(dependency);
      if (name === 'db') return db;
      if (dependency === 'crypto') return require('node:crypto');
      if (dependency.includes('/utils/') || name === 'catalog') return require(dependency);
      if (name === 'displayId.service') return { createDisplayId: async kind => kind === 'automation_case' ? 'AT_1' : 'TC_1' };
      if (name === 'dropdownCatalog.service') return { getDefaultValue: async () => 'functional', validateValue: async (_, value) => value };
      if (name === 'mobileFeature.service') return { assertAuthoringMobileFeatureEnabled: async () => {} };
      if (name === 'testCaseVersion.service') return versions;
      if (name === 'caseExecutionHooks.service') return hooksModule.exports;
      return {};
    }
  });
  return { service, state, versions: versionsModule.exports };
}
const createInput = overrides => ({ app_type_id: 'app', title: 'Account journey', created_by: 'author', steps: [], ...overrides });

test('new browser automation requires an explicit literal target and persists the canonical URL', async () => {
  const { service, state } = fixture();
  await service.createTestCase(createInput({ automated: 'no' }));
  assert.equal(state.row.automation_start_url, null);
  for (const target of [undefined, '', 'javascript:alert(1)', 'https://user:secret@example.test', '@t.url']) {
    await assert.rejects(service.createTestCase(createInput({ automated: 'yes', automation_start_url: target })), error => /^AUTOMATION_START_URL_/.test(error.code));
    assert.equal(state.row.automated, 'no', 'Invalid new targets must not create an automation case.');
  }
  const created = await service.createTestCase(createInput({ automated: 'yes', automation_start_url: ' HTTPS://APP.EXAMPLE.TEST/signup ' }));
  assert.equal(created.display_id, 'AT_1');
  assert.equal(state.row.automation_start_url, 'https://app.example.test/signup');
  assert.equal((await service.getTestCase(created.id)).automation_start_url, state.row.automation_start_url);
});

test('the versioned target guard checks the locked row and retains a concurrent target edit', async () => {
  const { service, state } = fixture({ row: { id: 'case', display_id: 'AT_1', app_type_id: 'app', title: 'Reviewed journey', automated: 'yes',
    automation_start_url: 'https://original.example.test/', created_by: 'author', author_id: 'author', review_status: 'not_requested' } });
  state.beforeTransaction = () => { state.row.automation_start_url = 'https://newer-review.example.test/'; };
  await assert.rejects(service.updateTestCase('case', { automation_start_url: 'https://queued-request.example.test/', expected_revision: 1 }, {
    expectedAutomationStartUrl: 'https://original.example.test/'
  }), error => error.code === 'AUTOMATION_START_URL_CHANGED');
  assert.equal(state.row.automation_start_url, 'https://newer-review.example.test/');
  assert.equal(state.revision, 1);
  assert.equal(state.versions.length, 0);
});

test('API and native authoring remain independent; mixed browser sections require their target', async () => {
  for (const appKind of ['api', 'android', 'ios']) {
    const { service, state } = fixture({ appKind });
    await service.createTestCase(createInput({ automated: 'yes' }));
    assert.equal(state.row.automation_start_url, null);
  }
  const { service } = fixture({ appKind: 'unified' });
  await service.createTestCase(createInput({ automated: 'yes', steps: [{ action: 'Call API', step_type: 'api' }] }));
  await assert.rejects(service.createTestCase(createInput({ automated: 'yes', steps: [{ action: 'Open application', step_type: 'web' }] })), error => error.code === 'AUTOMATION_START_URL_REQUIRED');
});

test('target edits are versioned and optimistic; legacy metadata stays editable without target inference', async () => {
  const { service, state, versions } = fixture({ row: {
    id: 'case', display_id: 'AT_1', app_type_id: 'app', title: 'Existing journey', automated: 'yes',
    automation_start_url: null, created_by: 'author', author_id: 'author', review_status: 'not_requested'
  } });
  await service.updateTestCase('case', { title: 'Legacy metadata edit', expected_revision: 1 });
  assert.equal(state.row.automation_start_url, null);
  await assert.rejects(service.updateTestCase('case', { automation_start_url: null }), error => error.code === 'AUTOMATION_START_URL_REQUIRED');
  await service.updateTestCase('case', { automation_start_url: 'https://app.example.test/signup', expected_revision: 2 });
  assert.equal(state.versions.at(-1).automation_start_url, null);
  const saved = clone(state.row);
  await assert.rejects(service.updateTestCase('case', { automation_start_url: 'https://other.example.test', expected_revision: 2 }), error => error.code === 'REVISION_CONFLICT');
  assert.deepEqual(state.row, saved);
  await service.updateTestCase('case', { automation_start_url: 'https://app.example.test/profile', expected_revision: 3 });
  assert.equal(state.versions.at(-1).automation_start_url, 'https://app.example.test/signup');
  assert.match(versions.summarizeChanges(state.versions.at(-1), state.row), /automation start url/);
  // This option is passed by the trusted restore service, never request data.
  await service.updateTestCase('case', { automation_start_url: null, expected_revision: 4 }, { preserveLegacyAutomationStartUrl: true });
  assert.equal(state.row.automation_start_url, null);
  assert.equal(state.versions.at(-1).automation_start_url, 'https://app.example.test/profile');
});
