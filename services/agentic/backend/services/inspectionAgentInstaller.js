// The API includes the engine's compiled recorder modules, so local setup does
// not depend on a configured or reachable remote Test Engine.
// The packaging check verifies every bundled module against this manifest.
const runtimeDependencies = Object.freeze({ acorn: "8.18.0", ajv: "8.18.0", fastify: "4.29.1", "jsonpath-plus": "10.4.0", playwright: "1.59.1", "selenium-webdriver": "4.43.0" });
exports.runtimeDependencies = runtimeDependencies;
exports.buildInstaller = ({ recorder, security, inspection_security, inspection_proxy, repository_locator, runtime_modules, origin, api_origin = origin, agent_token }) => {
  if (![recorder, security, inspection_security, inspection_proxy, repository_locator].every(value => typeof value === "string" && value.length > 100 && value.length < 1024 * 1024)) {
    throw Object.assign(new Error("The local inspection installer is unavailable. Update the HelloTest API and try again."), { statusCode: 503 });
  }
  if (!runtime_modules || typeof runtime_modules !== "object" || Array.isArray(runtime_modules)
    || !runtime_modules["pairedLocalExecution.js"] || Object.keys(runtime_modules).length > 80
    || !Object.entries(runtime_modules).every(([name, source]) => /^[a-zA-Z][a-zA-Z0-9]*\.js$/.test(name) && typeof source === "string" && source.length < 1024 * 1024)) {
    throw Object.assign(new Error("The local execution installer is unavailable. Update the HelloTest API and try again."), { statusCode: 503 });
  }
  for (const value of [origin, api_origin]) {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password) throw new Error("The paired application/API origin is invalid.");
  }
  const config = JSON.stringify({ origin, api_origin, token: agent_token });
  const occupiedPortMessage = JSON.stringify(`Port 4311 is already in use. Stop the existing HelloTest inspection agent in its terminal (Ctrl+C), then rerun the setup command copied from ${origin}. Each setup is paired with that application and browser; an agent started for localhost cannot connect to the cloud application.`);
  const modules = JSON.stringify({ "recorder.js": recorder, "testEngineSecurity.js": security, "inspectionSecurity.js": inspection_security, "inspectionProxy.js": inspection_proxy, "repositoryLocator.js": repository_locator, ...runtime_modules });
  return `// HelloTest paired local browser inspection and automation setup. Requires Node.js 20 or newer.
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
const config = ${config};
const modules = ${modules};
if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Install Node.js 20 or newer, then run this setup again.");
// Fail before installing dependencies when an older or differently paired agent
// owns the port. Never terminate another workspace's browser sessions.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", error => reject(error.code === "EADDRINUSE" ? Object.assign(new Error(${occupiedPortMessage}), { code: error.code }) : error));
  probe.listen({ host: "127.0.0.1", port: 4311 }, () => probe.close(resolve));
});
const directory = join(homedir(), ".hellotest", "inspection-agent", createHash("sha256").update(config.origin).digest("hex").slice(0, 16));
await mkdir(directory, { recursive: true, mode: 0o700 });
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: directory, stdio: "inherit", shell: process.platform === "win32" && command.endsWith(".cmd"), env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(directory, "browsers") } });
  child.on("error", reject);
  child.on("exit", code => code === 0 ? resolve() : reject(new Error(command + " failed with exit code " + code)));
});
await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: ${JSON.stringify(runtimeDependencies)} }), { mode: 0o600 });
console.log("Installing HelloTest paired browser agent and Playwright browsers…");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
await run(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"]);
await run(process.execPath, [join(directory, "node_modules", "playwright", "cli.js"), "install", "chromium", "firefox", "webkit"]);
for (const [name, source] of Object.entries(modules)) await writeFile(join(directory, name), source, { mode: 0o600 });
const launcher = \`import Fastify from "fastify";
import { registerRecorderRoutes } from "./recorder.js";
import { registerPairedLocalExecutionRoutes } from "./pairedLocalExecution.js";
import { createCorsHook, resolveCorsPolicy } from "./testEngineSecurity.js";
const app = Fastify({ logger: { level: "warn" } });
app.addHook("onRequest", createCorsHook(resolveCorsPolicy()));
app.options("/*", async (_req, reply) => reply.code(204).send());
app.get("/health", async () => ({ ok: true, ready: true, service: "hellotest-inspection-agent", supported_web_engines: ["playwright"], execution_protocol_version: 1, capabilities: { repository_inspection: true, local_execution: true } }));
await registerPairedLocalExecutionRoutes(app);
await registerRecorderRoutes(app);
process.once("SIGINT", () => void app.close());
process.once("SIGTERM", () => void app.close());
try {
  await app.listen({ host: "127.0.0.1", port: 4311 });
} catch (error) {
  await app.close();
  if (error.code === "EADDRINUSE") throw Object.assign(new Error(${occupiedPortMessage}), { code: error.code });
  throw error;
}
console.log("HelloTest paired browser and local execution agent is running at http://127.0.0.1:4311. Keep this terminal open; press Ctrl+C to stop.");
console.log(${JSON.stringify(`Paired application: ${origin}. Open HelloTest in the browser that generated this setup. Browser inspection, recording and Run local use this machine.`)});\`;
await writeFile(join(directory, "agent.mjs"), launcher, { mode: 0o600 });
process.env.HELLOTEST_INSPECTOR_TOKEN = config.token;
process.env.TESTENGINE_CORS_ORIGINS = config.origin;
process.env.HELLOTEST_PAIRED_ORIGIN = config.origin;
process.env.HELLOTEST_PAIRED_API_ORIGIN = config.api_origin;
process.env.ARTIFACT_ROOT = join(directory, "artifacts");
process.env.RECORDER_HEADLESS = "false";
process.env.PLAYWRIGHT_BROWSERS_PATH = join(directory, "browsers");
await import(pathToFileURL(join(directory, "agent.mjs")).href);
`;
};
