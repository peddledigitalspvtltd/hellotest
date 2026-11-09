const DIAGNOSTIC_MIME = 'application/vnd.hellotest.automation-browser-diagnostic+json';

const { isCriticalAutomationError, reportDiagnosticFailure } = require('./automationProgressDiagnostics');

/** Optional protected support evidence must never replace the build failure. */
async function retainBrowserDiagnostic({ error, transactionId, assertAccess, createArtifact, appendEvent }) {
  const diagnostic = error?.browser_diagnostic;
  const startup = diagnostic?.launch_phase === 'startup';
  const navigation = diagnostic?.failure_phase === 'navigation' && diagnostic?.browser_tool === 'browser_navigate';
  if (!transactionId || !diagnostic || !startup && !navigation) return null;
  const operation = startup ? 'browser_startup_diagnostic' : 'browser_navigation_diagnostic';
  try {
    await assertAccess();
    const content = JSON.stringify(diagnostic);
    if (Buffer.byteLength(content, 'utf8') > 2048) {
      reportDiagnosticFailure({ activityId: transactionId, operation, error: { code: 'AUTOMATION_BROWSER_DIAGNOSTIC_TOO_LARGE' } });
      return null;
    }
    const artifact = await createArtifact(transactionId, {
      file_name: startup ? 'browser-startup-diagnostic.json' : 'browser-navigation-diagnostic.json', mime_type: DIAGNOSTIC_MIME, content
    });
    await appendEvent(transactionId, { phase: 'automation.agent.browser.diagnostic', level: 'warning',
      message: `A protected browser ${startup ? 'startup' : 'navigation'} diagnostic was retained for investigation.`, details: { artifact_id: artifact.id } });
    return artifact;
  } catch (storageError) {
    if (isCriticalAutomationError(storageError)) throw storageError;
    reportDiagnosticFailure({ activityId: transactionId, operation, error: storageError });
    return null;
  }
}

module.exports = { DIAGNOSTIC_MIME, retainBrowserDiagnostic };
