const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { runAutomationBrowserAgent } = require('./automationBrowserAgent');
const { FLOW_PLANNING_READ_TOOLS, createAutomationFlowPlanningProtocol } = require('./automationFlowPlanningProtocol');
const { parameterReference, referenceKey } = require('./automationBrowserParameters');

const failure = message => Object.assign(new Error(message), { code: 'AUTOMATION_FLOW_PLAN_INVALID', statusCode: 422 });
const platformTypes = new Set(['web', 'api', 'android', 'ios']);
const parameterContractFailure = () => Object.assign(new Error('The manual-flow parameter reference contract is invalid.'), { code: 'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID', statusCode: 422, nonRetryable: true });
const canonicalParameterName = name => typeof name === 'string' && name.length <= 220
  && /^[tsr]\./.test(name) && !/[\u0000-\u001f\u007f]/.test(name) && referenceKey(parameterReference(name)) === name;

function flowPlanningParameterContract(requiredParameterNames, referencedParameterNames, featureKey) {
  if (!Array.isArray(requiredParameterNames) || requiredParameterNames.length > 2000
    || [...requiredParameterNames].some(name => !canonicalParameterName(name))
    || new Set(requiredParameterNames).size !== requiredParameterNames.length
    || (referencedParameterNames !== undefined && typeof referencedParameterNames !== 'function')
    || (requiredParameterNames.length && typeof referencedParameterNames !== 'function')) throw parameterContractFailure();
  const names = [...requiredParameterNames].sort();
  return {
    prompt: names.length ? { required_references: names.map(parameterReference), instruction: aiInstructionBlock(featureKey, 'automationFlowPlanning.parameters') } : undefined,
    validate(rows) {
      if (!names.length) return;
      const referenced = referencedParameterNames(rows);
      if (!Array.isArray(referenced) || referenced.length > 2000 || [...referenced].some(name => !canonicalParameterName(name))
        || new Set(referenced).size !== referenced.length) throw parameterContractFailure();
      const present = new Set(referenced), missing = names.filter(name => !present.has(name));
      if (missing.length) throw failure(`Keep required input references in flow_steps: ${missing.map(parameterReference).join(', ')}. Do not replace them with literal values or omit them; preserve the intended manual actions and outcomes.`);
    }
  };
}

/** Keep authored data bindings symbolic. General task projection materializes
 * public references; planning needs their identity for future case data edits. */
function projectFlowPlanningBrief(brief,browserParameters){
  if(typeof brief!=='string'||typeof browserParameters?.projectPrivateText!=='function')throw Object.assign(new Error('The manual-flow brief could not be privacy-projected.'),{code:'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID',statusCode:422,nonRetryable:true});
  const projected=browserParameters.projectPrivateText(brief,{preserveReferences:true});
  if(typeof projected!=='string')throw Object.assign(new Error('The manual-flow brief could not be privacy-projected.'),{code:'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID',statusCode:422,nonRetryable:true});
  return projected;
}

function assertFlowPlanningFeature(featureKey) {
  if(featureKey==='ai.agentic.automation-repair')throw Object.assign(new Error('Automation Repair needs an existing section plan to repair. Build this empty case with Automation Engineer first.'),{code:'AUTOMATION_REPAIR_PLAN_REQUIRED',statusCode:422,nonRetryable:true});
}

/** This is a proposed manual specification, never executable code or run evidence. */
function normalizeFlowPlan(payload, { allowedTypes = ['web'] } = {}) {
  if (payload && ['steps', 'automation_code', 'api_request', 'tool_calls'].some(key => Object.hasOwn(payload, key))) throw failure('Return only the proposed flow_steps. Executable source and inspection requests cannot accompany a completed manual plan.');
  const rows = payload?.flow_steps;
  if (!Array.isArray(rows) || !rows.length || rows.length > 40) throw failure('Return flow_steps with 1 to 40 ordered manual actions and their observable expected results.');
  const seen = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw failure(`Flow step ${index + 1} must be an object.`);
    if (row.automation_code || row.api_request || row.tool_calls) throw failure('Plan the manual behavior first; executable instructions and browser actions belong to the subsequent section build.');
    const action = typeof row.action === 'string' ? row.action.trim() : '';
    const expected = typeof row.expected_result === 'string' ? row.expected_result.trim() : '';
    const stepType = row.step_type || allowedTypes[0];
    if (!action || !expected || action.length > 3000 || expected.length > 3000) throw failure(`Flow step ${index + 1} needs an action and an observable expected_result, each at most 3000 characters.`);
    if (!platformTypes.has(stepType) || !allowedTypes.includes(stepType)) throw failure(`Flow step ${index + 1} has a runtime outside this application's allowed types.`);
    const key = JSON.stringify([stepType, action.replace(/\s+/g, ' '), expected.replace(/\s+/g, ' ')]);
    if (seen.has(key)) throw failure(`Flow step ${index + 1} duplicates an earlier action and expected result.`);
    seen.add(key);
    return { step_order: index + 1, action, expected_result: expected, step_type: stepType };
  });
}

