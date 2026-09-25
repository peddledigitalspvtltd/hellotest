import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith(".json")) return { default: JSON.parse(readFileSync(sourceFile(`${name}`, "lib"), "utf8")) };
  const exports = {};
  modules.set(name, exports);
  const source = readFileSync(sourceFile(`${name}.ts`, "lib"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", compiled)(dependency => load(dependency.replace(/^\.\//, "")), exports);
  return exports;
}
const { hasCapability } = load("capabilityAccess");
const { optionalQueryView } = load("optionalQueryView");
const session = {
  user: {
    id: "reporter", role: "member", workspace_permissions: ["workspace.view"],
    project_permissions: { first: ["feedback.create", "feedback.view", "requirement.view"], second: ["requirement.view"] }
  }
};
const snapshot = enabled => ({
  flags: { "hellotest.manual.bugs": enabled, "hellotest.manual.requirements": true },
  dependencies: {},
  permission_features: {
    "feedback.create": ["hellotest.manual.bugs"], "feedback.view": ["hellotest.manual.bugs"],
    "requirement.view": ["hellotest.manual.requirements"], "workspace.view": [], "user.view": []
  }
});

test("capabilities require the actual project grant and current feature availability", () => {
  assert.equal(hasCapability(session, snapshot(true), "feedback.view", "first"), true);
  assert.equal(hasCapability(session, snapshot(false), "feedback.view", "first"), false);
  assert.equal(hasCapability(session, snapshot(true), "feedback.view", "second"), false);
  assert.equal(hasCapability(session, snapshot(true), "user.view", "first"), false);
  assert.equal(hasCapability(session, null, "workspace.view"), false);
  assert.equal(hasCapability(session, snapshot(false), "workspace.view"), true);
});

test("disabling and re-enabling a feature preserves configured grants and unrelated capabilities", () => {
  const before = structuredClone(session);
  assert.equal(hasCapability(session, snapshot(false), "feedback.create", "first"), false);
  assert.equal(hasCapability(session, snapshot(false), "requirement.view", "first"), true);
  assert.equal(hasCapability(session, snapshot(true), "feedback.create", "first"), true);
  assert.deepEqual(session, before);
});

test("unknown policy entries and a disabled admin capability fail closed", () => {
  const admin = { user: { id: "admin", role: "admin" } };
  assert.equal(hasCapability(admin, snapshot(false), "feedback.create", "first"), false);
  assert.equal(hasCapability(admin, snapshot(true), "made-up.permission", "first"), false);
  assert.equal(hasCapability(session, { ...snapshot(true), permission_features: { "feedback.create": "bad" } }, "feedback.create", "first"), false);
});

test("unavailable optional query views hide cached data, errors, pending state, and refetch bypasses", async () => {
  let requests = 0;
  const cachedData = [{ id: "cached-sensitive-record" }];
  const error = new Error("Forbidden");
  const query = { data: cachedData, error, failureCount: 2, status: "error", fetchStatus: "fetching", isPending: true, isLoading: true, isError: true, isFetching: true, refetch: async () => { requests++; return query; } };
  const view = optionalQueryView(query, false);
  assert.deepEqual(view.data, []);
  assert.equal(view.error, null);
  for (const property of ["isPending", "isLoading", "isError", "isFetching", "isRefetching", "isEnabled"]) assert.equal(view[property], false, property);
  assert.equal(view.status, "success");
  assert.equal(view.fetchStatus, "idle");
  assert.equal(await view.refetch(), view);
  assert.deepEqual(await view.promise, []);
  assert.equal(requests, 0);
  assert.equal(query.data, cachedData);
  assert.equal(query.error, error);
});

test("available query views retain data, errors and real retry behavior", async () => {
  let requests = 0;
  const query = { data: [{ id: "visible-record" }], error: new Error("Try again"), refetch: async () => { requests++; return query; } };
  assert.equal(optionalQueryView(query, true), query);
  await optionalQueryView(query, true).refetch();
  assert.equal(requests, 1);
  assert.deepEqual(optionalQueryView(query, false).data, []);
  assert.equal(optionalQueryView(query, true).data[0].id, "visible-record");
});

test("optional detail and metric queries accept an explicit empty value", () => {
  const query = { data: { total: 19 }, refetch: async () => query };
  assert.equal(optionalQueryView(query, false, null).data, null);
  assert.deepEqual(optionalQueryView(query, false, { total: 0 }).data, { total: 0 });
});
