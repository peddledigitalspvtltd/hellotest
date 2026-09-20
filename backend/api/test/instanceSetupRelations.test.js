const assert = require('node:assert/strict');
const test = require('node:test');
const repository = require('../src/services/sampleData/repository');
const { createRelationValidator } = require('../src/services/sampleData/relations');

const authored = {
  projects: [{ id: 'sample-project', name: 'Authored name' }],
  app_types: [{ id: 'app', project_id: 'sample-project' }],
  test_cases: [{ id: 'case', app_type_id: 'app', title: 'Authored case' }],
  test_steps: [{ id: 'step', test_case_id: 'case', action: 'Authored action' }],
  requirement_iterations: [{ id: 'sprint', project_id: 'sample-project' }],
  requirement_releases: [{ id: 'release', project_id: 'sample-project', sprint_ids: ['sprint'] }]
};
const copied = value => JSON.parse(JSON.stringify(value));
const fixture = (changes = {}, planned = authored) => {
  const saved = { ...copied(planned), ...copied(changes) };
  const files = Object.keys(planned).map(table => ({ key: table, table, path: `${table}.json`, keys: ['id'] }));
  const queries = [];
  const db = { prepare(sql) { return { async all(...params) {
    queries.push({ sql, params });
    const table = /FROM "([a-z_]+)"/.exec(sql)[1];
    if (sql.includes('WHERE id IN')) return (saved[table] || []).filter(row => params.includes(row.id));
    const keys = [...new Set([...sql.matchAll(/"([a-z_]+)" = \?/g)].map(match => match[1]))];
    return (saved[table] || []).filter(row => {
      for (let offset = 0; offset < params.length; offset += keys.length) if (keys.every((key, index) => row[key] === params[offset + index])) return true;
      return false;
    });
  } }; } };
  const validate = createRelationValidator({ db, repository: { ...repository, loadFile: (_dataset, file) => copied(planned[file.table]) } });
  const input = { dataset: { manifest: { project_id: 'sample-project' } }, files, actorId: 'admin', mode: 'saved' };
  return { validate, input, saved, queries };
};
const foreign = {
  projects: [...authored.projects, { id: 'foreign-project' }],
  app_types: [...authored.app_types, { id: 'foreign-app', project_id: 'foreign-project' }],
  test_cases: [...authored.test_cases, { id: 'foreign-case', app_type_id: 'foreign-app' }]
};

test('planned setup validates a complete graph before any rows exist', async () => {
  const f = fixture(Object.fromEntries(Object.keys(authored).map(table => [table, []])));
  const result = await f.validate({ ...f.input, mode: 'planned' });
  assert.equal(result.records, 6);
  assert.ok(result.references >= 5);
  await assert.rejects(f.validate(f.input), { code: 'SETUP_RELATION_MISSING' });
});

test('existing indirect step ownership cannot escape the setup project', async () => {
  const f = fixture({ ...foreign, test_steps: [{ id: 'step', test_case_id: 'foreign-case' }] });
  for (const mode of ['planned', 'saved']) await assert.rejects(f.validate({ ...f.input, mode }), error => {
    assert.equal(error.code, 'SETUP_SCOPE_CONFLICT');
    assert.equal(error.file, 'test_steps.json');
    assert.match(error.publicMessage, /Existing data was retained/);
    return true;
  });
});

test('user-edited names, statuses, sprint links and mixed-app references within a project remain valid', async () => {
  const f = fixture({
    projects: [{ id: 'sample-project', name: 'Customized project' }],
    app_types: [...authored.app_types, { id: 'second-app', project_id: 'sample-project' }],
    test_cases: [...authored.test_cases, { id: 'second-case', app_type_id: 'second-app' }],
    requirement_iterations: [...authored.requirement_iterations, { id: 'custom-sprint', project_id: 'sample-project', state: 'completed' }],
    requirement_releases: [{ id: 'release', project_id: 'sample-project', name: 'Custom release', sprint_ids: ['custom-sprint'], metadata: { linked_test_case_ids: ['second-case'] } }]
  });
  await f.validate(f.input);
  await f.validate({ ...f.input, mode: 'planned' });
  assert.equal(f.saved.projects[0].name, 'Customized project');
});

