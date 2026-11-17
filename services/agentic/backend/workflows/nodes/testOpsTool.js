const connections=require("../connections");

const permissions=require("@hellotest/platform/backend/services/permission.service");
const flags=require("@hellotest/platform/backend/services/featureFlag.service");
const {contextFor,interpolate}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "testOpsTool";
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
    if (data.testOpsAction &&
        data.testOpsAction !== "read-runs")
        errors.push("Run evidence is read-only. Select Read runs.");
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "testOpsTool";
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    {
        if (!(await permissions.hasPermission(user, "knowledge.view", run.project_id)) ||
            !(await flags.areEnabled(flags.getFeatureKeysForPermission("knowledge.view"), { user })))
            throw connections.fail("Knowledge Repo access is required for this evidence node.", 403);
        const filters = kind === "testOpsTool"
            ? { source_kinds: ["execution"] }
            : kind === "repositoryTool"
                ? { source_kinds: ["knowledge_item", "file", "text"] }
                : {};
        const packet = await require("@hellotest/knowledge/backend/services/knowledgeRetrieval.service").retrieve({
            projectId: run.project_id,
            appTypeId: run.app_type_id,
            query: interpolate(data.knowledgeQuery ||
                (kind === "testOpsTool"
                    ? "Recent test runs and results"
                    : kind === "repositoryTool"
                        ? "Repository code and object metadata"
                        : "Project quality evidence"), context),
            filters,
            user,
            signal,
            budgets: {
                deadline_ms: Math.min(15000, Number(data.timeoutMs) || 15000),
                max_evidence_items: 10,
                max_query_cost_usd: 0,
            },
        });
        return {
            data: packet.evidence,
            context_packet_id: packet.context_packet_id,
            limitations: packet.limitations,
        };
    }
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("testOpsTool",{validate,execute});
