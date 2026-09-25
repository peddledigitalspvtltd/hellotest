import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const files = [];
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { if (!['node_modules','test','tests','dist','dist-admin','eval','instance-setup-data'].includes(item.name)) walk(path); } else files.push(path);
  }
}
const servicesRoot = fileURLToPath(new URL('../../../../', import.meta.url));
for (const item of readdirSync(servicesRoot, { withFileTypes: true })) {
  if (item.isDirectory()) walk(join(servicesRoot, item.name, 'frontend'));
}
// Source-inspection tests identify a component by name, independent of its owner.
export function sourceFile(name, layer) {
  const filename = basename(name);
  const matches = files.filter(file => basename(file) === filename && (!layer || file.includes(`/${layer}/`)));
  if (matches.length !== 1) throw new Error(`Expected one ${layer || 'source'} module named ${filename}; found ${matches.length}`);
  return pathToFileURL(matches[0]);
}
// Injected collaborators are keyed by module identity, not folder depth.
export const dependencyName = id => basename(id);
