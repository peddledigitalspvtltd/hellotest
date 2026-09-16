import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// Ship the browser runtime with the API so local setup needs no remote engine.
// Regenerate after changing recorder/security sources: npm run package:inspection-agent.
const names = { recorder: "recorder", security: "testEngineSecurity", inspection_security: "inspectionSecurity", inspection_proxy: "inspectionProxy" };
const modules = {};
const hashes = {};
for (const [key, name] of Object.entries(names)) {
  const source = await readFile(new URL(`../dist/lib/${name}.js`, import.meta.url), "utf8");
  modules[key] = source;
  hashes[key] = createHash("sha256").update(source).digest("hex");
}
const directory = new URL("../../../backend/api/src/assets/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("inspection-agent-runtime.json", directory), JSON.stringify({
  format: 1,
  hashes,
  gzip_base64: gzipSync(JSON.stringify(modules), { level: 9 }).toString("base64")
}, null, 2) + "\n");
console.log("Packaged inspection runtime for independent local-agent setup.");
