// Compatibility reader for offline documentation exports and existing callers.
// The feature catalog is authored with the rest of the versioned setup files.
const fs = require('node:fs');
const path = require('node:path');
const { loadManifest } = require('./repository');
module.exports = JSON.parse(fs.readFileSync(path.join(loadManifest().root, 'reference/hellotest-feature-blueprint.json'), 'utf8'));
