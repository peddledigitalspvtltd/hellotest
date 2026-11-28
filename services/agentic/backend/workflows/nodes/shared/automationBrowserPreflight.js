const inputs = require('../../automationNodeInputs');
const artifactTasks = require('../../artifactTasks');
const { normalizeAutomationStartUrl } = require('@hellotest/platform/backend/src/utils/automationStartUrl');

module.exports = async ({workflow,node,user,payload,hasInput,warnOnce}) => {
  if (node.data.artifactTask !== 'automation-engineer') return;
  const run = {project_id:workflow.project_id,app_type_id:workflow.app_type_id,input_payload:payload};
  const access = artifactTasks.access;
  const manual = inputs.manualCaseSource(node.data);
  await access(user,run.project_id,['automation.ai','automation.build','automation.code.view']);
  const source = manual && (hasInput || node.data.automationManualCaseId)
    ? await require('../../manualAutomationTask').loadSource({run,node,user,access,automationSteps:artifactTasks.automationSteps}) : null;
  const resolved = await inputs.resolveNodeInputs({run,node,user,access,startUrlFallback:source?.source.automation_start_url});
  if ((source?.verificationMode || resolved.verificationMode) !== 'generate_only') {
    await access(user, run.project_id, ['automation.run.local', 'run.create']);
  }
  if (source) {
    const {supplied,availableNames}=await require('../../manualAutomationTask').prepareInputs({run,node,user,access,draft:source.draft,resolved});
    const gap=artifactTasks.draftParameterInputGap(supplied.inputDraft,supplied.draft.steps,source.source.id,0,availableNames);
    if (gap) throw Object.assign(new Error(gap.message),{statusCode:422,code:gap.code,effect_dispatched:false,
      publicMessage:`Configure the required Test Case parameters ${gap.required_parameters.join(', ')} before building automation.`});
  }
  if (resolved.browserMode === 'offline' || manual && !source) return;
  if (source && !source.nativeSteps.some(step => step.step_type === 'web')) return;
  if (!resolved.startUrl) {
    if (source) normalizeAutomationStartUrl(null,{required:true});
    else warnOnce('Choose a Test Environment or Start URL to check browser reachability before generation. Case-specific Story URLs are checked when each case starts.');
    return;
  }
  if (!source) {
    const app = await require('@hellotest/platform/backend/public/applicationAccess').getAppType(workflow.app_type_id);
    if (app.project_id !== run.project_id) throw Object.assign(new Error('The application must belong to this workflow project.'),{statusCode:403});
    if (resolved.runtime !== 'web' && !['web','unified'].includes(app.kind || app.type || 'web')) return;
  }
  await require('@hellotest/automation/build').preflightAutomationBrowser({projectId:run.project_id,appTypeId:run.app_type_id,user,
    startUrl:resolved.startUrl,environmentId:resolved.testEnvironmentId || undefined,retryStartup:true});
};
