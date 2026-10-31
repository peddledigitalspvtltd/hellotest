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

test('every static instruction and generation operation has one registered admin or agent owner', () => {
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

test('model system messages do not introduce literal behavioral instructions outside their configuration owner',()=>{
  for(const [file,source] of sources) {
    if(!source.includes('fetchLlmWithRetry') && !source.includes('requestJsonCompletion'))continue;
    for(const match of source.matchAll(/role\s*:\s*(["'])(?:system|developer)\1\s*,\s*content\s*:\s*(["'])([^\n]*?)\2/g)) {
      assert.doesNotMatch(match[3],/^(?:You are|Return|Generate|Review|Use only|Never|Do not|Follow|Honor)\b/i,`${file}: behavioral instructions must use a managed template`);
    }
  }
});

test('the whole-repository model inventory captures adapters, small features and explicit transport exceptions',async()=>{
  const {inspectAiConfiguration}=await import('../../../../scripts/checks/ai-configuration-inventory.mjs');
  const inventory=inspectAiConfiguration();
  assert.deepEqual(inventory.failures,[]);
  assert.ok(inventory.scanned_sources>1000);
  assert.ok(inventory.transports.some(item=>item.kind==='inactive_vendor_model'&&item.runtime_status==='inactive'));
  assert.ok(inventory.transports.some(item=>item.kind==='connection_probe'));
  for(const id of ['ai.authoring.request_validation','ai.automation.recorder_mapping','ai.knowledge.graph_extract','ai.execution.report_analysis']) {
    assert.ok(inventory.profiles.find(item=>item.id===id)?.entry_points.length,`${id}: no source consumer`);
  }
});

test('inventory rejects new unmapped selections and raw model transports instead of silently omitting them',async()=>{
  const {inspectAiConfiguration}=await import('../../../../scripts/checks/ai-configuration-inventory.mjs');
  const raw=inspectAiConfiguration({sources:[{path:'services/ai/backend/services/newFeature.js',source:"fetch('https://provider.invalid/chat/completions', {body: JSON.stringify({model, messages})});"}]});
  assert.ok(raw.failures.some(message=>message.includes('model call has no statically registered feature')));
  assert.ok(raw.failures.some(message=>message.includes('bypasses the shared generation boundary')));
  const embedding=inspectAiConfiguration({sources:[{path:'services/knowledge/backend/services/newEmbedding.js',source:"client.embeddings.create({model:'embed',input:chunks});"}]});
  assert.ok(embedding.failures.some(message=>message.includes('bypasses the shared generation boundary')));
  const unmapped=inspectAiConfiguration({sources:[{path:'services/ai/backend/services/newFeature.js',source:"fetchLlmWithRetry(url, init, {featureKey:'ai.missing.profile'});"}]});
  assert.ok(unmapped.failures.some(message=>message.includes('unmapped feature selection ai.missing.profile')));
});

test('embedding endpoint detection excludes Office archive path regexes while retaining URL and SDK calls',async()=>{
  const {inspectAiConfiguration}=await import('../../../../scripts/checks/ai-configuration-inventory.mjs');
  const archive=inspectAiConfiguration({sources:[{path:'services/knowledge/backend/services/officeArchive.js',source:String.raw`if (/(?:vbaproject\.bin|\/activex\/|\/embeddings\/)/i.test(directory)) throw new Error('Embedded Office objects are rejected.');`}]});
  assert.deepEqual(archive.transports,[]);
  assert.deepEqual(archive.failures,[]);
  for(const source of [
    "fetch(`${base}/embeddings`, {method:'POST',body:JSON.stringify({input})});",
    "fetch(`${base}/embeddings/`, {method:'POST',body:JSON.stringify({input})});",
    "fetch('https://provider.invalid/v1/embeddings', {method:'POST'});",
    "client.embeddings.create({model:'embed',input:chunks});"
  ]){
    const detected=inspectAiConfiguration({sources:[{path:'services/knowledge/backend/services/newEmbedding.js',source}]});
    assert.equal(detected.transports.length,1,source);
    assert.ok(detected.failures.some(message=>message.includes('bypasses the shared generation boundary')),source);
  }
});
