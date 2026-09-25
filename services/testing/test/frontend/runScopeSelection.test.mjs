import { dependencyName } from "../../../platform/frontend/test/helpers/sourceFile.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
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
  const { SuiteScopePicker } = compile("../../frontend/components/SuiteCasePicker.tsx", (path) => {
    if (dependencyName(path) === "useCapabilityAccess") return { useCapabilityAccess: () => ({ can: () => true }) };
    if (dependencyName(path) === "optionalQueryView") return { optionalQueryView: (query) => query };
    if (path === "react") return { useMemo: (factory) => factory(), useState: (initial) => { const key = cursor++; if (!(key in state)) state[key] = initial; return [state[key], (value) => { state[key] = value; }]; } };
    if (dependencyName(path) === "CatalogSearchFilter") return { CatalogSearchFilter };
    if (dependencyName(path) === "RichTextEditor") return { richTextToPlainText: (value) => value || "" };
    if (dependencyName(path) === "AppIcons") return { SelectionToggleIcon: () => null, TestCaseIcon: () => null };
    if (dependencyName(path) === "api.client") return { testingApi: {} };
    if (path === "@tanstack/react-query") return { useQuery: () => { throw new Error("Unscoped suite selection must not fetch catalogs"); } };
    if (path.endsWith(".css")) return {};
    return require(path);
  });
  let selected = ["suite-b"];
  const render = () => {
    cursor = 0;
    let component = SuiteScopePicker({ suites: [{ id: "suite-a", name: "Alpha", test_case_ids: ["case-1"] }, { id: "suite-b", name: "Beta", test_case_ids: ["case-2"] }], selectedSuiteIds: selected, onChange: (next) => { selected = next; }, emptyMessage: "No suites" });
    while (typeof component.type === "function") component = component.type(component.props);
    return component;
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

for (const canFilterCases of [true, false]) {
  test(`suite popup preserves ordered selections and ${canFilterCases ? "editable pending filters" : "test-case permission boundaries"}`, () => {
    const state = [];
    const queries = [];
    let cursor = 0;
    let selected = ["suite-b", "suite-a"];
    const suites = [{ id: "suite-a", name: "Alpha" }, { id: "suite-b", name: "Beta" }];
    const CatalogSearchFilter = () => null;
    const { SuiteScopePicker } = compile("../../frontend/components/SuiteCasePicker.tsx", (path) => {
      if (dependencyName(path) === "useCapabilityAccess") return { useCapabilityAccess: () => ({ can: permission => permission === "suite.view" || canFilterCases }) };
      if (path === "react") return {
        useEffect() {}, useMemo: factory => factory(),
        useState: initial => { const key = cursor++; if (!(key in state)) state[key] = initial; return [state[key], value => { state[key] = value; }]; }
      };
      if (dependencyName(path) === "CatalogSearchFilter") return { CatalogSearchFilter };
      if (dependencyName(path) === "RichTextEditor") return { richTextToPlainText: value => value || "" };
      if (dependencyName(path) === "AppIcons") return { SelectionToggleIcon: () => null, TestCaseIcon: () => null };
      if (dependencyName(path) === "api.client") return { testingApi: {} };
      if (path === "@tanstack/react-query") return { useQuery: options => {
        queries.push(options);
        return { data: options.queryKey[0] === "suite-scope-picker" ? suites : [{ id: "module", name: "Accounts" }], isFetching: Boolean(options.enabled), isPlaceholderData: false, isError: false };
      } };
      if (path.endsWith(".css")) return {};
      return require(path);
    });
    const render = () => {
      cursor = 0;
      queries.length = 0;
      let component = SuiteScopePicker({ projectId: "project", appTypeId: "app", suites, selectedSuiteIds: selected, onChange: next => { selected = next; }, emptyMessage: "No suites" });
      while (typeof component.type === "function") component = component.type(component.props);
      assert.equal(nodes(component).some(node => node.type === "details"), false);
      const ordered = nodes(component).find(node => node.props?.itemLabel === "suite");
      return ordered.type(ordered.props);
    };
    let tree = render();
    let popup = nodes(tree).find(node => node.type === CatalogSearchFilter);
    assert.equal(queries.every(query => !query.enabled), true, "Opening the picker alone loads no linked-case catalogs");
    popup.props.onOpenChange(true);
    tree = render();
    popup = nodes(tree).find(node => node.type === CatalogSearchFilter);
    const moduleFilter = nodes(popup).find(node => node.props?.["aria-label"] === "Filter suites by module");
    assert.equal(Boolean(moduleFilter), canFilterCases);
    assert.equal(queries.find(query => query.queryKey[0] === "test-case-picker-modules").enabled, canFilterCases);
    if (!canFilterCases) {
      assert.equal(nodes(popup).some(node => node.props?.["aria-label"] === "Search linked test cases and metadata"), false);
      assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").every(node => !node.props.disabled), true);
      return;
    }
    moduleFilter.props.onChange({ target: { value: "module" } });
    tree = render();
    popup = nodes(tree).find(node => node.type === CatalogSearchFilter);
    assert.equal(popup.props.disabled, false, "Pending suite results leave their filter popup enabled");
    assert.equal(popup.props.activeFilterCount, 1);
    assert.equal(nodes(popup).filter(node => node.type === "select" || node.type === "input").every(node => !node.props.disabled), true);
    assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").every(node => node.props.disabled), true, "Stale results cannot be selected while filtering");
    assert.equal(nodes(tree).find(node => node.props?.["aria-label"] === "Move Beta down").props.disabled, false, "Existing selections may still be ordered while filtering");
    nodes(popup).find(node => node.type === "button" && text(node).trim() === "Clear filters").props.onClick();
    tree = render();
    popup = nodes(tree).find(node => node.type === CatalogSearchFilter);
    assert.equal(popup.props.activeFilterCount, 0);
    assert.equal(queries.find(query => query.queryKey[0] === "suite-scope-picker").enabled, false);
    assert.deepEqual(selected, ["suite-b", "suite-a"]);
    assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").every(node => !node.props.disabled), true);
  });
}

test("run context retains the selected dynamic data set without generating a sample", () => {
  let changedDataSet;
  const dataSet = { id: "data-1", name: "Dynamic accounts", app_type_id: "web", rows: [{ email: "{{random.email}}" }] };
  const { ExecutionContextSelector } = compile("../../frontend/components/ExecutionContextSelector.tsx", (path) => {
    if (dependencyName(path) === "useCapabilityAccess") return { useCapabilityAccess: () => ({ can: () => true }) };
    if (dependencyName(path) === "optionalQueryView") return { optionalQueryView: (query) => query };
    if (path === "react") return { useMemo: (factory) => factory(), useEffect() {}, useRef: (current) => ({ current }) };
    if (path === "@tanstack/react-query") return { useQuery: ({ queryKey }) => ({ data: queryKey[0] === "test-data-sets" ? [dataSet] : [], isLoading: false }) };
    if (dependencyName(path) === "AuthContext") return { useAuth: () => ({ session: {} }) };
    if (dependencyName(path) === "useFeatureFlags") return { useFeatureFlags: () => ({ data: {} }) };
    if (dependencyName(path) === "permissions") return { hasPermission: () => true };
    if (dependencyName(path) === "featureFlags") return { areFeatureFlagsEnabled: () => true };
    if (dependencyName(path) === "api.client") return { testingApi: {} };
    if (dependencyName(path) === "FormField") return { FormField: () => null };
    if (dependencyName(path) === "AppIcons") return { TestDataIcon: () => null };
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
  const { CatalogSearchFilter } = compile("../../../platform/frontend/src/shared/components/CatalogSearchFilter.tsx", (path) => {
    if (dependencyName(path) === "useCapabilityAccess") return { useCapabilityAccess: () => ({ can: () => true }) };
    if (dependencyName(path) === "optionalQueryView") return { optionalQueryView: (query) => query };
    if (path === "react") return {
      useState: () => stateIndex++ === 0 ? [true, (value) => openStates.push(value)] : [{}, () => {}],
      useRef: (current) => { const ref = { current }; refs.push(ref); return ref; },
      useEffect: (callback) => effects.push(callback), useLayoutEffect() {}, useId: () => "filter-test"
    };
    if (path === "react-dom") return { createPortal: (element) => element };
    if (dependencyName(path) === "AppIcons") return { SearchIcon: () => null };
    if (dependencyName(path) === "InfoTooltip") return { InfoTooltip: () => null };
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
