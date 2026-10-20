const DIAGNOSTIC_MIME = 'application/vnd.hellotest.automation-browser-diagnostic+json';

const { isCriticalAutomationError, reportDiagnosticFailure } = require('./automationProgressDiagnostics');

/** Optional protected support evidence must never replace the build failure. */
async function retainBrowserDiagnostic({ error, transactionId, assertAccess, createArtifact, appendEvent }) {
  if (!transactionId || !error?.browser_diagnostic || error.browser_diagnostic.launch_phase !== 'startup') return null;
  try {
    await assertAccess();
    const content = JSON.stringify(error.browser_diagnostic);
    if (Buffer.byteLength(content, 'utf8') > 2048) {
      reportDiagnosticFailure({ activityId: transactionId, operation: 'browser_startup_diagnostic', error: { code: 'AUTOMATION_BROWSER_DIAGNOSTIC_TOO_LARGE' } });
      return null;
    }
    const artifact = await createArtifact(transactionId, {
      file_name: 'browser-startup-diagnostic.json', mime_type: DIAGNOSTIC_MIME, content
    });
    await appendEvent(transactionId, { phase: 'automation.agent.browser.diagnostic', level: 'warning',
      message: 'A protected browser startup diagnostic was retained for investigation.', details: { artifact_id: artifact.id } });
    return artifact;
  } catch (storageError) {
    if (isCriticalAutomationError(storageError)) throw storageError;
    reportDiagnosticFailure({ activityId: transactionId, operation: 'browser_startup_diagnostic', error: storageError });
    return null;
  }
}

module.exports = { DIAGNOSTIC_MIME, retainBrowserDiagnostic };
