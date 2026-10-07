import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, resolve = () => ({})) {
  const exports = {};
  new Function("require", "exports", ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(resolve, exports);
  return exports;
}
const capabilities = load("../src/platform/lib/workspaceCapabilities.ts");
const discovery = load("../src/platform/lib/workspaceDiscovery.ts", () => capabilities);

test("recent destinations reject injected paths, duplicates and old capability identifiers", () => {
  assert.deepEqual(discovery.normalizeRecentCapabilities(["cases", "cases", "https://untrusted.test", "obsolete", 42, "runs"]), ["cases", "runs"]);
  assert.deepEqual(discovery.normalizeRecentCapabilities({ id: "cases" }), []);
  assert.equal(discovery.normalizeRecentCapabilities(capabilities.WORKSPACE_CAPABILITIES.map(item => item.id)).length, 6);
  assert.notEqual(discovery.recentCapabilityKey("alice", "project"), discovery.recentCapabilityKey("bob", "project"));
  assert.notEqual(discovery.recentCapabilityKey("alice", "one"), discovery.recentCapabilityKey("alice", "two"));
});

test("destination history resolves views while ignoring transient record and filter parameters", () => {
  assert.equal(discovery.capabilityForDestination("/", "?view=analytics&days=90").id, "analytics");
  assert.equal(discovery.capabilityForDestination("/executions", "?execution=run1").id, "runs");
  assert.equal(discovery.capabilityForDestination("/agentic-workflows", "?view=workflows&workflow=one").id, "workflows");
  assert.equal(discovery.capabilityForDestination("/agentic-workflows", "").id, "quality-agents");
  assert.equal(discovery.capabilityForDestination("/agentic-workflows", "?surface=quality&run=one").id, "quality-agents");
  assert.equal(discovery.capabilityForDestination("/unexpected", ""), undefined);
});

test("storage failures leave navigation available and successful writes keep the newest destination first", () => {
  const memory = new Map();
  globalThis.localStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const key = discovery.recentCapabilityKey("alice", "project");
  discovery.recordRecentCapability(key, "cases"); discovery.recordRecentCapability(key, "runs"); discovery.recordRecentCapability(key, "cases");
  assert.deepEqual(discovery.readRecentCapabilities(key), ["cases", "runs"]);
  memory.set(key, "malformed json"); assert.deepEqual(discovery.readRecentCapabilities(key), []);
  globalThis.localStorage = { getItem: () => { throw new Error("Storage disabled"); }, setItem: () => { throw new Error("Storage full"); } };
  assert.doesNotThrow(() => discovery.recordRecentCapability(key, "cases"));
  assert.deepEqual(discovery.readRecentCapabilities(key), []);
  delete globalThis.localStorage;
});
