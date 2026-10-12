const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const features = require('../../shared/aiFeatureCatalog.json');
const metrics = require('../../shared/metricCatalog.json');
const profiles = new Map(features.map(item => [item.id, item]));
const operations = new Set(features.flatMap(item => [item.id, ...item.aliases]));
const metricKeys = new Set(metrics.map(item => item.key));
const sources = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules','test','tests','dist','dist-admin','eval','instance-setup-data'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(js|ts|tsx)$/.test(path)) sources.push([path, readFileSync(path, 'utf8')]);
  }
}
walk(resolve(__dirname, '../../..'));

test('every static managed instruction and generation operation has an admin profile', () => {
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/aiInstructionBlock\(["']([^"']+)["'],\s*["']([^"']+)["']\)/g)) {
      assert.ok(profiles.has(match[1]), `${file}: missing feature ${match[1]}`);
      assert.equal(typeof profiles.get(match[1]).defaults.instruction_blocks[match[2]], 'string', `${file}: missing block ${match[2]}`);
    }
    if (!source.includes('fetchLlmWithRetry') || file.endsWith('llmHttpClient.js')) continue;
    for (const match of source.matchAll(/operation\s*:\s*["']([^"']+)["']/g)) {
      if (!match[1].includes('.') || match[1] === 'automation.engine.request') continue; // Native engine I/O has its own transport test.
      assert.ok(operations.has(match[1]), `${file}: unmapped model operation ${match[1]}`);
    }
  }
});

test('metric review consumers use registered definitions and both Story checklists are governed', () => {
  for (const [file, source] of sources) for (const match of source.matchAll(/(?:getMetricCriteria\(|criteriaKey[=:]\s*)["'](metric\.[^"']+)["']/g)) {
    assert.ok(metricKeys.has(match[1]), `${file}: missing metric ${match[1]}`);
  }
  for (const id of ['metric.story.backlog_readiness','metric.story.release_readiness']) assert.ok(metricKeys.has(id));
});

test('model system messages do not introduce literal behavioral instructions outside admin configuration',()=>{
  for(const [file,source] of sources) {
    if(!source.includes('fetchLlmWithRetry') && !source.includes('requestJsonCompletion'))continue;
    for(const match of source.matchAll(/role\s*:\s*(["'])(?:system|developer)\1\s*,\s*content\s*:\s*(["'])([^\n]*?)\2/g)) {
      assert.doesNotMatch(match[3],/^(?:You are|Return|Generate|Review|Use only|Never|Do not|Follow|Honor)\b/i,`${file}: behavioral instructions must use a managed template`);
    }
  }
});
