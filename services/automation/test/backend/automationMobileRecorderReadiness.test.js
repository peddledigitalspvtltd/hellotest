const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { parse } = require('acorn');
const file = require.resolve('../../backend/services/builder/recorderImport');
const source = fs.readFileSync(file, 'utf8');
let callback;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && (node.callee.name === 'persistMobileRecorderPlan' || node.callee.property?.name === 'persistMobileRecorderPlan')) {
    callback = node.arguments[1].properties.find(property => property.key.name === 'updateCaseReadiness')?.value;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(parse(source, { ecmaVersion: 'latest', sourceType: 'script' }));
assert.ok(callback, 'Exercise the production mobile recorder readiness callback.');

async function applyReadiness(steps) {
  const marks = [], reads = [];
  const run = new Function('selectStepsForCase', 'markTestCaseAutomationIncomplete', 'markTestCaseAutomationReady', 'normalizeText', 'created_by', 'require',
    `const ports={selectStepsForCase,markTestCaseAutomationIncomplete,markTestCaseAutomationReady,normalizeText}; let mobileReadinessIssues = []; return ${source.slice(callback.start, callback.end)};`)(
    { all: async id => { reads.push(id); return steps; } },
    { run: async id => { marks.push({ state: 'incomplete', id }); } },
    { run: async (user, id) => { marks.push({ state: 'ready', user, id }); } },
    value => String(value || '').trim(), 'author', createRequire(file));
  await run('mixed-case');
  assert.deepEqual(reads, ['mixed-case']);
  return marks;
}

const native = { id: 'native', step_order: 2, step_type: 'ios', automation_code: 'await ios.tap("~Save");' };

test('recording one native section cannot mark an unmapped web or API section ready', async () => {
  for (const other of [
    { id: 'web', step_order: 1, step_type: 'web', automation_code: '' },
    { id: 'api', step_order: 1, step_type: 'api', api_request: null }
  ]) assert.deepEqual(await applyReadiness([other, native]), [{ state: 'incomplete', id: 'mixed-case' }]);
});

test('a complete mixed plan retains recorder readiness without inventing assertions from manual prose', async () => {
  const web = { id: 'web', step_order: 1, step_type: 'web', automation_code: 'await page.locator("#open").click();', expected_result: 'Manual specification retained' };
  assert.deepEqual(await applyReadiness([web, native]), [{ state: 'ready', user: 'author', id: 'mixed-case' }]);
});
