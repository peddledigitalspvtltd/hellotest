const { resolveTestEngineSecret } = require("@hellotest/platform/backend/src/security/runtimeSecrets");
const { readBoundedResponseJson } = require("@hellotest/platform/backend/src/utils/boundedResponse");
const { isDeepStrictEqual } = require('node:util');
const { browserTransportError } = require("./automationBrowserTransportError");
const { automationBrowserScope } = require("./automationBrowserFlowPolicy");
const { configuredAssertionTimeoutMs, configuredNavigationTimeoutMs, browserTransportTimeoutMs } = require("../build/automationAssertionTimeout");
const { deadlineFailure, discoveredMode } = require('./automationBrowserLoopState');
const { runAutomationBrowserAgent, remainingBrowserCalls } = require('./automationBrowserLoop');
const { compactBrowserObservations } = require('./automationBrowserContext');
const MCP_PROTOCOL = '2025-03-26';
async function connectAutomationBrowser({ integration, startUrl, allowBrowserActions = false, signal }) {
  const assertionTimeoutMs=configuredAssertionTimeoutMs(integration.config?.assertion_timeout_ms);
  const navigationTimeoutMs=configuredNavigationTimeoutMs(integration.config?.navigation_timeout_ms);
  const pairedBridge = integration.paired_browser_bridge;
  const transport = pairedBridge ? await require("../../services/pairedBrowserBridge.service").createTransport(pairedBridge,{assertionTimeoutMs,navigationTimeoutMs}) : fetch;
  const endpoint = pairedBridge ? 'paired-browser-mcp' : `${integration.base_url.replace(/\/+$/, "")}/api/v1/automation/mcp`;
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(!pairedBridge ? { "x-hellotest-testengine-secret": resolveTestEngineSecret(integration.config?.shared_secret) } : {}), "mcp-protocol-version": MCP_PROTOCOL };
  let sequence = 0;
  let sessionId;
  let affinityCookie;
  let closed = false;
  let discoveredTools=[];
  const call = async (method, params, { deadlineMs } = {}) => {
    if (closed) throw new Error("Automation browser session is closed");
    signal?.throwIfAborted();
    const transportTimeout=browserTransportTimeoutMs(method,params,assertionTimeoutMs,navigationTimeoutMs);
    const remainingMs = Number.isFinite(deadlineMs) ? deadlineMs - Date.now() : transportTimeout;
    if (remainingMs <= 0) throw deadlineFailure();
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(transportTimeout, remainingMs)));
    const timeoutFailure=(cause,phase)=>Object.assign(new Error('The browser MCP request exceeded its bounded transport time allowance.',{cause}),{
      name:'TimeoutError',code:'BROWSER_TRANSPORT_TIMEOUT',browser_transport_phase:phase
    });
    const id = ++sequence;
    const response = await transport(endpoint, { method: "POST", redirect:"error", headers: { ...headers, ...(sessionId ? { "mcp-session-id": sessionId } : {}), ...(affinityCookie ? {cookie:affinityCookie} : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: signal ? AbortSignal.any([signal,timeout]) : timeout }).catch(error=>{
      if(timeout.aborted&&!signal?.aborted)throw timeoutFailure(error,'http_response');
      throw error;
    });
    // Guards and reverse proxies return ordinary JSON or HTML on 401/403,
    // without a JSON-RPC envelope. Classify HTTP before decoding that envelope;
    // otherwise an authentication failure becomes a misleading ID mismatch.
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw browserTransportError(response.status, { method });
    }
    if (method === "initialize") {
      sessionId = response.headers.get("mcp-session-id");
      const affinity=response.headers.get("set-cookie")?.match(/(?:^|,\s*)HELLOTEST_ENGINE=([^;,\s]+)/);
      if(affinity)affinityCookie=`HELLOTEST_ENGINE=${affinity[1]}`;
    }
    const payload = await readBoundedResponseJson(response, { maxBytes: 256 * 1024, label: "Automation browser response" }).catch((error) => {
      if(timeout.aborted&&!signal?.aborted)throw timeoutFailure(error,'response_body');
      if (error instanceof SyntaxError) return null;
      throw error;
    });
    if(payload&&(payload.jsonrpc!=="2.0"||payload.id!==id))throw browserTransportError(response.status,{method,protocol:true});
    if(method==='tools/call'&&payload?.error?.code===-32602){
      const contract=payload.error.data?.assertion_contract;
      const schema=discoveredTools.find(tool=>tool.name===params?.name)?.inputSchema;
      const argumentNames=new Set(Object.keys(schema?.properties||{})),modes=schema?.properties?.assertion?.enum||[];
      const names=value=>Array.isArray(value)?[...new Set(value.filter(item=>typeof item==='string'&&argumentNames.has(item)))].slice(0,20):[];
      const assertionContract=contract&&typeof contract==='object'?{
        ...(modes.includes(contract.assertion)?{assertion:contract.assertion}:{}),
        required_arguments:names(contract.required_arguments),forbidden_arguments:names(contract.forbidden_arguments)
      }:null;
      const allowed=payload.error.data?.allowed_assertions||contract?.allowed_assertions;
      const allowedAssertions=Array.isArray(allowed)?allowed.filter(item=>modes.includes(item)).slice(0,40):[];
      return {isError:true,content:[{type:'text',text:JSON.stringify({source:'playwright',code:'BROWSER_TOOL_INVALID_ARGUMENTS',message:'The MCP server rejected these tool arguments before execution. Correct the request using the discovered schema and any required or forbidden argument names.',action_outcome:'not_attempted',retry_safe:true,...(assertionContract?{assertion_contract:assertionContract}:{}),...(allowedAssertions.length?{allowed_assertions:allowedAssertions}:{})})}]};
    }
    if (payload?.error || !payload?.result) throw browserTransportError(response.status,{method,protocol:true});
    return payload.result;
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    if (sessionId) await transport(endpoint, { method: "DELETE", redirect:"error", headers: { ...headers, "mcp-session-id": sessionId, ...(affinityCookie ? {cookie:affinityCookie} : {}) }, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  };
  try {
    const initializedProtocol = await call("initialize", { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "hellotest-automation", version: "1.0.0" }, _meta: { hellotest: { start_url: startUrl, allow_browser_actions: allowBrowserActions === true,...(assertionTimeoutMs!==undefined?{assertion_timeout_ms:assertionTimeoutMs}:{}),...(navigationTimeoutMs!==undefined?{navigation_timeout_ms:navigationTimeoutMs}:{}) } } });
    if (!sessionId || initializedProtocol.protocolVersion !== MCP_PROTOCOL || !initializedProtocol.capabilities?.tools) throw new Error("Automation browser did not establish a compatible MCP tools session");
    if(assertionTimeoutMs!==undefined&&assertionTimeoutMs!==10_000&&initializedProtocol._meta?.hellotest?.assertion_timeout_ms!==assertionTimeoutMs)
      throw Object.assign(new Error('The connected browser runtime did not accept the configured assertion timeout. Update the paired local agent or TestEngine runtime before starting this build. No browser navigation or action was performed.'),{
        code:'AUTOMATION_BROWSER_ASSERTION_POLICY_UNSUPPORTED',statusCode:503,nonRetryable:true,action_outcome:'not_attempted'
      });
    if(navigationTimeoutMs!==undefined&&initializedProtocol._meta?.hellotest?.navigation_timeout_ms!==navigationTimeoutMs)
      throw Object.assign(new Error('The connected browser runtime did not accept the configured navigation timeout. Update the paired local agent or TestEngine runtime before starting this build. No browser navigation or action was performed.'),{
        code:'AUTOMATION_BROWSER_NAVIGATION_POLICY_UNSUPPORTED',statusCode:503,nonRetryable:true,action_outcome:'not_attempted'
      });
    signal?.throwIfAborted();
    const initialized = await transport(endpoint, { method: "POST", redirect:"error", headers: { ...headers, "mcp-session-id": sessionId, ...(affinityCookie ? {cookie:affinityCookie} : {}) }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    if (!initialized.ok) {
      await initialized.body?.cancel().catch(() => undefined);
      throw browserTransportError(initialized.status, { method: 'notifications/initialized' });
    }
    const { tools } = await call("tools/list");
    if (!Array.isArray(tools) || tools.length > 50 || tools.some((tool) => !tool || typeof tool.name !== "string" || !tool.inputSchema)) throw new Error("Automation browser returned an invalid tool catalog");
    discoveredTools=tools;
    return { tools, startUrl, scope: automationBrowserScope, call: (name, args, options) => call("tools/call", { name, arguments: args }, options), close };
  } catch (error) { await close(); throw error; }
}



module.exports = {connectAutomationBrowser,runAutomationBrowserAgent,compactBrowserObservations,remainingBrowserCalls};
