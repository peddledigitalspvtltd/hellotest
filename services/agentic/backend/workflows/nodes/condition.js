
const connections=require("../connections");

const {contextFor,condition}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "condition";
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
    check(() => condition(data, {}));
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "condition";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return { matched: condition(data, context), data: context.input };
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("condition",{validateConnections(_node,{outgoing}){return outgoing.some(edge=>edge.sourceHandle&&!['true','false'].includes(edge.sourceHandle))?['Connect condition outputs using the true or false ports.']:[];},validate,execute});
