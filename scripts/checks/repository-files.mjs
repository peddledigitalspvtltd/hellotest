import { execFileSync } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const generatedDirectories = new Set([
  '.git', '.cache', 'coverage', 'dist', 'dist-admin', 'node_modules',
  '.playwright-browsers', '.qaira', '.hellotest', '.firecrawl',
  '__pycache__', '.pytest_cache', '.next', '.turbo', 'playwright-report', 'test-results',
]);
const localFile = name => name === '.DS_Store' || /\.(?:tsbuildinfo|db|sqlite|sqlite3|log|pid|pyc|pyo)$/.test(name)
  || name === '.env' || (name.startsWith('.env.') && name !== '.env.example');
// Build tooling is source (scripts/build); only package output locations are omitted.
const buildOutput = path => path === 'build'
  || /^(?:services\/[^/]+(?:\/(?:backend|frontend))?|testengine(?:\/(?:backend|frontend))?|local-run\/mobile-engine)\/build$/.test(path);

/** Enumerate maintained archive files without entering dependency trees or symlinks. */
export async function listFilesystemSourceFiles(root) {
  const files = [];
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        if (!generatedDirectories.has(entry.name) && !buildOutput(path) && path !== 'local-run/artifacts') await visit(resolve(directory, entry.name), path);
      } else if (entry.isFile() && !localFile(entry.name)) files.push(path);
    }
  };
  await visit(resolve(root));
  return files.sort();
}

/**
 * Git checkouts retain every tracked path, including forbidden generated files.
 * Source ZIPs have no tracking metadata and use a maintained-file inventory.
 * Check only this root's metadata so an archive inside another repo stays scoped.
 */
export async function enumerateRepositoryFiles(root) {
  const absoluteRoot = resolve(root);
  let hasGit = false;
  try {
    await lstat(resolve(absoluteRoot, '.git'));
    hasGit = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!hasGit) return { source: 'filesystem', files: await listFilesystemSourceFiles(absoluteRoot) };
  // Never turn a damaged Git index or metadata directory into a weaker check.
  const output = execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: absoluteRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { source: 'git', files: output.split('\0').filter(Boolean).sort() };
}
