import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".json"]);
const ignoredDirectories = new Set([
  ".git",
  ".cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  ".playwright-browsers",
  "dist-admin",
  ".qaira",
  ".hellotest",
  ".firecrawl"
]);
const intentionallyRepeatedNames = new Set([
  "README.md",
  "index.js",
  "index.ts",
  "index.tsx",
  "service.manifest.js",
  "workers.js",
  "api.client.ts",
  "entry.ts",
  "server.cjs",
  "package.json",
  "package-lock.json"
]);
const intentionalRepeatedBasenameGroups = new Map([
  [
    [
      "services/agentic/backend/agents/catalog.js",
      "services/platform/backend/src/domain/catalog.js"
    ].sort().join("\n"),
    "The agent and domain catalogs expose separate contracts."
  ],
  [
    ["services/platform/backend/src/db/bootstrap.js", "services/platform/backend/src/obsDb/bootstrap.js"].sort().join("\n"),
    "Main and observability database bootstraps are separate lifecycle adapters."
  ],
  [
    ["services/platform/backend/src/server.js", "local-run/mobile-engine/src/server.js"].sort().join("\n"),
    "The API and mobile worker have independent process entry points."
  ],
  [
    ["services/platform/frontend/admin/api.ts", "services/platform/frontend/src/lib/api.ts"].sort().join("\n"),
    "The admin and workspace clients have separate authentication and runtime contracts."
  ],
  [
    ["services/platform/frontend/admin/main.tsx", "services/platform/frontend/src/main.tsx"].sort().join("\n"),
    "The admin and workspace applications intentionally keep conventional bundler entry names."
  ]
]);
const genericNames = new Set([
  "common.js",
  "common.ts",
  "config.js",
  "config.ts",
  "data.js",
  "data.ts",
  "helpers.js",
  "helpers.ts",
  "types.js",
  "types.ts",
  "utils.js",
  "utils.ts"
]);
const allowedPackageDocumentation = new Set([
  "CONTRIBUTING.md",
  "docs/architecture/backend.md",
  "services/platform/backend/instance-setup-data/reference/hellotest-feature-stories.md",
  "local-run/RECORDER_LOCAL_SETUP.md",
  "testengine/ARCHITECTURE.md"
]);

// These files are deliberately emitted in more than one bounded context. The
// setup reference is consumed by the installer and API tests, the docs copy is
// the portable product artifact, and the screenshots are linked from separate
// research documents. Keep the copies visible in the audit so a future change
// cannot add another mirror without an explicit reason.
const intentionalRepositoryDuplicateGroups = new Map([
  [
    [
      "services/agentic/backend/runtime/semantic_compiler/vendor/qaira_semantic_compiler/__init__.py",
      "services/agentic/backend/runtime/semantic_compiler/vendor/qaira_semantic_compiler/agents/__init__.py",
      "services/agentic/backend/runtime/semantic_compiler/vendor/qaira_semantic_compiler/core/__init__.py"
    ].sort().join("\n"),
    "Python package marker files are intentionally empty and remain beside each package."
  ],
  [
    [
      "services/platform/backend/instance-setup-data/reference/hellotest-feature-blueprint.json",
      "docs/product/hellotest-feature-blueprint.json"
    ].sort().join("\n"),
    "The backend reference is an install fixture; the docs copy is the portable product artifact."
  ],
  [
    [
      "services/platform/backend/instance-setup-data/reference/hellotest-feature-stories.md",
      "docs/product/hellotest-feature-stories.md"
    ].sort().join("\n"),
    "The backend reference is an install fixture; the docs copy is the portable product artifact."
  ],
  [
    [
      "docs/research/quality-analytics-readiness/readiness-after.png",
      "docs/research/screenshots/release-readiness/after-desktop.png"
    ].sort().join("\n"),
    "The same approved capture is linked by two research narratives with different scope."
  ],
  [
    [
      "docs/research/quality-analytics-readiness/readiness-before.png",
      "docs/research/screenshots/release-readiness/before-desktop.png"
    ].sort().join("\n"),
    "The same approved capture is linked by two research narratives with different scope."
  ]
]);

