const cases = require('@hellotest/testing/backend/services/testCase.service');
const scopes = require('@hellotest/testing/backend/services/testCaseScope.service');
const steps = require('@hellotest/testing/backend/services/testStep.service');
const { fail } = require('./connections');
const inputs = require('./automationNodeInputs');
const testData = require('./testDataGenerator');
const { failureInfo } = require('./runtimeEvents');
const { needsExecutionReview } = require('./automationResult');

async function loadSource({run,node,user,access,automationSteps}) {
  await access(user, run.project_id, ['testcase.view', 'automation.ai', 'automation.build', 'automation.code.view']);
  const reference = inputs.checkManualInput(run,node);
  let source;
  try { source = await cases.getTestCase(reference); }
  catch (error) {
    if (error.message !== 'Test case not found') throw error;
  }
  if (!source || source.app_type_id !== run.app_type_id) throw Object.assign(fail('The selected manual Test Case is unavailable in this workflow application.', 404), {code:'AUTOMATION_MANUAL_CASE_UNAVAILABLE'});
  const projects = await scopes.resolveTestCaseProjectIds(source.id);
  if (projects.length !== 1 || projects[0] !== run.project_id) throw fail('The selected manual Test Case must belong to the workflow project.', 403);
  if (source.automated === 'yes') throw Object.assign(fail('Select a manual Test Case as the source.', 422), {code:'AUTOMATION_MANUAL_CASE_REQUIRED'});
  const authored = source.authoring_mode === 'gherkin' && source.gherkin_document ? [] : await steps.getTestSteps({test_case_id:source.id});
  const draft = { title:source.title, description:source.description, authoring_mode:source.authoring_mode,
    gherkin_document:source.gherkin_document, manual_test_case_ids:[source.id], parameter_values:source.parameter_values || {},
    test_data_options:source.test_data_options || {}, test_data_set_ids:source.test_data_set_ids || [],
    steps:authored.map(step => ({id:step.id, step_order:step.step_order, action:step.action, expected_result:step.expected_result,
      step_type:step.step_type, api_request:step.api_request})) };
  if (draft.test_data_set_ids.length) await access(user,run.project_id,['data.view']);
  draft.steps = await automationSteps(draft);
  if (!draft.steps.length || draft.steps.length > 200) throw Object.assign(fail('The manual Test Case must have 1 to 200 authored steps or expanded Gherkin steps.', 422), {code:'AUTOMATION_CASE_STEPS_INVALID'});
  const appTypeKind = source.app_type_kind || 'web';
  const runtime = inputs.caseRuntime(draft, appTypeKind, inputs.validateNodeOptions(node.data));
  return {source,draft,appTypeKind,...runtime};
}

async function prepareInputs({run,node,user,access,draft,resolved,signal}) {
  const configured = testData.configuredInputs(resolved);
  const selectedData = await testData.prepareSelectedCase({ run,node,user,access,draft,steps:draft.steps,configured,signal });
  const preparedData = selectedData || testData.analyzeCase({draft,steps:draft.steps,configured});
  const bound = testData.automationDraftWithData(draft,preparedData);
  const supplied = inputs.caseInputs(bound,bound.steps,resolved);
  return { preparedData, supplied, availableNames:[...supplied.availableParameterNames,...Object.values(preparedData.parameter_bindings || {})] };
}

