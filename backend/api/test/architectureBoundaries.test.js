const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.resolve(__dirname, "../src");

const walkJavaScript = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walkJavaScript(target)
      : entry.name.endsWith(".js") ? [target] : [];
  });

const resolveLocalModule = (fromFile, request, sourceFiles) => {
  const unresolved = path.resolve(path.dirname(fromFile), request);
  return [unresolved, `${unresolved}.js`, path.join(unresolved, "index.js")]
    .map((candidate) => path.normalize(candidate))
    .find((candidate) => sourceFiles.has(candidate)) || null;
};

const buildDependencyGraph = () => {
  const files = walkJavaScript(sourceRoot).map((file) => path.normalize(file));
  const sourceFiles = new Set(files);
  const graph = new Map(files.map((file) => [file, []]));

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
      const dependency = resolveLocalModule(file, match[1], sourceFiles);
      if (dependency) graph.get(file).push(dependency);
    }
  }

  return graph;
};

const findCycles = (graph) => {
  let nextIndex = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowLinks = new Map();
  const cycles = [];

  const visit = (node) => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node)) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(dependency)));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;

    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== node);

    if (component.length > 1 || graph.get(node).includes(node)) cycles.push(component);
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return cycles;
};

const relative = (file) => path.relative(sourceRoot, file);

test("backend local dependencies remain acyclic", () => {
  const graph = buildDependencyGraph();
  const cycles = findCycles(graph).map((component) => component.map(relative));
  assert.deepEqual(cycles, []);
});

test("domain and application layers never depend on routes or Fastify plugins", () => {
  const graph = buildDependencyGraph();
  const protectedRoots = new Set(["services", "domain", "db", "obsDb", "security", "utils"]);
  const violations = [];

  for (const [source, dependencies] of graph) {
    const sourceArea = relative(source).split(path.sep)[0];
    if (!protectedRoots.has(sourceArea)) continue;

    for (const dependency of dependencies) {
      const dependencyArea = relative(dependency).split(path.sep)[0];
      if (dependencyArea === "routes" || dependencyArea === "plugins") {
        violations.push(`${relative(source)} -> ${relative(dependency)}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("application services do not reintroduce duplicate normalized modules", () => {
  const serviceDirectory = path.join(sourceRoot, "services");
  const names = fs.readdirSync(serviceDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => name.replace(/\.service\.js$/, "").replace(/\.js$/, "").toLowerCase());
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});