const scanRoots = [
  "services",
  "testengine/backend/src",
  "local-run/mobile-engine/src"
];

const failures = [];
const warnings = [];
const intentionalRepeatedBasenames = [];

async function collectFiles(directory, extensions = sourceExtensions) {
  const result = [];
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (relativePath(absolute) === "local-run/artifacts") continue;
    if (/\.tsbuildinfo$/.test(entry.name) || entry.name === ".env" || (entry.name.startsWith(".env.") && entry.name !== ".env.example")) continue;
    if (entry.isDirectory()) {
      result.push(...await collectFiles(absolute, extensions));
      continue;
    }
    if (extensions === null) {
      result.push(absolute);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    if (dot > 0 && extensions.has(entry.name.slice(dot))) result.push(absolute);
  }
  return result;
}

function relativePath(file) {
  return relative(root, file).replaceAll("\\", "/");
}

const files = (await Promise.all(scanRoots.map((directory) => collectFiles(resolve(root, directory)))))
  .flat()
  .sort();
// Repository scans include dotfiles, Dockerfiles, executable assets, and all
// other maintained files. Local secrets, browser downloads, and generated
// output are excluded by ignoredDirectories above.
const repositoryFiles = await collectFiles(root, null);

// Exact content duplicates are safe to identify mechanically. Generated run artifacts
// and dependency trees are excluded above, so any result here needs an owner decision.
const hashes = new Map();
for (const file of files) {
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  const list = hashes.get(digest) || [];
  list.push(file);
  hashes.set(digest, list);
}
for (const duplicate of hashes.values()) {
  if (duplicate.length < 2) continue;
  const names = duplicate.map(relativePath);
  warnings.push({ type: "exact-content-duplicate", files: names });
}

const repositoryHashes = new Map();
let repositoryDuplicateFilesSkippedLarge = 0;
for (const file of repositoryFiles) {
  const fileStat = await stat(file);
  // Hashing a local recorder binary or browser asset is wasteful and cannot
  // identify a useful source duplicate. Keep those files counted, but record
  // that they were excluded from the content comparison.
  if (fileStat.size > 5 * 1024 * 1024) {
    repositoryDuplicateFilesSkippedLarge += 1;
    continue;
  }
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  const list = repositoryHashes.get(digest) || [];
  list.push(file);
  repositoryHashes.set(digest, list);
}
const repositoryDuplicateGroups = [...repositoryHashes.values()]
  .filter((duplicate) => duplicate.length > 1)
  .map((duplicate) => duplicate.map(relativePath).sort());
const unreviewedRepositoryDuplicates = repositoryDuplicateGroups.filter((filesInGroup) => {
  const key = filesInGroup.join("\n");
  const reason = intentionalRepositoryDuplicateGroups.get(key);
  if (reason) return false;
  warnings.push({ type: "repository-exact-content-duplicate", files: filesInGroup });
  return true;
});

