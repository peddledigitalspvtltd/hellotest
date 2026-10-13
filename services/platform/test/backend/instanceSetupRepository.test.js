const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const repository = require('../../backend/services/sampleData/repository');

const envKey = 'HELLOTEST_INSTANCE_SETUP_DATA_DIR';
const authoredAt = '2026-09-21T09:00:00.000Z';
const staticRoot = path.resolve(__dirname, '../../backend/instance-setup-data');
const digest = value => createHash('sha256').update(value).digest('hex');
const moduleSpec = (key, depends_on = []) => ({ key, label: key, group: 'Fixture', description: key, depends_on, features: [], routes: [], feature_keys: [] });

function withRoot(root, callback) {
  const previous = process.env[envKey];
  process.env[envKey] = root;
  try { return callback(); }
  finally {
    if (previous === undefined) delete process.env[envKey];
    else process.env[envKey] = previous;
  }
}

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-setup-repository-'));
  const manifest = {
    schema_version: 1, dataset_id: 'test-instance', version: 5, project_id: 'fixture-project', authored_at: authoredAt,
    modules: [moduleSpec('workspace'), moduleSpec('planning', ['workspace'])], files: []
  };
  const writeManifest = () => fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const writeRecords = (file, records, schemaVersion = 1) => {
    const raw = JSON.stringify({ schema_version: schemaVersion, records }, null, 2) + '\n';
    const target = path.join(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, raw);
    file.record_count = records.length;
    file.sha256 = digest(raw);
    return file;
  };
  const projects = { key: 'workspace.projects', module: 'workspace', path: 'workspace/projects.json', table: 'projects', keys: ['id'], depends_on: [] };
  const stories = { key: 'planning.requirements', module: 'planning', path: 'planning/requirements.json', table: 'requirements', keys: ['id'], depends_on: [projects.key] };
  const project = { id: 'fixture-project', name: 'Authored fixture', created_by: repository.ACTOR_TOKEN, created_at: authoredAt,
    additional_fields: { owner: repository.ACTOR_TOKEN, by_actor: { [repository.ACTOR_TOKEN]: { roles: ['qa'], owner: repository.ACTOR_TOKEN } } },
    description: `Installer ${repository.ACTOR_TOKEN}: fixed authored text.`,
    metadata: JSON.stringify({ owner: repository.ACTOR_TOKEN, by_actor: { [repository.ACTOR_TOKEN]: { owner: repository.ACTOR_TOKEN } } }) };
  writeRecords(projects, [project]);
  writeRecords(stories, [{ id: 'fixture-story', project_id: project.id, title: 'Saved Story', created_at: authoredAt }]);
  manifest.files = [projects, stories];
  writeManifest();
  try { return withRoot(root, () => callback({ root, manifest, projects, stories, project, writeRecords, writeManifest })); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const failsWith = (operation, code) => assert.throws(operation, error => {
  assert.equal(error.code, code);
  assert.equal(error.retryable, false);
  assert.equal(error.statusCode, 409);
  assert.equal(typeof error.publicMessage, 'string');
  return true;
});

test('repository dataset retains authored dates and IDs while binding actors without mutating files', () => fixture(({ root, project }) => {
  const first = repository.buildRecords('reviewer-one');
  const second = repository.buildRecords('reviewer-two');
  const one = first.workspace[0].values;
  const two = second.workspace[0].values;
  assert.equal(one.id, project.id);
  assert.equal(two.id, project.id);
  assert.equal(one.created_at, authoredAt);
  assert.equal(two.created_at, authoredAt);
  assert.equal(one.created_by, 'reviewer-one');
  assert.equal(two.additional_fields.owner, 'reviewer-two');
  assert.equal(one.additional_fields.by_actor['reviewer-one'].owner, 'reviewer-one');
  assert.equal(JSON.parse(one.metadata).by_actor['reviewer-one'].owner, 'reviewer-one');
  assert.match(one.description, /^Installer reviewer-one:/);
  one.additional_fields.owner = 'changed by caller';
  assert.equal(repository.buildRecords('reviewer-one').workspace[0].values.additional_fields.owner, 'reviewer-one');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'workspace/projects.json'))).records[0].created_by, repository.ACTOR_TOKEN);
}));

