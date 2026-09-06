import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

// Exercise the shipped live-view event handlers without starting a recorder
// browser or reaching an external application.
const source = await readFile(new URL("../src/lib/recorder.ts", import.meta.url), "utf8");
const template = source.slice(source.indexOf("const renderLiveViewHtml ="), source.indexOf("const stopSession ="));
const renderHtml = (inspect = false) => vm.runInNewContext(template.match(/return (`<!doctype[\s\S]*?`);/)[1], {
  sessionId: '"test-session"', inspectMode: inspect,
  session: { id: "test-session", display_mode: "browser-live-view" }
});

function mountControls({ token = "test-token", fails = false, inspect = false, embedded = false, pageId = "", parentOrigin = "https://hellotest.example", frameId = "current-frame" } = {}) {
  const requests = [];
  const requestUrls = [];
  const states = [];
  const parent = { postMessage: (state, origin) => states.push({ state: JSON.parse(JSON.stringify(state)), origin }) };
  const windowHandlers = {};
  const nodes = new Map();
  let focused;
  let resize;
  let stream;
  class Element {
    handlers = {};
    attrs = {};
    style = {};
    classList = { toggle() {}, add() {}, remove() {} };
    value = "";
    width = 0;
    height = 0;
    clientWidth = 808;
    clientHeight = 508;
    hidden = true;
    disabled = false;
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    focus() { focused = this; }
    contains() { return false; }
    querySelector() { return get("summary"); }
    getContext() { return { drawImage() {} }; }
    getBoundingClientRect() { return { left: 0, top: 0, width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; }
    async fire(name, fields = {}) { return this.handlers[name]?.({ preventDefault() {}, ...fields }); }
  }
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  get("screen").parentElement = get("viewport");
  get("escapeKey").setAttribute("data-key", "Escape");
  class EventSource extends Element {
    constructor(url) { super(); stream = this; this.url = url; }
  }
  class Image extends Element {
    set src(value) { this.handlers.load?.(); }
  }
  const context = {
    URL, URLSearchParams, Image, EventSource,
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} },
    document: { body: get("body"), getElementById: get, querySelectorAll: (selector) => selector === "[data-key]" ? [get("escapeKey")] : [], addEventListener() {} },
    fetch: async (url, options) => {
      requests.push(JSON.parse(options.body));
      requestUrls.push(url);
      return { ok: !fails, json: async () => ({ message: "Input unavailable" }) };
    },
    window: { location: { search: `?${new URLSearchParams({ token, page_id: pageId, ...(embedded ? { embedded: "repository-inspect", parent_origin: parentOrigin, parent_frame: frameId } : {}) })}` },
      parent, addEventListener: (event, handler) => { windowHandlers[event] = handler; },
      EventSource, requestAnimationFrame: (fn) => fn(), setTimeout: () => 1, clearTimeout() {} }
  };
  vm.runInNewContext(renderHtml(inspect).match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { get, requests, requestUrls, states, streamUrl: () => stream.url,
    command: (command, value, overrides = {}) => windowHandlers.message({ source: parent, origin: parentOrigin,
      data: { type: "hellotest:recorder:command", session_id: "test-session", frame_id: frameId, command, value }, ...overrides }),
    focused: () => focused, resize: () => resize(), frame: (width, height) => stream.fire("frame", {
    data: JSON.stringify({ data: "frame", metadata: { deviceWidth: width, deviceHeight: height } })
  }) };
}

test("fit uses both available dimensions and pointer positions map to the remote browser", async () => {
  const view = mountControls();
  await view.frame(1600, 1000);
  assert.equal(view.get("screen").style.width, "800px");
  assert.equal(view.get("screen").style.height, "500px");
  await view.get("screen").fire("pointerdown", { button: 0, clientX: 200, clientY: 150 });
  assert.deepEqual(view.requests[0], { type: "click", x: 400, y: 300 });

  view.get("viewport").clientHeight = 258;
  view.resize();
  assert.equal(view.get("screen").style.width, "400px");
  assert.equal(view.get("screen").style.height, "250px");
  await view.get("scaleToggle").fire("click");
  assert.equal(view.get("screen").style.width, "1600px");
  assert.equal(view.get("scaleToggle").textContent, "Fit");
  await view.get("scaleToggle").fire("click");
  assert.equal(view.get("screen").style.width, "400px");
});

test("successful typing clears its draft and returns focus to the browser", async () => {
  const view = mountControls();
  await view.get("typeToggle").fire("click");
  assert.equal(view.get("actionPanel").hidden, false);
  view.get("textInput").value = "Hello world";
  await view.get("textForm").fire("submit");
  assert.deepEqual(view.requests, [{ type: "type", text: "Hello world" }]);
  assert.equal(view.get("textInput").value, "");
  assert.equal(view.get("actionPanel").hidden, true);
  assert.equal(view.focused(), view.get("screen"));
});

test("failed actions preserve the draft and Escape restores the corresponding toolbar control", async () => {
  const view = mountControls({ fails: true });
  await view.get("typeToggle").fire("click");
  view.get("textInput").value = "Keep this text";
  await view.get("textForm").fire("submit");
  assert.equal(view.get("textInput").value, "Keep this text");
  assert.equal(view.get("actionPanel").hidden, false);
  assert.equal(view.get("statusText").textContent, "Input unavailable");
  await view.frame(1600, 1000);
  assert.equal(view.get("statusText").textContent, "Input unavailable", "New frames must not erase action errors");
  assert.equal(view.get("typeButton").disabled, false);
  await view.get("textInput").fire("keydown", { key: "Escape" });
  assert.equal(view.get("actionPanel").hidden, true);
  assert.equal(view.focused(), view.get("typeToggle"));
});