// Repeated basenames are expected for service composition roots, but the same
// implementation name across feature folders makes ownership hard to discover.
const byBasename = new Map();
const setupDirectory = "services/platform/backend/instance-setup-data";
const setupManifest = JSON.parse(await readFile(resolve(root, setupDirectory, "manifest.json"), "utf8"));
const setupFiles = new Set(setupManifest.files.map(file => `${setupDirectory}/${file.path}`));
for (const file of files) {
  const basename = file.slice(file.lastIndexOf("/") + 1);
  const list = byBasename.get(basename) || [];
  list.push(file);
  byBasename.set(basename, list);
}
for (const [basename, matches] of byBasename) {
  if (matches.length < 2 || intentionallyRepeatedNames.has(basename)) continue;
  const paths = matches.map(relativePath).sort();
  // A browser scenario and a unit contract for the same owner can share a
  // subject name; their layer directories make their different purpose clear.
  const testLocations = paths.map(path => {
    const owned = path.match(/^services\/([^/]+)\/test\/(backend|frontend|browser)\/[^/]+\.test\.[cm]?js$/);
    if (owned) return { owner: owned[1], layer: owned[2], shared: false };
    const shared = path.match(/^services\/platform\/(backend|frontend)\/test\/(browser\/)?[^/]+\.test\.[cm]?js$/);
    return shared ? { owner: "platform", layer: shared[2] ? "browser" : shared[1], shared: true } : null;
  });
  if (testLocations.every(Boolean)
    && (new Set(testLocations.map(match => match.owner)).size === 1 || testLocations.some(match => match.shared))
    && new Set(testLocations.map(match => match.layer)).size === paths.length) {
    intentionalRepeatedBasenames.push({ basename, files: paths, reason: "Distinct browser and unit contracts, including the shared runtime harness" });
    continue;
  }
  if (paths.every(path => setupFiles.has(path))) {
    intentionalRepeatedBasenames.push({ basename, files: paths, reason: "Manifest-selected setup modules contain distinct records for the same table; instance setup verification checks record identities and links" });
    continue;
  }
  const reason = intentionalRepeatedBasenameGroups.get(paths.join("\n"));
  if (reason) {
    intentionalRepeatedBasenames.push({ basename, files: paths, reason });
    continue;
  }
  warnings.push({
    type: "repeated-basename",
    basename,
    files: paths
  });
}

const markdownOutsideDocs = repositoryFiles
  .filter((file) => file.endsWith(".md"))
  .map(relativePath)
  .filter((file) => file !== "README.md" && !file.startsWith("docs/") && !file.endsWith("/README.md") && !allowedPackageDocumentation.has(file));
if (markdownOutsideDocs.length) {
  warnings.push({ type: "documentation-outside-docs", files: markdownOutsideDocs });
}
const markdownFiles = repositoryFiles.filter((file) => file.endsWith(".md"));
for (const file of markdownFiles) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim();
    if (!rawTarget || rawTarget.startsWith("http") || rawTarget.startsWith("#") || rawTarget.startsWith("/") || rawTarget.startsWith("mailto:")) continue;
    const target = rawTarget.split("#", 1)[0].split("?", 1)[0];
    if (!target) continue;
    const targetPath = resolve(file, "..", target);
    try {
      await access(targetPath);
    } catch {
      failures.push(`Markdown link points to a missing file: ${relativePath(file)} -> ${rawTarget}`);
    }
  }
}

for (const file of files) {
  const basename = file.slice(file.lastIndexOf("/") + 1);
  if (!genericNames.has(basename)) continue;
  const path = relativePath(file);
  // These are infrastructure boundaries, where a generic name is deliberate.
  if (/^(services\/platform\/backend\/src\/(config\.js|db\/|obsDb\/|routes\/index\.js)|services\/platform\/frontend\/src\/(types\.ts|services\/))/.test(path)) continue;
  warnings.push({ type: "generic-basename", file: path, recommendation: "use a bounded-context name" });
}

// Every API route implementation must be owned exactly once by a service manifest.
const routeFiles = (await collectFiles(resolve(root, "services")))
  .filter((file) => /\/routes\/[^/]+\.routes\.js$/.test(file));
const routeManifest = require(resolve(root, "services/platform/backend/src/routes/manifest.js"));
const routeOwners = new Map();
for (const route of routeManifest.routeModules || []) {
  const source = route.source?.replaceAll("\\", "/");
  if (!source) {
    failures.push("route manifest contains an entry without a source path");
    continue;
  }
  const owners = routeOwners.get(source) || [];
  owners.push(route.service);
  routeOwners.set(source, owners);
}
for (const file of routeFiles) {
  const source = relativePath(file);
  const owners = routeOwners.get(source) || [];
  if (owners.length === 0) failures.push(`API route is not owned by a service manifest: ${source}`);
  if (owners.length > 1) failures.push(`API route has multiple service owners: ${source} (${owners.join(", ")})`);
}
for (const source of routeOwners.keys()) {
  if (!routeFiles.some((file) => relativePath(file) === source)) failures.push(`service manifest references a missing route: ${source}`);
}