test('actor binding preserves encoded JSON and nested keys for arbitrary valid user IDs', () => fixture(() => {
  const actor = 'reviewer"quoted\\identity\nline';
  const row = repository.buildRecords(actor).workspace[0].values;
  assert.equal(row.created_by, actor);
  assert.equal(row.additional_fields.by_actor[actor].owner, actor);
  const metadata = JSON.parse(row.metadata);
  assert.equal(metadata.owner, actor);
  assert.equal(metadata.by_actor[actor].owner, actor);
}));

test('every actual module selection includes the full file and module dependency closure', () => withRoot(staticRoot, () => {
  const dataset = repository.loadManifest();
  assert.equal(dataset.manifest.authored_at, '2026-10-12T09:00:00.000Z');
  assert.equal(dataset.manifest.dataset_id, 'hellotest-instance-v1');
  const all = repository.getInstallPlan();
  assert.equal(all.total_files, dataset.manifest.files.length);
  assert.equal(all.dataset_version, dataset.manifest.version);
  assert.equal(all.manifest_hash, dataset.manifest_hash);
  const modules = new Map(dataset.manifest.modules.map(module => [module.key, module]));
  for (const module of modules.values()) {
    const plan = repository.getInstallPlan([module.key]);
    const included = new Set(plan.files.map(file => file.key));
    for (const selected of plan.selection.installed) for (const dependency of modules.get(selected).depends_on) {
      assert(plan.selection.installed.indexOf(dependency) < plan.selection.installed.indexOf(selected), `${module.key}: parent ${dependency} precedes ${selected}`);
    }
    for (const file of plan.files) {
      assert(plan.selection.installed.includes(file.module));
      for (const dependency of file.depends_on) assert(included.has(dependency), `${module.key}: missing ${dependency}`);
      assert.equal(repository.loadFile(dataset, file, 'static-reviewer').length, file.record_count);
    }
  }
  const presets = repository.getRolePresets(dataset);
  assert(presets.length > 0);
  assert(presets.every(role => role.id === `instance-role-${role.key}`));
  const records = repository.buildRecords('static-reviewer');
  const review = records.design.find(record => record.values.id === 'sample-v5-data-case-review').values;
  assert.equal(review.review_status, 'pending');
  assert.equal(review.reviewer_id, 'static-reviewer');
  const runResult = records.execution.find(record => record.values.id === 'sample-v5-data-result-1').values;
  assert.equal(runResult.lifecycle_history[0].actor_id, 'static-reviewer');
  assert.equal(runResult.started_at, '2026-09-20T08:30:00.000Z');
}));

test('version 6 sample data provides a connected HelloTest delivery and execution walkthrough', () => withRoot(staticRoot, () => {
  const records = Object.values(repository.buildRecords('setup-admin')).flat();
  const values = table => records.filter(record => record.table === table).map(record => record.values);
  const selected = table => values(table).filter(record => Object.values(record).some(value => typeof value === 'string' && value.startsWith('sample-v6-ht-')));
  const sprints = selected('requirement_iterations');
  const releases = selected('requirement_releases');
  const stories = selected('requirements');
  const suites = selected('test_suites');
  const cases = selected('test_cases');
  const groups = selected('shared_step_groups');
  const runs = selected('executions');
  const results = selected('execution_results');
  const defects = selected('feedback');
  assert.ok(repository.loadManifest().manifest.version >= 6);
  assert.equal(sprints.length, 3);
  assert(sprints.every(sprint => sprint.name.length <= 7));
  assert.equal(releases.length, 3);
  assert(releases.every(release => release.name.length <= 7 && /^6\.\d$/.test(release.fix_version)));
  assert.equal(stories.length, 8);
  assert.deepEqual(new Set(stories.map(story => story.priority)), new Set([1, 2, 3, 4, 5]));
  assert(stories.some(story => story.status === 'dev_done'));
  assert(stories.some(story => story.status === 'qa_done'));
  assert(stories.every(story => story.iteration_id && story.release && story.additional_fields.assignee_id === 'setup-admin'));
  assert.equal(selected('requirement_release_items').length, stories.length);
  assert.equal(suites.length, 3);
  assert.equal(groups.length, 3);
  assert.equal(cases.length, 8);
  for (const table of ['requirement_test_cases', 'test_case_module_cases', 'test_case_module_requirements', 'suite_test_cases', 'test_case_data_sets']) assert.equal(selected(table).length, cases.length);
  assert.equal(runs.length, 3);
  assert(runs.every(run => run.test_environment_id && run.test_configuration_id && run.test_data_set_id));
  assert.deepEqual(new Set(results.map(result => result.status)), new Set(['passed', 'failed', 'blocked', 'skipped']));
  assert.equal(defects.length, 6);
  assert.deepEqual(new Set(defects.map(defect => defect.severity)), new Set(['critical', 'high', 'medium', 'low']));
  assert(defects.every(defect => defect.linked_test_run_id && defect.linked_test_case_ids.length && defect.linked_test_suite_ids.length && defect.linked_module_ids.length && defect.linked_requirement_ids.length));
  assert.equal(selected('requirement_defects').length, defects.length);
  assert.equal(selected('test_case_defects').length, defects.length);
}));

