import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as parameters from "../src/lib/stepParameters.ts";
import * as gherkin from "../src/lib/gherkin.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/RunParameterTemplateButton.tsx", import.meta.url), "utf8");
const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const hooks = [], effects = [], requests = [], downloads = [];
  let cursor = 0, dirty = false, mounted = true, updatesAfterUnmount = 0;
  let props = { projectId: "project", cases: [{ id: "case-a", title: "Case A @t.alpha" }] };
  const exports = {};
  new Function("require", "exports", script)((path) => {
    if (path === "react") return {
      useState(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value) => {
          if (!mounted) updatesAfterUnmount++;
          if (!Object.is(hooks[index], value)) { hooks[index] = value; dirty = true; }
        }];
      },
      useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
      useLayoutEffect(callback, dependencies) {
        const index = cursor++;
        if (!hooks[index] || dependencies.some((value, offset) => !Object.is(value, hooks[index].dependencies[offset]))) {
          effects.push(() => {
            hooks[index]?.cleanup?.();
            hooks[index] = { dependencies, cleanup: callback() };
          });
        }
      }
    };
    if (path === "../auth/AuthContext") return { useAuth: () => ({ session: {} }) };
    if (path === "../lib/permissions") return { hasPermission: () => true };
    if (path === "../lib/stepParameters") return parameters;
    if (path === "../lib/gherkin") return gherkin;
    if (path === "../lib/executionParameterContext") return { downloadParameterCsvTemplate: (declarations) => downloads.push(declarations) };
    if (path === "../lib/api") return { api: {
      testSteps: { list: (query) => new Promise((resolve, reject) => requests.push({ query, resolve, reject })) },
      testEnvironments: { list: async () => [] }, testConfigurations: { list: async () => [] }, testDataSets: { list: async () => [] }
    } };
    if (path === "@tabler/icons-react") return { IconDownload: () => null };
    return require(path);
  }, exports);
  const render = (changes = {}) => {
    props = { ...props, ...changes };
    let tree;
    do {
      dirty = false; cursor = 0;
      tree = exports.RunParameterTemplateButton(props);
      effects.splice(0).forEach((effect) => effect());
    } while (dirty);
    return tree;
  };
  const button = () => nodes(render()).find((node) => node.type === "button");
  return {
    render, button, requests, downloads,
    click: () => { button().props.onClick(); render(); },
    unmount: () => { mounted = false; hooks.forEach((hook) => hook?.cleanup?.()); },
    get updatesAfterUnmount() { return updatesAfterUnmount; }
  };
}

test("a stale template response cannot download or clear a newer selection's loading state", async () => {
  const view = fixture();
  view.click();
  view.click();
  assert.equal(view.requests.length, 1, "duplicate clicks share the active request");
  const tree = view.render({ cases: [{ id: "case-b", title: "Case B @t.beta" }] });
  assert.match(nodes(tree).find((node) => node.props?.role === "status").props.children, /selection changed/i);
  view.click();
  assert.equal(view.requests.length, 2);
  view.requests[0].resolve([]);
  await flush();
  assert.equal(view.downloads.length, 0);
  assert.equal(view.button().props.disabled, true, "the replacement request remains pending");
  view.requests[1].resolve([]);
  await flush();
  assert.deepEqual(view.downloads[0].map((item) => item.name), ["t.beta"]);
  assert.equal(view.button().props.disabled, false);
});

test("switching back to an earlier selection still invalidates its original request", async () => {
  const view = fixture();
  view.click();
  view.render({ dataSetId: "data-b" });
  view.render({ dataSetId: "" });
  view.requests[0].reject(new Error("Old source failed"));
  await flush();
  assert.equal(view.downloads.length, 0);
  assert.equal(nodes(view.render()).some((node) => node.props?.role === "alert"), false);
  assert.equal(view.button().props.disabled, false);
});

test("closing the dialog suppresses both pending success and failure without post-unmount state updates", async () => {
  for (const outcome of ["resolve", "reject"]) {
    const view = fixture();
    view.click();
    view.unmount();
    view.requests[0][outcome](outcome === "resolve" ? [] : new Error("Late failure"));
    await flush();
    assert.equal(view.downloads.length, 0);
    assert.equal(view.updatesAfterUnmount, 0);
  }
});
