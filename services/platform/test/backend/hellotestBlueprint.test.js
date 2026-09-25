const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const blueprint = require('../../backend/services/sampleData/hellotestBlueprint');
const { buildRecords, loadManifest } = require('../../backend/services/sampleData/repository');
const PROJECT = loadManifest().manifest.project_id;
const { renderBlueprintMarkdown, featureId, sprintId, releaseId } = require('../../backend/services/sampleData/hellotestFeatureRecords');
const root = path.resolve(__dirname, '../../../..');
const featuresByKey = new Map(blueprint.features.map(feature => [feature.key, feature]));
const packs = buildRecords('blueprint-test-owner', new Date('2026-09-20T00:00:00.000Z'));
const rows = table => Object.values(packs).flat().filter(record => record.table === table).map(record => record.values);

test('blueprint covers every routed workspace capability and accounts for every feature flag', () => {
  const capabilitiesSource = fs.readFileSync(path.join(root, 'services/platform/frontend/src/platform/lib/workspaceCapabilities.ts'), 'utf8');
  const capabilities = [...capabilitiesSource.matchAll(/\{ id: "([^"]+)"/g)].map(match => match[1]);
  assert.ok(capabilities.length > 25, 'Read the actual capability inventory');
  const covered = new Set(blueprint.features.flatMap(feature => feature.capabilities));
  assert.deepEqual(capabilities.filter(key => !covered.has(key)), [], 'Every actual navigation capability needs an authored story');
  assert.deepEqual([...covered].filter(key => !capabilities.includes(key)), [], 'Do not invent navigation capabilities');
  const { FEATURE_DEFINITIONS } = require('../../backend/services/featureFlag.service');
  const availableFlags = new Set(FEATURE_DEFINITIONS.map(item => item.key));
  const storyFlags = new Set(blueprint.features.flatMap(feature => feature.feature_keys));
  const reserved = new Set(blueprint.catalog_only_flags.map(item => item.key));
  assert.deepEqual([...availableFlags].filter(key => !storyFlags.has(key) && !reserved.has(key)), []);
  assert.deepEqual([...storyFlags, ...reserved].filter(key => !availableFlags.has(key)), []);
  for (const entry of blueprint.catalog_only_flags) assert.ok(entry.reason.includes('no standalone'));
});

test('feature stories have distinct scope, source provenance, acceptance boundaries and acyclic dependencies', () => {
  assert.equal(featuresByKey.size, blueprint.features.length);
  assert.equal(new Set(blueprint.features.map(item => item.title)).size, blueprint.features.length);
  for (const feature of blueprint.features) {
    assert.match(feature.user_story, /^As a .+, I want to .+\.$/);
    assert.ok(feature.acceptance_criteria.length >= 3);
    assert.equal(new Set(feature.acceptance_criteria).size, feature.acceptance_criteria.length);
    assert.ok(feature.boundary.length > 35, `${feature.key} needs an actionable failure boundary`);
    assert.ok(feature.labels.includes('hellotest-core'));
    assert.ok(feature.effort_story_points > 0);
    for (const file of feature.source_files) assert.ok(fs.existsSync(path.join(root, file)), `${feature.key}: ${file}`);
    const visited = new Set();
    function visit(key) {
      assert.ok(featuresByKey.has(key), `Missing dependency ${key}`);
      assert.ok(!visited.has(key), `Circular dependency from ${feature.key}`);
      visited.add(key);
      featuresByKey.get(key).depends_on.forEach(visit);
      visited.delete(key);
    }
    visit(feature.key);
  }
});

test('planning records link canonical sprint and release identities with consistent dates, owners and effort', () => {
  const stories = new Map(rows('requirements').map(item => [item.id, item]));
  const sprints = new Map(rows('requirement_iterations').map(item => [item.id, item]));
  const releases = new Map(rows('requirement_releases').map(item => [item.id, item]));
  const links = rows('requirement_release_items');
  for (const feature of blueprint.features) {
    const story = stories.get(featureId(feature.key));
    const release = releases.get(releaseId(feature.release_key));
    assert.equal(story.project_id, PROJECT);
    assert.equal(story.created_by, 'blueprint-test-owner');
    assert.equal(story.additional_fields.assignee_id, 'blueprint-test-owner');
    assert.equal(story.additional_fields.effort_story_points, feature.effort_story_points);
    assert.equal(story.additional_fields.original_dev_id, null, 'Do not invent staff assignments');
    assert.equal(story.additional_fields.original_qa_id, null);
    assert.equal(story.release, release.name);
    assert.equal(story.fix_version, release.fix_version);
    assert.ok(story.description.includes(feature.boundary));
    assert.equal(story.gherkin_scenarios.length, feature.acceptance_criteria.length + 1);
    const link = links.filter(item => item.requirement_id === story.id);
    assert.equal(link.length, 1);
    assert.equal(link[0].release_id, release.id);
    if (feature.sprint_key) {
      const sprint = sprints.get(sprintId(feature.sprint_key));
      assert.equal(story.iteration_id, sprint.id);
      assert.equal(story.sprint, sprint.name);
      assert.ok(release.sprint_ids.includes(sprint.id));
      assert.equal(link[0].source, 'sprint');
      assert.ok(Date.parse(story.dev_completion_target_date) >= Date.parse(sprint.start_date));
      assert.ok(Date.parse(story.dev_completion_target_date) <= Date.parse(story.qa_completion_target_date));
      assert.equal(story.qa_completion_target_date, sprint.end_date);
      assert.ok(Date.parse(sprint.end_date) <= Date.parse(release.target_date));
    } else {
      assert.equal(story.iteration_id, null);
      assert.equal(story.sprint, null);
      assert.equal(story.dev_completion_target_date, null);
      assert.equal(story.qa_completion_target_date, null);
      assert.equal(link[0].source, 'manual');
      assert.equal(story.status, 'draft');
    }
  }
  for (const sprint of blueprint.sprints) {
    assert.equal(sprints.get(sprintId(sprint.key)).effort_points,
      blueprint.features.filter(feature => feature.sprint_key === sprint.key).reduce((sum, feature) => sum + feature.effort_story_points, 0));
  }
});

test('new acceptance stories do not claim completion or fabricated execution coverage', () => {
  const ids = new Set(blueprint.features.map(feature => featureId(feature.key)));
  for (const story of rows('requirements').filter(item => ids.has(item.id))) {
    assert.ok(['draft', 'ready'].includes(story.status));
    assert.equal(story.additional_fields.execution_evidence, false);
  }
  assert.equal(rows('requirement_test_cases').filter(item => ids.has(item.requirement_id)).length, 0);
  assert.equal(rows('test_cases').filter(item => ids.has(item.requirement_id)).length, 0);
  assert.equal(rows('requirements').filter(item => item.id.startsWith('sample-v2-')).length, 6, 'Retain the independent legacy commerce story set');
  assert.ok(rows('executions').every(item => item.id.startsWith('sample-v2-') || item.id.startsWith('sample-v4-metrics-') || item.id.startsWith('sample-v5-data-') || item.id.startsWith('sample-v6-ht-')), 'Only explicitly labeled synthetic examples create sample runs; source blueprint authoring remains unexecuted');
});

test('portable artifacts match installed content and lexical knowledge keeps exact document offsets and ACL', () => {
  const markdown = renderBlueprintMarkdown();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'docs/product/hellotest-feature-blueprint.json'), 'utf8')), blueprint);
  assert.equal(fs.readFileSync(path.join(root, 'docs/product/hellotest-feature-stories.md'), 'utf8'), markdown);
  const artifacts = rows('workspace_transaction_artifacts');
  assert.equal(artifacts.find(item => item.id === 'sample-v3-artifact-hellotest-stories').content, markdown);
  assert.deepEqual(JSON.parse(artifacts.find(item => item.id === 'sample-v3-artifact-hellotest-json').content), blueprint);
  const chunks = rows('ai_knowledge_chunks').filter(item => item.document_id === 'sample-v3-document-hellotest');
  assert.equal(chunks.length, blueprint.groups.length);
  for (const chunk of chunks) {
    assert.equal(chunk.content, markdown.slice(chunk.char_start, chunk.char_end));
    assert.ok(chunk.content.startsWith(`### ${chunk.heading}`));
    assert.equal(chunk.search_vector, chunk.content);
    assert.ok(chunk.char_end > chunk.char_start);
  }
  const index = rows('ai_knowledge_index_states').find(item => item.document_id === 'sample-v3-document-hellotest');
  assert.equal(index.lexical_state, 'ready');
  assert.equal(index.dense_state, 'not_configured');
  assert.equal(index.indexed_chunk_count, chunks.length);
  assert.ok(rows('ai_knowledge_security_bindings').some(item => item.source_id === 'sample-v3-source-hellotest' && item.principal_id === PROJECT && item.effect === 'ALLOW'));
});
