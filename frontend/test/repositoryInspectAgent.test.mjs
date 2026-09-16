import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/hooks/useRepositoryInspectAgent.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sameDeps = (left, right) => Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));

// Exercise hook commits and async completions without a browser or backend writes.
function createHarness() {
  const slots = [], requests = [], probes = [], timers = new Map();
  let cursor = 0, pendingEffects = [], dirty = false, props = [true, "project-a"], mounted = true, lateWrites = 0, nextTimer = 0, value;
  const react = {
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, next => {
        if (!mounted) lateWrites += 1;
        const resolved = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(resolved, slot.value)) { slot.value = resolved; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        const next = { deps, cleanup: previous?.cleanup };
        slots[index] = next;
        pendingEffects.push({ slot: next, effect });
      }
    }
  };
  const events = () => ({ addEventListener() {}, removeEventListener() {} });
  const api = { repositoryInspection: { localAgentSetup(input, options) { const task = deferred(); requests.push({ ...task, input, signal: options.signal }); return task.promise; } } };
  const exports = {};
  const hook = new Function("require", "exports", "fetch", "window", "document", "navigator", "localStorage", "crypto", "setTimeout", "clearTimeout", source + "\nreturn exports.useRepositoryInspectAgent;")(
    name => name === "react" ? react : { api }, exports,
    (url, options) => { const task = deferred(); probes.push({ ...task, url, signal: options.signal }); return task.promise; },
    { ...events(), location: { origin: "https://app.hellotest.ai" } }, { ...events(), visibilityState: "visible" }, { onLine: true }, { getItem() { return ""; }, setItem() {} }, webcrypto,
    callback => { const id = ++nextTimer; timers.set(id, callback); return id; }, id => timers.delete(id)
  );
  const flush = (nextProps = props) => {
    props = nextProps;
    let renders = 0;
    do {
      dirty = false; cursor = 0; pendingEffects = [];
      value = hook(...props);
      const effects = pendingEffects;
      effects.forEach(item => item.slot.cleanup?.());
      effects.forEach(item => { item.slot.cleanup = item.effect(); });
      if (++renders > 15) throw new Error("Hook did not settle");
    } while (dirty);
    return value;
  };
  return { flush, requests, probes, timers, get current() { return value; }, get lateWrites() { return lateWrites; }, unmount() { mounted = false; slots.forEach(slot => slot.cleanup?.()); } };
}

test("switching projects aborts stale setup and protects the new request's command and busy state", async () => {
  const harness = createHarness();
  harness.flush();
  const oldTask = harness.current.prepareSetup();
  harness.flush([true, "project-b"]);
  assert.equal(harness.requests[0].signal.aborted, true);
  assert.equal(harness.current.command, "");
  assert.equal(harness.current.setupError, "");
  assert.equal(harness.current.preparingSetup, false);
  const newTask = harness.current.prepareSetup();
  harness.flush();
  harness.requests[0].resolve({ download_url: "https://app.test/project-a", expires_at: "soon" });
  await oldTask;
  harness.flush();
  assert.equal(harness.current.command, "");
  assert.equal(harness.current.preparingSetup, true, "Old completion cannot clear the new request's busy state");
  harness.requests[1].resolve({ download_url: "https://app.test/project-b", expires_at: "later" });
  await newTask;
  harness.flush();
  assert.match(harness.current.command, /project-b/);
  assert.equal(harness.current.preparingSetup, false);
  harness.flush([true, "project-c"]);
  assert.equal(harness.current.command, "", "A previously loaded command is cleared when scope changes");
  assert.equal(harness.current.expiresAt, undefined);
  harness.unmount();
});

test("disabling permissions clears setup and ignores stale errors and stale entry callbacks", async () => {
  const harness = createHarness();
  harness.flush();
  const oldOpen = harness.current.openSetup;
  const task = harness.current.prepareSetup();
  harness.flush([false, "project-a"]);
  harness.requests[0].reject(new Error("Old forbidden request"));
  await task;
  oldOpen();
  harness.flush();
  assert.equal(harness.current.command, "");
  assert.equal(harness.current.setupOpen, false);
  assert.equal(harness.current.setupError, "");
  assert.equal(harness.current.preparingSetup, false);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.probes.length, 0);
  harness.unmount();
});

test("retries ignore superseded setup errors and keep only the newest command", async () => {
  const harness = createHarness();
  harness.flush();
  const first = harness.current.prepareSetup();
  const second = harness.current.prepareSetup();
  assert.equal(harness.requests[0].signal.aborted, true);
  harness.requests[1].resolve({ download_url: "https://app.test/new-command", expires_at: "later" });
  await second;
  harness.requests[0].reject(new Error("Old failed attempt"));
  await first;
  harness.flush();
  assert.match(harness.current.command, /new-command/);
  assert.equal(harness.current.setupError, "");
  harness.unmount();
});

test("unmount aborts setup and in-flight polling without late writes or restarting the timer", async () => {
  const harness = createHarness();
  harness.flush();
  const setupTask = harness.current.prepareSetup();
  const checkTask = harness.current.check();
  harness.flush();
  harness.probes[0].resolve(new Response(JSON.stringify({ ready: true, service: "hellotest-inspection-agent", protocol_version: 1 })));
  await checkTask;
  harness.flush();
  assert.equal(harness.current.state, "connected");
  const [timerId, poll] = harness.timers.entries().next().value;
  harness.timers.delete(timerId);
  const pollingTask = poll();
  harness.unmount();
  assert.equal(harness.requests[0].signal.aborted, true);
  assert.equal(harness.probes[1].signal.aborted, true);
  harness.requests[0].resolve({ download_url: "https://app.test/late", expires_at: "later" });
  harness.probes[1].resolve(new Response(JSON.stringify({ ready: true, service: "hellotest-inspection-agent", protocol_version: 1 })));
  await Promise.all([setupTask, pollingTask]);
  assert.equal(harness.lateWrites, 0);
  assert.equal(harness.timers.size, 0);
});
