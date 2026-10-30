const canonicalChecks = ['intent', 'actor-flow', 'business-outcome', 'acceptance', 'scope-boundary', 'solution-design', 'implementation-approach', 'delivery-boundaries', 'test-coverage'];
function groomingCandidate({ ref = 'requirement:story', ...overrides } = {}) {
  const section = (texts, lists) => ({ ...Object.fromEntries(texts.map(key => [key, ''])), ...Object.fromEntries(lists.map(key => [key, []])), evidence_refs: [] });
  return {
    walkthrough: {
      purpose: { summary: 'Review the supplied Story intent.', why_needed: '', expected_outcomes: [], evidence_refs: [ref] },
      user_journey: section(['summary', 'trigger'], ['actors', 'steps', 'use_cases', 'alternate_paths']),
      business_impact: section(['summary'], ['stakeholders', 'value_outcomes', 'success_measures']),
      solution_design: section(['overview'], ['behaviors', 'rules', 'dependencies', 'constraints']),
      implementation: section(['overview'], ['components', 'data', 'integrations', 'quality_requirements']),
      validation: section(['summary'], ['acceptance_criteria', 'test_scenarios', 'edge_cases', 'linked_test_coverage']),
      remaining: section(['summary'], ['gaps', 'questions', 'decisions', 'actions', 'risks'])
    },
    layman: { explanation: 'Review the supplied Story intent.', analogy: '', evidence_refs: [ref] },
    business: section(['context'], ['roles_and_flow', 'use_cases', 'outcomes', 'success_measures', 'stakeholders']),
    technical: section(['overview'], ['functional_requirements', 'data_and_integrations', 'non_functional_requirements', 'testability_notes', 'acceptance_criteria', 'dependencies', 'constraints', 'edge_cases', 'security_and_privacy', 'observability']),
    scope: section([], ['in_scope', 'out_of_scope']), assumptions: [], open_questions: [], risks: [], review_evidence_refs: [],
    readiness: { status: 'not-ready', summary: 'Confirm the evidence needed for planning.', gaps: [], next_actions: [],
      checks: canonicalChecks.map(id => ({ id, label: id, status: 'missing', detail: 'The available source does not establish this check.', evidence_refs: [] })) },
    ...overrides
  };
}
module.exports = { groomingCandidate, canonicalChecks };
