const contracts = require("./knowledgeContracts.service");
const fixtureSet = require("@hellotest/platform/backend/eval/knowledge/fixtures.json");
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
function evaluateKnowledgeFixtures(fixtures = fixtureSet) {
  const checks = [], metrics = [], exposures = [];
  const request = item => contracts.buildRetrievalRequest({
    projectId: "project-a",
    tenantId: "tenant-a",
    query: item.question || "What is the onboarding status?",
    filters: item.filters,
    budgets: item.budgets
  });
  const packet = item => contracts.buildContextPacket({
    retrievalRequest: request(item),
    evidence: item.candidates,
    authorization: {
      enforced: true
    }
  });
  for (const item of fixtures.retrieval) {
    const context = packet(item), actual = context.evidence.map(e => e.evidence_id), expected = new Set(item.expected), forbidden = new Set(item.forbidden);
    const found = actual.filter(id => expected.has(id));
    const leaked = actual.filter(id => forbidden.has(id));
    exposures.push(leaked.length);
    const first = actual.findIndex(id => expected.has(id));
    const dcg = actual.reduce((total, id, index) => total + (expected.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
    const ideal = Array.from({
      length: Math.min(expected.size, actual.length)
    }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
    metrics.push({
      recall: expected.size ? found.length / expected.size : 1,
      precision: actual.length ? found.length / actual.length : 0,
      mrr: first < 0 ? 0 : 1 / (first + 1),
      ndcg: ideal ? dcg / ideal : 0,
      hit: found.length ? 1 : 0
    });
    checks.push({
      id: item.id,
      category: "retrieval",
      passed: leaked.length === 0 && found.length === expected.size,
      selected_evidence_ids: actual,
      unauthorized_exposure_count: leaked.length
    });
  }
  const groundedPacket = packet({
    candidates: [{
        evidence_id: "e1",
        source_id: "story",
        content: "Onboarding status is Done.",
        is_current: true
      }]
  });
  for (const item of fixtures.grounding) {
    const outcome = {
      status: "answered",
      confidence: item.confidence,
      content: item.summary,
      answer_structure: {
        summary: item.summary,
        findings: item.findings || [],
        supported_claims: item.claims
      }
    };
    const answer = contracts.buildAnswerContract({
      outcome,
      contextPacket: groundedPacket
    });
    const rendered = contracts.applyAnswerContract(outcome, answer, groundedPacket);
    const publicText = JSON.stringify({
      content: rendered.content,
      citations: rendered.citations,
      structure: rendered.answer_structure,
      contract: answer
    });
    const passed = answer.claims.length === item.expected_claims && item.forbidden_text.every(value => !publicText.includes(value)) && answer.grounding.model_confidence_accepted === false;
    checks.push({
      id: item.id,
      category: "grounding",
      passed,
      accepted_claims: answer.claims.length,
      rejected_claims: answer.grounding.unsupported_claim_count
    });
  }
  const baseline = contracts.buildModelRequest({
    contextPacket: groundedPacket
  }).messages[0].content;
  for (const [index, hostile] of fixtures.injection.entries()) {
    const context = packet({
      candidates: [{
          evidence_id: "injection",
          source_id: "untrusted",
          content: hostile,
          is_current: true
        }]
    });
    const before = JSON.stringify(context.authorization), model = contracts.buildModelRequest({
      contextPacket: context
    });
    const passed = model.messages[0].content === baseline && model.messages.length === 2 && model.messages[1].role === "user" && model.tools.length === 0 && JSON.stringify(context.authorization) === before;
    checks.push({
      id: `injection-${index + 1}`,
      category: "instruction_separation",
      passed
    });
  }
  return {
    dataset_id: fixtures.dataset_id,
    scope: fixtures.scope,
    generated_at: new Date().toISOString(),
    status: checks.every(item => item.passed) ? "passed" : "failed",
    checks,
    retrieval: {
      recall_at_k: mean(metrics.map(item => item.recall)),
      precision_at_k: mean(metrics.map(item => item.precision)),
      mrr: mean(metrics.map(item => item.mrr)),
      ndcg: mean(metrics.map(item => item.ndcg)),
      hit_rate: mean(metrics.map(item => item.hit)),
      k_policy: "per-request candidate and context limits"
    },
    security: {
      unauthorized_exposure_count: exposures.reduce((sum, value) => sum + value, 0),
      unauthorized_exposure_rate: mean(exposures.map(count => count > 0 ? 1 : 0)),
      target: 0,
      evaluated_requests: fixtures.retrieval.length,
      scope: "Observed fixture boundary exposure only; production ACL and model-resistance evaluation remain separate."
    },
    grounding: {
      citation_binding_tested: true,
      unvalidated_rendering_tested: true,
      semantic_entailment_calibrated: false,
      model_confidence_accepted: false
    },
    limitations: ["This small deterministic suite is not the 100\u2013200 question production retrieval goldset.", "No model calls were made; prompt-injection resistance of a provider has not been measured.", "Latency isolation, noisy-neighbour impact, semantic recall and probabilistic confidence remain uncalibrated."]
  };
}
module.exports = {
  evaluateKnowledgeFixtures
};
