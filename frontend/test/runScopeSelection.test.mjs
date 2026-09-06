import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = (file, resolve) => {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(resolve, exports);
  return exports;
};
const nodes = (element) => Array.isArray(element) ? element.flatMap(nodes) : element && typeof element === "object" ? [element, ...nodes(element.props?.children)] : [];
const text = (element) => Array.isArray(element) ? element.map(text).join("") : element && typeof element === "object" ? text(element.props?.children) : typeof element === "string" || typeof element === "number" ? String(element) : "";

test("suite toolbar selection respects filtered visibility, existing order, and clear", () => {
  const state = [];
  let cursor = 0;
  const CatalogSearchFilter = () => null;
  const { SuiteScopePicker } = compile("../src/components/SuiteCasePicker.tsx", (path) => {
    if (path === "react") return { useMemo: (factory) => factory(), useState: (initial) => { const key = cursor++; if (!(key in state)) state[key] = initial; return [state[key], (value) => { state[key] = value; }]; } };
    if (path === "./CatalogSearchFilter") return { CatalogSearchFilter };
    if (path === "./RichTextEditor") return { richTextToPlainText: (value) => value || "" };
    if (path === "./AppIcons") return { SelectionToggleIcon: () => null, TestCaseIcon: () => null };
    if (path.endsWith(".css")) return {};
    return require(path);
  });
  let selected = ["suite-b"];
  const render = () => {
    cursor = 0;
    const component = SuiteScopePicker({ suites: [{ id: "suite-a", name: "Alpha", test_case_ids: ["case-1"] }, { id: "suite-b", name: "Beta", test_case_ids: ["case-2"] }], selectedSuiteIds: selected, onChange: (next) => { selected = next; }, emptyMessage: "No suites" });
    return component.type(component.props);
  };
  let tree = render();
  nodes(tree).find((node) => node.type === CatalogSearchFilter).props.onChange("Alpha");
  tree = render();
  const toolbar = nodes(tree).find((node) => node.props?.className?.includes("suite-reference-picker-toolbar--scope"));
  assert.ok(nodes(toolbar).some((node) => node.type === CatalogSearchFilter));
  nodes(toolbar).find((node) => node.type === "button" && text(node).trim() === "Select all").props.onClick();
  assert.deepEqual(selected, ["suite-b", "suite-a"], "Select all appends filtered suites and keeps hidden selections in order");
  tree = render();
  assert.equal(nodes(tree).find((node) => node.type === "button" && text(node).trim() === "Select all").props.disabled, true);
  nodes(tree).find((node) => node.type === CatalogSearchFilter).props.onChange("");
  tree = render();
  nodes(tree).find((node) => node.props?.["aria-label"] === "Move Beta down").props.onClick({ preventDefault() {} });
  assert.deepEqual(selected, ["suite-a", "suite-b"]);
  tree = render();
  nodes(tree).find((node) => node.type === "button" && text(node).trim() === "Clear").props.onClick();
  assert.deepEqual(selected, []);
});

