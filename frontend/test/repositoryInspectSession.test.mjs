import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildInspectLiveUrl, inspectSessionRequest, loadRepositoryInspectTabs, normalizeRepositoryInspectStartUrl, repositoryInspectLegacyPageUrl, stopRepositoryInspectSession } from "../src/lib/repositoryInspectSession.ts";

const session = { id: "inspect-1", purpose: "repository-inspect", status: "running", status_url: "http://localhost:4311/api/v1/recorder/sessions/inspect-1", live_view_url: "http://localhost:4311/api/v1/recorder/sessions/inspect-1/live?token=secret-session-token" };
const tab = (id, active = false) => ({ id, title: id, url: `https://app.test/${id}`, active });
const pageSource = ts.createSourceFile("AutomationPage.tsx", readFileSync(new URL("../src/pages/AutomationPage.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handler = (name, context) => {
  let found;
  const visit = (node) => { if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(pageSource) === name) found = node; else ts.forEachChild(node, visit); };
  visit(pageSource);
  assert.ok(found, name);
  const code = `${ts.isVariableDeclaration(found) ? "const " : ""}${found.getText(pageSource)}; exports.handler = ${name};`;
  const exports = {};
  new Function(...Object.keys(context), "exports", ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(...Object.values(context), exports);
  return exports.handler;
};

test("inspection tab refresh activates the selected tab and retains the session token", async () => {
  const requests = [];
  const read = async (url, options) => { requests.push({ url, options }); return url.endsWith("/tabs") ? { active_page_id: "a", tabs: [tab("a", true), tab("b")] } : {}; };
  const result = await loadRepositoryInspectTabs(session, "b", read, true);
  assert.equal(result.pageId, "b");
  assert.equal(result.tabs.find((item) => item.active).id, "b");
  assert.equal(requests[1].url, `${session.status_url}/tabs/activate`);
  assert.equal(requests[1].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].options.body), { page_id: "b" });
  for (const request of requests) assert.equal(request.options.headers.get("X-HelloTest-Recorder-Token"), "secret-session-token");
  const live = new URL(buildInspectLiveUrl(session, "b", 7));
  assert.equal(live.searchParams.get("token"), "secret-session-token");
  assert.equal(live.searchParams.get("page_id"), "b");
  assert.equal(live.searchParams.get("refresh"), "7");
  assert.equal(buildInspectLiveUrl({ ...session, status: "stopped" }, "b", 8), "");
});

test("a closed selected tab falls back to a real active tab; background polling never activates tabs", async () => {
  const requests = [];
  const result = await loadRepositoryInspectTabs(session, "closed", async (url) => { requests.push(url); return { active_page_id: "also-closed", tabs: [tab("first"), tab("active", true)] }; });
  assert.equal(result.pageId, "active");
  assert.equal(requests.length, 1);
  const empty = await loadRepositoryInspectTabs(session, "closed", async () => ({ tabs: [] }), true);
  assert.equal(empty.pageId, "");
});

test("recorder fetch forwards Headers and JSON content type for authenticated activation", async () => {
  let received;
  const read = handler("readRecorderJson", { fetch: async (url, options) => { received = { url, options }; return new Response(JSON.stringify({ ok: true })); } });
  const request = inspectSessionRequest(session, "/tabs/activate", { method: "POST", body: JSON.stringify({ page_id: "b" }), headers: { "X-Request-Test": "kept" } });
  await read(request.url, request.options);
  assert.equal(received.options.headers.get("X-HelloTest-Recorder-Token"), "secret-session-token");
  assert.equal(received.options.headers.get("Content-Type"), "application/json");
  assert.equal(received.options.headers.get("X-Request-Test"), "kept");
});

test("late tab responses cannot repopulate a closed or replaced inspection session", async () => {
  let resolve;
  const changed = [];
  const context = {
    inspectSessionRef: { current: session }, inspectSessionGenerationRef: { current: 0 }, inspectTabRequestRef: { current: 0 }, selectedInspectTabIdRef: { current: "a" },
    loadRepositoryInspectTabs: () => new Promise((done) => { resolve = done; }), readRecorderJson() {},
    setInspectTabs: (value) => changed.push(value), setSelectedInspectTabId: (value) => changed.push(value), setInspectPreviewRevision: () => changed.push("preview")
  };
  const load = handler("loadInspectTabs", context);
  const pending = load(undefined, { activate: true, refreshPreview: true });
  context.inspectSessionGenerationRef.current += 1;
  context.inspectSessionRef.current = null;
  resolve({ tabs: [tab("a")], pageId: "a" });
  await pending;
  assert.deepEqual(changed, []);
});