test('module selection deduplicates requests and rejects empty or unknown selections', () => fixture(() => {
  const selected = repository.resolveModules(['planning', 'planning']);
  assert.deepEqual(selected.requested, ['planning']);
  assert.deepEqual(selected.installed, ['workspace', 'planning']);
  assert.deepEqual(selected.dependencies_added, ['workspace']);
  for (const request of [[], ['missing'], [null], 'planning']) assert.throws(() => repository.resolveModules(request), error => error.statusCode === 400);
}));

test('an explicitly configured missing dataset cannot silently install the bundled fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-setup-missing-'));
  try { withRoot(root, () => assert.throws(() => repository.loadManifest(), error => /^SETUP_(DATA_MISSING|FILE_UNREADABLE)$/.test(error.code))); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('checksum changes are rejected before returning altered records', () => fixture(({ root, projects }) => {
  const dataset = repository.loadManifest();
  fs.appendFileSync(path.join(root, projects.path), ' ');
  failsWith(() => repository.loadFile(dataset, projects, 'actor'), 'SETUP_CHECKSUM_MISMATCH');
}));

test('missing or invalid JSON files return actionable non-retryable errors', () => fixture(({ root, projects, project, writeRecords }) => {
  const dataset = repository.loadManifest();
  fs.unlinkSync(path.join(root, projects.path));
  failsWith(() => repository.loadFile(dataset, projects), 'SETUP_FILE_UNREADABLE');
  writeRecords(projects, [project]);
  fs.writeFileSync(path.join(root, projects.path), '{broken JSON');
  failsWith(() => repository.loadFile(dataset, projects), 'SETUP_INVALID_JSON');
}));

test('manifest and files reject unsupported shapes and mismatched record counts', () => fixture(({ manifest, projects, project, writeManifest, writeRecords }) => {
  let dataset = repository.loadManifest();
  projects.record_count = 2;
  failsWith(() => repository.loadFile(dataset, projects), 'SETUP_RECORD_COUNT');
  writeRecords(projects, [project], 2);
  failsWith(() => repository.loadFile(dataset, projects), 'SETUP_RECORD_COUNT');
  manifest.schema_version = 42;
  writeManifest();
  failsWith(() => repository.loadManifest(), 'SETUP_MANIFEST_INVALID');
}));

test('null and incorrectly typed manifest sections return structured validation errors', () => fixture(({ root, manifest, writeManifest }) => {
  for (const value of [null, [], 'manifest']) {
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(value));
    failsWith(() => repository.loadManifest(), 'SETUP_MANIFEST_INVALID');
  }
  const module = manifest.modules[0];
  for (const invalid of [null, [], { ...module, key: undefined }, { ...module, depends_on: [7] }, { ...module, features: [null] }]) {
    manifest.modules[0] = invalid;
    writeManifest();
    failsWith(() => repository.loadManifest(), 'SETUP_MANIFEST_INVALID');
  }
  manifest.modules[0] = module;
  const file = manifest.files[0];
  for (const invalid of [null, [], { ...file, key: 7 }, { ...file, table: undefined }, { ...file, keys: [undefined] }, { ...file, keys: ['id', 'id'] }]) {
    manifest.files[0] = invalid;
    writeManifest();
    failsWith(() => repository.loadManifest(), 'SETUP_MANIFEST_INVALID');
  }
}));

test('null file envelopes are rejected without a native TypeError', () => fixture(({ root, projects }) => {
  const dataset = repository.loadManifest();
  for (const value of [null, [], 'records']) {
    const raw = JSON.stringify(value);
    fs.writeFileSync(path.join(root, projects.path), raw);
    failsWith(() => repository.loadFile(dataset, { ...projects, sha256: digest(raw) }), 'SETUP_RECORD_COUNT');
  }
}));

