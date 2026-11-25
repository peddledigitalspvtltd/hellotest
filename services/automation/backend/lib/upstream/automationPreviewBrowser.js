const { setTimeout: delay } = require('node:timers/promises');
const client = require('./automationUpstreamMcpClient');

function transientHandshake(error) {
  return error?.code === 'BROWSER_TRANSPORT_TIMEOUT' || error?.code === 'AUTOMATION_BROWSER_ENGINE_UNAVAILABLE'
    && [408,425,429,500,502,503,504].includes(error.statusCode);
}

// This boundary encloses only initialize, initialized and tools/list. A new
// session is safe here because no page navigation, model turn or case action
// has started. No tools/call is ever replayed by this policy.
async function connectPreviewBrowser(options,{retryStartup,onProgress,beforeConnect}) {
  await beforeConnect();
  try { return await client.connectUpstreamPlaywright(options); }
  catch (error) {
    options.signal?.throwIfAborted();
    if (!retryStartup || !transientHandshake(error)) throw error;
    await onProgress({phase:'automation.agent.browser.startup_retry',level:'warning',
      message:'The Playwright MCP session could not start. Reconnecting once before opening the application.',
      details:{error_code:error.code,browser_startup_attempt:2}});
    await delay(400,undefined,{signal:options.signal});
    await beforeConnect();
    return client.connectUpstreamPlaywright(options);
  }
}

module.exports={connectPreviewBrowser};
