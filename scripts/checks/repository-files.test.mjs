import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { enumerateRepositoryFiles, listFilesystemSourceFiles } from './repository-files.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'qaira-source-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, path, content = path) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('source archives include maintained dotfiles but omit nested dependencies, generated data and symlink escapes', async t => {
  const root = await fixture(t);
  const maintained = ['Dockerfile', '.github/workflows/check.yml', 'scripts/build/helper.mjs', 'services/app/backend/src/build/compiler.ts', 'services/app/src/quality.ts', 'services/app/.env.example', 'docs/a file\nwith newline.md'];
  const excluded = ['node_modules/pkg/index.js', 'services/app/node_modules/pkg/index.js', 'build/bundle.js', 'services/app/build/output.js', 'services/app/frontend/build/index.html', 'services/app/dist/bundle.js', 'services/app/dist-admin/index.html', 'coverage/results.json', '.cache/temp.ts', 'local-run/artifacts/result.json', '__pycache__/source.pyc', 'services/app/.env', 'services/app/.env.production', 'debug.log', 'source.tsbuildinfo'];
  await Promise.all([...maintained, ...excluded].map(path => put(root, path)));
  const outside = await fixture(t); await put(outside, 'private.txt');
  await symlink(outside, join(root, 'external-directory'));
  await symlink(join(outside, 'private.txt'), join(root, 'external-file.txt'));
  const inventory = await enumerateRepositoryFiles(root);
  assert.equal(inventory.source, 'filesystem');
  assert.deepEqual(inventory.files, maintained.sort());
});

test('Git inventory preserves tracked generated files and exact path names so guardrails still detect them', async t => {
  const root = await fixture(t); git(root, ['init', '--quiet']);
  const tracked = ['src/quality.ts', 'src/with space\nand newline.ts', 'node_modules/pkg/index.js', 'services/app/dist/bundle.js', '.env'];
  await Promise.all(tracked.map(path => put(root, path)));
  git(root, ['add', '--force', '--', ...tracked]);
  await put(root, 'src/untracked.ts');
  const inventory = await enumerateRepositoryFiles(root);
  assert.equal(inventory.source, 'git');
  assert.deepEqual(inventory.files, tracked.sort());
  assert.deepEqual(await listFilesystemSourceFiles(root), ['src/quality.ts', 'src/untracked.ts', 'src/with space\nand newline.ts']);
});

test('an extracted app inside another repository never borrows the parent Git index', async t => {
  const outer = await fixture(t); git(outer, ['init', '--quiet']);
  await put(outer, 'parent.ts'); git(outer, ['add', '--', 'parent.ts']);
  const extracted = join(outer, 'app'); await put(extracted, 'source.ts');
  assert.deepEqual(await enumerateRepositoryFiles(extracted), { source: 'filesystem', files: ['source.ts'] });
});

test('worktree metadata files retain Git mode; damaged root metadata fails visibly instead of bypassing checks', async t => {
  const root = await fixture(t); git(root, ['init', '--quiet']);
  await put(root, 'source.ts'); git(root, ['add', '--', 'source.ts']);
  git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Fixture']);
  const worktree = join(await fixture(t), 'worktree');
  git(root, ['worktree', 'add', '--quiet', '--detach', worktree]);
  assert.deepEqual(await enumerateRepositoryFiles(worktree), { source: 'git', files: ['source.ts'] });
  assert.deepEqual(await listFilesystemSourceFiles(worktree), ['source.ts'], 'worktree metadata files are not product source');
  const damaged = await fixture(t); await mkdir(join(damaged, '.git')); await put(damaged, 'source.ts');
  await assert.rejects(enumerateRepositoryFiles(damaged), /git ls-files/);
});

async function minimalArchitecture(root) {
  await Promise.all([
    put(root, 'services/catalog.json', JSON.stringify({ services: [{ id: 'runtime', port: 7001, source: 'runtime', health: '/health' }] })),
    put(root, 'services/capabilities.json', JSON.stringify({ dependencies: {} })),
    put(root, 'services/platform/backend/instance-setup-data/manifest.json', JSON.stringify({ files: [] })),
    put(root, 'services/platform/backend/src/routes/manifest.js', 'module.exports = { routeModules: [], serviceManifests: [] };\n// serviceManifests.flatMap\n'),
    put(root, 'services/platform/backend/Dockerfile', 'FROM node:22\n'),
    put(root, 'runtime/server.cjs', 'module.exports = { service: "runtime" };\n'),
  ]);
  for (const name of ['repository-files.mjs', 'audit-source-layout.mjs', 'validate-service-architecture.mjs']) {
    await put(root, `scripts/checks/${name}`, await readFile(new URL(name, import.meta.url), 'utf8'));
  }
}
const check = (root, name, args = []) => execFileSync(process.execPath, [join(root, 'scripts/checks', name), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('both architecture checks succeed from an extracted source tree with installed dependencies and build output', async t => {
  const root = await fixture(t); await minimalArchitecture(root);
  await put(root, 'node_modules/pkg/README.md', '[broken](missing.md)');
  await put(root, 'services/platform/frontend/dist/index.html');
  const layout = JSON.parse(check(root, 'audit-source-layout.mjs', ['--strict']));
  const architecture = JSON.parse(check(root, 'validate-service-architecture.mjs'));
  assert.equal(layout.ok, true); assert.equal(layout.file_inventory, 'filesystem');
  assert.equal(architecture.ok, true); assert.equal(architecture.file_inventory, 'filesystem');
});

test('real Git checkouts still fail both audits when dependency or generated files are tracked', async t => {
  const root = await fixture(t); await minimalArchitecture(root); git(root, ['init', '--quiet']);
  await put(root, 'node_modules/pkg/index.js'); await put(root, 'services/runtime/dist/output.js');
  git(root, ['add', '--force', '--', 'node_modules/pkg/index.js', 'services/runtime/dist/output.js']);
  for (const name of ['audit-source-layout.mjs', 'validate-service-architecture.mjs']) {
    assert.throws(() => check(root, name), error => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, /tracked/);
      assert.match(error.stderr, /node_modules/);
      return true;
    });
  }
});
