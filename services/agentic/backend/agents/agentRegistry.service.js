const { randomUUID } = require('node:crypto');
const db = require('@hellotest/platform/backend/src/db');
const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
const integrations = require('@hellotest/integration/backend/services/integration.service');
const rag = require('@hellotest/knowledge/backend/services/knowledgeRag.service');
const contract = require('./agentDefinition');

async function resolveModel(projectId, userId, integrationId, usageKey = 'ai.agentic.workflow') {
  let integration;
  try {
    integration = await selection.resolveLlmIntegrationForUsage({ integrationId, userId, projectId, usageKey, fallback: 'project-then-global', allowMissing: true });
    rag.assertLlmIntegrationProjectScope(integration, projectId);
  } catch (cause) {
    if (cause.statusCode === 403) throw cause;
    throw contract.fail(cause.publicMessage || 'The selected model connection is unavailable. Check Integrations.', 'AGENT_MODEL_UNAVAILABLE', 422);
  }
  if (!integration || !integration.model?.trim() || integration.is_active === false) throw contract.fail('An active LLM connection with a model is required. Configure it in Integrations.', 'AGENT_MODEL_REQUIRED', 422);
  return integration;
}
const store = {
  list: projectId => db.prepare(`SELECT a.*, v.definition, v.definition_hash, v.activated_at FROM ai_agent_definitions a JOIN ai_agent_versions v ON v.agent_id = a.id AND v.version = a.current_version WHERE a.project_id = ? ORDER BY a.updated_at DESC, a.id LIMIT 200`).all(projectId),
  get: (id, projectId) => db.prepare('SELECT * FROM ai_agent_definitions WHERE id = ? AND project_id = ?').get(id, projectId),
  version: (id, version) => db.prepare('SELECT * FROM ai_agent_versions WHERE agent_id = ? AND version = ?').get(id, version)
};
async function get(id, projectId) {
  const row = await store.get(id, projectId);
  if (!row) throw contract.fail('Agent not found in this project.', 'AGENT_NOT_FOUND', 404);
  const version = await store.version(id, row.current_version);
  return { ...row, definition: version.definition, definition_hash: version.definition_hash, activated_at: version.activated_at };
}
async function resolve(id, version, projectId) {
  const row = await store.get(id, projectId);
  if (!row || row.archived || !row.active_version) throw contract.fail('This agent is unavailable. Activate a version in the Agent library.', 'AGENT_UNAVAILABLE');
  const pinned = version ?? row.active_version;
  if (!Number.isInteger(pinned) || pinned < 1) throw contract.fail('Choose a published agent version.');
  const saved = await store.version(id, pinned);
  if (!saved?.activated_at) throw contract.fail('The selected agent version has not been activated.', 'AGENT_VERSION_INACTIVE');
  return { id, version: pinned, definition: contract.normalize(saved.definition), definition_hash: saved.definition_hash };
}
async function save(input, id, userId) {
  const definition = contract.normalize(input.definition);
  const projectId = input.project_id;
  if (typeof projectId !== 'string' || !projectId.trim()) throw contract.fail('Select a project.');
  if (input.activate != null && typeof input.activate !== 'boolean') throw contract.fail('Activation must be true or false.');
  if (input.activate) await resolveModel(projectId, userId, definition.integration_id);
  const agentId = id || `agent-${randomUUID()}`;
  await db.transaction(async () => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext(?))', [`ai-agent:${agentId}`]);
    const current = id ? await store.get(id, projectId) : null;
    if (id && !current) throw contract.fail('Agent not found in this project.', 'AGENT_NOT_FOUND', 404);
    if (current && current.current_version !== input.expected_version) throw contract.fail('This agent changed. Reload it before saving your edits.', 'AGENT_VERSION_CONFLICT', 409);
    const version = (current?.current_version || 0) + 1;
    if (!current) await db.prepare('INSERT INTO ai_agent_definitions (id, project_id, current_version, created_by) VALUES (?, ?, 0, ?)').run(agentId, projectId, userId);
    await db.prepare('INSERT INTO ai_agent_versions (agent_id, version, definition, definition_hash, created_by, activated_at) VALUES (?, ?, ?, ?, ?, ?)').run(agentId, version, definition, contract.definitionHash(definition), userId, input.activate ? new Date().toISOString() : null);
    await db.prepare('UPDATE ai_agent_definitions SET current_version = ?, active_version = ?, archived = false, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').run(version, input.activate ? version : current?.active_version || null, agentId, projectId);
  })();
  return get(agentId, projectId);
}
async function archive(id, projectId, expectedVersion) {
  const row = await db.prepare('UPDATE ai_agent_definitions SET archived = true, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND current_version = ? RETURNING id').get(id, projectId, expectedVersion);
  if (!row) throw contract.fail('Agent changed or is unavailable. Reload the library.', 'AGENT_VERSION_CONFLICT', 409);
  return { archived: true };
}
async function list(projectId) {
  const rows = await store.list(projectId);
  return Promise.all(rows.map(async row => ({ ...row, active_definition: row.active_version ? (await store.version(row.id, row.active_version))?.definition : null })));
}
module.exports = { list, get, resolve, save, archive, resolveModel, _internals: { store } };
