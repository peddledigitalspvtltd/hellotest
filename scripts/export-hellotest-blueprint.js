#!/usr/bin/env node
// Deterministic local export; no provider calls or workspace mutations.
const fs = require('node:fs');
const path = require('node:path');
const blueprint = require('../backend/api/src/services/sampleData/hellotestBlueprint');
const { renderBlueprintMarkdown } = require('../backend/api/src/services/sampleData/hellotestFeatureRecords');
const directory = path.resolve(__dirname, '../docs/product');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'hellotest-feature-blueprint.json'), JSON.stringify(blueprint, null, 2) + '\n');
fs.writeFileSync(path.join(directory, 'hellotest-feature-stories.md'), renderBlueprintMarkdown());
process.stdout.write(`Exported ${blueprint.features.length} stories, ${blueprint.sprints.length} sprints and ${blueprint.releases.length} sample releases to ${directory}\n`);
