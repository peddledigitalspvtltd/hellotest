
const connections=require("../connections");

const {contextFor}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "artifactTask";
    const errors = [];
    const check = (task) => {
        try {
            task();
        }
        catch (error) {
            errors.push(error.publicMessage || error.message);
        }
    };
    if (Number(data.retryCount) > 0 && !require("../runtimeEvents").canRetry(kind, data))
        errors.push("Retries are available for AI reviews and HTTP GET/HEAD requests. Set retries to zero for this node.");
    if (!require("../artifactTasks").TASKS.has(data.artifactTask))
        errors.push("Choose a native artifact task.");
    if (data.artifactTask === 'test-case-generation') {
        try {
            require('../generationNodeOptions').generationOptions(data);
        }
        catch (error) {
            errors.push(error.publicMessage || 'Check the Test Case Generator settings.');
        }
    }
    if (data.artifactTask === 'test-data-generator') {
        try {
            require('../testDataGenerator').validateNodeOptions(data);
        }
        catch (error) {
            errors.push(error.publicMessage || 'Check the Test Data Generator settings.');
        }
    }
    if (data.artifactTask === "automation-engineer" && data.readinessPolicy != null && !["verify-inputs", "require-ready"].includes(data.readinessPolicy))
        errors.push("Choose whether Automation Engineer verifies inputs or requires a ready assurance assessment.");
    if (data.artifactTask === 'automation-engineer') {
        try {
            require('../automationNodeInputs').validateNodeOptions(data);
        }
        catch (error) {
            errors.push(error.publicMessage || 'Check the Automation input settings.');
        }
    }
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "artifactTask";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return require("../artifactTasks").execute({ run, node, sources, user, signal, onProgress, context });
    throw connections.fail("This node does not have an execution adapter.");
}
function inputContract(node) {
    return require('../automationNodeInputs').manualCaseSource(node.data) ? 'manualAutomationCase' : 'nativeStory';
}
function validateInput(context) {
    if (inputContract(context.node) === 'manualAutomationCase') {
        if (context.hasInput || context.node.data.automationManualCaseId) {
            context.checkInputOnce(`manualAutomationCase-${context.node.id}`, () => require('../automationNodeInputs').checkManualInput({project_id:context.workflow.project_id,app_type_id:context.workflow.app_type_id,input_payload:context.payload},context.node));
        } else context.warnOnce('Supply manual_test_case_id in the trigger input before running manual Test Case automation.');
        return;
    }
    if (context.hasInput) context.checkInputOnce('nativeStory', () => require('../artifactTasks').checkInput({project_id:context.workflow.project_id,app_type_id:context.workflow.app_type_id,input_payload:context.payload,workflow_snapshot:context.workflow}));
    else context.warnOnce('Trigger values have not been checked. Choose a Sprint and supply the execution input before running native tasks.');
}
module.exports=require('./definition')('artifactTask',{
    timeoutMaxMs:()=>3600000,inputContract,validateInput,
    preflight:{model:require('./shared/nativePreflight'),connection:require('./shared/automationBrowserPreflight')},
    preflightFailure:(_phase,failure)=>failure.publicMessage||failure.message||'Check the native task model and permissions.',validate,execute
});