/** Reuse the configured Engineer, with browser mutations unavailable during planning. */
async function planAutomationFlow({ featureKey, context, allowedTypes = ['web'], browser, startUrl, complete, parse, observations = [], onObservation = () => {}, onProgress = async () => {}, deadlineMs, requiredParameterNames = [], referencedParameterNames }) {
  assertFlowPlanningFeature(featureKey);
  const parameterContract = flowPlanningParameterContract(requiredParameterNames, referencedParameterNames, featureKey);
  const readTools = new Set(FLOW_PLANNING_READ_TOOLS);
  const protocol = createAutomationFlowPlanningProtocol({ featureKey, allowedTypes, toolNames: browser?.tools?.map(tool => tool.name) || [] });
  const limits = { model_calls: 6, browser_calls: 4, validation_attempts: 3 };
  const deadline = Math.min(Number.isFinite(deadlineMs) ? deadlineMs : Infinity, Date.now() + 180_000);
  const ledger = [...observations];
  let modelCalls = 0, browserCalls = 0;
  const budgetFailure = (kind, message) => Object.assign(new Error(message), { code: `AUTOMATION_FLOW_PLAN_${kind}_EXHAUSTED`, statusCode: 422, nonRetryable: true,
    details: { model_call_count: modelCalls, browser_call_count: browserCalls, max_model_calls: limits.model_calls, max_browser_calls: limits.browser_calls } });
  const assertDeadline = () => { if (Date.now() >= deadline) throw budgetFailure('DEADLINE', 'The manual-flow planning time allowance ended. No executable instructions were generated; refine the brief or review the current application evidence before retrying.'); };
  const completePlanning = async (prompt, remainingMs, traceOptions) => {
    assertDeadline();
    if (modelCalls >= limits.model_calls) throw budgetFailure('MODEL_BUDGET', 'The manual-flow planner reached its shared model-call allowance. No executable instructions were generated; review the brief and planning feedback before retrying.');
    modelCalls++;
    return complete(prompt, Math.max(1, Math.min(remainingMs, deadline - Date.now())), traceOptions);
  };
  const parsePlanning = output => {
    try { return parse(output); }
    catch (error) {
      if (error.code && error.code !== 'AI_INVALID_JSON') throw error;
      throw Object.assign(new Error('The manual-flow response was not a valid JSON object.'), { code: 'AI_INVALID_JSON' });
    }
  };
  const planningBrowser = browser && { ...browser, tools: browser.tools.filter(tool => readTools.has(tool.name)), call: (name, args) => {
    if (!readTools.has(name)) throw failure('Manual-flow planning cannot perform browser mutations.');
    assertDeadline();
    if (browserCalls >= limits.browser_calls) throw budgetFailure('TOOL_BUDGET', 'The manual-flow planner reached its shared browser-read allowance. Continue from retained evidence; no additional inspection was performed.');
    browserCalls++;
    return browser.call(name, args);
  } };
  const observe = async observation => { ledger.push(observation); await onObservation(observation); };
  let feedback;
  await onProgress({ phase: 'automation.agent.flow.planning', message: 'Developing the manual flow from the supplied brief and application context. Browser actions begin after the flow is saved.', details: { flow_source: 'agent_brief', verification_status: 'unverified' } });
  for (let attempt = 1; attempt <= limits.validation_attempts; attempt++) {
    const prompt = [aiInstructionBlock(featureKey, 'automationFlowPlanning.instructions'),
      JSON.stringify({ generation_stage: 'manual_flow_planning', browser_interaction_mode:'read_only', allowed_step_types: allowedTypes, context, planning_protocol: protocol,
        ...(parameterContract.prompt ? { planning_parameter_contract: parameterContract.prompt } : {}),
        planning_budget: { remaining_model_calls: Math.max(0, limits.model_calls - modelCalls), remaining_browser_calls: Math.max(0, limits.browser_calls - browserCalls), validation_attempt: attempt, max_validation_attempts: limits.validation_attempts },
        ...(feedback ? { validation_feedback: feedback } : {}) })].join('\n\n');
    try {
      const response = planningBrowser
        ? await runAutomationBrowserAgent({ featureKey, phase: 'flow_plan', prompt, browser: planningBrowser, startUrl: attempt === 1 ? startUrl : undefined, complete: completePlanning, parse: parsePlanning, onProgress, onObservation: observe, initialObservations: ledger, maxTurns: 3, maxCalls: Math.max(0, limits.browser_calls - browserCalls), deadlineMs: deadline })
        : parsePlanning(await completePlanning(prompt, deadline - Date.now()));
      const rows = normalizeFlowPlan(response, { allowedTypes });
      parameterContract.validate(rows);
      return rows;
    }
    catch (error) {
      if (error.code !== 'AUTOMATION_FLOW_PLAN_INVALID' && error.code !== 'AI_INVALID_JSON') throw error;
      feedback = { code: error.code === 'AUTOMATION_FLOW_PLAN_INVALID' ? error.code : 'AI_INVALID_JSON',
        message: error.code === 'AUTOMATION_FLOW_PLAN_INVALID' ? error.message : aiInstructionBlock(featureKey, 'automationFlowPlanning.jsonCorrection') };
    }
  }
  throw failure('The agent could not produce a complete manual flow from this brief. Add the intended actions, test data and expected outcome, then retry.');
}

module.exports = { normalizeFlowPlan, planAutomationFlow, assertFlowPlanningFeature, projectFlowPlanningBrief };
