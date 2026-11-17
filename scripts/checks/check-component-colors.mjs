import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'services/platform/frontend/package.json'));
const postcss = require('postcss');

/** Check declaration values, never selectors, comments or embedded asset strings. */
export function findLiteralColors(css, from = 'component.css') {
  const failures = [];
  postcss.parse(css, { from }).walkDecls(declaration => {
    const value = declaration.value.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/url\((?:[^)(]|\([^)(]*\))*\)/gi, '')
      .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    if (/#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/i.test(value)) {
      failures.push({ file: from, line: declaration.source?.start?.line, property: declaration.prop, message: 'Use a semantic UI token instead of a literal hex color.' });
    }
  });
  return failures;
}

export function checkComponentColors() {
  const failures = [];
  let stylesheets = 0;
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.css')) {
        stylesheets++;
        failures.push(...findLiteralColors(readFileSync(file, 'utf8'), relative(root, file)));
      }
    }
  }
  for (const service of ['automation', 'agentic', 'ai']) visit(resolve(root, `services/${service}/frontend`));
  return { ok: failures.length === 0, stylesheets, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkComponentColors();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
