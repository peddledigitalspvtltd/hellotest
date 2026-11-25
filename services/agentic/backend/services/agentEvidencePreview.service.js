const orchestrator = require('@hellotest/ai/services/aiContextOrchestrator');
const execution = require('@hellotest/knowledge/backend/services/knowledgeExecution.service');
const evidenceScope = require('@hellotest/platform/backend/src/utils/agentEvidenceScopeSql');
const registry = require('../agents/agentRegistry.service');
const { resolveCaseEvidenceInput } = require('./agentReviewScope');

const liveScopes = {
  stories: ['stories', 'stories'],
  'test-cases': ['test_cases', 'test-cases'],
  runs: ['runs', 'runs'],
  bugs: ['bugs', 'bugs'],
  automation: ['repository_objects', 'object-repository']
};

function previewRows(route, evidence, projectId) {
  const counts = evidence?.counts || {};
  return route.effective_scopes.map(scope => {
    const [countKey, hitScope] = liveScopes[scope] || [];
    const count = counts[countKey];
    const hit = evidence?.hits?.find(item => item.source_id === `live-project-${projectId}-${hitScope}`);
    let previewCount = null;
    if (hit) {
      try {
        const snapshot = JSON.parse(hit.content);
        if (Array.isArray(snapshot?.records)) previewCount = snapshot.records.length;
        else if (Number.isSafeInteger(snapshot?.returned_records)) previewCount = snapshot.returned_records;
      } catch { /* A missing sample does not alter the permission-checked record count. */ }
    }
    return {
      scope,
      required_confirmation: route.priority_scopes.includes(scope) && count === 0,
      available: Number.isSafeInteger(count) ? count : null,
      preview_count: previewCount
    };
  });
}

async function preview(input, user, signal) {
  const { project_id: projectId, app_type_id: appTypeId, agent_id: agentId, prompt } = input;
  const custom = agentId.startsWith('agent-') ? await registry.resolve(agentId, input.agent_version, projectId) : null;
  const definition = custom?.definition;
  const requestedScopes = definition ? definition.context_scopes.filter(scope => definition.allowed_tools.includes(scope === 'knowledge' ? 'knowledge_search' : 'project_evidence')) : input.context_scopes;
  if (definition && (!requestedScopes.length || definition.ai_configuration?.context?.mode === 'none')) return { status: 'checked', scopes: [] };
  const route = orchestrator.planContext({
    prompt, agentId, mode: 'agent', requestedScopes,
    ...(definition ? { specialist: { input_type: 'custom_agent_task', priority_scopes: requestedScopes, retrieval_focus: definition.objective } } : {})
  });
  if (definition) {
    route.effective_scopes = route.effective_scopes.filter(scope => requestedScopes.includes(scope));
    route.live_scopes = route.live_scopes.filter(scope => requestedScopes.includes(scope));
  }
  let evidence;
  try {
    evidence = await execution.run({ signal }, () => execution.bounded(async () => {
      const resolved = await resolveCaseEvidenceInput({ inputs: input.inputs || {}, user, projectId, appTypeId });
      return orchestrator.buildLiveProjectEvidence({
        projectId, appTypeId, prompt, user, route, evidenceScope: evidenceScope.normalize(resolved)
      });
    }, { timeoutMs: 3_500 }));
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'unavailable', scopes: [] };
  }
  return { status: 'checked', scopes: previewRows(route, evidence, projectId) };
}

module.exports = { preview, previewRows };
