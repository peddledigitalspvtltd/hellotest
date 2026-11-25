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
const { AutomationBuildVerificationSettings } = load('../../frontend/components/AutomationBuildVerificationSettings.tsx', name =>
 name === '../lib/automationBuildPipeline' ? pipeline : frontendRequire(name));
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

test('Automation Engineer requests CLI verification with MCP authoring and respects execution permissions', () => {
 const options = { mode: 'verify_repair_cli', driver: 'mcp', canVerify: true, interactive: true };
 const request = pipeline.automationBuildPipelineRequest(options);
 assert.equal(request.verification_mode, 'verify_repair');
 assert.equal(request.verification_driver, 'playwright_test_cli');
 assert.equal(request.browser_driver, 'mcp');
 for (const overrides of [{ canVerify: false }, { interactive: false }]) {
  const guarded = pipeline.automationBuildPipelineRequest({ ...options, mode: 'verify_cli', ...overrides });
  assert.equal(guarded.verification_mode, 'generate_only');
  assert.equal(guarded.verification_driver, 'native');
 }
});

test('automatic verification follows the selected environment until the user chooses another mode', () => {
 const options = { mode: 'auto', driver: 'mcp', canVerify: true, interactive: true };
 assert.equal(pipeline.automationBuildPipelineRequest(options).verification_mode, 'generate_only');
 assert.equal(pipeline.automationBuildPipelineRequest({ ...options, hasEnvironment: true }).verification_mode, 'verify');
 assert.equal(pipeline.automationBuildPipelineRequest({ ...options, hasEnvironment: true, mode: 'generate_only' }).verification_mode, 'generate_only');
 assert.equal(pipeline.automationBuildPipelineRequest({ ...options, hasEnvironment: true, interactive: false }).verification_mode, 'generate_only');
});
