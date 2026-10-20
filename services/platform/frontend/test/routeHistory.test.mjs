import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTsModule } from './helpers/loadTsModule.mjs';

function fixture() {
  const values = new Map();
  const sessionStorage = { getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
  return { values, ...loadTsModule(fileURLToPath(new URL('../src/platform/lib/routeHistory.ts',import.meta.url)), {window:{sessionStorage}}) };
}

test('post-auth navigation excludes login, signup and legacy auth destinations without losing workspace query/hash',()=>{
  const view=fixture();
  for(const route of ['/login','/login/?return=1','/signup#details','/auth?old=1','/auth/session','//other.test/path','/\\other.test/path']) {
    assert.equal(view.isRestorableWorkspaceRoute(route),false,route);
    view.rememberCurrentWorkspaceRoute(route);view.rememberAuthRedirectRoute(route);
    assert.equal(view.readPostAuthRoute(),'/');
  }
  const destination='/executions?view=scheduled-runs#next';
  view.rememberAuthRedirectRoute(destination);
  assert.equal(view.readPostAuthRoute(),destination);
  assert.equal(view.getPostAuthRoute(),destination);
  assert.equal(view.readAuthRedirectRoute(),'');
  view.rememberCurrentWorkspaceRoute('/automation?case_id=AT-1');
  assert.equal(view.readPostAuthRoute(),'/automation?case_id=AT-1');
});

test('stale auth destinations in storage never create an authentication redirect loop',()=>{
  const view=fixture();
  view.values.set('hellotest.auth_redirect_route','/signup');
  view.values.set('hellotest.current_workspace_route','/login');
  assert.equal(view.getPostAuthRoute(),'/');
  assert.equal(view.readPostAuthRoute(),'/');
});
