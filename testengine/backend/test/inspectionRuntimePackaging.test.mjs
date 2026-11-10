import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";

const execute = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/package-inspection-agent.mjs", import.meta.url));
const pack = (...args) => execute(process.execPath, [script, ...args]);

test("the distributed paired runtime matches the current compiled native dependency closure", async () => {
  const { stdout } = await pack("--check");
  assert.match(stdout, /Verified paired inspection\/execution runtime/);
});

test("freshness verification rejects changed embedded runtime bytes and leaves the bundle untouched", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hellotest-runtime-freshness-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "inspection-agent-runtime.json");
  await pack("--output", output);
  await pack("--check", "--output", output);
  const bundle = JSON.parse(await readFile(output, "utf8"));
  bundle.gzip_base64 = gzipSync(gunzipSync(Buffer.from(bundle.gzip_base64, "base64")), { level: 1 }).toString("base64");
  await writeFile(output, JSON.stringify(bundle));
  await pack("--check", "--output", output);
  bundle.gzip_base64 = "stale-runtime";
  const stale = JSON.stringify(bundle);
  await writeFile(output, stale);
  await assert.rejects(pack("--check", "--output", output), error => /bundle is stale/.test(error.stderr));
  assert.equal(await readFile(output, "utf8"), stale);
});