test("closing the browser flushes pending capture, preserves staged fields, and allows reopening", async () => {
  const staged = [{ locator: "#saved" }];
  const state = { session, tabs: [tab("a")], selected: "a", closing: false };
  const context = {
    inspectLifecycleBusyRef: { current: false }, inspectSessionRef: { current: session }, inspectSessionGenerationRef: { current: 0 }, inspectTabRequestRef: { current: 0 }, selectedInspectTabIdRef: { current: "a" }, reinspectFieldLocatorRef: { current: "" },
    stopLiveInspect: async () => staged.push({ locator: "#just-captured" }), stopRepositoryInspectSession,
    readRecorderJson: async (url, options) => { assert.equal(url, `${session.status_url}/stop`); assert.equal(options.headers.get("X-HelloTest-Recorder-Token"), "secret-session-token"); return { ...session, status: "stopped" }; },
    setIsClosingInspectBrowser: (value) => { state.closing = value; }, setInspectRecorderSession: (value) => { state.session = value; }, setSelectedInspectTabId: (value) => { state.selected = value; }, setInspectTabs: (value) => { state.tabs = value; }, setIsInspectingLiveField() {}, setHighlightedInspectLocator() {}, setReinspectFieldLocator() {}, setInspectMessage() {}
  };
  await handler("closeInspectBrowser", context)();
  assert.deepEqual(staged.map((field) => field.locator), ["#saved", "#just-captured"]);
  assert.equal(state.session, null);
  assert.deepEqual(state.tabs, []);
  assert.equal(state.selected, "");
  assert.equal(state.closing, false);
  assert.equal(context.inspectLifecycleBusyRef.current, false);
});

test("stopping an already removed session succeeds, while transport failure stays retryable", async () => {
  assert.equal(await stopRepositoryInspectSession(session, async () => { throw Object.assign(new Error("Already removed"), { status: 404 }); }), null);
  await assert.rejects(stopRepositoryInspectSession(session, async () => { throw new Error("Runtime unreachable"); }), /Runtime unreachable/);
});

test("reopening recovers an expired session and selects a tab from the new browser", async () => {
  const requested = [];
  const staged = [{ locator: "#kept" }];
  const context = {
    inspectLifecycleBusyRef: { current: false }, inspectSessionRef: { current: session }, inspectSessionGenerationRef: { current: 0 }, inspectTabRequestRef: { current: 0 }, selectedInspectTabIdRef: { current: "old-tab" },
    screenUrlDraft: "https://app.test/checkout", normalizeRepositoryInspectStartUrl, loadRepositoryInspectTabs, stopRepositoryInspectSession,
    readRecorderJson: async (url, options) => {
      requested.push({ url, options });
      if (url.includes("/inspect-1/")) throw Object.assign(new Error("Recorder session not found"), { status: 404 });
      if (url.endsWith("/sessions")) {
        assert.equal(JSON.parse(options.body).purpose, "repository-inspect");
        return { ...session, id: "new-session", live_view_path: "/api/v1/recorder/sessions/new-session/live?token=new-token" };
      }
      if (url.endsWith("/tabs")) return { active_page_id: "new-tab", tabs: [tab("new-tab", true)] };
      return {};
    },
    recommendedInspectMode: "local", canInspectRepository: true,
    inspectAgent: { check: async () => ({ publicBaseUrl: "http://localhost:4311", token: "pairing-token" }) },
    connectLocalInspectSession: handler("connectLocalInspectSession", {}),
    setInspectSessionMode() {}, setInspectTabs() {}, setSelectedInspectTabId() {}, setInspectPreviewRevision() {}, setInspectMessage() {}, setIsLaunchingInspectBrowser() {}, setIsInspectingLiveField() {}, setInspectRecorderSession() {}
  };
  context.loadInspectTabs = handler("loadInspectTabs", context);
  const reopened = await handler("launchInspectBrowser", context)();
  assert.equal(reopened.id, "new-session");
  assert.equal(context.inspectSessionRef.current.id, "new-session");
  assert.equal(context.selectedInspectTabIdRef.current, "new-tab");
  assert.equal(context.inspectLifecycleBusyRef.current, false);
  assert.deepEqual(staged, [{ locator: "#kept" }]);
  assert.ok(requested.some((item) => item.url.endsWith("/new-session/tabs/activate")));
});

test("remote inspection retains the public proxy prefix and capability for every operation", async () => {
  const remote = { ...session, recorder_mode: "remote", status_url: "https://app.hellotest.ai/api/repository-inspection/sessions/inspect-1?token=opaque-capability", live_view_url: "https://app.hellotest.ai/api/repository-inspection/sessions/inspect-1/live?token=opaque-capability" };
  const request = inspectSessionRequest(remote, "/inspect/result?page_id=tab%2Ftwo");
  const url = new URL(request.url);
  assert.equal(url.origin, "https://app.hellotest.ai");
  assert.equal(url.pathname, "/api/repository-inspection/sessions/inspect-1/inspect/result");
  assert.equal(url.searchParams.get("token"), "opaque-capability");
  assert.equal(url.searchParams.get("page_id"), "tab/two");
  assert.equal(request.options.headers.get("X-HelloTest-Recorder-Token"), "opaque-capability");
  assert.equal(request.options.headers.has("X-HelloTest-Agent-Token"), false);
  assert.equal(inspectSessionRequest(remote).url, remote.status_url);
});

