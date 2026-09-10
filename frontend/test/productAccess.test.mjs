import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as permissions from '../src/lib/permissions.ts';

const load = (file, resolve = () => ({})) => {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(resolve, exports);
  return exports;
};
const features = load('../src/lib/featureFlags.ts', () => permissions);
const session = { user: { id: 'member', role: 'member', workspace_permissions: ['workspace.view'], project_permissions: { a: ['agentic_workflow.view', 'automation.view'], b: [] }, permissions: ['agentic_workflow.view', 'automation.view', 'feature_flag.manage'] } };

test('workspace and project authority cannot leak through aggregate or legacy role metadata', () => {
  assert.equal(permissions.hasPermission(session, 'agentic_workflow.view', 'a'), true);
  assert.equal(permissions.hasPermission(session, 'agentic_workflow.view', 'b'), false);
  assert.equal(permissions.hasPermission(session, 'feature_flag.manage', 'a'), false);
  assert.equal(permissions.hasPermission({ user: { ...session.user, project_permissions: undefined } }, 'agentic_workflow.view', 'a'), false);
  assert.equal(permissions.hasPermission({ user: { ...session.user, workspace_permissions: undefined } }, 'feature_flag.manage'), false);
  assert.equal(permissions.hasPermission({ user: { ...session.user, role_id: 'jira-admin' } }, 'feature_flag.manage'), false);
  assert.equal(permissions.hasPermission({ user: { ...session.user, role: 'admin', status: 'suspended' } }, 'feature_flag.manage'), false);
  assert.equal(permissions.hasPermission({ user: { ...session.user, role: 'admin' } }, 'feature_flag.manage'), true);
});

test('deep links and trailing slashes retain the same permission and feature boundary', () => {
  assert.equal(permissions.canAccessPath(session, '/agentic-workflows/?agent=test-designer#result', undefined, 'a'), true);
  assert.equal(permissions.canAccessPath(session, '/agentic-workflows/?agent=test-designer', undefined, 'b'), false);
  assert.deepEqual(features.requiredFeatureFlagsForPath('/object-repository/?item=a#evidence'), ['hellotest.automation.workspace', 'hellotest.automation.object_repository']);
  assert.equal(permissions.canAccessPath(session, '/new-unregistered-page', undefined, 'a'), false);
  assert.equal(permissions.canAccessPath(session, '/agentic-workflows', { '/agentic-workflows': [] }, 'a'), false);
  assert.equal(permissions.canAccessPath(session, '/local-playwright', undefined, 'a'), true);
});

test('unavailable and malformed flag snapshots never expose guarded capabilities', () => {
  const keys = ['hellotest.ai.agentic_workflows'];
  for (const snapshot of [null, undefined, {}, { flags: null }, { flags: [] }, { flags: {} }, { flags: { [keys[0]]: 'true' } }]) {
    assert.equal(features.areFeatureFlagsEnabled(snapshot, keys), false);
  }
  assert.equal(features.areFeatureFlagsEnabled({ flags: { [keys[0]]: true } }, keys), true);
  assert.equal(features.areFeatureFlagsEnabled(null, []), true);
});

test('feature publication includes only edits and preserves enabled children while their parent is off', () => {
  const original = { workspace: true, repository: true, agent: false };
  assert.deepEqual(features.createFeatureFlagPatch(original, { ...original, workspace: false }), { workspace: false });
  assert.deepEqual(features.createFeatureFlagPatch(original, { ...original, unknown: true }), {});
  const local = { ...original, workspace: false };
  assert.deepEqual(features.effectiveFeatureFlags(local, { repository: ['workspace'] }), { workspace: false, repository: false, agent: false });
  assert.equal(local.repository, true);
});

test('workspace flag loading remains enabled before first project and propagates cancellation', async () => {
  let options;
  const api = { featureFlags: { snapshot: async (input) => { options = input; return { flags: {} }; } } };
  const { useFeatureFlags } = load('../src/hooks/useFeatureFlags.ts', (name) => {
    if (name === '@tanstack/react-query') return { useQuery: (input) => input };
    if (name.endsWith('/api')) return { api };
    if (name.endsWith('/queryKeys')) return { queryKeys: { featureFlags: (id) => ['feature-flags', id] } };
    if (name === './useCurrentProject') return { useCurrentProject: () => [''] };
    throw new Error(`Unexpected dependency: ${name}`);
  });
  const query = useFeatureFlags(true);
  assert.equal(query.enabled, true);
  const controller = new AbortController();
  await query.queryFn({ signal: controller.signal });
  assert.equal(options.signal, controller.signal);
  assert.equal(options.fresh, true);
  assert.equal(useFeatureFlags(false).enabled, false);
});
