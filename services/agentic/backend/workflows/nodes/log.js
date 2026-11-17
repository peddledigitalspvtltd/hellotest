const connections=require("../connections");

const {sanitizeAiText}=require("@hellotest/platform/backend/src/security/aiTextPolicy");
const {contextFor,interpolate}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "log";
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
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "log";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return {
        data: context.input,
        message: sanitizeAiText(interpolate(data.logMessage || "Received connected data.", context)).text,
    };
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("log",{validate,execute});
