const { createHash } = require('node:crypto');
const { browserReceipt } = require('./automationInteractiveEvidence');
const { browserCurrentSnapshotObservation } = require('./automationBrowserContext');
const { recordedSectionRequests } = require('./automationBrowserRecording');
const { unsuccessfulBrowserCheck } = require('./automationBrowserRecovery');
const { maskParameterReferences } = require('./automationBrowserParameters');

const TARGET_LIMIT = 120;
const CHANGE_LIMIT = 24;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function pageState(page, metadataFields = { url: true, title: true }) {
  return page && Object.fromEntries(Object.entries(page).filter(([key]) => !['observation_id', 'captured_at'].includes(key)
    && (!['url', 'url_truncated'].includes(key) || metadataFields.url)
    && (!['title', 'title_truncated'].includes(key) || metadataFields.title)));
}

/** Metadata is a separate assertion subject, not an application's rendered
 * screen identity. Inspect original authored clauses rather than substituted
 * values: entering a value such as "document title" creates no new oracle. A
 * successful explicit metadata predicate always retains its actual subject. */
function reviewMetadataRequirements(sourceObligations = [], operations = []) {
  const fields = { url: false, title: false };
  for (const goal of sourceObligations) {
    for (const value of [goal?.action, goal?.expected_result]) {
      if (typeof value !== 'string') continue;
      const authored = maskParameterReferences(value);
      const unquoted = authored.replace(/"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/gu, ' ');
      const clauses = unquoted.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      // The omission classifier is intentionally conservative for languages it
      // cannot identify. Unknown prose keeps metadata rather than suppressing
      // evidence for a possibly explicit non-English browser requirement.
      const familiarEnglish = /\b(?:the|is|are|navigate|enter|click|verify|check|displayed|visible|shown|without|should|must|open|select|save|saved|retained|appears|matches)\b/i.test(clauses);
      if (clauses.trim() && (!familiarEnglish || /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(clauses))) { fields.url = true; fields.title = true; }
      if (/\b(?:title|title[ -]?bar|titre|titulo|título|titel|titolo)\b/i.test(clauses) || /<title\b/i.test(unquoted)) fields.title = true;
      if (/\b(?:url|uri|address[ -]?bar|web[ -]?address|hostname|host[ -]?name|domain|pathname|path[ -]?name|origin|protocol|query[ -]?(?:string|parameter)|route|adresse|direccion|dirección|endereco|endereço)\b|https?:\/\//i.test(clauses)) fields.url = true;
    }
  }
  for (const operation of operations) if (operation?.name === 'browser_assert') {
    if (['url', 'url_contains'].includes(operation.arguments?.assertion)) fields.url = true;
    if (['title', 'title_normalized'].includes(operation.arguments?.assertion)) fields.title = true;
  }
  return fields;
}
function targetMetadata(element) {
  const result = {};
  const fields = { tag: element.tag, role: element.accessible_role || element.role, name: element.accessible_name || element.label || element.name,
    text: element.text, input_type: element.attributes?.type, placeholder: element.attributes?.placeholder,
    visible: element.displayed, disabled: element.disabled, checked: element.checked };
  for (const [key, value] of Object.entries(fields)) if (typeof value === 'string') {
    const limit = key === 'text' ? 500 : 200;
    result[key] = value.slice(0, limit);
    if (value.length > limit) result.excerpt_truncated = true;
  } else if (typeof value === 'boolean') result[key] = value;
  if (element.text_truncated || element.label_truncated || element.accessible_name_truncated) result.excerpt_truncated = true;
  return result;
}
function compactPage(page) {
  // Document metadata is supplied once under page_metadata_context. A rendered
  // view can change inside an SPA without a corresponding URL or title change.
  return { scope: page.scope,
    accessibility: typeof page.accessibility === 'string' ? page.accessibility.slice(0, 5000) : undefined,
    targets: Array.isArray(page.elements) ? page.elements.slice(0, TARGET_LIMIT).map(targetMetadata) : [],
    ...(pageSummary(page).partial || page.accessibility?.length > 5000 ? { partial: true } : {}) };
}
function pageSummary(page) {
  return { scope: typeof page?.scope === 'string' ? page.scope : 'unknown',
    partial: !Array.isArray(page?.elements) || Boolean(page?.partial || page?.truncated || page?.accessibility_truncated || page?.elements_truncated || page?.fields_truncated || page.elements.length > TARGET_LIMIT
      || page.elements.some(element => targetMetadata(element).excerpt_truncated)),
    target_count: Array.isArray(page?.elements) ? page.elements.length : 0 };
}
function targetEntries(page) {
  return (Array.isArray(page?.elements) ? page.elements : []).slice(0, TARGET_LIMIT).map(element => {
    const target = targetMetadata(element);
    const locator = element.locators_validated === true && element.locator_candidates?.find(value => typeof value === 'string' && value);
    const identity = locator ? `locator:${locator}` : fingerprint({ tag: target.tag, role: target.role, name: target.name, input_type: target.input_type, placeholder: target.placeholder });
    return { identity, target };
  });
}
const pageMetadata = (page, fields) => ({ ...(fields.url && typeof page?.url === 'string' ? { url: page.url, ...(page.url_truncated ? { url_truncated: true } : {}) } : {}),
  ...(fields.title && typeof page?.title === 'string' ? { title: page.title, ...(page.title_truncated ? { title_truncated: true } : {}) } : {}) });

/** A rendered transition is a comparison of sampled evidence, not a business
 * outcome. Address-bar/document metadata is kept in a separate context slot. */
function renderedTransition({ observations, stepId, snapshot, metadataFields = { url: true, title: true } }) {
  let baseline, lastAction = -1;
  for (const [position, observation] of observations.entries()) {
    if (observation.execution_step_id !== stepId) continue;
    const operation = recordedSectionRequests([observation], stepId)[0];
    if (!operation || operation.name === 'browser_assert') continue;
    lastAction = position;
    if (!baseline) baseline = browserCurrentSnapshotObservation(observations.slice(0, position));
  }
  const beforePage = baseline && browserReceipt(baseline), afterPage = snapshot && browserReceipt(snapshot);
  const before = pageSummary(beforePage), after = pageSummary(afterPage);
  const added = [], removed = [], changes = [];
  if (beforePage && afterPage) {
    const beforeEntries = targetEntries(beforePage), afterEntries = targetEntries(afterPage);
    const beforeById = new Map(), afterById = new Map();
    for (const row of beforeEntries) beforeById.set(row.identity, [...(beforeById.get(row.identity) || []), row.target]);
    for (const row of afterEntries) afterById.set(row.identity, [...(afterById.get(row.identity) || []), row.target]);
    for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
      const prior = [...(beforeById.get(id) || [])], next = [...(afterById.get(id) || [])];
      // Exact duplicate descriptors cancel before pairing a remaining unique
      // target. Ambiguous targets are reported as observed set differences.
      for (let index = prior.length - 1; index >= 0; index--) {
        const match = next.findIndex(target => fingerprint(target) === fingerprint(prior[index]));
        if (match >= 0) { prior.splice(index, 1);next.splice(match, 1); }
      }
      if (prior.length === 1 && next.length === 1) changes.push({ before: prior[0], after: next[0] });
      else { removed.push(...prior);added.push(...next); }
    }
  }
  const observedAfterAction = Boolean(snapshot && observations.indexOf(snapshot) > lastAction);
  return {
    rendered_transition: { baseline_available: Boolean(beforePage), comparison_scope: 'bounded_snapshot_targets', before,
      after: { ...after, observed_after_latest_action: observedAfterAction },
      observed_change: Boolean(beforePage && afterPage && (added.length || removed.length || changes.length)),
      added: added.slice(0, CHANGE_LIMIT), removed: removed.slice(0, CHANGE_LIMIT), state_changes: changes.slice(0, CHANGE_LIMIT),
      // Elements are selected controls/result samples, even for a nonpartial
      // body snapshot. Omission from either sample cannot establish page-wide
      // absence. Actual negative predicates have their own confirmed receipt.
      absence_claims_supported: false,
      changes_truncated: added.length > CHANGE_LIMIT || removed.length > CHANGE_LIMIT || changes.length > CHANGE_LIMIT,
      change_is_business_success: false },
    page_metadata_context: { before: pageMetadata(beforePage, metadataFields), after: pageMetadata(afterPage, metadataFields),
      ...(metadataFields.url ? { url_changed: Boolean(beforePage && afterPage && beforePage.url !== afterPage.url) } : {}),
      ...(metadataFields.title ? { title_changed: Boolean(beforePage && afterPage && beforePage.title !== afterPage.title) } : {}),
      evidence_role: 'requested_subjects_only', omitted_incidental_fields: ['url', 'title'].filter(field => !metadataFields[field]) }
  };
}

/** Keep the actual ledger intact. Only a rejected-review cache can ignore a
 * repeated successful predicate under identical action/failure/page epochs. */
function canonicalReviewEvidence({ observations, stepId, metadataFields = { url: true, title: true } }) {
  const keep = [], seenActions = new Set(), assertions = new Set(), pageHistory = [];
  let lastPage, actionEpoch = 0, failureEpoch = 0, operationIndex = 0;
  for (const observation of observations) {
    if (observation.tool === 'browser_snapshot' && !observation.result?.isError) {
      const page = browserReceipt(observation);
      if (page) {
        const state = fingerprint(pageState(page, metadataFields));
        if (state !== lastPage) { lastPage = state;pageHistory.push(state); }
      }
    }
    if (observation.execution_step_id !== stepId) continue;
    if (observation.mcp_call !== false && observation.tool?.startsWith('browser_') && (observation.result?.isError || unsuccessfulBrowserCheck(observation))) failureEpoch++;
    const operation = recordedSectionRequests([observation], stepId)[0];
    if (!operation || observation.action_id && seenActions.has(observation.action_id)) continue;
    if (observation.action_id) seenActions.add(observation.action_id);
    operationIndex++;
    if (operation.name !== 'browser_assert') { actionEpoch++;keep.push(operationIndex);continue; }
    const key = fingerprint({ operation, actionEpoch, failureEpoch, pageEpoch: pageHistory.length, page: lastPage });
    // Without a preceding observed page, an additional check might be the only
    // new evidence. Do not collapse it based on an assumed unchanged state.
    if (!lastPage || !assertions.has(key)) keep.push(operationIndex);
    assertions.add(key);
  }
  return { operation_indexes: keep, action_epoch: actionEpoch, failure_epoch: failureEpoch, page_history: pageHistory };
}

module.exports = { targetMetadata, compactPage, pageState, renderedTransition, canonicalReviewEvidence, reviewMetadataRequirements };
