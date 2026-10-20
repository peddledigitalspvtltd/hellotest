const { createHash } = require('node:crypto');

const nativeTools = new Set(['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_assert',
  'browser_validate_locator', 'browser_press_key', 'browser_fill', 'browser_select_option',
  'browser_hover', 'browser_check', 'browser_uncheck', 'browser_wait_for', 'browser_screenshot']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => Array.isArray(value) ? value.map(stable)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;

function nativeReceipt(observation) {
  if (!record(observation) || observation.mcp_call === false || !nativeTools.has(observation.tool)) return null;
  for (const block of observation.result?.content || []) if (block?.type === 'text' && typeof block.text === 'string' && block.text.length <= 128_000) {
    try { const value = JSON.parse(block.text); if (record(value) && value.source === 'playwright') return value; } catch {}
  }
  return null;
}
const unscoped = args => record(args) && Object.keys(args).length === 0;

function snapshotFingerprint(page) {
  if (!record(page) || typeof page.url !== 'string' || typeof page.accessibility !== 'string' || !Array.isArray(page.elements)) return null;
  // Keep URL, current controls, field state and completeness. Only transport
  // provenance is incidental; nested application attributes are not removed.
  const state = Object.fromEntries(Object.entries(page).filter(([key]) => !['observation_id', 'captured_at', 'source', 'verification_status'].includes(key)));
  return createHash('sha256').update(JSON.stringify(stable(state))).digest('hex');
}

/** Accept only the host's actual observation ledger, never an actor-supplied
 * evidence array. This guard grants no action, readiness or outcome authority.
 * It returns feedback before dispatch; the caller must not call MCP when it
 * returns a decision, and must terminate before another model turn on stop. */
function createAutomationSnapshotReadGuard() {
  const blocked = new Set(), identities = new WeakMap();
  let nextIdentity = 0;
  const identity = row => { if (!identities.has(row)) identities.set(row, ++nextIdentity); return identities.get(row); };
  return Object.freeze({
    inspect({ request, observations = [], stepId } = {}) {
      if (request?.name !== 'browser_snapshot' || !unscoped(request.arguments) || !Array.isArray(observations)) return null;
      let fingerprint, matches = 0, barrier = 0;
      for (let index = observations.length - 1; index >= 0; index--) {
        const row = observations[index], receipt = nativeReceipt(row);
        if (!receipt) continue;
        // Optional images do not refresh typed target/state evidence. In
        // particular, the bootstrap screenshot must not hide its baseline.
        if (row.tool === 'browser_screenshot') continue;
        // A real action/check/wait can initiate or observe asynchronous state;
        // failures may also reveal new information. Synthetic feedback cannot.
        if (row.tool !== 'browser_snapshot' || row.result?.isError || !unscoped(row.arguments || {})) { barrier = identity(row); break; }
        const current = snapshotFingerprint(receipt);
        if (!current) return null;
        if (fingerprint && current !== fingerprint) { barrier = identity(row); break; }
        fingerprint = current; matches++;
        // The last snapshot from a prior section is a baseline, rather than a
        // repeated refresh charged against this section's allowance.
        if (stepId && row.execution_step_id && row.execution_step_id !== stepId) { barrier = identity(row); break; }
      }
      if (matches < 2) return null;
      const key = JSON.stringify([stepId || null, fingerprint, barrier]);
      const stop = blocked.has(key);
      blocked.add(key);
      return { stop, feedback: {
        code: stop ? 'AUTOMATION_BROWSER_SNAPSHOT_READ_STALLED' : 'AUTOMATION_BROWSER_SNAPSHOT_UNCHANGED',
        ...(typeof stepId === 'string' ? { step_id: stepId } : {}),
        action_outcome: 'not_attempted', expected_result_verified: false,
        remaining_unchanged_snapshot_refreshes: 0,
        message: stop
          ? 'The same full-page snapshot was requested again after unchanged-evidence feedback. This section stopped before another browser or model retry. Use the retained targets and review the unfinished requirement or missing prerequisite.'
          : 'The current full-page evidence already includes one unchanged refresh. No snapshot was repeated. Use its existing target references for a remaining action or native expected-result assertion. For asynchronous state, use a bounded native assertion or wait, or request a scoped snapshot for genuinely missing evidence. Report section_issue when a prerequisite is unmet; a fresh observation ID does not verify the expected result.'
      } };
    }
  });
}

module.exports = { createAutomationSnapshotReadGuard };
