const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILD_FEATURES, buildFeature } = require('../../backend/services/aiAutomationFeaturePolicy');
const catalog = require('../../../platform/shared/aiFeatureCatalog.json');
test('automation task selection is bounded to independently governed build profiles', () => {
 assert.equal(buildFeature(undefined),'ai.automation.keyword_generation');
 for(const id of BUILD_FEATURES){assert.equal(buildFeature(id),id);assert.ok(catalog.some(profile=>profile.id===id));}
 for(const input of ['ai.admin.prompt_optimization','ai.agentic.browser_decision','arbitrary',{},''])assert.throws(()=>buildFeature(input),{code:'AI_FEATURE_INVALID'});
});
