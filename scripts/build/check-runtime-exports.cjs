const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function checkRuntimeExports(root) {
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  const missing = [];
  let checked = 0;
  for (const entry of fs.readdirSync(path.join(root, 'services'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(root, 'services', entry.name, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    for (const key of Object.keys(metadata.exports || {})) {
      if (!/^\.\/(?:backend|shared)(?:\/|$)/.test(key) || key.includes('*')) continue;
      const specifier = metadata.name + key.slice(1);
      checked += 1;
      try { requireFromRoot.resolve(specifier); }
      catch (error) { missing.push(`${specifier}: ${error.code || error.message}`); }
    }
  }
  if (missing.length) throw new Error(`Runtime exports are missing from the image:\n${missing.join('\n')}`);
  return checked;
}

if (require.main === module) {
  try { console.log(`Verified ${checkRuntimeExports(path.resolve(process.argv[2] || '.'))} runtime exports.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkRuntimeExports };
