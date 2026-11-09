import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createPlaywrightCodeBindings } from '../../../../testengine/backend/dist/lib/playwrightBindings.js';

const file = new URL('../../backend/services/aiAutomationBuilder.service.js', import.meta.url), require = createRequire(file);
const { chromium } = require('../../../../testengine/backend/node_modules/playwright');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const source = await readFile(file, 'utf8'), database = { prepare: () => ({ all: async () => [], get: async () => null, run: async () => ({ changes: 1 }) }) };
const hostModule = { exports: {} };
new Function('require', 'module', 'exports', `${source}\nmodule.exports={buildRecorderStepCandidates,buildRecorderStepCandidate,createRecorderAutomationCode,buildFallbackRecorderMappings};`)(id => {
  if (id.endsWith('/db') || id.endsWith('/obsDb')) return database;
  if (id === 'crypto' || id.endsWith('/testStepAutomation') || id.endsWith('/automationRecorderActions') || id.endsWith('/automationBrowserParameters')) return require(id);
  return {};
}, hostModule, hostModule.exports);
const host = hostModule.exports;

test('a newly recorded plan replays with observed locators when optional repository learning fails', { timeout: 30000 }, async t => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><label>Name<input id="name"></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Save</button><output></output>');
  });
  server.listen(0, '127.0.0.1');await once(server, 'listening');t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, testCase = { id: 'case', project_id: 'project', app_type_id: 'app', automated: 'yes', automation_status: 'ready', title: 'Observed flow' };
  const actions = [{ index: 1, type: 'navigation', url: origin }, { index: 2, type: 'fill', locator: 'getByLabel("Name")', value: 'Recorded name' }, { index: 3, type: 'click', locator: 'getByRole("button", { name: "Save" })' }];
  let rows = [];
  const dependencies = {
    selectStepsForCase: { all: async () => rows }, selectCaseWithScope: { get: async () => testCase },
    loadAutomationParameterContext: async () => ({ runtime_parameter_values: {}, private_parameter_names: [] }),
    require: id => id.endsWith('automationBrowserParameters') ? { loadBrowserParameterResolver: async () => createBrowserParameterResolver({}) } : require(id),
    buildRecorderRepositoryModel: async input => {
      assert.equal(input.allowAiNaming, false);
      return { byActionIndex: new Map([[2, { reference: 'Unpersisted.Name', field_name: 'Name', locator: actions[1].locator }], [3, { reference: 'Unpersisted.Save', field_name: 'Save', locator: actions[2].locator }]]) };
    },
    ...host, inferAutomationStepType: require('../../../platform/backend/src/utils/testStepAutomation').inferAutomationStepType,
    normalizeGeneratedProgram: require('../../backend/lib/automationGeneratedProgram').normalizeGeneratedProgram,
    appendEvent: async () => {}, applyRecorderSteps: async ({ stepCandidates }) => {
      rows = stepCandidates.map((candidate, index) => ({ ...candidate, id: `step-${index}`, step_id: `step-${index}`, operation: 'created' }));return rows;
    },
    markTestCaseAutomationIncomplete: { run: async () => {} }, markTestCaseAutomationReady: { run: async () => {} },
    persistLearning: async () => { throw new Error('Repository storage is temporarily unavailable'); }, updateTransaction: async () => {}, normalizeText: value => value
  };
  const body = source.slice(source.indexOf('const finalizeRecorderBuild ='), source.indexOf('exports.buildAutomationForCase ='));
  const finalize = new Function(...Object.keys(dependencies), body + '\nreturn finalizeRecorderBuild;')(...Object.values(dependencies));
  const result = await finalize({ testCase, session: { id: 'recording' }, createdBy: 'user', capturedActions: actions, capturedNetwork: [] });
  assert.equal(result.generated_step_count, 3);assert.equal(result.automation_status, 'ready');
  assert.ok(result.warnings.some(message => /repository learning/.test(message)));
  const executable = rows.map(row => row.automation_code).join('\n');
  assert.doesNotMatch(executable, /Unpersisted\./);
  assert.match(executable, /page\.getByLabel/);assert.match(executable, /page\.getByRole/);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });t.after(() => browser.close());
  const page = await browser.newPage(), bindings = createPlaywrightCodeBindings(page, { interpolate: value => value, resolveLocator: value => value, resolveUrl: value => value });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('page', executable)(bindings.page);
  assert.equal(await page.locator('output').textContent(), 'Recorded name');
});