// The catalog and source roots form the deployment contract. Keep this check here
// because a valid route manifest alone does not guarantee a deployable service.
const catalog = JSON.parse(await readFile(resolve(root, "services/catalog.json"), "utf8"));
const apiProfiles = catalog.services.filter((service) => service.kind === "api" && service.profile);
const sourceProfiles = new Set((routeManifest.serviceManifests || []).map((service) => service.id));
for (const service of apiProfiles) {
  if (!sourceProfiles.has(service.profile)) failures.push(`catalog profile has no loaded service manifest: ${service.profile}`);
  if (service.source !== `services/${service.profile}/backend`) failures.push(`catalog backend source mismatch: ${service.id}`);
  if (service.frontend_source !== `services/${service.profile}/frontend`) failures.push(`catalog frontend source mismatch: ${service.id}`);
  try {
    await access(resolve(root, `${service.source}/service.manifest.js`));
    await access(resolve(root, `${service.frontend_source}/index.ts`));
  } catch {
    failures.push(`service ${service.profile} is missing a source composition root`);
  }
}

const trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const isForbiddenEnvironmentFile = (file) => {
  const basename = file.slice(file.lastIndexOf("/") + 1);
  return basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example");
};
const forbiddenTrackedFiles = trackedFiles.filter((file) =>
  /(^|\/)(?:node_modules|dist|coverage|\.cache)(\/|$)|^local-run\/artifacts\/|\.tsbuildinfo$|(^|\/)(?:.*\.db|.*\.sqlite|.*\.sqlite3|.*\.log|.*\.pid)$/.test(file)
  || isForbiddenEnvironmentFile(file)
);
if (forbiddenTrackedFiles.length) {
  failures.push(`generated, local, or dependency files are tracked: ${forbiddenTrackedFiles.slice(0, 10).join(", ")}`);
}

const fileCategory = (file) => {
  const path = relativePath(file).toLowerCase();
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (path.endsWith(".md")) return "documentation";
  if (path.endsWith(".sh") || path.endsWith(".cmd")) return "shell";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "deployment-config";
  if (basename === "dockerfile" || basename === ".dockerignore") return "container";
  if (path.endsWith(".sql") || path.endsWith(".json") || path.endsWith(".csv")) return "data-contract";
  if ([...sourceExtensions].some((extension) => path.endsWith(extension))) return "source";
  if (path.endsWith(".env") || path.endsWith(".example") || path.endsWith(".cfg") || path.endsWith(".conf") || path.endsWith(".alloy")) return "runtime-config";
  return "asset-or-other";
};
const fileCategories = Object.fromEntries(
  [...new Set(repositoryFiles.map(fileCategory))]
    .sort()
    .map((category) => [category, repositoryFiles.filter((file) => fileCategory(file) === category).length])
);
const noExtensionFiles = repositoryFiles
  .filter((file) => !file.includes("/") || !/\.[^/]+$/.test(file.slice(file.lastIndexOf("/") + 1)))
  .map(relativePath)
  .sort();

const result = {
  ok: failures.length === 0,
  files_scanned: files.length,
  repository_files_scanned: repositoryFiles.length,
  file_categories: fileCategories,
  no_extension_files: noExtensionFiles,
  markdown_files: markdownFiles.length,
  route_files: routeFiles.length,
  route_owners: routeOwners.size,
  exact_content_duplicates: warnings.filter((item) => item.type === "exact-content-duplicate").length,
  repository_exact_content_duplicates: repositoryDuplicateGroups.length,
  unreviewed_repository_duplicates: unreviewedRepositoryDuplicates.length,
  intentional_repository_duplicates: repositoryDuplicateGroups.length - unreviewedRepositoryDuplicates.length,
  repository_duplicate_files_skipped_large: repositoryDuplicateFilesSkippedLarge,
  repeated_basenames: warnings.filter((item) => item.type === "repeated-basename").length,
  intentional_repeated_basenames: intentionalRepeatedBasenames,
  generic_basenames: warnings.filter((item) => item.type === "generic-basename").length,
  markdown_outside_docs: markdownOutsideDocs.length,
  warnings
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
if (process.argv.includes("--strict") && warnings.length) process.exit(2);
