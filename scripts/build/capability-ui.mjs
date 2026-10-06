import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'services/platform/frontend/package.json'));
const { build } = require('vite');
const ts = require('typescript');
const owner = process.argv[2];
const owners = Object.keys(JSON.parse(readFileSync(resolve(root, 'services/capabilities.json'))).dependencies);
if (owner === 'all') {
  for (const name of owners) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], { cwd: root, stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status || 1);
  }
  process.exit(0);
}
if (!owners.includes(owner)) throw new Error('Supply a configured capability name.');
const packageRoot = resolve(root, 'services', owner);
const metadata = JSON.parse(readFileSync(resolve(packageRoot, 'package.json')));
const platformExports = JSON.parse(readFileSync(resolve(root, 'services/platform/package.json'))).exports;
const providerModules = {
  'react': 'react', 'react/jsx-runtime': 'react/jsx-runtime', 'react-dom': 'react-dom', 'react-dom/client': 'react-dom/client',
  'react-router-dom': 'react-router-dom', '@tanstack/react-query': '@tanstack/react-query'
};
const sourceModules = {
  'services/platform/frontend/src/auth/AuthContext': 'auth', 'services/platform/frontend/src/context/LocalizationContext': 'localization',
  'services/platform/frontend/src/lib/httpClient': 'http', 'services/platform/frontend/src/lib/aiHttpClient': 'aiHttp',
  'services/platform/frontend/src/shared/hooks/useDialogFocus': 'dialogFocus',
  'services/platform/frontend/src/shared/components/LoadingState': 'loading',
  'services/platform/frontend/src/platform/capabilities/loadCapability': 'capabilityLoader'
};
function exportedNames(file) {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = [];
  for (const node of ast.statements) {
    if (!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) { if (node.name) names.push(node.name.text); }
    if (ts.isVariableStatement(node)) for (const variable of node.declarationList.declarations) if (ts.isIdentifier(variable.name)) names.push(variable.name.text);
  }
  return names;
}
const hostExports = Object.fromEntries(Object.keys(providerModules).map(name => [name, Object.keys(require(name)).filter(key => key !== 'default' && /^[$\w]+$/.test(key))]));
for (const [source, key] of Object.entries(sourceModules)) {
  const file = ['.tsx', '.ts'].map(extension => resolve(root, source + extension)).find(file => { try { readFileSync(file); return true; } catch { return false; } });
  hostExports[key] = exportedNames(file);
}
const front = JSON.parse(readFileSync(resolve(root, 'services/platform/frontend/package.json')));
const aliases = Object.keys(front.dependencies).filter(name => !(name in providerModules)).map(name => ({ find: name, replacement: resolve(root, 'services/platform/frontend/node_modules', name) }));
const outDir = process.env.CAPABILITY_UI_OUTPUT_ROOT ? resolve(process.env.CAPABILITY_UI_OUTPUT_ROOT, owner) : resolve(packageRoot, 'dist/ui');
const result = await build({
  configFile: false, root: packageRoot, publicDir: false,
  resolve: { alias: aliases, dedupe: Object.keys(front.dependencies) },
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{
    name: 'hellotest-capability-host',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source in providerModules) return '\0hellotest-host:' + providerModules[source];
      const platformTarget = source.startsWith('@hellotest/platform/')
        ? platformExports['./' + source.slice('@hellotest/platform/'.length)] : null;
      if (platformTarget || (importer && source.startsWith('.'))) {
        const absolute = (platformTarget ? resolve(root, 'services/platform', platformTarget)
          : resolve(dirname(importer), source)).replace(/\.(tsx?|jsx?)$/, '');
        for (const [file, key] of Object.entries(sourceModules)) if (absolute === resolve(root, file)) return '\0hellotest-host:' + key;
      }
    },
    load(id) {
      if (!id.startsWith('\0hellotest-host:')) return;
      const key = id.slice('\0hellotest-host:'.length);
      return `const host = window.__HELLOTEST_UI_HOST__;\nif (host?.protocol !== 1) throw new Error('Incompatible HelloTest UI host');\nconst value = host.modules[${JSON.stringify(key)}];\nexport default value.default || value;\n` + hostExports[key].map(name => `export const ${name} = value.${name};`).join('\n');
    }
  }],
  build: {
    outDir, emptyOutDir: true, sourcemap: process.env.HELLOTEST_DEBUG_SOURCEMAPS === 'true' ? 'inline' : false, cssCodeSplit: false,
    lib: { entry: resolve(packageRoot, 'frontend/entry.ts'), formats: ['es'] },
    rollupOptions: { output: { entryFileNames: 'entry-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } }
  }
});
const output = result.output || result[0].output;
const entry = output.find(file => file.type === 'chunk' && file.isEntry);
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify({ protocol: 1, capability: owner, version: metadata.version, entry: entry.fileName, styles: output.filter(file => file.type === 'asset' && file.fileName.endsWith('.css')).map(file => file.fileName) }, null, 2) + '\n');
console.log(`Built ${metadata.name}@${metadata.version}: ${outDir}`);
