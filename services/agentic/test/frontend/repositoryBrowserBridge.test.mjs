import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import ts from "typescript";
import * as bridge from "../../frontend/lib/repositoryBrowserBridge.ts";

const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const { renderToStaticMarkup } = require("react-dom/server");
const liveUrl = "http://localhost:4311/api/v1/recorder/sessions/session-a/live?token=private%2Btoken&page_id=page-b&refresh=7";
const nodes = (element) => Array.isArray(element) ? element.flatMap(nodes)
  : element && typeof element === "object" ? [element, ...nodes(element.props?.children)] : [];
const text = (element) => Array.isArray(element) ? element.map(text).join("")
  : element && typeof element === "object" ? text(element.props?.children)
    : typeof element === "string" || typeof element === "number" ? String(element) : "";
const validMessage = (overrides = {}) => ({
  type: "hellotest:recorder:state", session_id: "session-a", frame_id: "frame-a",
  width: 1440, height: 900, actual_size: false, pending: 0, error: "", ...overrides
});

test("embedded frame URL retains token, page and refresh revision while binding the exact parent/frame", () => {
  const result = new URL(bridge.repositoryInspectFrameUrl(liveUrl, "https://hellotest.test/editor?private=ignored#fragment", "frame-a"));
  assert.equal(result.origin, "http://localhost:4311");
  assert.equal(result.pathname, "/api/v1/recorder/sessions/session-a/live");
  assert.equal(result.searchParams.get("token"), "private+token");
  assert.equal(result.searchParams.get("page_id"), "page-b");
  assert.equal(result.searchParams.get("refresh"), "7");
  assert.equal(result.searchParams.get("embedded"), "repository-inspect");
  assert.equal(result.searchParams.get("parent_origin"), "https://hellotest.test");
  assert.equal(result.searchParams.get("parent_frame"), "frame-a");
  assert.equal(result.searchParams.has("private"), false);
  for (const [url, origin] of [["javascript:alert(1)", "https://app.test"], ["data:text/html,unsafe", "https://app.test"], [liveUrl, "file:///app.html"], ["invalid", "https://app.test"], [liveUrl, ""]]) {
    assert.equal(bridge.repositoryInspectFrameUrl(url, origin, "frame-a"), "");
  }
});

test("state messages require the exact source, origin, session and current frame generation", () => {
  const frameWindow = {};
  const expected = { origin: "http://localhost:4311", source: frameWindow, sessionId: "session-a", frameId: "frame-a" };
  const event = { origin: expected.origin, source: frameWindow, data: validMessage() };
  assert.deepEqual(bridge.readRepositoryBrowserState(event, expected), { width: 1440, height: 900, actualSize: false, pending: 0, error: "" });
  for (const forged of [
    { ...event, origin: "http://127.0.0.1:4311" },
    { ...event, origin: "http://localhost:4312" },
    { ...event, source: {} },
    { ...event, data: validMessage({ session_id: "previous-session" }) },
    { ...event, data: validMessage({ frame_id: "previous-frame-same-session" }) },
    { ...event, data: validMessage({ frame_id: undefined }) },
    { ...event, data: validMessage({ type: "hellotest:recorder:command" }) },
    { ...event, data: null }, { ...event, data: "not a state message" }
  ]) assert.equal(bridge.readRepositoryBrowserState(forged, expected), null);
  assert.equal(bridge.readRepositoryBrowserState(event, { ...expected, source: null }), null);
  assert.equal(bridge.readRepositoryBrowserState(event, { ...expected, sessionId: "" }), null);
  assert.equal(bridge.readRepositoryBrowserState(event, { ...expected, frameId: "" }), null);
});

