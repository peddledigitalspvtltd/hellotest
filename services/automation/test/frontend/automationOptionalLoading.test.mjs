import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createAutomationOptionalModule } from "../../frontend/lib/automationOptionalModule.ts";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test("optional modules share in-flight downloads and retain the successful module", async () => {
  const download = deferred();
  let calls = 0;
  const module = { build: () => "source" };
  const loader = createAutomationOptionalModule(() => { calls += 1; return download.promise; });
  assert.equal(calls, 0);
  const first = loader.load(), second = loader.load();
  assert.equal(first, second);
  await tick();
  assert.equal(calls, 1);
  download.resolve(module);
  assert.equal(await first, module);
  assert.equal(loader.current(), module);
  assert.equal(await loader.load(), module);
  assert.equal(calls, 1);
});

test("a failed or synchronously throwing optional download remains retryable", async () => {
  let calls = 0;
  const loader = createAutomationOptionalModule(() => {
    calls += 1;
    if (calls === 1) throw new Error("Temporary download failure");
    return Promise.resolve({ ready: true });
  });
  await assert.rejects(loader.load(), /Temporary download failure/);
  assert.equal(loader.current(), undefined);
  assert.deepEqual(await loader.load(), { ready: true });
  assert.equal(calls, 2);
});

/** Execute the production hook with lifecycle scheduling; no compiler/import implementation is mirrored. */
function exportPreviewFixture(importer) {
  const slots = [];
  let cursor = 0, effects = [], writes = 0;
  const changed = (left, right) => !left || left.some((value, index) => !Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; writes += 1; }];
    },
    useMemo(fn, dependencies) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) slots[index] = { dependencies, value: fn() };
      return slots[index].value;
    },
    useEffect(fn, dependencies) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) {
        const previous = slots[index];
        slots[index] = { dependencies };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
      }
    }
  };
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL("../../frontend/hooks/useAutomationExportPreview.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function("require", "exports", compiled)(name => {
    if (name === "react") return react;
    if (name === "../lib/automationOptionalModule") return { createAutomationOptionalModule };
    if (name === "../lib/playwrightExport") return importer();
    throw new Error(`Unexpected dependency ${name}`);
  }, exports);
  return {
    render(input) { cursor = 0; return exports.useAutomationExportPreview(input); },
    flush() { const scheduled = effects; effects = []; scheduled.forEach(run => run()); },
    writes: () => writes,
    unmount() { slots.forEach(slot => slot?.cleanup?.()); }
  };
}

test("inactive previews never load or evaluate source and compilation waits for ready context", async () => {
  const builds = [];
  let downloads = 0;
  const fixture = exportPreviewFixture(() => { downloads += 1; return { buildPlaywrightExport: input => { builds.push(input); return input.title; } }; });
  const input = { title: "Current reviewed source" };
  let result = fixture.render({ enabled: false, ready: true, input }); fixture.flush();
  await tick();
  assert.equal(downloads, 0); assert.equal(result.code, ""); assert.deepEqual(builds, []);
  result = fixture.render({ enabled: true, ready: false, input }); fixture.flush();
  await tick();
  result = fixture.render({ enabled: true, ready: false, input }); fixture.flush();
  assert.equal(downloads, 1); assert.deepEqual(builds, []); assert.equal(result.code, "");
  result = fixture.render({ enabled: true, ready: true, input }); fixture.flush();
  assert.equal(result.code, input.title); assert.deepEqual(builds, [input]);
  fixture.render({ enabled: true, ready: true, input }); fixture.flush();
  assert.equal(builds.length, 1, "unchanged renders do not recompile or regenerate data");
  result = fixture.render({ enabled: false, ready: true, input }); fixture.flush();
  assert.equal(result.code, "", "closed/permission-revoked previews retain no accessible source");
});

test("an optional compiler completing after dismissal cannot update a closed preview", async () => {
  const download = deferred();
  const fixture = exportPreviewFixture(() => download.promise);
  const input = { title: "Old case" };
  fixture.render({ enabled: true, ready: true, input }); fixture.flush();
  await tick();
  fixture.render({ enabled: false, ready: true, input }); fixture.flush();
  const before = fixture.writes();
  download.resolve({ buildPlaywrightExport: () => { throw new Error("Closed previews must not compile"); } });
  await tick();
  assert.equal(fixture.writes(), before);
  assert.equal(fixture.render({ enabled: false, ready: true, input }).code, "");
});

