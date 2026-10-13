import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await markdownFiles(path.join(directory, entry.name)));
    else if (entry.name.endsWith('.md')) files.push(path.join(directory, entry.name));
  }
  return files;
}
const files = await markdownFiles(path.join(root, 'docs'));
const errors = [];
for (const file of files) {
  // Ignore example links inside fenced code, but validate all real local targets.
  const content = (await readFile(file, 'utf8')).replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    const location = path.resolve(path.dirname(file), decodeURIComponent(target.split('?')[0]));
    try { await stat(location); }
    catch { errors.push(`${path.relative(root, file)}: missing ${target}`); }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Documentation links verified: ${files.length} Markdown files.`);
