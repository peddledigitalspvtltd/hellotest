
const connections=require("../connections");

const {contextFor}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "errorHandler";
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
    const data = node.data || {}, kind = "errorHandler";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return {
        data: sources.map((source) => ({
            node_id: source.node_id,
            status: source.status,
            error: source.error || null,
            error_details: source.error_details || null,
            input: source.input?.input ?? null,
            attempts: source.attempts || 0,
        })),
        recovered: true,
    };
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("errorHandler",{validateConnections(_node,{incoming,nodes}){return incoming.some(edge=>nodes.find(parent=>parent.id===edge.source)?.data.onError!=='errorOutput')?['Set each connected parent to Route to error handler.']:[];},validate,execute});
