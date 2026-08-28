const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../../..");
const legacyRoot = path.join(repositoryRoot, "apps/hellotest-execution-engine");
const legacyDist = path.join(legacyRoot, "dist");
const legacySource = path.join(legacyRoot, "src");
const skippedDirectoryNames = new Set([".git", "dist", "node_modules"]);

const listFiles = async (directory, options = {}) => {
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (options.skipDirectories?.has(entry.name)) continue;
      files.push(...await listFiles(path.join(directory, entry.name), options));
      continue;
    }

    if (entry.isFile()) files.push(path.join(directory, entry.name));
  }

  return files;
};

const relativePaths = (root, files) => files
  .map((file) => path.relative(root, file).split(path.sep).join("/"))
  .sort();

test("the archived execution engine cannot re-enter the supported release or deployment surface", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(legacyRoot, "package.json"), "utf8"));
  assert.equal(packageJson.private, true);
  assert.match(packageJson.deprecated || "", /archived/i);
  assert.equal(packageJson.hellotest?.supportStatus, "archived");
  assert.equal(packageJson.hellotest?.deployable, false);
  assert.equal(packageJson.hellotest?.replacement, "testengine/backend");
  assert.equal(packageJson.scripts?.start, undefined);
  assert.equal(packageJson.scripts?.dev, undefined);
  assert.match(packageJson.scripts?.build || "", /npm run clean/);

  const tsconfig = JSON.parse(await fs.readFile(path.join(legacyRoot, "tsconfig.json"), "utf8"));
  assert.equal(tsconfig.compilerOptions?.rootDir, "src");
  assert.equal(tsconfig.compilerOptions?.outDir, "dist");
  assert.equal(tsconfig.compilerOptions?.noEmitOnError, true);

  const legacySourceFiles = (await listFiles(legacySource))
    .filter((file) => file.endsWith(".ts"));
  assert.ok(legacySourceFiles.length >= 18, "archived TypeScript source must remain available for reference");
  await fs.access(path.join(legacySource, "index.ts"));

  const archivedKubernetesFiles = await listFiles(path.join(legacyRoot, "k8s"));
  assert.deepEqual(
    archivedKubernetesFiles.filter((file) => /\.ya?ml$/i.test(file)),
    [],
    "the archived package must not contain deployable Kubernetes resources"
  );

  const repositoryFiles = await listFiles(repositoryRoot, { skipDirectories: skippedDirectoryNames });
  const deploymentFiles = repositoryFiles.filter((file) => {
    if (file.startsWith(`${legacyRoot}${path.sep}`)) return false;
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    const basename = path.basename(file);
    return /\.ya?ml$/i.test(file)
      || /^Dockerfile(?:\.|$)/i.test(basename)
      || /^(?:deploymentscripts|scripts)\//.test(relative) && /\.(?:sh|mjs|js|json)$/i.test(file)
      || /^(?:hellotest\.sh|start-testengine-ops\.sh)$/.test(relative);
  });

  for (const deploymentFile of deploymentFiles) {
    const source = await fs.readFile(deploymentFile, "utf8");
    assert.doesNotMatch(
      source,
      /(?:apps\/)?hellotest-execution-engine/i,
      `${path.relative(repositoryRoot, deploymentFile)} must not restore the archived execution plane`
    );
  }

  const canonicalManifest = await fs.readFile(
    path.join(repositoryRoot, "testengine/k8s/testengine-workers.yaml"),
    "utf8"
  );
  assert.match(canonicalManifest, /image:\s+hellotest-testengine:/);

  const rootReadme = await fs.readFile(path.join(repositoryRoot, "README.md"), "utf8");
  assert.match(rootReadme, /testengine\/backend[^\n]+sole supported/i);
  assert.match(rootReadme, /apps\/hellotest-execution-engine[^\n]+archived/i);

  const sourceStems = relativePaths(legacySource, legacySourceFiles)
    .map((file) => file.replace(/\.ts$/, ""));
  const expectedDistFiles = sourceStems
    .flatMap((stem) => [`${stem}.d.ts`, `${stem}.js`, `${stem}.js.map`])
    .sort();
  const actualDistFiles = relativePaths(legacyDist, await listFiles(legacyDist));

  assert.equal(actualDistFiles.some((file) => file.startsWith("src/")), false);
  assert.deepEqual(
    actualDistFiles,
    expectedDistFiles,
    "the archived maintenance build must contain exactly one canonical output per source"
  );
});
