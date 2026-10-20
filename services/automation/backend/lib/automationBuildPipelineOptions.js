const VERIFICATION_MODES = new Set(['generate_only', 'verify', 'verify_repair']);
const BROWSER_DRIVERS = new Set(['mcp']);
const VERIFICATION_DRIVERS = new Set(['native','playwright_test_cli']);

/** The browser's interaction policy also applies to the fresh verification run. */
function normalizeBuildPipelineOptions({ verification_mode, browser_driver, verification_driver, allow_browser_actions } = {}) {
  const mode = verification_mode === undefined ? 'generate_only' : verification_mode;
  const driver = browser_driver === undefined ? 'mcp' : browser_driver;
  const verifier = verification_driver === undefined ? 'native' : verification_driver;
  if (!VERIFICATION_MODES.has(mode) || !BROWSER_DRIVERS.has(driver) || !VERIFICATION_DRIVERS.has(verifier)) {
    throw Object.assign(new Error('Choose a supported build verification mode and browser connection.'), {
      code: 'AUTOMATION_BUILD_OPTIONS_INVALID', statusCode: 400, nonRetryable: true
    });
  }
  if (mode !== 'generate_only' && allow_browser_actions !== true) {
    throw Object.assign(new Error('Running generated automation requires the browser mode “Perform steps in browser”.'), {
      code: 'AUTOMATION_VERIFICATION_REQUIRES_BROWSER_ACTIONS', statusCode: 400, nonRetryable: true
    });
  }
  return { verification_mode: mode, browser_driver: driver, verification_driver:mode==='generate_only'?'native':verifier };
}

async function assertBuildVerificationAccess({mode,createdBy,projectId}) {
 if(mode==='generate_only')return;
 const permissions=['automation.run.local','run.create'];
 const access=await require('@hellotest/platform/backend/services/optionalEvidenceAccess.service').getOptionalEvidenceAccess({id:createdBy},projectId,permissions);
 if(permissions.some(key=>!access[key]))throw Object.assign(new Error('Isolated verification requires local automation execution and run creation permissions.'),{statusCode:403,code:'AUTOMATION_VERIFICATION_ACCESS_REQUIRED'});
}
module.exports = { normalizeBuildPipelineOptions, assertBuildVerificationAccess };
