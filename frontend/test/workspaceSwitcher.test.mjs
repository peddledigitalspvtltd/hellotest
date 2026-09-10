import assert from "node:assert/strict";
import test from "node:test";
import { applicationsForWorkspace, availableWorkspaceProjects, filterWorkspaceOptions, workspaceMenuPosition } from "../src/lib/workspaceSwitcher.ts";

test("application options reject another project's cached results without changing source data", () => {
  const first = { id: "web", project_id: "one", name: "Storefront", type: "web" };
  const second = { id: "api", project_id: "two", name: "Payments", type: "api" };
  const catalog = Object.freeze([first, second, first, null, { id: "unscoped", name: "Unsafe" }]);
  assert.deepEqual(applicationsForWorkspace("one", catalog), [first]);
  assert.deepEqual(applicationsForWorkspace("two", catalog), [second]);
  assert.deepEqual(applicationsForWorkspace("", catalog), []);
  assert.deepEqual(applicationsForWorkspace("one", undefined), []);
  assert.deepEqual(applicationsForWorkspace("one", { items: catalog }), []);
  assert.equal(catalog.length, 5);
});

test("project options exclude denied and duplicate projects; search matches names and accents", () => {
  const catalog = [{ id: "1", name: "Café checkout" }, { id: "2", name: "Private", has_access: false }, { id: "1", name: "Duplicate" }, { id: "3", name: "Mobile" }];
  assert.deepEqual(availableWorkspaceProjects(catalog).map(item => item.id), ["1", "3"]);
  assert.deepEqual(filterWorkspaceOptions(availableWorkspaceProjects(catalog), " CAFÉ ").map(item => item.id), ["1"]);
  assert.deepEqual(filterWorkspaceOptions(availableWorkspaceProjects(catalog), "cafe").map(item => item.id), ["1"]);
  assert.deepEqual(filterWorkspaceOptions(catalog, "unknown"), []);
});

for (const collapsed of [false, true]) {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 220 }, { width: 1440, height: 900 }, { width: 280, height: 200, left: 20, top: 80 }]) {
    test(`menu remains within the visual viewport ${JSON.stringify(viewport)}, collapsed=${collapsed}`, () => {
      const anchor = { left: 20, right: 250, width: 230, top: viewport.height - 80, bottom: viewport.height - 32 };
      const result = workspaceMenuPosition(anchor, viewport, collapsed);
      assert.ok(result.left >= (viewport.left || 0) + 8);
      assert.ok(result.top >= (viewport.top || 0) + 8);
      assert.ok(result.left + result.width <= (viewport.left || 0) + viewport.width - 8);
      assert.ok(result.top + result.maxHeight <= (viewport.top || 0) + viewport.height - 8);
      assert.ok(result.maxHeight >= 0);
    });
  }
}