test("untrusted viewport dimensions and errors are normalized without granting control from truthy values", () => {
  const source = {};
  const expected = { origin: "http://localhost:4311", source, sessionId: "session-a", frameId: "frame-a" };
  const read = (data) => bridge.readRepositoryBrowserState({ origin: expected.origin, source, data: validMessage(data) }, expected);
  assert.deepEqual(read({ width: 1440.4, height: 899.7, actual_size: "true", pending: -3, error: { html: "unsafe" } }), {
    width: 1440, height: 900, actualSize: false, pending: 0, error: ""
  });
  for (const dimension of [-1, Infinity, NaN, 32769, "1920", null]) {
    assert.equal(read({ width: dimension, height: dimension }).width, 0);
    assert.equal(read({ width: dimension, height: dimension }).height, 0);
  }
  assert.equal(read({ pending: Infinity }).pending, 0);
  assert.equal(read({ pending: "1" }).pending, 0);
  assert.equal(read({ actual_size: true }).actualSize, true);
  assert.equal(read({ error: "x".repeat(1000) }).error.length, 500);
});

// Exercise the real TSX handlers and effect cleanup with the same lightweight
// hook fixtures used elsewhere in this test suite. This is not browser/layout QA.
function mountBrowser(overrides = {}) {
  const slots = [];
  const listeners = new Map();
  const hostByKey = new Map();
  const hostByElement = new WeakMap();
  const posts = [];
  const selections = [];
  const frameWindow = { postMessage: (message, targetOrigin) => posts.push({ message, targetOrigin }) };
  let focused = null;
  let hookIndex = 0;
  let dirty = false;
  let pendingEffects = [];
  let tree;
  class HostNode {
    constructor(type) { this.type = type; this.parent = null; this.children = []; this.open = false; }
    focus() { focused = this; }
    contains(target) { for (let node = target; node; node = node.parent) if (node === this) return true; return false; }
    querySelector(type) { return this.children.find((child) => child.type === type) || null; }
  }
  const windowFixture = {
    location: { origin: "https://hellotest.test" },
    addEventListener(name, callback, capture) {
      const group = listeners.get(name) || new Map();
      group.set(callback, { capture });
      listeners.set(name, group);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); }
  };
  const dependenciesChanged = (old, next) => !old || !next || old.length !== next.length || next.some((value, index) => !Object.is(value, old[index]));
  const hooks = {
    useRef(initial) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (next) => {
        const value = typeof next === "function" ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useMemo(factory, dependencies) {
      const index = hookIndex++;
      if (!slots[index] || dependenciesChanged(slots[index].dependencies, dependencies)) slots[index] = { value: factory(), dependencies };
      return slots[index].value;
    },
    useEffect(callback, dependencies) {
      const index = hookIndex++;
      if (!slots[index] || dependenciesChanged(slots[index].dependencies, dependencies)) {
        pendingEffects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    }
  };
  const componentExports = {};
  const code = ts.transpileModule(readFileSync(new URL("../../frontend/components/RepositoryInspectBrowser.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  new Function("require", "exports", "window", "Node", code)((path) => {
    if (path === "react") return hooks;
    if (path === "../lib/repositoryBrowserBridge") return bridge;
    if (path === "@hellotest/platform/frontend/src/platform/components/AppIcons") return { RefreshIcon: () => null };
    if (path === "@hellotest/platform/frontend/src/shared/components/LoadingState") return { LoadingState: () => null };
    if (path.endsWith(".css")) return {};
    return require(path);
  }, componentExports, windowFixture, HostNode);
  const props = {
    sessionId: "session-a", liveUrl, selectedTabId: "page-b", isRefreshingTabs: false,
    tabs: [{ id: "page-a", title: "First", url: "https://app.test/first" }, { id: "page-b", title: "Second", url: "https://app.test/second", active: true }, { id: null, title: "Invalid", url: "about:blank" }],
    onSelectTab: (id) => selections.push(id), onRefreshTabs() {}, ...overrides
  };
  const attach = (element, parent = null, path = "root") => {
    if (Array.isArray(element)) { element.forEach((child, index) => attach(child, parent, `${path}.${index}`)); return; }
    if (!element || typeof element !== "object") return;
    let host = parent;
    if (typeof element.type === "string") {
      const key = `${element.type}:${element.key ?? element.props.id ?? element.props.title ?? path}`;
      host = hostByKey.get(key) || new HostNode(element.type);
      hostByKey.set(key, host);
      hostByElement.set(element, host);
      host.parent = parent;
      host.children = [];
      if (parent) parent.children.push(host);
      if (element.type === "iframe") host.contentWindow = frameWindow;
      if (element.type === "input") host.form = parent?.type === "form" ? parent : null;
      if (typeof element.ref === "function") element.ref(host);
      else if (element.ref) element.ref.current = host;
    }
    attach(element.props?.children, host, `${path}.children`);
  };
  const render = () => {
    for (let pass = 0; pass < 10; pass += 1) {
      hookIndex = 0;
      dirty = false;
      tree = componentExports.RepositoryInspectBrowser(props);
      attach(tree);
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
      if (!dirty) return tree;
    }
    throw new Error("Component did not settle after its effects");
  };
  const find = (predicate) => nodes(tree).find(predicate);
  const dispatch = (name, event) => { for (const callback of [...(listeners.get(name)?.keys() || [])]) callback(event); render(); };
  const frameId = () => new URL(find((node) => node.type === "iframe").props.src).searchParams.get("parent_frame");
  render();
  return {
    find, render, posts, selections, frameWindow, listeners, props,
    host: (element) => hostByElement.get(element), focused: () => focused, tree: () => tree, frameId,
    act: (callback) => { callback(); render(); },
    update: (next) => { Object.assign(props, next); render(); },
    ready: (overrides = {}) => dispatch("message", { source: frameWindow, origin: "http://localhost:4311", data: validMessage({ frame_id: frameId(), session_id: props.sessionId, ...overrides }) }),
    dispatch,
    cleanup: () => slots.forEach((slot) => slot?.cleanup?.())
  };
}

const button = (browser, label) => browser.find((node) => node.type === "button" && text(node) === label);
const keyEvent = (key, target) => ({ key, target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

test("parent commands require readiness and carry exact session/frame identity with an explicit scale toggle", (t) => {
  const browser = mountBrowser();
  t.after(browser.cleanup);
  assert.equal(button(browser, "Enter").props.disabled, true);
  browser.act(() => button(browser, "Enter").props.onClick());
  assert.equal(browser.posts.length, 0);
  browser.ready();
  for (const label of ["Enter", "Tab", "100%"] ) browser.act(() => button(browser, label).props.onClick());
  assert.deepEqual(browser.posts.map((post) => post.message), [
    { type: "hellotest:recorder:command", session_id: "session-a", frame_id: browser.frameId(), command: "key", value: "Enter" },
    { type: "hellotest:recorder:command", session_id: "session-a", frame_id: browser.frameId(), command: "key", value: "Tab" },
    { type: "hellotest:recorder:command", session_id: "session-a", frame_id: browser.frameId(), command: "scale", value: "toggle" }
  ]);
  assert.ok(browser.posts.every((post) => post.targetOrigin === "http://localhost:4311"));
  browser.ready({ actual_size: true });
  assert.equal(button(browser, "Fit").props["aria-pressed"], true);
  browser.update({ isRefreshingTabs: true });
  browser.act(() => button(browser, "Enter").props.onClick());
  assert.equal(browser.posts.length, 3);
});

test("same-session frame refresh rejects queued old-frame messages and escapes error content", (t) => {
  const browser = mountBrowser();
  t.after(browser.cleanup);
  browser.ready();
  const previousFrameId = browser.frameId();
  browser.update({ liveUrl: liveUrl.replace("refresh=7", "refresh=8") });
  assert.notEqual(browser.frameId(), previousFrameId);
  assert.equal(button(browser, "Enter").props.disabled, true);
  browser.ready({ frame_id: previousFrameId, error: "Stale frame error" });
  assert.equal(button(browser, "Enter").props.disabled, true);
  assert.equal(browser.find((node) => node.props?.role === "alert"), undefined);
  browser.ready({ error: '<img src=x onerror="unsafe()">' });
  assert.equal(button(browser, "Enter").props.disabled, false);
  const markup = renderToStaticMarkup(browser.tree());
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.equal(browser.listeners.get("message").size, 1, "reloading removes the previous listener");
});

test("browser tabs support arrow wrapping and Home/End focus without sending remote key commands", (t) => {
  const browser = mountBrowser();
  t.after(browser.cleanup);
  const tabs = () => nodes(browser.tree()).filter((node) => node.props?.role === "tab");
  assert.equal(tabs().length, 2);
  assert.deepEqual(tabs().map((node) => node.props.tabIndex), [-1, 0]);
  for (const [index, key, expectedIndex] of [[1, "ArrowRight", 0], [0, "ArrowLeft", 1], [1, "Home", 0], [0, "End", 1]]) {
    const event = keyEvent(key);
    browser.act(() => tabs()[index].props.onKeyDown(event));
    assert.equal(event.prevented, true);
    assert.equal(browser.selections.at(-1), tabs()[expectedIndex].key);
    assert.equal(browser.focused(), browser.host(tabs()[expectedIndex]));
  }
  assert.equal(browser.posts.length, 0);
});

test("Go and Type submit their intended values; Escape returns focus without dismissing the parent inspector", (t) => {
  const browser = mountBrowser();
  t.after(browser.cleanup);
  browser.ready();
  const goTrigger = browser.host(button(browser, "Go"));
  browser.act(() => button(browser, "Go").props.onClick({ currentTarget: goTrigger }));
  let input = browser.find((node) => node.type === "input");
  assert.equal(input.props.value, "https://app.test/second");
  assert.equal(browser.focused(), browser.host(input));
  const escape = keyEvent("Escape", browser.host(input));
  browser.dispatch("keydown", escape);
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(browser.focused(), goTrigger);
  assert.equal(browser.find((node) => node.type === "form"), undefined);
  assert.equal(browser.posts.length, 0);

  browser.act(() => button(browser, "Go").props.onClick({ currentTarget: goTrigger }));
  browser.act(() => browser.find((node) => node.type === "input").props.onChange({ target: { value: "  https://app.test/next?q=1  " } }));
  browser.act(() => browser.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }));
  assert.equal(browser.posts.at(-1).message.command, "navigate");
  assert.equal(browser.posts.at(-1).message.value, "https://app.test/next?q=1");
  browser.ready({ pending: 1 });
  browser.ready({ pending: 0 });
  assert.equal(browser.focused(), browser.host(browser.find((node) => node.type === "iframe")));

  browser.act(() => button(browser, "Type").props.onClick({ currentTarget: browser.host(button(browser, "Type")) }));
  browser.act(() => browser.find((node) => node.type === "input").props.onChange({ target: { value: "  text with intentional spaces  " } }));
  browser.act(() => browser.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }));
  assert.equal(browser.posts.at(-1).message.command, "type");
  assert.equal(browser.posts.at(-1).message.value, "  text with intentional spaces  ");
});

