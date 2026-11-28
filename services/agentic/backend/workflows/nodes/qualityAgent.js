const { createHash } = require('node:crypto');
const execution = require('@hellotest/knowledge/backend/services/knowledgeExecution.service');
const quality = require('../../services/qualityAgents.service');
const contracts = require('../../services/qualityAgentContracts');
const { selectedEnvironment } = require('../automationNodeInputs');
const { contextFor, mapValues, object } = require('./shared/values');

const terminal = new Set(['completed', 'failed', 'cancelled']);
const reference = /^\$(?:input|request|item|nodes|iteration)(?:\.|$)/;

function scopedTarget(base, path) {
  const environment = new URL(contracts.targetUrl(base));
  if (path == null || path === '') return environment.href;
  if (typeof path !== 'string' || !/^\/(?!\/)/.test(path) || /[\\\x00-\x20]/.test(path)) {
    throw contracts.fail('Enter a relative page path on the selected Test Environment.');
  }
  const target = new URL(path, environment);
  if (target.origin !== environment.origin) throw contracts.fail('The page path must stay on the selected Test Environment.');
  return contracts.targetUrl(target.href);
}

async function environmentFor(run, node, user) {
  const testEnvironmentId = typeof node.data.testEnvironmentId === 'string' ? node.data.testEnvironmentId.trim() : '';
  const environment = await selectedEnvironment({ run, node, user,
    access: require('../artifactTasks').access, options: { testEnvironmentId } });
  if (!environment?.base_url) throw contracts.fail('Select a Test Environment with an application URL.', 422);
  return environment;
}

function validate({ data = {} }) {
  const errors = [];
  if (!contracts.KINDS.has(data.qualityAgentKind)) errors.push('Choose a Browser Quality Agent.');
  if (Number(data.retryCount) > 0) errors.push('Browser Quality Agent runs own recovery. Set workflow retries to zero.');
  if (typeof data.testEnvironmentId !== 'string' || !data.testEnvironmentId.trim()) errors.push('Select a Test Environment with an application URL.');
  if (data.qualityTargetPath && !reference.test(data.qualityTargetPath)) {
    try { scopedTarget('https://example.test/', data.qualityTargetPath); }
    catch (error) { errors.push(error.publicMessage); }
  }
  return errors;
}

async function preflight({ workflow, node, user }) {
  const environment = await environmentFor(workflow, node, user);
  scopedTarget(environment.base_url, reference.test(node.data.qualityTargetPath) ? '' : node.data.qualityTargetPath);
  const catalog = await quality.catalog({ project_id: workflow.project_id, app_type_id: workflow.app_type_id }, user);
  if (!catalog.runtime.available) throw contracts.fail(catalog.runtime.reason || 'The configured Test Engine is unavailable.', 503);
  if (node.data.qualityAgentKind === 'web' && catalog.runtime.missions?.supported !== true) throw contracts.fail('Update the configured Test Engine to run Browser Quality Agents.', 503);
}

async function execute({ run, node, sources, user, signal, requireRunAccess }) {
  const data = node.data || {};
  const context = contextFor(run, sources);
  const candidate = context.input?.quality_review ?? run.input_payload?.quality_review;
  const supplied = object(candidate) ? candidate : {};
  const { credential_ref: _credential, mission, ...options } = object(supplied.options) ? supplied.options : {};
  const environment = await environmentFor(run, node, user);
  const pagePath = mapValues(data.qualityTargetPath, context);
  if (reference.test(data.qualityTargetPath) && pagePath == null) throw contracts.fail('The mapped page path is unavailable. Check the connected input.', 422);
  const request = {
    project_id: run.project_id, app_type_id: run.app_type_id, kind: data.qualityAgentKind,
    target_url: scopedTarget(environment.base_url, pagePath),
    goal: mapValues(data.qualityGoal, context) || supplied.goal,
    llm_integration_id: data.llmIntegrationId || undefined,
    ...(data.aiConfiguration ? { ai_configuration: data.aiConfiguration } : {}),
    ...(data.reviewCriteria ? { review_criteria: data.reviewCriteria } : {}),
    baseline_id: supplied.baseline_id,
    execution_mode: 'agent',
    options: { ...options, ...(data.qualityAgentKind === 'web' ? { mission: { max_actions: mission?.max_actions ?? 6, allow_form_submission: false } } : {}) }
  };
  // Map targets and test inputs, never authority, credentials, or a run ID.
  const requestKey = `workflow-node:${createHash('sha256').update(JSON.stringify([run.id, node.id, run.iteration_path || []])).digest('hex')}`;
  const job = await quality.createRun(request, user, { requestKey, workflowTrace: { run_id: run.id, node_id: node.id } });
  let state = job;
  try {
    while (!terminal.has(state.status)) {
      if (signal.aborted) throw execution.abortError();
      await execution.bounded(() => new Promise(resolve => setTimeout(resolve, 1000)), { signal, timeoutMs: 2000 });
      await requireRunAccess(user, run.project_id);
      state = await quality.getRun(job.id, user);
    }
    if (signal.aborted) throw execution.abortError();
    if (state.status !== 'completed' || !state.agent_assessment) {
      const uncertain = state.error?.code === 'QUALITY_AGENT_MODEL_OUTCOME_UNKNOWN';
      throw Object.assign(contracts.fail(state.error?.message || 'The Browser Quality Agent could not deliver its validated assessment.',
        502, state.error?.code || 'QUALITY_AGENT_INCOMPLETE'), { operation_id: job.id, outcome_unknown: uncertain, retryable: false });
    }
    const findings = state.findings || [];
    return {
      quality_run_id: job.id, agent_id: `browser-${state.kind}`, outcome: state.outcome,
      assessment: state.agent_assessment, metrics: state.metrics,
      findings: findings.slice(0, 24).map(({ id, severity, title, selector }) => ({ id, severity, title, selector })),
      finding_count: findings.length, limitations: state.limitations?.slice(0, 8).map(item => item.slice(0, 600)),
      ...((state.outcome === 'needs_review' || state.outcome === 'error') ? { verification: { status: 'needs_input' } } : {}),
      requires_human_review: true
    };
  } finally {
    if (!terminal.has(state.status)) await quality.cancelRun(job.id, user).catch(() => {});
  }
}

module.exports = require('./definition')('qualityAgent', {
  timeoutMaxMs: () => 240000, validate, execute, preflight: {
    connection: preflight,
    model: ({ workflow, node, user }) => require('../../services/browserMissionPlanner').resolveMissionModel({
      project_id: workflow.project_id, kind: node.data.qualityAgentKind, llm_integration_id: node.data.llmIntegrationId
    }, user)
  }
});
