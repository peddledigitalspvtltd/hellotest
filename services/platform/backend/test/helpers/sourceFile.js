const { readdirSync, existsSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');
const files = [];
function walk(directory) {
  if (!existsSync(directory)) return;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { if (!['node_modules','test','tests','dist','dist-admin','eval','instance-setup-data'].includes(item.name)) walk(path); } else if (path.endsWith('.js')) files.push(path);
  }
}
for (const item of readdirSync(resolve(__dirname, '../../../..'), { withFileTypes: true })) {
  if (item.isDirectory()) walk(resolve(__dirname, '../../../..', item.name, 'backend'));
}
exports.sourceFile = (name, layer) => {
  if (name.includes('/utils/')) layer = 'utils';
  if (name.includes('/domain/')) layer = 'domain';
  if (['db', 'obsDb'].includes(basename(name))) layer = undefined;
  const filename = basename(name).replace(/\.js$/, '') + '.js';
  const matches = files.filter(file => basename(file) === filename && (!layer || file.includes(`/${layer}/`)));
  if (matches.length !== 1) throw new Error(`Expected one ${layer || 'source'} module named ${filename}; found ${matches.length}`);
  return matches[0];
};
// Injected collaborators are keyed by module identity, not folder depth.
exports.dependencyName = id => basename(id.startsWith('@hellotest/') && !/\/(?:backend|frontend|shared)\//.test(id) ? require.resolve(id) : id).replace(/\.js$/, '');

// Source-contract fixtures inspect the real cohesive owners after a split;
// execution fixtures continue to load the public service and its actual ports.
exports.readOwnedAutomationSource = async name => {
  const { readFileSync } = require('node:fs');
  const { implementationSource } = require('../../../../automation/test/helpers/implementationSource');
  const modules = name === 'testEngineDispatch.service'
    ? ['dispatch/engineTypes', 'dispatch/engineEnvelope', 'dispatch/executionPlanning']
    : name === 'aiAutomationBuilder.service' ? ['builder/engineResolution', 'builder/programGeneration', 'builder/recorderImport'] : [];
  return [readFileSync(exports.sourceFile(name), 'utf8'), ...modules.map(implementationSource)].join('\n');
};