test("Go and Type wait for a started command to complete and clear only the submitted Type draft", (t) => {
  const browser = mountBrowser();
  t.after(browser.cleanup);
  browser.ready();
  const open = (label) => browser.act(() => button(browser, label).props.onClick({ currentTarget: browser.host(button(browser, label)) }));
  const edit = (value) => browser.act(() => browser.find((node) => node.type === "input").props.onChange({ target: { value } }));
  const submit = () => browser.act(() => browser.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }));
  const form = () => browser.find((node) => node.type === "form");
  const input = () => browser.find((node) => node.type === "input");

  open("Go");
  edit("https://app.test/new-page");
  submit();
  assert.ok(form(), "posting a command does not imply that navigation succeeded");
  assert.equal(input().props.value, "https://app.test/new-page");
  submit();
  assert.equal(browser.posts.length, 1, "repeat Enter before the first pending state cannot submit twice");
  browser.ready({ pending: 0 });
  assert.ok(form(), "an idle snapshot before command acknowledgement cannot close the form");
  browser.ready({ pending: 1 });
  assert.ok(form());
  assert.equal(browser.find((node) => node.type === "button" && node.props.type === "submit").props.disabled, true);
  browser.ready({ pending: 0 });
  assert.equal(form(), undefined);
  assert.equal(browser.focused(), browser.host(browser.find((node) => node.type === "iframe")));

  open("Type");
  edit("Submitted text");
  submit();
  browser.ready({ pending: 1 });
  browser.ready({ pending: 0 });
  assert.equal(form(), undefined);
  open("Type");
  assert.equal(input().props.value, "", "successful typing clears the exact submitted draft");
  edit("Another submission");
  submit();
  browser.ready({ pending: 1 });
  edit("New text composed while waiting");
  browser.ready({ pending: 0 });
  open("Type");
  assert.equal(input().props.value, "New text composed while waiting", "later edits survive completion of the earlier command");
});

