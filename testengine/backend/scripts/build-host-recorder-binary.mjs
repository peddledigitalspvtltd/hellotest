import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineDir = resolve(__dirname, "..");
const repoDir = resolve(engineDir, "..", "..");
const localRunDir = resolve(repoDir, "local-run");
const packageDir = resolve(localRunDir, "host-recorder-package");
const outDir = resolve(packageDir, "dist", `${process.platform}-${process.arch}`);
const bundlePath = join(outDir, "hellotest-host-recorder.cjs");
const seaConfigPath = join(outDir, "sea-config.json");
const seaBlobPath = join(outDir, "hellotest-host-recorder.blob");
const binaryName = process.platform === "win32" ? "hellotest-host-recorder.exe" : "hellotest-host-recorder";
const binaryPath = join(outDir, binaryName);
const localBinPath = resolve(localRunDir, "bin", binaryName);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || engineDir,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${output ? `\n${output}` : ""}`);
  }

  return result;
};

await mkdir(outDir, { recursive: true });
await rm(bundlePath, { force: true });
await rm(seaBlobPath, { force: true });
await rm(binaryPath, { force: true });

run("./node_modules/.bin/esbuild", [
  "src/server.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  `--outfile=${bundlePath}`,
  "--external:chromium-bidi/lib/cjs/bidiMapper/BidiMapper",
  "--external:chromium-bidi/lib/cjs/cdp/CdpConnection",
  "--log-level=warning"
]);

const bundledSource = await readFile(bundlePath, "utf8");
await writeFile(
  bundlePath,
  bundledSource
    .replaceAll('require.resolve("../../../package.json")', "process.execPath")
    .replaceAll('require.resolve("..")', "process.execPath")
    .replaceAll('require.resolve("./chromium/appIcon.png")', "process.execPath")
    .replaceAll('require.resolve("./loader")', "process.execPath")
);

await writeFile(seaConfigPath, JSON.stringify({
  main: relative(engineDir, bundlePath),
  output: relative(engineDir, seaBlobPath),
  disableExperimentalSEAWarning: true
}, null, 2));

run(process.execPath, [`--experimental-sea-config=${seaConfigPath}`]);
await copyFile(process.execPath, binaryPath, constants.COPYFILE_FICLONE_FORCE).catch(async () => {
  await copyFile(process.execPath, binaryPath);
});

if (process.platform !== "win32") {
  run("chmod", ["755", binaryPath]);
}

if (process.platform === "darwin") {
  run("codesign", ["--remove-signature", binaryPath]);
}

const postjectArgs = [
  binaryPath,
  "NODE_SEA_BLOB",
  seaBlobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
];

if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}

run("./node_modules/.bin/postject", postjectArgs);

if (process.platform === "darwin") {
  run("codesign", ["--sign", "-", binaryPath]);
}

if (process.platform !== "win32") {
  run("chmod", ["755", binaryPath]);
}

await copyFile(binaryPath, localBinPath);

if (process.platform !== "win32") {
  run("chmod", ["755", localBinPath]);
}

console.log(`Built ${binaryPath}`);
console.log(`Installed ${localBinPath}`);