test("remote key controls retain focus and Shift+Tab can leave the canvas", async () => {
  const view = mountControls();
  view.get("moreControls").open = true;
  await view.get("escapeKey").fire("click");
  assert.deepEqual(view.requests[0], { type: "press", key: "Escape" });
  assert.equal(view.get("moreControls").open, false);
  assert.equal(view.focused(), view.get("screen"));
  let prevented = false;
  await view.get("screen").fire("keydown", { key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(view.requests.length, 1);
});

test("empty navigation and disconnected typing do not send or discard inputs", async () => {
  const view = mountControls({ token: "" });
  view.get("address").value = "   ";
  await view.get("addressForm").fire("submit");
  await view.get("typeToggle").fire("click");
  view.get("textInput").value = "Keep offline";
  await view.get("textForm").fire("submit");
  assert.equal(view.requests.length, 0);
  assert.equal(view.get("textInput").value, "Keep offline");
  assert.equal(view.get("actionPanel").hidden, false);
});

test("embedded inspector accepts only its exact parent and routes commands to the selected page", async () => {
  const view = mountControls({ inspect: true, embedded: true, pageId: "tab-two" });
  await view.command("type", "ignored", { origin: "https://other.example" });
  await view.command("type", "ignored", { source: {} });
  await view.command("type", "ignored", { data: { type: "hellotest:recorder:command", session_id: "other-session", frame_id: "current-frame", command: "type", value: "ignored" } });
  await view.command("unknown", "ignored");
  assert.equal(view.requests.length, 0);
  await view.command("navigate", "https://application.example/orders");
  await view.command("type", "Customer name");
  await view.command("key", "Enter");
  assert.deepEqual(view.requests, [{ type: "goto", url: "https://application.example/orders" }, { type: "type", text: "Customer name" }, { type: "press", key: "Enter" }]);
  assert.ok(view.requestUrls.every((url) => new URL(url, "http://engine.test").searchParams.get("page_id") === "tab-two"));
  assert.equal(new URL(view.streamUrl(), "http://engine.test").searchParams.get("page_id"), "tab-two");
  assert.ok(view.states.some(({ state }) => state.pending === 1));
  assert.equal(view.states.at(-1).state.pending, 0);
  assert.ok(view.states.every(({ origin }) => origin === "https://hellotest.example"));
  assert.ok(view.states.every(({ state }) => state.frame_id === "current-frame"));
  assert.doesNotMatch(JSON.stringify(view.states), /test-token/);
});

test("embedded toolbar reports dimensions, scale and errors without repeating unchanged frames", async () => {
  const view = mountControls({ inspect: true, embedded: true, fails: true });
  await view.frame(1365, 768);
  assert.equal(view.states.at(-1).state.width, 1365);
  assert.equal(view.states.at(-1).state.height, 768);
  const count = view.states.length;
  await view.frame(1365, 768);
  assert.equal(view.states.length, count);
  await view.command("scale", "actual");
  assert.equal(view.states.at(-1).state.actual_size, true);
  await view.command("scale", "fit");
  assert.equal(view.states.at(-1).state.actual_size, false);
  await view.command("type", "Keep the error");
  assert.equal(view.states.at(-1).state.error, "Input unavailable");
  assert.equal(view.states.at(-1).state.pending, 0);
});

test("standalone recording retains its toolbar and never enables the embedded command bridge", async () => {
  const html = renderHtml(false);
  assert.match(html, /<strong>HelloTest Live builder<\/strong>/);
  assert.match(html, /id="addressToggle"/);
  assert.doesNotMatch(renderHtml(true), /<strong>HelloTest Live builder<\/strong>/);
  const standalone = mountControls({ embedded: true });
  await standalone.command("type", "Ignored outside inspector");
  assert.equal(standalone.requests.length, 0);
  assert.equal(standalone.states.length, 0);
  const invalidOrigin = mountControls({ inspect: true, embedded: true, parentOrigin: "https://hellotest.example/path" });
  await invalidOrigin.command("type", "Ignored invalid origin");
  assert.equal(invalidOrigin.requests.length, 0);
});

test("a same-session command from a previous iframe load cannot reach the selected browser", async () => {
  const view = mountControls({ inspect: true, embedded: true, frameId: "new-frame" });
  const command = { type: "hellotest:recorder:command", session_id: "test-session", command: "type", value: "stale input" };
  await view.command("type", "stale input", { data: { ...command, frame_id: "old-frame" } });
  await view.command("type", "missing identity", { data: command });
  assert.equal(view.requests.length, 0);
  await view.command("type", "current input");
  assert.deepEqual(view.requests, [{ type: "type", text: "current input" }]);
  assert.ok(view.states.every(({ state }) => state.frame_id === "new-frame"));
  const noFrame = mountControls({ inspect: true, embedded: true, frameId: "" });
  await noFrame.command("type", "unbound input");
  assert.equal(noFrame.requests.length, 0);
  assert.equal(noFrame.states.length, 0);
});