test("switching cases during a compiler download renders only the current input", async () => {
  const download = deferred(), builds = [];
  const fixture = exportPreviewFixture(() => download.promise);
  fixture.render({ enabled: true, ready: true, input: { title: "Previous case" } }); fixture.flush();
  await tick();
  const current = { title: "Current case" };
  fixture.render({ enabled: true, ready: true, input: current }); fixture.flush();
  download.resolve({ buildPlaywrightExport: input => { builds.push(input.title); return input.title; } });
  await tick();
  const result = fixture.render({ enabled: true, ready: true, input: current }); fixture.flush();
  assert.equal(result.code, "Current case"); assert.deepEqual(builds, ["Current case"]);
});

test("compiler failures block source and a retry recomputes unchanged reviewed input", async () => {
  let attempts = 0;
  const fixture = exportPreviewFixture(() => ({ buildPlaywrightExport: () => { if (++attempts === 1) throw new Error("Cannot compile current instructions"); return "Recovered source"; } }));
  const options = { enabled: true, ready: true, input: {} };
  fixture.render(options); fixture.flush(); await tick();
  let result = fixture.render(options); fixture.flush();
  assert.equal(result.code, ""); assert.match(result.error.message, /Cannot compile/);
  result.retry();
  result = fixture.render(options); fixture.flush();
  assert.equal(result.code, "Recovered source"); assert.equal(result.error, undefined); assert.equal(attempts, 2);
});

const pageSource = readFileSync(new URL("../../frontend/pages/AutomationPage.tsx", import.meta.url), "utf8");
function repositoryImportFixture() {
  const download = deferred(), parsed = deferred();
  const changes = [];
  const context = {
    repositoryImportRequestRef: { current: 0 }, repositoryImportScopeRef: { current: "project:app" },
    repositoryImporter: { load: () => download.promise },
    setIsParsingRepositoryImport: value => changes.push(["parsing", value]),
    setRepositoryImportPreview: value => changes.push(["preview", value]),
    setIsRepositoryImportModalOpen: value => changes.push(["open", value]),
    showInfo: value => changes.push(["info", value]), showError: error => changes.push(["error", error.message])
  };
  const start = pageSource.indexOf("  const handleRepositoryImportFiles = async (");
  const end = pageSource.indexOf("\n\n  const exportRepositoryCsv", start);
  const compiled = ts.transpileModule(pageSource.slice(start, end) + "\nreturn handleRepositoryImportFiles;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const handler = new Function(...Object.keys(context), compiled)(...Object.values(context));
  return { context, changes, download, parsed, handler };
}

test("repository import ignores a parsed preview after its application selection changed", async () => {
  const fixture = repositoryImportFixture();
  const event = { target: { files: [{ name: "objects.zip" }], value: "file" } };
  const action = fixture.handler(event);
  fixture.download.resolve({ parseObjectRepositoryFiles: () => fixture.parsed.promise }); await tick();
  fixture.context.repositoryImportScopeRef.current = "project:another-app";
  fixture.parsed.resolve({ entries: [{ record_type: "field" }], fileNames: ["objects.zip"], inputKinds: ["zip"], warnings: [] });
  await action;
  assert.equal(event.target.value, "");
  assert.deepEqual(fixture.changes, [["parsing", true]], "old application data cannot reopen or overwrite the current import");
});

test("a newer repository file request wins while an older import is still parsing", async () => {
  const fixture = repositoryImportFixture();
  const firstParse = deferred();
  fixture.download.resolve({ parseObjectRepositoryFiles: files => files[0].name === "first.zip" ? firstParse.promise : Promise.resolve({ entries: [{ record_type: "field", id: "second" }], fileNames: ["second.zip"], inputKinds: ["zip"], warnings: [] }) });
  const first = fixture.handler({ target: { files: [{ name: "first.zip" }], value: "" } }); await tick();
  await fixture.handler({ target: { files: [{ name: "second.zip" }], value: "" } });
  const before = [...fixture.changes];
  firstParse.reject(new Error("Old file failed")); await first;
  assert.deepEqual(fixture.changes, before);
  assert.equal(fixture.changes.find(([name]) => name === "preview")[1].entries[0].id, "second");
});

const pageAst = ts.createSourceFile("AutomationPage.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate) {
  let result;
  const visit = node => {
    if (predicate(node)) { result = node; return; }
    ts.forEachChild(node, visit);
  };
  visit(pageAst);
  assert.ok(result, "Production expression must exist");
  return result;
}
function evaluate(expression, context) {
  const compiled = ts.transpileModule(`const value = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${compiled}\nreturn value;`)(...Object.values(context));
}

test("the Runs badge loads only summary history when the authorized Runs tab opens", async () => {
  const node = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(pageAst) === "selectedCaseHistoryQuery");
  const calls = [];
  const context = {
    useQuery: options => options, projectId: "project", selectedCaseId: "case", selectedAutomationCaseDetail: { id: "case" },
    session: {}, view: "cases", activeAutomationWorkspaceTab: "details", canViewExecutionMetrics: true,
    AUTOMATION_CASE_DETAIL_STALE_TIME_MS: 30_000,
    api: { executionResults: { list: (...args) => { calls.push(args); return []; } } }
  };
  const query = overrides => evaluate(node.initializer.getText(pageAst), { ...context, ...overrides });
  assert.equal(query().enabled, false);
  assert.equal(query({ activeAutomationWorkspaceTab: "runs" }).enabled, true);
  for (const overrides of [{ session: null }, { selectedAutomationCaseDetail: null }, { canViewExecutionMetrics: false }, { view: "repository" }]) {
    assert.equal(query({ activeAutomationWorkspaceTab: "runs", ...overrides }).enabled, false);
  }
  const signal = new AbortController().signal;
  await query().queryFn({ signal });
  assert.deepEqual(calls, [[{ project_id: "project", test_case_id: "case", projection: "summary", limit: 5000 }, { signal }]]);
  assert.deepEqual(query().queryKey, ["execution-results", "automation-case-history", "summary", "project", "case"]);
});

