import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { builtinModules, createRequire } from "node:module";
import { parse } from "acorn";

const require = createRequire(import.meta.url);
const { runtimeDependencies } = require("../../../services/agentic/backend/services/inspectionAgentInstaller.js");
// Traverse the native executor dependency closure so the downloaded agent runs
// the same pipeline. Incomplete packaging fails here instead of on a laptop.
const names = { recorder: "recorder", security: "testEngineSecurity", inspection_security: "inspectionSecurity", inspection_proxy: "inspectionProxy", repository_locator: "repositoryLocator" };
const sources = new Map();
const pending = [...Object.values(names), "pairedLocalExecution"];
function imports(source) {
  const found = [];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) found.push(node.source.value);
    if (node.type === "ImportExpression") {
      if (node.source.type !== "Literal" || typeof node.source.value !== "string") throw new Error("The paired runtime cannot package a nonliteral dynamic import.");
      found.push(node.source.value);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  };
  visit(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  return found;
}
while (pending.length) {
  const name = pending.shift();
  if (sources.has(name)) continue;
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) throw new Error(`Unsupported paired runtime module ${name}`);
  const source = await readFile(new URL(`../dist/lib/${name}.js`, import.meta.url), "utf8");
  sources.set(name, source);
  for (const specifier of imports(source)) {
    if (specifier.startsWith("node:") || builtinModules.includes(specifier)) continue;
    if (specifier.startsWith(".")) {
      if (!/^\.\/[a-zA-Z][a-zA-Z0-9]*\.js$/.test(specifier)) throw new Error(`${name} imports unsupported local module ${specifier}`);
      pending.push(specifier.slice(2, -3));
    } else {
      const dependency = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      if (!runtimeDependencies[dependency]) throw new Error(`${name} imports ${dependency}; pin it in the local installer dependencies.`);
    }
  }
}
const modules = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, sources.get(name)]));
const legacy = new Set(Object.values(names));
modules.runtime_modules = Object.fromEntries([...sources].filter(([name]) => !legacy.has(name)).map(([name, source]) => [`${name}.js`, source]));
const hashes = Object.fromEntries([...sources].map(([name, source]) => [Object.keys(names).find(key => names[key] === name) || `runtime.${name}`, createHash("sha256").update(source).digest("hex")]));
const directory = new URL("../../../services/platform/backend/src/assets/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("inspection-agent-runtime.json", directory), JSON.stringify({ format: 1, execution_protocol_version: 1, hashes, gzip_base64: gzipSync(JSON.stringify(modules), { level: 9 }).toString("base64") }, null, 2) + "\n");
console.log(`Packaged paired inspection/execution runtime (${sources.size} native modules).`);
