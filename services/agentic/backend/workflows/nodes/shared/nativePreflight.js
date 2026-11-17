const agentRegistry=require('../../../agents/agentRegistry.service');
const nodeAiConfiguration=require('../../nodeAiConfiguration');
const text=value=>typeof value==='string'?value.trim():'';
module.exports=async({workflow,node,user,payload})=>{
        const task = node.data.artifactTask;
        const dataOptions = task === 'test-data-generator' ? require('../../testDataGenerator').validateNodeOptions(node.data) : null;
        const codes = task === 'story-assurance' ? ['requirement.view', 'requirement.ai']
          : task === 'automation-engineer' ? ['requirement.view', 'automation.ai', 'automation.build', 'automation.code.view']
            : task === 'test-data-generator' ? dataOptions.source === 'dataset' ? ['data.view'] : ['data.ai']
              : ['requirement.view', 'testcase.ai'];
        if (workflow.settings?.template_id === 'sprint-automator' && workflow.settings?.library_publication_mode === 'automatic'
          && ['test-case-generation', 'automation-engineer'].includes(task)) {
          codes.push('agentic_workflow.view', 'testcase.create');
          if (task === 'automation-engineer') {
            codes.push('automation.view');
            if (node.data.testEnvironmentId) codes.push('data.view');
          }
        }
        await require('../../artifactTasks').access(user, workflow.project_id, codes);
        if (task === 'test-data-generator' && dataOptions.source === 'dataset') await require('../../testDataGenerator').loadDataSet({ run:{project_id:workflow.project_id,app_type_id:workflow.app_type_id},node,user,
          access:require('../../artifactTasks').access });
        if (task === 'automation-engineer') await require('../../automationNodeInputs').resolveNodeInputs({ run:{project_id:workflow.project_id,app_type_id:workflow.app_type_id,input_payload:payload},node,user,
          access:require('../../artifactTasks').access });
        // Test Data Generator has a safe deterministic fallback and does not
        // block dataset-backed workflows on an unrelated model connection.
        if (task !== 'test-data-generator') await nodeAiConfiguration.runNode(node, {}, () => agentRegistry.resolveModel(workflow.project_id, user?.id, node.data.llmIntegrationId || text(payload.integration_id) || undefined,
          require('../../artifactTasks').taskUsageKey(task)));
};
