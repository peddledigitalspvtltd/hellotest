const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { storyAiSnapshot, text } = require('@hellotest/platform/backend/src/utils/aiArtifactContext');
const structuredReview = require('./structuredReview.service');

async function preview({ project_id, requirements = [], integration_id, additional_context, user }) {
  if (typeof additional_context === 'string' && additional_context.length > 18000) throw Object.assign(new Error('Shorten Gherkin guidance to 18,000 characters.'), { statusCode: 422, code: 'AI_INPUT_BUDGET_EXCEEDED' });
  const ids = new Set();
  const drafts = requirements.slice(0, 20).map((story, index) => {
    const client_id = text(story.client_id || `requirement-${index + 1}`, 255);
    if (ids.has(client_id)) throw Object.assign(new Error('Story client identifiers must be unique.'), { statusCode: 400 });
    ids.add(client_id);
    return { client_id, story: storyAiSnapshot(story, { textLimit: 1200, itemLimit: 500, listLimit: 8 }) };
  });
  const eligible = drafts.filter(item => item.story.acceptance_criteria.length);
  if (!eligible.length) throw Object.assign(new Error('Provide explicit acceptance criteria before generating Story scenarios.'), { statusCode: 422, code: 'AI_EVIDENCE_REQUIRED' });
  const evidenceFor = (items) => ({ stories: items.map(item => ({ client_id: item.client_id, story: item.story,
    criteria: item.story.acceptance_criteria.map((criterion, index) => ({ ref: `${item.client_id}:AC${index + 1}`, text: criterion })) })), user_guidance: text(additional_context, 18000) });
  const review = await structuredReview.review({ projectId: project_id, userId: user?.id, integrationId: integration_id,
    usageKey: 'ai.requirement.gherkin',
    task: aiInstructionBlock("ai.requirement.gherkin", "storyGherkin.task"),
    evidence: evidenceFor(eligible),
    fallbackEvidence: evidenceFor(eligible.map(item => ({ ...item, story: storyAiSnapshot(item.story, { textLimit: 400, itemLimit: 200, listLimit: 8 }) }))),
    maxOutputTokens: 8192,
    contract: '{"requirements":[{"client_id":"exact supplied client_id","scenarios":[{"gherkin":"Scenario: title\\nGiven ...\\nWhen ...\\nThen ...","criterion_refs":["exact supplied criterion ref"]}]}]}',
    validate(value) {
      if (!value || !Array.isArray(value.requirements) || value.requirements.length !== eligible.length) throw structuredReview.invalid();
      const seen = new Set();
      for (const item of value.requirements) {
        const input = eligible.find(draft => draft.client_id === item?.client_id);
        if (!input || seen.has(item.client_id) || !Array.isArray(item.scenarios) || !item.scenarios.length || item.scenarios.length > 8) throw structuredReview.invalid();
        seen.add(item.client_id);
        const allowed = new Set(input.story.acceptance_criteria.map((_, index) => `${item.client_id}:AC${index + 1}`));
        const distinct = new Set();
        for (const scenario of item.scenarios) {
          if (typeof scenario.gherkin !== 'string' || scenario.gherkin.length > 4000
            || !/^Scenario(?: Outline)?:\s*\S+/im.test(scenario.gherkin)
            || !/^\s*Given\s+\S+/im.test(scenario.gherkin) || !/^\s*When\s+\S+/im.test(scenario.gherkin) || !/^\s*Then\s+\S+/im.test(scenario.gherkin)
            || /documented Story context applies|reviewed behavior is exercised/i.test(scenario.gherkin)
            || !Array.isArray(scenario.criterion_refs) || !scenario.criterion_refs.length || scenario.criterion_refs.some(ref => !allowed.has(ref))) throw structuredReview.invalid();
          const normalized = scenario.gherkin.toLowerCase().replace(/\s+/g, ' ').trim();
          if (distinct.has(normalized)) throw structuredReview.invalid();
          distinct.add(normalized);
        }
      }
      return value;
    }
  });
  const rows = drafts.map(item => ({ client_id: item.client_id, gherkin_scenarios: review.result.requirements.find(row => row.client_id === item.client_id)?.scenarios.map(scenario => scenario.gherkin.trim()) || [] }));
  return { requirements: rows, fallback_used: false, fallback_reason: null, generation_mode: 'llm', integration: review.integration,
    model_execution: review.model_execution, context_reduced: Boolean(review.context_reduced), requires_human_review: true,
    validation: { story_count: rows.length, scenario_count: rows.reduce((sum, row) => sum + row.gherkin_scenarios.length, 0), skipped_story_count: drafts.length - eligible.length,
      repaired_story_count: review.model_execution?.model_calls > 1 ? eligible.length : 0,
      exact_story_draft_used: true, criterion_references_checked: true, semantic_verification: 'human_review_required' } };
}
module.exports = { preview };
