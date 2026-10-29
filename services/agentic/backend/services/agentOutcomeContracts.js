const catalog = require('../../shared/agentOutcomeContracts.json');
const profiles = require('../../shared/workflowSpecialists.json');
const invalid = message => Object.assign(new Error(message), { publicMessage: message, code: 'AGENT_DEFINITION_INVALID', statusCode: 422 });

function normalizeOutputContract(value) {
  if (value == null) return { kind: 'review', minimum_artifacts: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['kind', 'minimum_artifacts'].includes(key))
    || !catalog.custom_kinds.includes(value.kind)) throw invalid('Choose a supported agent output kind.');
  const minimum = value.minimum_artifacts ?? (value.kind === 'review' ? 0 : 1);
  if (!Number.isInteger(minimum) || minimum < (value.kind === 'review' ? 0 : 1) || minimum > (value.kind === 'review' ? 0 : 8)) {
    throw invalid('Review outputs use zero required proposals; authoring outputs require one to eight proposals.');
  }
  return { kind: value.kind, minimum_artifacts: minimum };
}

function outcomeContract(agentId, definition) {
  const selectedId = definition?.feature_id ? Object.keys(profiles).find(id => profiles[id].featureId === definition.feature_id) || agentId : agentId;
  const configured = definition?.output_contract;
  const output = configured ? normalizeOutputContract(configured) : null;
  const builtin = catalog.agents[selectedId] || { mode: 'review' };
  return { schema: catalog.schema, agent_id: selectedId,
    mode: output ? output.kind === 'review' ? 'review' : 'author' : builtin.mode,
    artifact_kinds: output ? output.kind === 'review' ? [] : [output.kind] : builtin.artifact_kinds || [],
    minimum_artifacts: output ? output.minimum_artifacts : builtin.minimum_artifacts || 0,
    findings_require_proposals: output ? output.kind === 'review' : builtin.findings_require_proposals === true,
    refine_existing_proposals: !output && builtin.refine_existing_proposals === true,
    allow_clean_review: !output && builtin.allow_clean_review === true,
    typed_repair: !output && builtin.typed_repair === true,
    context_scopes: definition?.context_scopes || profiles[selectedId]?.scopes || [] };
}

module.exports = { normalizeOutputContract, outcomeContract, catalog };