async function execute({run,node,user,signal,onProgress,access,automationSteps,fingerprint,taskGuidance,dataPreparationGap,draftParameterInputGap,generateCase,manualAutomationBuildIssue,agentPresentation}) {
  const loaded = await loadSource({run,node,user,access,automationSteps});
  const {source,draft,appTypeKind,nativeSteps,inspectBrowser,interactive,verificationMode,verificationDriver,requestedVerification} = loaded;
  const sourceFingerprint = fingerprint(draft);
  const manualCase = {id:source.id, display_id:source.display_id, title:source.title, revision:source.revision, source_fingerprint:sourceFingerprint};
  const resolved = await inputs.resolveNodeInputs({run,node,user,access,startUrlFallback:source.automation_start_url});
  const { preparedData, supplied, availableNames } = await prepareInputs({run,node,user,access,draft,resolved,signal});
  const inputGap = dataPreparationGap(preparedData,draft,source.id,0)
    || draftParameterInputGap(supplied.inputDraft,supplied.draft.steps,source.id,0,availableNames);
  const wrap = (data, status) => {
    const output = {artifact_task:'automation-engineer',generation_mode:'native',publication_status:'proposal',requires_human_review:true,
      processed:1,verification:{status,limitation:'Build validation checks the generated source. Application execution has its own verification receipt.'},
      data:{manual_case:manualCase,test_data:preparedData,...data}};
    return {__workflow_result:{output,context:output}};
  };
  if (inputGap) return wrap({automation_input_required:inputGap},'needs_input');
  const progress = async event => {
    const details = event.details || {};
    const completed = Number.isInteger(details.completed_sections) ? details.completed_sections : details.saved_sections;
    const active = nativeSteps.find(step => step.id === (details.active_step_id || details.step_id));
    await onProgress({current_item:1,total_items:1,percent:Number.isInteger(completed) ? Math.min(99,Math.round(completed * 100 / nativeSteps.length)) : 0,
      ...(event.phase==='automation.agent.browser.startup_retry' ? {automation_startup_retry:true} : {}),
      automation_progress:{total:1,processed:0,total_sections:nativeSteps.length,completed_sections:completed,active_step_order:active?.step_order,
        active_message:typeof event.message === 'string' ? supplied.project(event.message).slice(0, 500)
          .replace('Previously saved sections remain in Plan.','The manual Test Case remains in the library.') : undefined}});
  };
  let generated;
  try {
    generated = await generateCase({run,node,user,signal,interactive,requestedVerification,identity:{manual_test_case_id:source.id,source_fingerprint:sourceFingerprint,browser_mode:resolved.browserMode,
      ...(preparedData.test_data_set_revision ? {test_data_set_revision:preparedData.test_data_set_revision} : {})},
      iterationPath:['manual_case',source.id],supplied,builderInput:{
        project_id:run.project_id,app_type_id:run.app_type_id,app_type_kind:appTypeKind,user_id:user.id,
        integration_id:node.data.llmIntegrationId || run.input_payload.integration_id || undefined,
        inspect_browser:inspectBrowser,allow_browser_actions:interactive,verification_mode:verificationMode,verification_driver:verificationDriver,
        test_environment_id:resolved.testEnvironmentId || undefined,test_data_set_id:preparedData.test_data_set_id,
        expected_test_data_set_revision:preparedData.test_data_set_revision,additional_context:taskGuidance(node),
        onProgress:agentPresentation?.progress === false ? undefined : progress
      }});
  } catch (error) {
    if (error.systemic_failure || error.outcome_unknown || error.transactionOutcomeUnknown || signal?.aborted
        || (interactive && error.effect_dispatched !== false)) throw error;
    const issue = manualAutomationBuildIssue(error,draft,source.id);
    if (issue) return wrap(issue,'needs_input');
    if (interactive && [400,422].includes(error.statusCode)) return wrap({automation_failure:failureInfo(error)},'needs_input');
    throw error;
  }
  signal?.throwIfAborted();
  if (generated.case_failure) return wrap(manualAutomationBuildIssue(null,draft,source.id,generated.case_failure),'needs_input');
  const current = await loadSource({run,node,user,access,automationSteps});
  if (fingerprint(current.draft) !== sourceFingerprint || current.source.revision !== source.revision) {
    throw Object.assign(fail('The manual Test Case changed during generation. Inspect the earlier browser execution before building its current revision.', 409), {code:'AUTOMATION_MANUAL_CASE_CHANGED'});
  }
  await onProgress({percent:100,current_item:1,total_items:1,automation_progress:{completed:1,total:1,processed:1}});
  const needsReview = needsExecutionReview(generated);
  return wrap({automation:generated},needsReview ? 'needs_input' : 'passed');
}

module.exports = {loadSource,prepareInputs,execute};
