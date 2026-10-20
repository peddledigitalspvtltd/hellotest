import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateAutomationVerificationRequest, type AutomationVerificationRequest, type AutomationVerificationResult } from "./automationVerification.js";

const require = createRequire(import.meta.url);
const MAX_OUTPUT = 2 * 1024 * 1024, MAX_RECEIPT = 512 * 1024;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Options = { signal?: AbortSignal; artifactRoot?: string; temporaryRoot?: string };

/** Only operational browser settings cross the process boundary. In particular,
 * application/database secrets, NODE_OPTIONS and shell configuration do not. */
function cliEnvironment(artifactRoot?: string) {
  const env: NodeJS.ProcessEnv = { CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", NODE_ENV: "production" };
  for (const name of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
    "PLAYWRIGHT_EXECUTABLE_PATH", "PLAYWRIGHT_BROWSERS_PATH", "RECORDER_ALLOWED_PRIVATE_HOSTS", "RECORDER_TARGET_ORIGIN_ALIASES", "ARTIFACT_ROOT"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  if (artifactRoot) env.ARTIFACT_ROOT = artifactRoot;
  return env;
}

function unavailable(request: AutomationVerificationRequest, started: number, code: string, unknown: boolean, cancelled = false): AutomationVerificationResult {
  return { schema_version: 1, verification_id: request.verification_id, execution_driver: "playwright_test_cli", browser: "chromium",
    status: unknown ? "unknown" : cancelled ? "cancelled" : "failed", verification_status: "unverified", replay_safe: !unknown,
    completed_operations: 0, completed_interactions: 0, assertion_count: 0, duration_ms: Date.now() - started,
    failure: { step_id: request.sections[0].step_id, operation_index: 0, operation_kind: "browser_navigate", code,
      action_outcome: unknown ? "unknown" : "not_attempted",
      summary: unknown ? "The CLI process did not return a confirmed execution receipt. Reconcile application state before another run."
        : "The isolated Playwright Test CLI could not start this verification." } };
}

/** A sealed receipt comes only from the host-written test after the shared
 * executor closes its browser. CLI exit status alone never proves a test ran. */
function validReceipt(value: any, request: AutomationVerificationRequest, seal: string): value is { result: AutomationVerificationResult } {
  const result = value?.result, operations = request.sections.flatMap(section => section.operations);
  const integers = ["completed_operations", "completed_interactions", "assertion_count", "duration_ms"];
  if (value?.seal !== seal || value?.request_digest !== digest(request) || !result || result.schema_version !== 1
    || result.verification_id !== request.verification_id || result.browser !== "chromium" || result.execution_driver !== "native"
    || !["passed", "failed", "skipped", "unknown", "cancelled", "timed_out"].includes(result.status)
    || !["verified", "unverified"].includes(result.verification_status) || typeof result.replay_safe !== "boolean"
    || integers.some(key => !Number.isSafeInteger(result[key]) || result[key] < 0)
    || result.completed_operations > operations.length || result.completed_interactions > result.completed_operations
    || result.assertion_count > result.completed_operations) return false;
  const prefix = operations.slice(0, result.completed_operations);
  if (result.completed_interactions !== prefix.filter(operation => !["browser_assert", "browser_navigate"].includes(operation.name)).length
    || result.assertion_count !== prefix.filter(operation => operation.name === "browser_assert").length) return false;
  if (result.status === "passed") return result.verification_status === "verified" && !result.failure
    && result.completed_operations === operations.length;
  return result.verification_status === "unverified";
}

/** Optional Playwright TEST CLI execution, not Microsoft's browser-authoring
 * CLI. The CLI runs the exact same closed recorded program and proxy as native
 * verification in a separate process; no model-authored JS or shell is run. */
export async function runAutomationVerificationCli(input: AutomationVerificationRequest, options: Options = {}): Promise<AutomationVerificationResult> {
  const request = validateAutomationVerificationRequest(input), started = Date.now();
  if (options.signal?.aborted) return unavailable(request, started, "AUTOMATION_VERIFICATION_CANCELLED", false, true);
  let directory: string | undefined, childStarted = false;
  try {
    const playwrightRoot = path.dirname(require.resolve("playwright/package.json"));
    directory = await mkdtemp(path.join(options.temporaryRoot || tmpdir(), "hellotest-verification-cli-"));
    await chmod(directory, 0o700);
    const requestFile = path.join(directory, "request.json"), resultFile = path.join(directory, "receipt.json"), cancelFile = path.join(directory, "cancel");
    const configFile = path.join(directory, "playwright.config.cjs"), specFile = path.join(directory, "recorded.spec.cjs");
    const seal = randomBytes(32).toString("hex"), requestDigest = digest(request);
    const executorUrl = pathToFileURL(fileURLToPath(new URL("./automationVerification.js", import.meta.url))).href;
    // The only interpolated strings are host-owned paths and a random seal.
    // Requirements, input values and source stay in the private data file.
    const spec = `const { test, expect } = require(${JSON.stringify(path.join(playwrightRoot, "test.js"))});
const { readFile, writeFile, rename } = require('node:fs/promises');
const { existsSync } = require('node:fs');
test('verify the immutable recorded program', async () => {
  const { runAutomationVerification } = await import(${JSON.stringify(executorUrl)});
  const request = JSON.parse(await readFile(${JSON.stringify(requestFile)}, 'utf8'));
  const controller = new AbortController();
  const cancellation = setInterval(() => { if (existsSync(${JSON.stringify(cancelFile)})) controller.abort(); }, 25);
  cancellation.unref();
  let result;
  try { result = await runAutomationVerification({ ...request, execution_driver: 'native' }, { signal: controller.signal }); }
  finally { clearInterval(cancellation); }
  const file = ${JSON.stringify(resultFile)};
  await writeFile(file + '.tmp', JSON.stringify({ seal: ${JSON.stringify(seal)}, request_digest: ${JSON.stringify(requestDigest)}, result }), { mode: 0o600 });
  await rename(file + '.tmp', file);
  expect(result.status).toBe('passed');
  expect(result.verification_status).toBe('verified');
});
`;
    const timeout = (request.timeout_ms ?? 30_000) + 5_000;
    await Promise.all([
      writeFile(requestFile, JSON.stringify(request), { mode: 0o600 }),
      writeFile(specFile, spec, { mode: 0o600 }),
      writeFile(configFile, `module.exports = ${JSON.stringify({ testDir: directory, testMatch: "recorded.spec.cjs", outputDir: path.join(directory, "results"), workers: 1, retries: 0, forbidOnly: true, timeout, reporter: "json", fullyParallel: false })};`, { mode: 0o600 })
    ]);
    if (options.signal?.aborted) return unavailable(request, started, "AUTOMATION_VERIFICATION_CANCELLED", false, true);
    const outcome = await new Promise<{ code: number | null; interrupted: boolean; spawned: boolean }>((resolve) => {
      let interrupted = false, bytes = 0, settled = false, killTimer: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(process.execPath, [path.join(playwrightRoot, "cli.js"), "test", "--config", configFile, "--workers=1", "--retries=0", "--max-failures=1", "--forbid-only", "--reporter=json"],
        { cwd: directory, env: cliEnvironment(options.artifactRoot), shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
      const kill = (signal: NodeJS.Signals) => {
        try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
      };
      const interrupt = () => {
        if (interrupted) return;
        interrupted = true;
        // Give the shared executor a bounded opportunity to close its own
        // browser/proxy before terminating the CLI process tree.
        void writeFile(cancelFile, "cancel", { mode: 0o600 }).catch(() => kill("SIGTERM"));
        killTimer = setTimeout(() => kill("SIGKILL"), 1_000); killTimer.unref();
      };
      const timer = setTimeout(interrupt, timeout + 1_000); timer.unref();
      const finish = (code: number | null) => {
        if (settled) return; settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", interrupt);
        // Terminate descendants even when the CLI exits before its browser.
        kill("SIGKILL"); resolve({ code, interrupted, spawned: childStarted });
      };
      child.once("spawn", () => { childStarted = true; if (options.signal?.aborted) interrupt(); });
      child.once("error", () => finish(null)); child.once("close", finish);
      const discard = (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_OUTPUT) interrupt(); };
      child.stdout.on("data", discard); child.stderr.on("data", discard);
      options.signal?.addEventListener("abort", interrupt, { once: true });
    });
    if (outcome.interrupted) return unavailable(request, started, "AUTOMATION_VERIFICATION_CLI_OUTCOME_UNKNOWN", outcome.spawned, options.signal?.aborted);
    if ((await stat(resultFile)).size > MAX_RECEIPT) throw new Error("Invalid CLI receipt");
    const envelope = JSON.parse(await readFile(resultFile, "utf8"));
    if (!validReceipt(envelope, request, seal) || (envelope.result.status === "passed" ? outcome.code !== 0 : outcome.code !== 1)) throw new Error("Invalid CLI execution result");
    return { ...envelope.result, execution_driver: "playwright_test_cli" };
  } catch {
    return unavailable(request, started, "AUTOMATION_VERIFICATION_CLI_UNAVAILABLE", childStarted);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
