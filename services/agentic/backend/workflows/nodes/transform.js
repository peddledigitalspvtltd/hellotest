const connections=require("../connections");

const {parseObject,mapValues,contextFor}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "transform";
    const errors = [];
    const check = (task) => {
        try {
            task();
        }
        catch (error) {
            errors.push(error.publicMessage || error.message);
        }
    };
    check(() => mapValues(parseObject(data.transformMapping || "{}", "Field mapping"), {}));
    if (Number(data.retryCount) > 0 && !require("../runtimeEvents").canRetry(kind, data))
        errors.push("Retries are available for AI reviews and HTTP GET/HEAD requests. Set retries to zero for this node.");
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "transform";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return {
        data: mapValues(parseObject(data.transformMapping || "{}", "Field mapping"), context),
    };
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("transform",{validate,execute});
