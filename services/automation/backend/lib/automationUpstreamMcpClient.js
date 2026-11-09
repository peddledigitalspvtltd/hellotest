const { randomUUID } = require('node:crypto');
const { resolveTestEngineSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');
const { readBoundedResponseJson } = require('@hellotest/platform/backend/src/utils/boundedResponse');
const { normalizeAutomationStartUrl } = require('@hellotest/platform/backend/src/utils/automationStartUrl');
const { configuredAssertionTimeoutMs, configuredNavigationTimeoutMs } = require('./automationAssertionTimeout');
const { browserTransportError } = require('./automationBrowserTransportError');
const { UPSTREAM_BROWSER_DRIVER } = require('./automationBuildPipelineOptions');
const diagnostics = require('./automationProgressDiagnostics');

const MCP_PROTOCOL='2025-03-26';
const MAX_RESPONSE_BYTES=2*1024*1024;
const unsupported=()=>Object.assign(new Error('The connected browser does not provide the supported upstream Playwright MCP runtime. Update TestEngine or the paired agent before rebuilding.'),{
  code:'AUTOMATION_UPSTREAM_MCP_UNSUPPORTED',statusCode:503,nonRetryable:true,action_outcome:'not_attempted'
});

/** Only the native MCP transport lives here. Tool catalogs, arguments and
 * results retain their upstream shape; the shared builder owns model policy. */
async function connectUpstreamPlaywright({integration,startUrl,buildId=randomUUID(),secrets={},signal,capturePreview=false,onPreview}={}){
  signal?.throwIfAborted();
  const entryUrl=normalizeAutomationStartUrl(startUrl,{required:true});
  if(!integration||typeof buildId!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(buildId)
    ||!secrets||typeof secrets!=='object'||Array.isArray(secrets)||Object.keys(secrets).length>256
    ||Object.entries(secrets).some(([key,value])=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||key.length>160||typeof value!=='string'||value.length>16384)
    ||Buffer.byteLength(JSON.stringify(secrets))>256*1024)throw Object.assign(new Error('Supply a valid upstream browser integration, build identity and bounded secret bindings.'),{statusCode:400,code:'AUTOMATION_UPSTREAM_MCP_INPUT_INVALID',nonRetryable:true});
  const config=integration.config||{};
  const previewEnabled=capturePreview===true&&typeof onPreview==='function';
  const assertionTimeoutMs=configuredAssertionTimeoutMs(config.assertion_timeout_ms);
  const navigationTimeoutMs=configuredNavigationTimeoutMs(config.navigation_timeout_ms);
  const transportTimeoutMs=Math.max(60000,(assertionTimeoutMs||0)+20000,(navigationTimeoutMs||0)+20000);
  const pairedBridge=integration.paired_browser_bridge;
  const transport=pairedBridge?await require('../services/pairedBrowserBridge.service').createTransport(pairedBridge,{provider:UPSTREAM_BROWSER_DRIVER,assertionTimeoutMs,navigationTimeoutMs}):fetch;
  const endpoint=pairedBridge?'paired-upstream-playwright-mcp':`${String(integration.base_url||'').replace(/\/+$/,'')}/api/v1/automation/playwright-mcp`;
  if(!pairedBridge){
    let target;try{target=new URL(endpoint);}catch{throw Object.assign(new Error('Configure a valid TestEngine connection before building automation.'),{statusCode:422,code:'AUTOMATION_UPSTREAM_MCP_INPUT_INVALID'});}
    if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Object.assign(new Error('Configure an HTTP or HTTPS TestEngine connection without embedded credentials.'),{statusCode:422,code:'AUTOMATION_UPSTREAM_MCP_INPUT_INVALID'});
  }
  const headers={'content-type':'application/json',accept:'application/json','mcp-protocol-version':MCP_PROTOCOL,
    ...(!pairedBridge?{'x-hellotest-testengine-secret':resolveTestEngineSecret(config.shared_secret)}:{})};
  let sequence=0,sessionId,affinityCookie,closed=false;
  const requestHeaders=()=>({...headers,...(sessionId?{'mcp-session-id':sessionId}:{}),...(affinityCookie?{cookie:affinityCookie}:{})});
  const post=async(method,params,{deadlineMs}={})=>{
    if(closed)throw Object.assign(new Error('The upstream Playwright MCP session is closed.'),{code:'AUTOMATION_UPSTREAM_MCP_CLOSED',nonRetryable:true});
    signal?.throwIfAborted();
    const remainingMs=Number.isFinite(deadlineMs)?deadlineMs-Date.now():transportTimeoutMs;
    if(remainingMs<=0)throw Object.assign(new Error('The upstream browser build deadline ended before dispatch.'),{code:'AUTOMATION_BUILD_DEADLINE',statusCode:422,nonRetryable:true,action_outcome:'not_attempted'});
    const timeout=AbortSignal.timeout(Math.max(1,Math.min(transportTimeoutMs,remainingMs)));
    const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
    const notification=method==='notifications/initialized',id=notification?undefined:++sequence;
    const body=JSON.stringify({jsonrpc:'2.0',...(id!==undefined?{id}:{}),method,...(params!==undefined?{params}:{})});
    if(Buffer.byteLength(body)>256*1024)throw Object.assign(new Error('The upstream browser request exceeds its bounded input size.'),{code:'AUTOMATION_UPSTREAM_MCP_INPUT_INVALID',statusCode:400,nonRetryable:true,action_outcome:'not_attempted'});
    let response;
    try{
      response=await transport(endpoint,{method:'POST',redirect:'error',headers:requestHeaders(),body,signal:requestSignal});
      if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw browserTransportError(response.status,{method});}
      if(method==='initialize'){
        sessionId=response.headers.get('mcp-session-id');
        const affinity=response.headers.get('set-cookie')?.match(/(?:^|,\s*)HELLOTEST_ENGINE=([^;,\s]+)/);
        if(affinity)affinityCookie=`HELLOTEST_ENGINE=${affinity[1]}`;
      }
      if(notification){await response.body?.cancel().catch(()=>undefined);return;}
      const payload=await readBoundedResponseJson(response,{maxBytes:MAX_RESPONSE_BYTES,label:'Upstream Playwright MCP response'});
      requestSignal.throwIfAborted();
      if(!payload||payload.jsonrpc!=='2.0'||payload.id!==id||!Object.hasOwn(payload,'result')||payload.error)throw browserTransportError(response.status,{method,protocol:true});
      // The browser UI uses protected transport metadata, never native tool
      // content or the model channel. Retain the native result byte-for-byte.
      const preview=payload._meta?.hellotest?.browser_preview;
      if(previewEnabled&&method==='tools/call'&&payload.result?.isError!==true&&preview?.tool===params?.name&&Array.isArray(preview.content)&&preview.content.length===1){
        const block=preview.content[0];
        if(block?.type==='image'&&block.mimeType==='image/jpeg'&&typeof block.data==='string'&&block.data.length<=174764&&/^[A-Za-z0-9+/]+={0,2}$/.test(block.data)){
          const bytes=Buffer.from(block.data,'base64');
          if(bytes.length&&bytes.length<=128*1024&&bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) {
            const url=(()=>{try{const value=new URL(preview.url);return ['http:','https:'].includes(value.protocol)?value.origin+value.pathname:undefined;}catch{return undefined;}})();
            const observedAt=typeof preview.observed_at==='string'&&Number.isFinite(Date.parse(preview.observed_at))?preview.observed_at:new Date().toISOString();
            try { await onPreview({tool:preview.tool,content:[{type:'image',mimeType:'image/jpeg',data:block.data}],...(url?{url}:{}),observed_at:observedAt}); }
            catch(error) {
              if(diagnostics.isCriticalAutomationError(error))throw error;
              diagnostics.reportDiagnosticFailure({operation:'upstream_ui_preview',error});
            }
            requestSignal.throwIfAborted();
          }
        }
      }
      return payload.result;
    }catch(error){
      if(signal?.aborted)throw signal.reason||error;
      if(timeout.aborted)throw Object.assign(new Error('The upstream Playwright MCP request exceeded its transport deadline.'),{name:'TimeoutError',code:'BROWSER_TRANSPORT_TIMEOUT',statusCode:504,nonRetryable:true,retry_safe:false});
      if(diagnostics.isCriticalAutomationError(error)||error.statusCode||/^(?:AUTOMATION_|PAIRED_BROWSER_|DEPENDENCY_RESPONSE_TOO_LARGE|BROWSER_)/.test(error.code||''))throw error;
      if(error instanceof SyntaxError)throw browserTransportError(response?.status||502,{method,protocol:true});
      throw browserTransportError(503,{method});
    }
  };
  const close=async()=>{
    if(closed)return;closed=true;
    if(!sessionId)return;
    try{
      const response=await transport(endpoint,{method:'DELETE',redirect:'error',headers:requestHeaders(),signal:AbortSignal.timeout(5000)});
      await response.body?.cancel().catch(()=>undefined);
    }catch{/* Closing an uncertain session never replays its last tool call. */}
  };
  try{
    const initialized=await post('initialize',{protocolVersion:MCP_PROTOCOL,capabilities:{},clientInfo:{name:'hellotest-automation-upstream',version:'1.0.0'},
      _meta:{hellotest:{start_url:entryUrl,build_id:buildId,secrets,...(previewEnabled?{capture_preview:true}:{}),...(assertionTimeoutMs!==undefined?{assertion_timeout_ms:assertionTimeoutMs}:{}),...(navigationTimeoutMs!==undefined?{navigation_timeout_ms:navigationTimeoutMs}:{})}}});
    const provider=initialized?._meta?.hellotest;
    if(!sessionId||initialized?.protocolVersion!==MCP_PROTOCOL||!initialized.capabilities?.tools||provider?.provider!==UPSTREAM_BROWSER_DRIVER||provider.upstream_package!=='@playwright/mcp'||typeof provider.upstream_version!=='string')throw unsupported();
    if((assertionTimeoutMs!==undefined&&provider.assertion_timeout_ms!==assertionTimeoutMs)||(navigationTimeoutMs!==undefined&&provider.navigation_timeout_ms!==navigationTimeoutMs))throw unsupported();
    await post('notifications/initialized');
    const catalog=await post('tools/list');
    if(!Array.isArray(catalog?.tools)||catalog.tools.length>100||catalog.tools.some(tool=>!tool||typeof tool.name!=='string'||!tool.inputSchema||typeof tool.inputSchema!=='object'))throw unsupported();
    return {tools:catalog.tools,startUrl:entryUrl,provider,call:(name,args,options)=>post('tools/call',{name,arguments:args},options),close};
  }catch(error){await close();throw error;}
}

module.exports={connectUpstreamPlaywright};
