import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_ROUTES,
  WORKSPACE_ROUTE_PATHS,
  routePath,
  workspaceChildPath
} from "../src/lib/workspaceRoutes.ts";
import { asArray } from "../src/lib/collectionGuards.ts";

test("unavailable query collections keep a stable identity across renders", () => {
  const firstFallback = asArray(undefined);
  const secondFallback = asArray(undefined);
  const nullFallback = asArray(null);

  assert.equal(firstFallback, secondFallback);
  assert.equal(firstFallback, nullFallback);
  assert.deepEqual(firstFallback, []);

  const populated = [{ id: "case-1" }];
  assert.equal(asArray(populated), populated);
});

test("workspace route registry has unique, normalized paths", () => {
  const routes = Object.values(WORKSPACE_ROUTES);

  assert.equal(WORKSPACE_ROUTE_PATHS.size, routes.length);
  routes.forEach((route) => {
    assert.equal(routePath(route), route);
    assert.ok(route.startsWith("/"));
    assert.equal(route.includes("?"), false);
    assert.equal(route.includes("#"), false);
  });
});

test("every registered page resolves as a child route and can be revisited in arbitrary order", () => {
  const routes = Object.values(WORKSPACE_ROUTES);
  const transitionOrders = [
    routes,
    [...routes].reverse(),
    [...routes.filter((_, index) => index % 2 === 0), ...routes.filter((_, index) => index % 2 === 1)],
    [...routes].sort((left, right) => left.length - right.length || left.localeCompare(right))
  ];

  for (const order of transitionOrders) {
    let currentRoute = WORKSPACE_ROUTES.home;
    for (const nextRoute of [...order, ...order]) {
      currentRoute = nextRoute;
      assert.equal(routePath(currentRoute), nextRoute);
      const childPath = workspaceChildPath(nextRoute);
      assert.equal(childPath ? `/${childPath}` : "/", nextRoute);
    }
  }
});

test("query-backed sidebar subpages retain one canonical page path", () => {
  assert.equal(routePath(`${WORKSPACE_ROUTES.executions}?view=suite-runs`), WORKSPACE_ROUTES.executions);
  assert.equal(routePath(`${WORKSPACE_ROUTES.agenticWorkflows}?view=runs`), WORKSPACE_ROUTES.agenticWorkflows);
  assert.equal(routePath(`${WORKSPACE_ROUTES.home}?view=custom#dashboard`), WORKSPACE_ROUTES.home);
});
