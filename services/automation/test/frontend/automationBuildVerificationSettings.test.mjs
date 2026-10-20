import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from '../../../platform/frontend/node_modules/typescript/lib/typescript.js';

const frontendRequire = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const { Children } = frontendRequire('react');
function load(file, resolve = frontendRequire) {
 const exports = {};
 const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
 new Function('require', 'exports', compiled)(resolve, exports);
 return exports;
}
const pipeline = load('../../frontend/lib/automationBuildPipeline.ts');
const { AutomationBuildVerificationSettings } = load('../../frontend/components/AutomationBuildVerificationSettings.tsx');
const settings = extra => ({ mode: 'generate_only', canVerify: true, interactive: true, onModeChange: () => {}, ...extra });

test('existing verification select offers CLI run and bounded repair with explicit execution disclosure', () => {
 const tree = AutomationBuildVerificationSettings(settings({ mode: 'verify_cli' }));
 const markup = renderToStaticMarkup(tree);
 assert.match(markup, /Run with Playwright Test CLI/);
 assert.match(markup, /Run CLI \+ bounded locator repair/);
 assert.match(markup, /through Playwright Test CLI/);
 assert.match(markup, /This performs application actions again/);
 assert.doesNotMatch(markup, /After generating · Playwright MCP|npx|shell command/);
 const repairMarkup = renderToStaticMarkup(AutomationBuildVerificationSettings(settings({ mode: 'verify_repair_cli' })));
 assert.match(repairMarkup, /One observed locator correction/);
 assert.match(repairMarkup, /Data, actions and expected results stay fixed/);
});

test('verification settings disable every run choice without permissions or interactive mode', () => {
 for (const extra of [{ canVerify: false }, { interactive: false }]) {
  const tree = AutomationBuildVerificationSettings(settings({ mode: 'verify_cli', ...extra }));
  const select = Children.toArray(tree.props.children).find(child => child.type === 'select');
  assert.equal(select.props.value, 'generate_only');
  for (const option of Children.toArray(select.props.children)) if (option.props.value !== 'generate_only') assert.equal(option.props.disabled, true);
  assert.match(renderToStaticMarkup(tree), /Saved instructions remain unverified/);
 }
});

test('selecting CLI bounded repair passes its exact choice through the existing change handler', () => {
 let selected;
 const tree = AutomationBuildVerificationSettings(settings({ onModeChange: value => { selected = value; } }));
 const select = Children.toArray(tree.props.children).find(child => child.type === 'select');
 select.props.onChange({ target: { value: 'verify_repair_cli' } });
 assert.equal(selected, 'verify_repair_cli');
});

function agentFixture({ choice, canVerify = true, interactive = true }) {
 let mutation;
 const queued = [];
 const dependencies = {
  react: { useEffect: () => {}, useRef: value => ({ current: value }), useState: value => [value === 'generate_only' ? choice : value, () => {}] },
  '@tanstack/react-query': { useMutation: options => { mutation = options.mutationFn; return { isPending: false, isError: false, mutate: () => {} }; }, useQueryClient: () => ({ invalidateQueries: async () => {} }) },
  '@hellotest/testing/frontend/api.client': { testingApi: { testCases: { buildAutomationBatch: async value => { queued.push(value); return { transaction_id: 'queued' }; } } } },
  '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess': { useCapabilityAccess: () => ({ can: permission => !['automation.run.local', 'run.create'].includes(permission) || canVerify }) },
  '@hellotest/platform/frontend/src/platform/components/AppIcons': { PlayIcon: () => null },
  './AutomationAgentActivity': { AutomationAgentActivity: () => null },
  './AutomationBuildVerificationSettings': { AutomationBuildVerificationSettings },
  '../lib/automationBuildPipeline': pipeline,
  './AgentAutomationBuildAction.css': {}
 };
 const { AgentAutomationBuildAction } = load('../../frontend/components/AgentAutomationBuildAction.tsx', name => Object.hasOwn(dependencies, name) ? dependencies[name] : frontendRequire(name));
 AgentAutomationBuildAction({ projectId: 'project', appTypeId: 'web', caseId: 'case', prompt: 'Use reviewed inputs', context: { mode: 'minimal' }, allowBrowserActions: interactive });
 return { queued, submit: () => mutation() };
}

test('Agent Studio build action emits CLI verification with MCP authoring and frozen user input scope', async () => {
 const fixture = agentFixture({ choice: 'verify_repair_cli' });
 await fixture.submit();
 assert.equal(fixture.queued.length, 1);
 assert.equal(fixture.queued[0].verification_mode, 'verify_repair');
 assert.equal(fixture.queued[0].verification_driver, 'playwright_test_cli');
 assert.equal(fixture.queued[0].browser_driver, 'mcp');
 assert.deepEqual(fixture.queued[0].test_case_ids, ['case']);
 assert.equal(fixture.queued[0].additional_context, 'Use reviewed inputs');
 for (const overrides of [{ canVerify: false }, { interactive: false }]) {
  const guarded = agentFixture({ choice: 'verify_cli', ...overrides });
  await guarded.submit();
  assert.equal(guarded.queued[0].verification_mode, 'generate_only');
  assert.equal(guarded.queued[0].verification_driver, 'native');
 }
});
