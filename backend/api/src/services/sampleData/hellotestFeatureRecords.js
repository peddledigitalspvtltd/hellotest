// Offline reference helpers. Setup itself consumes the manifest's object files.
const fs = require('node:fs');
const path = require('node:path');
const { loadManifest } = require('./repository');
const renderBlueprintMarkdown = () => fs.readFileSync(path.join(loadManifest().root, 'reference/hellotest-feature-stories.md'), 'utf8');
const featureId = key => `sample-v3-feature-${key}`;
const sprintId = key => `sample-v3-ht-sprint-${key}`;
const releaseId = key => `sample-v3-ht-release-${key}`;
module.exports = { renderBlueprintMarkdown, featureId, sprintId, releaseId };