test("failed Go and Type commands retain their form, value and focus and can be retried", (t) => {
  const browser = mountBrowser();
  t.after(browser.cleanup);
  browser.ready();
  for (const [label, value] of [["Go", "https://app.test/unavailable"], ["Type", "  unsent text  "]]) {
    browser.act(() => button(browser, label).props.onClick({ currentTarget: browser.host(button(browser, label)) }));
    browser.act(() => browser.find((node) => node.type === "input").props.onChange({ target: { value } }));
    const submit = () => browser.act(() => browser.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }));
    submit();
    browser.ready({ pending: 1, error: "" });
    browser.ready({ pending: 0, error: "The browser could not complete the command" });
    const input = browser.find((node) => node.type === "input");
    assert.ok(browser.find((node) => node.type === "form"));
    assert.equal(input.props.value, value);
    assert.equal(browser.focused(), browser.host(input));
    assert.equal(text(browser.find((node) => node.props?.role === "alert")), "The browser could not complete the command");
    const beforeRetry = browser.posts.length;
    submit();
    assert.equal(browser.posts.length, beforeRetry + 1, "a completed failure releases the submission guard for retry");
    browser.ready({ pending: 1, error: "" });
    browser.ready({ pending: 0, error: "" });
    assert.equal(browser.find((node) => node.type === "form"), undefined);
  }
});