test('release sprint arrays reject missing or foreign native Sprint references', async () => {
  const missing = fixture({ requirement_releases: [{ id: 'release', project_id: 'sample-project', sprint_ids: ['missing-sprint'] }] });
  await assert.rejects(missing.validate(missing.input), { code: 'SETUP_RELATION_MISSING', file: 'requirement_releases.json' });
  const crossProject = fixture({ ...foreign,
    requirement_iterations: [...authored.requirement_iterations, { id: 'foreign-sprint', project_id: 'foreign-project' }],
    requirement_releases: [{ id: 'release', project_id: 'sample-project', sprint_ids: ['foreign-sprint'] }]
  });
  await assert.rejects(crossProject.validate(crossProject.input), { code: 'SETUP_SCOPE_CONFLICT', file: 'requirement_releases.json' });
});

test('typed snapshot references are validated inside nested objects and encoded JSON', async () => {
  for (const snapshot of [
    { levels: [{ test_case_id: 'foreign-case' }] },
    JSON.stringify({ levels: [{ test_case_id: 'foreign-case' }] })
  ]) {
    const f = fixture({ ...foreign, test_steps: [{ ...authored.test_steps[0], snapshot }] });
    await assert.rejects(f.validate(f.input), { code: 'SETUP_SCOPE_CONFLICT', file: 'test_steps.json' });
  }
  const dangling = fixture({ test_steps: [{ ...authored.test_steps[0], snapshot: { linked_test_case_ids: ['missing-case'] } }] });
  await assert.rejects(dangling.validate(dangling.input), { code: 'SETUP_RELATION_MISSING' });
});

test('step-level Defect maps verify both native step and Defect references', async () => {
  const f = fixture({ feedback: [{ id: 'defect', project_id: 'sample-project' }],
    test_steps: [{ ...authored.test_steps[0], metadata: { step_defects: { step: ['defect'] } } }]
  });
  await f.validate(f.input);
  f.saved.feedback[0].project_id = 'foreign-project';
  f.saved.projects.push({ id: 'foreign-project' });
  await assert.rejects(f.validate(f.input), { code: 'SETUP_SCOPE_CONFLICT', file: 'test_steps.json' });
});

test('arbitrary parameter columns and JSON examples do not become domain references', async () => {
  const f = fixture({ test_cases: [{ ...authored.test_cases[0],
    parameter_values: { project_id: 'customer-supplied-value', source_id: 42 },
    description: '{"test_case_id":"documentation-example"}',
    snapshot: { rows: [{ project_id: 'row-value' }], columns: ['project_id'] }
  }] });
  await f.validate(f.input);
});

test('repeated references reuse bounded table batches rather than one query per field', async () => {
  const f = fixture({
    test_cases: [...authored.test_cases, { id: 'external-case', app_type_id: 'app' }],
    requirement_releases: [{ ...authored.requirement_releases[0], metadata: { linked_test_case_ids: Array(250).fill('external-case') } }]
  });
  const result = await f.validate(f.input);
  assert.ok(result.references > 250);
  const externalQueries = f.queries.filter(query => query.sql.includes('WHERE id IN'));
  assert.equal(externalQueries.length, 1);
  assert.deepEqual(externalQueries[0].params, ['external-case']);
});

test('composite relationship rows inherit their related objects project scope', async () => {
  const planned = { ...authored, requirement_test_cases: [{ requirement_id: 'story', test_case_id: 'case' }], requirements: [{ id: 'story', project_id: 'sample-project' }] };
  const f = fixture({}, planned);
  f.input.files.find(file => file.table === 'requirement_test_cases').keys = ['requirement_id', 'test_case_id'];
  await f.validate(f.input);
  f.saved.requirements[0].project_id = 'foreign-project';
  f.saved.projects.push({ id: 'foreign-project' });
  await assert.rejects(f.validate(f.input), { code: 'SETUP_SCOPE_CONFLICT' });
});

test('abort stops relationship validation before further database reads', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.validate({ ...f.input, signal: controller.signal }), { code: 'SETUP_INTERRUPTED', retryable: true });
  assert.equal(f.queries.length, 0);
});
