async function connectionPreflight({workflow,node}){const data=node.data||{},{connection}=await require('../connections').resolve(data.connectionId,workflow.project_id,null,'mcp');if(!connection.tools?.includes(data.mcpTool))throw require('../connections').fail('Enable this tool in Integrations or choose an enabled tool.');if(!connection.toolDefinitions?.some(tool=>tool.name===data.mcpTool))throw require('../connections').fail('Discover and save this server tool in Integrations before running it.',422);require('../connections')._internals.authHeaders(connection);}
const connections=require("../connections");

const mcp=require("../mcpClient");

const {parseObject,mapValues,contextFor}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "mcpTool";
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
    {
        if (!data.connectionId || !data.mcpTool)
            errors.push("Choose an MCP server and tool.");
        check(() => mapValues(parseObject(data.mcpArguments || "{}", "Tool arguments"), {}));
    }
    if (Number(data.retryCount) > 0)
        errors.push("MCP calls cannot be automatically retried. Set retries to zero.");
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "mcpTool";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    return mcp.call({
        projectId: run.project_id,
        connectionId: data.connectionId,
        user,
        expectedToolHash: data.mcpToolHash,
        signal,
        timeoutMs: Number(data.timeoutMs) || 30000,
    }, data.mcpTool, mapValues(parseObject(data.mcpArguments || "{}", "Tool arguments"), context));
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("mcpTool",{preflight:{connection:connectionPreflight},preflightFailure:(_phase,failure)=>failure.publicMessage||'This connection could not be checked. Review its settings in Admin Space.',validate,execute});
