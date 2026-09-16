import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/recorder.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("recorder.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(["normalizeText", "clipRawText", "touchSession", "getRecorderPageId", "resolvePageTitle",
  "resolveActivePage", "resolveRecorderPage", "serializeRecorderPage", "readRecorderToken", "requireRecorderToken", "registerRecorderRoutes"]);
const declarations = ast.statements.filter((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((declaration) => names.has(declaration.name.getText(ast))));
const compiled = ts.transpileModule(declarations.map((node) => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText.replaceAll("import.meta.url", JSON.stringify(new URL("../src/lib/recorder.ts", import.meta.url).href));

async function setup() {
  const calls = [];
  const page = (id) => ({ id, closed: false, isClosed() { return this.closed; }, url: () => `https://${id}.example`,
    title: async () => id, bringToFront: async () => { calls.push(["activate", id]); },
    keyboard: { type: async (text) => { calls.push(["type", id, text]); } },
    screenshot: async () => { calls.push(["screenshot", id]); return Buffer.from(id); }
  });
  const first = page("first");
  const second = page("second");
  const pages = [first, second];
  const ids = new WeakMap(pages.map((entry) => [entry, entry.id]));
  const session = { id: "session", status: "running", purpose: "repository-inspect", live_token: "private-token", actions: [], network: [],
    context: { pages: () => pages, newPage: async () => { throw new Error("Must not create a fallback tab"); },
      newCDPSession: async (selected) => {
        calls.push(["stream", selected.id]);
        return { on() {}, send: async () => {}, detach: async () => {} };
      }
    }
  };
  const routes = new Map();
  const exported = {};
  const context = { exports: exported, process: { env: {} }, resolveTestEngineSharedSecret: () => ({ secret: null }), sessions: new Map([[session.id, session]]), recorderPageIds: ids, randomUUID,
    RECORDER_CLEANUP_INTERVAL_MS: 1000, REMOTE_TEXT_LIMIT: 4000, SCREENCAST_QUALITY: 80, SCREENCAST_EVERY_NTH_FRAME: 1,
    setInterval: () => 1, clearInterval() {}, Buffer, console
  };
  vm.runInNewContext(compiled, context);
  await exported.registerRecorderRoutes({
    get: (route, handler) => routes.set(`GET ${route}`, handler),
    post: (route, handler) => routes.set(`POST ${route}`, handler), addHook() {}, log: { warn() {} }
  });
  const request = async (method, suffix, { token = "private-token", body, query = {} } = {}) => {
    const reply = { statusCode: 200, sent: false, code(code) { this.statusCode = code; return this; },
      header() { return this; }, type() { return this; }, hijack() { this.sent = true; },
      raw: { destroyed: false, writableEnded: false, write() {}, writeHead() {}, end() {} }
    };
    const result = await routes.get(`${method} /api/v1/recorder/sessions/:id/${suffix}`)({
      params: { id: "session" }, headers: { "x-hellotest-recorder-token": token }, query, body, raw: { on() {} }
    }, reply);
    return { status: reply.statusCode, result };
  };
  return { calls, first, second, session, request };
}

test("activating an older tab changes the active tab used by unpinned input", async () => {
  const recorder = await setup();
  assert.equal((await recorder.request("GET", "tabs")).result.active_page_id, "second");
  const activated = await recorder.request("POST", "tabs/activate", { body: { page_id: "first" } });
  assert.equal(activated.status, 200);
  assert.equal(activated.result.active_page_id, "first");
  assert.equal((await recorder.request("GET", "tabs")).result.active_page_id, "first");
  await recorder.request("POST", "input", { body: { type: "type", text: "first field" } });
  assert.deepEqual(recorder.calls, [["activate", "first"], ["type", "first", "first field"]]);
});

test("stream, screenshot, and input stay pinned to the selected page even when another tab is active", async () => {
  const recorder = await setup();
  await recorder.request("POST", "tabs/activate", { body: { page_id: "first" } });
  await recorder.request("GET", "stream", { query: { page_id: "second" } });
  const screenshot = await recorder.request("GET", "screenshot", { query: { page_id: "second" } });
  await recorder.request("POST", "input", { query: { page_id: "second" }, body: { type: "type", text: "second field" } });
  assert.equal(screenshot.result.toString(), "second");
  assert.deepEqual(recorder.calls, [["activate", "first"], ["stream", "second"], ["screenshot", "second"], ["type", "second", "second field"]]);
});

test("invalid tokens and closed selected tabs cannot redirect input or activate a fallback page", async () => {
  const recorder = await setup();
  assert.equal((await recorder.request("POST", "tabs/activate", { token: "wrong", body: { page_id: "first" } })).status, 403);
  assert.equal((await recorder.request("POST", "tabs/activate", { body: {} })).status, 400);
  recorder.second.closed = true;
  assert.equal((await recorder.request("POST", "tabs/activate", { body: { page_id: "second" } })).status, 409);
  assert.equal((await recorder.request("POST", "input", { query: { page_id: "second" }, body: { type: "type", text: "must not reach first" } })).status, 409);
  assert.equal((await recorder.request("GET", "screenshot", { query: { page_id: "second" } })).status, 409);
  assert.deepEqual(recorder.calls, []);
  recorder.session.status = "stopped";
  assert.equal((await recorder.request("POST", "tabs/activate", { body: { page_id: "first" } })).status, 409);
});
