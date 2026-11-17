function validateConnections(node,{outgoing,nodes}){const data=node.data||{};if(data.dataOperation!=='switch')return [];const effective={...require('../../../shared/workflowDataOperations.json').switch.defaults,...data};let routes;try{routes=typeof effective.dataRoutes==='string'?JSON.parse(effective.dataRoutes):effective.dataRoutes;}catch{routes=[];}const handles=new Set((Array.isArray(routes)?routes:[]).map(route=>route?.id));if(effective.dataFallback==='fallback')handles.add('fallback');return outgoing.some(edge=>!handles.has(edge.sourceHandle)&&!(data.onError==='errorOutput'&&nodes.some(next=>next.id===edge.target&&(next.data?.kind||next.type||'agent')==='errorHandler')))?['Connect Switch outputs using a configured route ID or the enabled fallback port.']:[];}
const connections=require("../connections");
const dataOperations=require("../dataOperations");

const {readPath,mapValues,contextFor,condition}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "dataOperation";
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
    check(() => dataOperations.validate(data, { condition }));
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "dataOperation";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return dataOperations.execute(data, context, { readPath, mapValues, condition, signal });
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("dataOperation",{validateConnections,validate,execute});