test("run context retains the selected dynamic data set without generating a sample", () => {
  let changedDataSet;
  const dataSet = { id: "data-1", name: "Dynamic accounts", app_type_id: "web", rows: [{ email: "{{random.email}}" }] };
  const { ExecutionContextSelector } = compile("../src/components/ExecutionContextSelector.tsx", (path) => {
    if (path === "react") return { useMemo: (factory) => factory(), useEffect() {}, useRef: (current) => ({ current }) };
    if (path === "@tanstack/react-query") return { useQuery: ({ queryKey }) => ({ data: queryKey[0] === "test-data-sets" ? [dataSet] : [], isLoading: false }) };
    if (path === "../auth/AuthContext") return { useAuth: () => ({ session: {} }) };
    if (path === "../hooks/useFeatureFlags") return { useFeatureFlags: () => ({ data: {} }) };
    if (path === "../lib/permissions") return { hasPermission: () => true };
    if (path === "../lib/featureFlags") return { areFeatureFlagsEnabled: () => true };
    if (path === "../lib/api") return { api: {} };
    if (path === "./FormField") return { FormField: () => null };
    if (path === "./AppIcons") return { TestDataIcon: () => null };
    if (path.includes("testDataGenerators")) throw new Error("Run setup must not materialize generated samples");
    return require(path);
  });
  const tree = ExecutionContextSelector({ projectId: "project", appTypeId: "web", selectedEnvironmentId: "", selectedConfigurationId: "", selectedDataSetId: "data-1", onEnvironmentChange() {}, onConfigurationChange() {}, onDataSetChange: (id) => { changedDataSet = id; } });
  const dataField = nodes(tree).find((node) => node.props?.label === "Test data");
  assert.equal(dataField.props.selectedId, "data-1");
  assert.deepEqual(dataField.props.items, [dataSet]);
  dataField.props.onChange("");
  assert.equal(changedDataSet, "");
  assert.doesNotMatch(text(tree), /Generated test data sample|random.email/);
});

test("catalog filter owns initial focus, Tab boundaries, and Escape before its containing dialog", (t) => {
  const previousGlobals = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  t.after(() => { for (const [key, value] of Object.entries(previousGlobals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const refs = [];
  const effects = [];
  const frames = [];
  const listeners = new Map();
  const openStates = [];
  let stateIndex = 0;
  class Element {
    constructor(name) { this.name = name; this.offsetParent = {}; this.children = []; }
    contains(target) { return target === this || this.children.includes(target); }
    closest() { return null; }
    matches(selector) { return selector.includes(this.name); }
    querySelectorAll() { return this.children; }
    focus() { globalThis.document.activeElement = this; }
  }
  globalThis.Node = Element;
  globalThis.document = { body: {} };
  globalThis.window = {
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    addEventListener: (name, callback, capture) => listeners.set(name, { callback, capture }),
    removeEventListener: (name) => listeners.delete(name)
  };
  const { CatalogSearchFilter } = compile("../src/components/CatalogSearchFilter.tsx", (path) => {
    if (path === "react") return {
      useState: () => stateIndex++ === 0 ? [true, (value) => openStates.push(value)] : [{}, () => {}],
      useRef: (current) => { const ref = { current }; refs.push(ref); return ref; },
      useEffect: (callback) => effects.push(callback), useLayoutEffect() {}, useId: () => "filter-test"
    };
    if (path === "react-dom") return { createPortal: (element) => element };
    if (path === "./AppIcons") return { SearchIcon: () => null };
    if (path === "./InfoTooltip") return { InfoTooltip: () => null };
    return require(path);
  });
  CatalogSearchFilter({ value: "", onChange() {}, placeholder: "Search suites", children: null });
  const trigger = new Element("button");
  const popover = new Element("div");
  const select = new Element("select");
  const clear = new Element("button");
  popover.children = [select, clear];
  refs[1].current = trigger;
  refs[2].current = popover;
  const cleanup = effects[0]();
  frames[0]();
  assert.equal(document.activeElement, select);
  const keydown = listeners.get("keydown");
  assert.equal(keydown.capture, true, "Popover receives Escape before the parent document capture handler");
  const dispatch = (key, target, shiftKey = false) => {
    let prevented = false;
    let stopped = false;
    keydown.callback({ key, target, shiftKey, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    return { prevented, stopped };
  };
  assert.deepEqual(dispatch("Tab", clear), { prevented: true, stopped: true });
  assert.equal(document.activeElement, select);
  dispatch("Tab", select, true);
  assert.equal(document.activeElement, clear);
  assert.deepEqual(dispatch("Escape", select), { prevented: true, stopped: true });
  assert.equal(document.activeElement, trigger);
  assert.deepEqual(openStates, [false]);
  assert.deepEqual(dispatch("Escape", new Element("outside-dialog")), { prevented: false, stopped: false });
  cleanup();
  assert.equal(listeners.has("keydown"), false);
});