test('role identities and permissions must be nonempty strings', () => fixture(({ manifest, projects, writeManifest, writeRecords }) => {
  projects.kind = 'role_presets';
  const role = { id: 'instance-role-viewer', key: 'viewer', name: 'Viewer', permission_codes: ['workspace.view'] };
  for (const invalid of [
    { ...role, id: 7 }, { ...role, key: [] }, { ...role, name: 7 }, { ...role, name: ' ' },
    { ...role, permission_codes: [] }, { ...role, permission_codes: [null] }, { ...role, permission_codes: [''] }
  ]) {
    writeRecords(projects, [invalid]);
    writeManifest();
    failsWith(() => repository.loadFile(repository.loadManifest(), projects), 'SETUP_ROLE_INVALID');
  }
  writeRecords(projects, [role]);
  writeManifest();
  assert.deepEqual(repository.getRolePresets(repository.loadManifest()), [role]);
}));

test('duplicate identities and invalid SQL column names are rejected', () => fixture(({ projects, project, writeRecords }) => {
  const dataset = repository.loadManifest();
  writeRecords(projects, [project, { ...project, name: 'Duplicate ID' }]);
  failsWith(() => repository.loadFile(dataset, projects), 'SETUP_DUPLICATE_IDENTITY');
  writeRecords(projects, [{ ...project, 'unsafe;column': 'rejected' }]);
  failsWith(() => repository.loadFile(dataset, projects), 'SETUP_RECORD_INVALID');
  writeRecords(projects, [{ ...project, id: null }]);
  failsWith(() => repository.loadFile(dataset, projects), 'SETUP_RECORD_INVALID');
}));

test('module cycles and missing module prerequisites are rejected', () => fixture(({ manifest, writeManifest }) => {
  manifest.modules[0].depends_on = ['planning'];
  writeManifest();
  failsWith(() => repository.loadManifest(), 'SETUP_DEPENDENCY_INVALID');
  manifest.modules[0].depends_on = ['unknown'];
  writeManifest();
  failsWith(() => repository.loadManifest(), 'SETUP_DEPENDENCY_INVALID');
}));

test('file dependency order and duplicates are validated before planning', () => fixture(({ manifest, projects, stories, writeManifest }) => {
  manifest.files = [stories, projects];
  writeManifest();
  failsWith(() => repository.loadManifest(), 'SETUP_MANIFEST_INVALID');
  manifest.files = [projects, { ...projects }];
  writeManifest();
  failsWith(() => repository.loadManifest(), 'SETUP_MANIFEST_INVALID');
}));

test('a file dependency outside the selected module closure cannot be skipped', () => fixture(({ manifest, writeManifest }) => {
  manifest.modules[1].depends_on = [];
  writeManifest();
  failsWith(() => repository.getInstallPlan(['planning']), 'SETUP_DEPENDENCY_INVALID');
}));

test('relative traversal and absolute file paths cannot escape the dataset', () => fixture(({ root, projects }) => {
  const dataset = repository.loadManifest();
  for (const target of ['../outside.json', '..\\outside.json', path.join(root, 'workspace/projects.json')]) {
    failsWith(() => repository.loadFile(dataset, { ...projects, path: target }), 'SETUP_FILE_PATH');
  }
}));

test('symlinked JSON files cannot read outside the dataset directory', () => fixture(({ root, projects }) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-setup-outside-'));
  try {
    const target = path.join(outside, 'outside.json');
    fs.writeFileSync(target, JSON.stringify({ schema_version: 1, records: [{ id: 'external' }] }));
    fs.symlinkSync(target, path.join(root, 'outside-link.json'));
    failsWith(() => repository.loadFile(repository.loadManifest(), { ...projects, path: 'outside-link.json' }), 'SETUP_FILE_PATH');
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
}));

test('schema bootstrap is excluded from the sample installation plan', () => {
  const plan = withRoot(staticRoot, () => repository.getInstallPlan());
  assert.ok(fs.existsSync(path.join(staticRoot, 'schema-setup/schema.sql')));
  assert.equal(fs.existsSync(path.join(staticRoot, 'schema-setup/seed.sql')), false);
  assert.ok(plan.files.every(file => !file.path.includes('schema-setup') && file.path.endsWith('.json')));
  fixture(({ manifest, writeManifest }) => {
    manifest.files[0].path = 'schema-setup/bootstrap.json';
    writeManifest();
    failsWith(() => repository.loadManifest(), 'SETUP_FILE_PATH');
  });
});
