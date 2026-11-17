import { readFile } from 'node:fs/promises';

// Source contracts inspect the effective stylesheet after entry files acquire
// ordered imports. Browser/build validation still uses the real CSS loader.
export async function readSourceFile(file, encoding = 'utf8', ancestors = new Set()) {
  const source = await readFile(file, encoding);
  const url = file instanceof URL ? file : new URL(`file://${file}`);
  if (!url.pathname.endsWith('.css')) return source;
  if (ancestors.has(url.href)) throw new Error(`Stylesheet import cycle: ${url.pathname}`);
  const seen = new Set(ancestors).add(url.href);
  const imports = [...source.matchAll(/@import\s+["'](\.[^"']+\.css)["']\s*;/g)];
  if (!imports.length) return source;
  let result = '', offset = 0;
  for (const match of imports) {
    result += source.slice(offset, match.index) + await readSourceFile(new URL(match[1], url), encoding, seen);
    offset = match.index + match[0].length;
  }
  return result + source.slice(offset);
}

// Page contracts follow only the capability's extracted workspace modules. This
// keeps their existing assertions attached to production code after a seam moves.
export async function readTestingWorkspaceSource(file, encoding = 'utf8') {
  const url = file instanceof URL ? file : new URL(`file://${file}`);
  const seen = new Set();
  const allowed = /\/services\/testing\/frontend\/(?:pages\/execution-workspace|workspaces\/test-cases)\//;
  async function visit(current, entry = false) {
    if (seen.has(current.href)) return '';
    seen.add(current.href);
    const source = await readSourceFile(current, encoding);
    if (!entry && !allowed.test(current.pathname)) return source;
    const children = [];
    for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
      const target = new URL(match[1], current);
      if (!allowed.test(target.pathname)) continue;
      for (const suffix of /\.[jt]sx?$/.test(target.pathname) ? [''] : ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = new URL(target.href + suffix);
        try { children.push(await visit(candidate)); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    return [source, ...children].join('\n');
  }
  return visit(url, /\/(?:ExecutionsPage|TestCasesPage)\.tsx$/.test(url.pathname));
}
