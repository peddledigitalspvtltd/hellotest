const { browserReceipt } = require('./automationInteractiveEvidence');
const { captureBrowserBatchState } = require('./automationBrowserBatchState');
const { browserBatchTargetEvidence, resolveModelToolRequest } = require('./automationBrowserModelTargets');

const identityFields = ['role', 'tag', 'name', 'context_text', 'input_type', 'placeholder', 'evidence_kind', 'identity_key'];
const completePageIdentity = page => typeof page?.url === 'string' && page.url.length > 0 && page.url.length <= 2_000
  && !page.url_truncated && typeof (page.target_id || page.page_id) === 'string' && (page.target_id || page.page_id).length <= 200
  && !page.target_id_truncated && !page.page_id_truncated;
const completeIdentity = target => target && target.identity_complete === true && identityFields.every(key => target[`${key}_truncated`] !== true)
  && !identityFields.some(key => typeof target[key] === 'string' && /\[(?:private parameter (?:reference|value)|redacted(?:_secret|_token)?)\]/i.test(target[key]));
const sameIdentity = (before, after) => completeIdentity(before) && completeIdentity(after)
  && identityFields.every(key => before[key] === after[key]);
const uniqueAliasTarget = (evidence, key) => {
  const matches = evidence.targets.filter(target => target.stable_aliases.some(alias => alias.key === key));
  return matches.length === 1 ? matches[0] : null;
};

/** Retain only this response batch's original host snapshot. The actor may
 * attest unchangedControls only after its own fresh same-page inspection.
 * This helper does not authorize replay, choose targets, derive selectors or
 * turn a copied snapshot into current browser authority. */
function createBrowserBatchTargetResolver({ snapshot } = {}) {
  const initial = browserBatchTargetEvidence(snapshot);
  const initialState = initial ? captureBrowserBatchState(browserReceipt(snapshot)) : null;
  return {
    resolve(request, currentSnapshot, { unchangedControls = false } = {}) {
      // Capture authority before ordinary resolution: resolving a stale ref
      // itself must never register a JSON copy and then reuse it as evidence.
      const current = browserBatchTargetEvidence(currentSnapshot);
      try { return resolveModelToolRequest(request, typeof request?.arguments?.locator === 'string' && request.arguments.locator.startsWith('ref:') && !current ? null : currentSnapshot); }
      catch (error) {
        if (error?.code !== 'AUTOMATION_BROWSER_TARGET_REF_STALE' || unchangedControls !== true || !initial || !current) throw error;
        const original = browserBatchTargetEvidence(snapshot);
        if (!original || original.fingerprint !== initial.fingerprint) throw error;
        const initialPage = browserReceipt(snapshot), currentPage = browserReceipt(currentSnapshot);
        if (!completePageIdentity(initialPage) || !completePageIdentity(currentPage)) throw error;
        const after = captureBrowserBatchState(currentPage);
        if (!initialState.controls_complete || !after.controls_complete || !initialState.target_id || !initialState.url || initialState.url !== after.url
          || initialState.target_id !== after.target_id || !initialState.controls_fingerprint
          || initialState.controls_fingerprint !== after.controls_fingerprint) throw error;
        // This also rejects references from an earlier model response, even
        // when that response happened to observe an identical form.
        const previous = original.targets.find(target => target.ref === request?.arguments?.locator);
        if (!completeIdentity(previous)) throw error;
        for (const alias of previous.stable_aliases) {
          if (uniqueAliasTarget(original, alias.key)?.ref !== previous.ref) continue;
          const fresh = uniqueAliasTarget(current, alias.key);
          if (!sameIdentity(previous, fresh)) continue;
          return resolveModelToolRequest({ ...request, arguments: { ...request.arguments, locator: fresh.ref } }, currentSnapshot);
        }
        throw error;
      }
    }
  };
}

module.exports = { createBrowserBatchTargetResolver };
