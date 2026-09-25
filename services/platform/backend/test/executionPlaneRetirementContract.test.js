const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../../../..");
const legacyRoot = path.join(repositoryRoot, "apps/hellotest-execution-engine");
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

test("the retired execution engine is absent and cannot re-enter deployments", async () => {
  await assert.rejects(fs.access(legacyRoot), { code: "ENOENT" });
  const rootPackage = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(rootPackage.scripts["setup:testengine"], "npm ci --prefix testengine/backend");
  assert.equal(rootPackage.scripts["test:testengine"], "npm --prefix testengine/backend test");
  assert.ok(rootPackage.scripts.test.includes("test:testengine"), "root checks must exercise the retained engine");

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
});