test("Cancel, Escape and a new frame discard pending completion ownership", (t) => {
  const browser = mountBrowser();
  t.after(browser.cleanup);
  browser.ready();
  for (const dismiss of ["Cancel", "Escape", "frame"]) {
    browser.act(() => button(browser, "Type").props.onClick({ currentTarget: browser.host(button(browser, "Type")) }));
    browser.act(() => browser.find((node) => node.type === "input").props.onChange({ target: { value: `Pending ${dismiss}` } }));
    browser.act(() => browser.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }));
    browser.ready({ pending: 1 });
    if (dismiss === "Cancel") browser.act(() => button(browser, "Cancel").props.onClick());
    else if (dismiss === "Escape") browser.dispatch("keydown", keyEvent("Escape", browser.host(browser.find((node) => node.type === "input"))));
    else { browser.update({ liveUrl: `${liveUrl}&next-frame=1` }); browser.ready(); }
    assert.equal(browser.find((node) => node.type === "form"), undefined);
    browser.act(() => button(browser, "Go").props.onClick({ currentTarget: browser.host(button(browser, "Go")) }));
    browser.ready({ pending: 0, error: "" });
    assert.ok(browser.find((node) => node.type === "form"), "an abandoned command cannot dismiss the replacement form");
    browser.act(() => button(browser, "Cancel").props.onClick());
  }
});