test("remote launch never discovers or contacts a browser-machine local agent", async () => {
  const remote = { ...session, recorder_mode: "remote", id: "remote-session", status_url: "https://app.test/api/repository-inspection/sessions/remote-session?token=opaque", live_view_url: "https://app.test/api/repository-inspection/sessions/remote-session/live?token=opaque" };
  let started;
  const context = {
    recommendedInspectMode: "remote", canInspectRepository: true, normalizeRepositoryInspectStartUrl, activeRepositoryProjectId: "project", projectId: "project", activeRepositoryAppTypeId: "app", appTypeId: "app", screenUrlDraft: "https://target.test",
    inspectLifecycleBusyRef: { current: false }, inspectSessionRef: { current: null }, inspectSessionGenerationRef: { current: 0 }, inspectTabRequestRef: { current: 0 }, selectedInspectTabIdRef: { current: "" },
    inspectAgent: { check: () => assert.fail("Remote launch must not probe localhost") },
    api: { repositoryInspection: { start: async input => { started = input; return remote; } } },
    loadRepositoryInspectTabs, stopRepositoryInspectSession,
    readRecorderJson: async url => { assert.equal(new URL(url).origin, "https://app.test"); return new URL(url).pathname.endsWith("/tabs") ? { tabs: [tab("remote-tab", true)] } : {}; },
    setInspectSessionMode() {}, setInspectTabs() {}, setSelectedInspectTabId() {}, setInspectPreviewRevision() {}, setInspectMessage() {}, setIsLaunchingInspectBrowser() {}, setIsInspectingLiveField() {}, setInspectRecorderSession() {}
  };
  context.loadInspectTabs = handler("loadInspectTabs", context);
  const result = await handler("launchInspectBrowser", context)();
  assert.equal(result, remote);
  assert.deepEqual(started, { project_id: "project", app_type_id: "app", start_url: "https://target.test/" });
  assert.equal(context.selectedInspectTabIdRef.current, "remote-tab");
});

test("local inspection forwards pairing credentials only for explicitly local sessions", () => {
  const local = { ...session, recorder_mode: "local", inspector_agent_token: "paired-secret" };
  assert.equal(inspectSessionRequest(local, "/tabs").options.headers.get("X-HelloTest-Agent-Token"), "paired-secret");
  assert.equal(inspectSessionRequest({ ...local, recorder_mode: "remote" }, "/tabs").options.headers.has("X-HelloTest-Agent-Token"), false);
});

test("inspection creation requires repository management without depending on execution permissions", async () => {
  const launch = handler("launchInspectBrowser", { canInspectRepository: false, recommendedInspectMode: "remote" });
  await assert.rejects(launch(), /Object repository management permission is required/);
});

test("inspection URLs trim and canonicalize websites but reject screen names and matching patterns", () => {
  for (const value of [undefined, null, "", " \n "]) assert.equal(normalizeRepositoryInspectStartUrl(value), undefined);
  assert.equal(normalizeRepositoryInspectStartUrl("  https://app.test/checkout  "), "https://app.test/checkout");
  assert.equal(normalizeRepositoryInspectStartUrl("app.test/checkout"), "https://app.test/checkout");
  assert.equal(normalizeRepositoryInspectStartUrl("http://localhost:3000"), "http://localhost:3000/");
  assert.equal(normalizeRepositoryInspectStartUrl("localhost:3000"), "https://localhost:3000/");
  assert.equal(normalizeRepositoryInspectStartUrl("http://intranet/login"), "http://intranet/login");
  for (const value of ["Checkout", "checkout-screen", "/checkout", "//app.test", "https://user:secret@app.test", "javascript:alert(1)", "ftp://app.test", "file:///tmp/app", "about:blank", "https://app.test/login\nextra", "*.app.test"]) {
    assert.throws(() => normalizeRepositoryInspectStartUrl(value), /Page URL empty/, value);
  }
});

test("repository screen identifiers never become inspection navigation URLs", () => {
  const resolve = handler("getRepositoryScreenUrl", { repositoryInspectLegacyPageUrl });
  assert.equal(resolve([{ page_key: "Checkout page" }]), "No URL captured");
  assert.equal(resolve([{ page_key: "/checkout" }]), "No URL captured");
  assert.equal(resolve([{ page_key: "https://app.test/legacy" }]), "https://app.test/legacy");
  assert.equal(resolve([{ page_key: "Checkout", page_url: "https://app.test/checkout" }]), "https://app.test/checkout");
});

test("invalid page URLs are rejected before either browser transport creates a session", async () => {
  const context = { recommendedInspectMode: "remote", canInspectRepository: true, inspectLifecycleBusyRef: { current: false }, screenUrlDraft: "CheckoutScreen", normalizeRepositoryInspectStartUrl };
  await assert.rejects(handler("launchInspectBrowser", context)(), /Screen names and URL match patterns cannot be opened/);
  assert.equal(context.inspectLifecycleBusyRef.current, false);
});
