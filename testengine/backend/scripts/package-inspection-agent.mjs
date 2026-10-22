import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { builtinModules, createRequire } from "node:module";
import { parse } from "acorn";

const require = createRequire(import.meta.url);
const { runtimeDependencies } = require("../../../services/agentic/backend/services/inspectionAgentInstaller.js");

// Ship the browser runtime with the API so local setup needs no remote engine.
// Regenerate after changing recorder/security sources: npm run package:inspection-agent.
const names = { recorder: "recorder", security: "testEngineSecurity", inspection_security: "inspectionSecurity", inspection_proxy: "inspectionProxy", repository_locator: "repositoryLocator" };
const modules = {};
const hashes = {};
for (const [key, name] of Object.entries(names)) {
  const source = await readFile(new URL(`../dist/lib/${name}.js`, import.meta.url), "utf8");
  modules[key] = source;
  hashes[key] = createHash("sha256").update(source).digest("hex");
}
// Fail packaging when a new import would make the downloaded setup incomplete.
const bundledFiles = new Set(Object.values(names).map(name => `./${name}.js`));
for (const [key, source] of Object.entries(modules)) {
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    const specifier = node.source?.value;
    if (typeof specifier !== "string" || specifier.startsWith("node:") || builtinModules.includes(specifier)) continue;
    if (specifier.startsWith(".")) {
      if (!bundledFiles.has(specifier)) throw new Error(`${key} imports missing local module ${specifier}; include it in the inspection installer.`);
    } else {
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      if (!runtimeDependencies[name]) throw new Error(`${key} imports ${name}; add its pinned version to the inspection installer dependencies.`);
    }
  }
}
const directory = new URL("../../../services/platform/backend/src/assets/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("inspection-agent-runtime.json", directory), JSON.stringify({
  format: 1,
  hashes,
  gzip_base64: gzipSync(JSON.stringify(modules), { level: 9 }).toString("base64")
}, null, 2) + "\n");
console.log("Packaged inspection runtime for independent local-agent setup.");
