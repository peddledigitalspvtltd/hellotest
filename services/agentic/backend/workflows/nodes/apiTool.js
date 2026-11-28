
const connections=require("../connections");
const { WORKSPACE_SPRINT_STORIES, readWorkspaceSprintStories } = require('../sprintPipeline');

const {httpMethod,parseRequestBody,mapValues,contextFor,interpolate}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "apiTool";
    const errors = [];
    if (data.apiResource === WORKSPACE_SPRINT_STORIES)
        return (data.apiMethod || 'GET') === 'GET' && !data.connectionId && !data.apiUrl && !data.apiBody && !data.apiAuth && !data.credentialId
            ? [] : ['The workspace Sprint read uses GET and the running project session.'];
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
        let method;
        check(() => { method = httpMethod(kind, data); });
        if (method && !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method))
            errors.push('Choose a supported HTTP method.');
        if (method && data.apiBody && !["GET", "HEAD"].includes(method))
            check(() => mapValues(parseRequestBody(data.apiBody), {}));
        if (!data.apiUrl && !data.connectionId)
            errors.push("Enter an endpoint or select a connection.");
        if (data.apiAuth || data.credentialId)
            errors.push("Replace inline authentication with a server-managed connection.");
        if (Number(data.retryCount) > 0 &&
            !["GET", "HEAD"].includes(method))
            errors.push("Set retries to zero for HTTP requests that may change data.");
        if (data.apiPagination && !['none', 'cursor'].includes(data.apiPagination))
            errors.push('Choose supported cursor pagination.');
        if (data.apiPagination === 'cursor' && method !== 'GET')
            errors.push('Cursor pagination is available only for HTTP GET.');
        if (data.apiResource && data.apiResource !== 'sprintStories')
            errors.push('Choose the supported Sprint Stories resource or a standard HTTP endpoint.');
        if (data.apiResource === 'sprintStories' && !data.connectionId)
            errors.push('Select a managed HelloTest HTTP API connection with an API key.');
    }
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, }) {
    const data = node.data || {}, kind = "apiTool";
    if (data.apiResource === WORKSPACE_SPRINT_STORIES) return readWorkspaceSprintStories({ run, user, signal });
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    if (data.apiResource === "sprintStories") {
        const sprintId = require("../artifactTasks").checkSprintInput(run);
        await require("../artifactTasks").access(user, run.project_id, ["requirement.view"]);
        const { connection, url } = await connections.resolve(data.connectionId, run.project_id, data.apiUrl || undefined);
        if (!connection)
            throw connections.fail("Select a managed HelloTest HTTP connection with an API key.", 422);
        const endpoint = new URL(url);
        endpoint.pathname = endpoint.pathname.replace(/\/+$/, "").replace(/\/requirements$/, "") + "/requirements";
        endpoint.search = "";
        endpoint.searchParams.set("project_id", run.project_id);
        endpoint.searchParams.set("sprint_id", sprintId);
        endpoint.searchParams.set("include_page", "true");
        endpoint.searchParams.set("page_size", "20");
        // The whole selected Sprint must fit the native Story pipeline budget.
        // Pagination never returns a successful prefix of a larger Sprint.
        return connections.callHttp({ projectId: run.project_id, data: { ...data, apiUrl: endpoint.toString(), apiMethod: "GET", apiPagination: "cursor", apiMaxItems: 100 }, signal });
    }
    return connections.callHttp({
        projectId: run.project_id,
        data: {
            ...data,
            apiUrl: interpolate(data.apiUrl, context, true),
            apiBody: data.apiBody && !["GET", "HEAD"].includes(httpMethod(kind, data)) ? JSON.stringify(mapValues(parseRequestBody(data.apiBody), context)) : "",
            apiMethod: httpMethod(kind, data),
        },
        signal,
    });
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports = require("./definition")("apiTool", {
    allowsCredentialReference: true,
    validateInput(context) {
        if (context.hasInput && !context.hasNativeInput && ['sprintStories', WORKSPACE_SPRINT_STORIES].includes(context.node.data.apiResource))
            context.checkInputOnce('sprintStories', () => require('../artifactTasks').checkSprintInput({project_id:context.workflow.project_id,input_payload:context.payload}));
    },
    preflight: { connection: context => context.node.data.apiResource === WORKSPACE_SPRINT_STORIES
        ? require('../artifactTasks').access(context.user, context.workflow.project_id, ['requirement_iteration.view', 'requirement.view'])
        : require('./shared/httpPreflight')(context,String(context.node.data.apiMethod||'GET').toUpperCase()) },
    preflightFailure: (_phase, failure) => failure.publicMessage || 'This connection could not be checked. Review its settings in Admin Space.',
    validate, execute
});
