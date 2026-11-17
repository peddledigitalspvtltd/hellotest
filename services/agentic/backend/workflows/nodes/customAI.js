const validateSpecialist=require('./shared/specialistValidation');
const connections=require("../connections");

const {contextFor}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "customAI";
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
    return [...errors,...validateSpecialist(node,{custom:true})];
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "customAI";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return review(run, {
        ...node,
        data: { ...data, kind: "agent", agentId: "quality-evaluator", customTask: true },
    });
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("customAI",{timeoutMaxMs:()=>150000,preflight:{model:require('./shared/modelPreflight')},preflightFailure:(_phase,failure)=>failure.publicMessage||"Check this agent's version and model connection.",validate,execute,specialistAlias:true});
