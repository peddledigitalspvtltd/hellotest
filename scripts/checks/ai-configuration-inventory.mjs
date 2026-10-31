#!/usr/bin/env node
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Generated browser metadata, not another independently editable policy store.
// Migration dictionaries and full provider prompts do not belong in node UI bundles.
export function executionDefaults(catalog) {
  return catalog.map(item=>({id:item.id,defaults:{...Object.fromEntries(['temperature','top_p','max_output_tokens','context','agent_execution','output_schema'].filter(key=>Object.hasOwn(item.defaults,key)).map(key=>[key,item.defaults[key]])),
    ...(item.defaults.instruction_blocks['application.artifactContract']?{instruction_blocks:{'application.artifactContract':item.defaults.instruction_blocks['application.artifactContract']}}:{})}}));
}
const omitted = new Set(['node_modules', '.git', 'test', 'tests', 'dist', 'dist-admin', 'eval', 'instance-setup-data', 'artifacts', '__pycache__']);
// An embeddings URL ends its string/template endpoint here. A plain archive
// path matcher such as /\/embeddings\// is not a provider request.
const modelSignal = /fetchLlmWithRetry\s*\(|fetchCompletion\s*\(|(?:modelGateway|gateway)\.request\s*\(|requestJsonCompletion\s*\(|chat\/completions|\/embeddings\/?["'`]|\.embeddings\.create|\.chat\.completions\.create|\.responses\.create|\.messages\.create|generateContent|(?:require\(|from\s+)["'](?:openai|@anthropic-ai\/sdk)["']/;

// These are transport responsibilities, not alternative feature definitions.
// Every ordinary generation still needs a catalog identity and the shared HTTP boundary.
const boundaries = new Map([
  ['scripts/checks/ai-configuration-inventory.mjs', 'source_audit'],
  ['services/platform/backend/src/utils/aiFeatureRuntime.js', 'shared_policy'],
  ['services/platform/backend/src/utils/llmHttpClient.js', 'shared_transport'],
  ['services/knowledge/backend/services/knowledgeJsonCompletion.service.js', 'model_adapter'],
  ['services/knowledge/backend/services/knowledgeModelGateway.service.js', 'model_adapter'],
  ['services/platform/backend/src/services/integrationConnectionProbe.service.js', 'connection_probe'],
  ['services/trace/backend/routes/opsConsole.routes.js', 'native_telemetry'],
  ['services/trace/backend/routes/opsTelemetry.routes.js', 'native_telemetry'],
  ['services/agentic/backend/runtime/semantic_compiler/vendor/qaira_semantic_compiler/core/llm_client.py', 'inactive_vendor_model']
]);

export function readAiSources(root = repository) {
  const sources = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (omitted.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:[cm]?js|tsx?|py)$/.test(path) && !/\.test\.[cm]?js$/.test(path)) sources.push({path: relative(root, path), source: readFileSync(path, 'utf8')});
    }
  }
  for (const directory of ['services', 'testengine', 'local-run', 'scripts']) walk(resolve(root, directory));
  return sources;
}

export function inspectAiConfiguration({root = repository, sources = readAiSources(root)} = {}) {
  const catalog = JSON.parse(readFileSync(resolve(root, 'services/platform/shared/aiFeatureCatalog.json'), 'utf8'));
  const projection = JSON.parse(readFileSync(resolve(root, 'services/platform/shared/aiPromptDefaults.json'), 'utf8'));
  const profiles = new Map(catalog.map(item => [item.id, item]));
  const identities = new Map();
  const failures = [];
  const browserDefaults=JSON.parse(readFileSync(resolve(root,'services/platform/shared/aiExecutionDefaults.json'),'utf8'));
  if(JSON.stringify(browserDefaults)!==JSON.stringify(executionDefaults(catalog)))failures.push('Generated execution defaults are stale. Run node scripts/checks/ai-configuration-inventory.mjs --write-defaults.');
  const entryPoints = new Map(catalog.map(item => [item.id, new Set()]));
  const transports = [];
  for (const item of catalog) {
    if (!['admin', 'agent'].includes(item.configuration_owner)) failures.push(`${item.id}: missing configuration owner`);
    if (item.transport === 'chat' && !['json', 'text', 'html'].includes(item.output_kind)) failures.push(`${item.id}: missing native response kind`);
    if (item.id.startsWith('ai.agentic.') && item.configuration_owner !== 'agent') failures.push(`${item.id}: agent configuration cannot be admin-owned`);
    for (const identity of [item.id, ...item.aliases]) {
      if (identities.has(identity)) failures.push(`${identity}: duplicate feature/operation identity`);
      identities.set(identity, item.id);
    }
    for (const key of Object.keys(item.defaults.instruction_blocks)) {
      if (typeof item.defaults.instruction_blocks[key] !== 'string') failures.push(`${item.id}:${key}: invalid instruction`);
    }
  }
  const publicIds = new Set();
  for (const item of projection) {
    const profile = profiles.get(item.key);
    if (publicIds.has(item.key)) failures.push(`${item.key}: duplicate public default`);
    publicIds.add(item.key);
    if (!profile || profile.configuration_owner !== 'admin' || profile.runtime_status === 'reserved') failures.push(`${item.key}: public default has no active admin owner`);
    if (profile && item.value !== profile.defaults.prompt) failures.push(`${item.key}: public default differs from the canonical prompt`);
  }
  for (const item of catalog.filter(item => item.configuration_owner === 'admin' && item.runtime_status !== 'reserved')) {
    if (!publicIds.has(item.id)) failures.push(`${item.id}: omitted from public admin defaults`);
  }
  for (const {path, source} of sources) {
    const used = new Set();
    for (const match of source.matchAll(/aiInstructionBlock\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g)) {
      const profile = profiles.get(match[1]);
      if (!profile) failures.push(`${path}: unknown instruction profile ${match[1]}`);
      else if (!Object.hasOwn(profile.defaults.instruction_blocks, match[2])) failures.push(`${path}: missing instruction ${match[1]}:${match[2]}`);
      if (profile) used.add(profile.id);
    }
    // Literal usage identities and named constants cover direct calls; dynamic
    // agent/browser selectors are separately constrained by their runtime allowlists.
    for (const match of source.matchAll(/["'](ai\.[A-Za-z0-9_.-]+)["']/g)) if (identities.has(match[1])) used.add(identities.get(match[1]));
    for (const match of source.matchAll(/`(ai\.[A-Za-z0-9_.-]+)\$\{/g)) {
      for (const id of profiles.keys()) if (id.startsWith(match[1])) used.add(id);
    }
    for (const match of source.matchAll(/\boperation\s*:\s*["']([^"']+)["']/g)) if (identities.has(match[1])) used.add(identities.get(match[1]));
    for (const id of used) entryPoints.get(id).add(path);
    if (!modelSignal.test(source) && !boundaries.has(path)) continue;
    const kind = boundaries.get(path) || 'feature_generation';
    if (kind === 'feature_generation') {
      if (!used.size) failures.push(`${path}: model call has no statically registered feature or adapter boundary`);
      if (!/fetchLlmWithRetry|fetchCompletion|(?:modelGateway|gateway)\.request|requestJsonCompletion/.test(source)) failures.push(`${path}: model transport bypasses the shared generation boundary`);
      for (const match of source.matchAll(/\b(?:featureKey|usageKey)\s*:\s*["']([^"']+)["']/g)) {
        if (!identities.has(match[1])) failures.push(`${path}: unmapped feature selection ${match[1]}`);
      }
    }
    transports.push({path, kind, profiles: [...used].sort(), configuration_owners: [...new Set([...used].map(id => profiles.get(id).configuration_owner))].sort(),
      ...(kind === 'inactive_vendor_model' ? {runtime_status:'inactive', note:'The repository worker invokes the deterministic compile.py adapter, not the vendored model orchestrator.'} : {})});
  }
  return {
    ok: failures.length === 0,
    scanned_sources: sources.length,
    counts: {profiles: catalog.length, admin_configurable: catalog.filter(item => item.configuration_owner === 'admin' && item.runtime_status !== 'reserved').length,
      agent_owned: catalog.filter(item => item.configuration_owner === 'agent').length,
      active_agent: catalog.filter(item => item.configuration_owner === 'agent' && item.runtime_status !== 'reserved').length,
      reserved: catalog.filter(item => item.runtime_status === 'reserved').length,
      classified_sources: transports.length, generation_sources: transports.filter(item => item.kind === 'feature_generation').length},
    transports,
    profiles: catalog.map(item => ({id: item.id, configuration_owner: item.configuration_owner, transport: item.transport,
      runtime_status: item.runtime_status || 'active', operations: item.aliases, entry_points: [...entryPoints.get(item.id)].sort()})),
    failures
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if(process.argv.includes('--write-defaults')) {
    const catalog=JSON.parse(readFileSync(resolve(repository,'services/platform/shared/aiFeatureCatalog.json'),'utf8'));
    writeFileSync(resolve(repository,'services/platform/shared/aiExecutionDefaults.json'),JSON.stringify(executionDefaults(catalog),null,2)+'\n');
  }
  const result = inspectAiConfiguration();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