test("an unloaded Runs badge is unknown, while a loaded empty history correctly shows zero", () => {
  const item = findNode(node => ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(pageAst) === "value" && property.initializer.getText(pageAst) === '"runs"'));
  const count = item.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(pageAst) === "count").initializer;
  const badge = data => evaluate(count.getText(pageAst), { selectedCaseHistoryQuery: { data }, activeCaseHistory: data || [] });
  assert.equal(badge(undefined), undefined);
  assert.equal(badge([]), 0);
  assert.equal(badge([{ id: "one" }, { id: "two" }]), 2);
});

test("inactive authoring views do not parse source drafts or manufacture instructions", () => {
  const node = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(pageAst) === "exportSourceSnapshot");
  const callback = node.initializer.arguments[0].getText(pageAst);
  const run = evaluate(callback, {
    needsAutomationSource: false, needsAutomationGherkin: false,
    automatedSteps: { map: () => { throw new Error("Inactive source parsing"); } }
  });
  assert.deepEqual(run(), { steps: [], errors: [] });
});

test("repository projection remains the same public compatibility export without loading a compiler for field authoring", async () => {
  const repository = await import("../../shared/automationRepository.mjs");
  const artifact = await import("../../shared/playwrightArtifact.mjs");
  assert.equal(repository.buildAutomationRepositoryFields, artifact.buildAutomationRepositoryFields);
  assert.equal(repository.preparePlaywrightRepository, artifact.preparePlaywrightRepository);
  const authoringAst = ts.createSourceFile("automationKeywordInputs.ts", readFileSync(new URL("../../frontend/lib/automationKeywordInputs.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const imports = authoringAst.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
  assert.ok(imports.includes("../../shared/automationRepository.mjs"));
  assert.equal(imports.includes("../../shared/playwrightArtifact.mjs"), false);
});
