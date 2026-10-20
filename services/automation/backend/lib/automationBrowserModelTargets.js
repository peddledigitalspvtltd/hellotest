const { randomBytes, createHash } = require('node:crypto');
const { parseExpressionAt } = require('acorn');
const { browserReceipt } = require('./automationInteractiveEvidence');
const { isNativeTextEntryControl } = require('./automationBrowserAssertionSubject');
const { recordedLocatorSource } = require('./automationRecordedProgram');

// Authority belongs to the actual host observation, never a model-supplied map
// or a JSON copy of a page. Portable locators stay private until dispatch.
const snapshots = new WeakMap();
const MAX_TARGETS = 120;
const text = (value, limit = 180) => typeof value === 'string' ? value.slice(0, limit) : '';
const privacyMask = /\[(?:private parameter (?:reference|value)|redacted(?:_secret|_token)?)\]/i;

// Formatting equivalence is limited to the existing closed semantic locator
// grammar. CSS, role= strings and arbitrary expressions keep exact matching.
function semanticLocatorKey(value) {
  if(typeof value!=='string'||!/^(?:page\.)?getBy(?:Role|Label|Placeholder|Text|TestId|Title|AltText)\s*\(/i.test(value.trim()))return null;
  return recordedLocatorSource(value);
}
function currentRegistry(observation) {
  const entry=observation&&typeof observation==='object'?snapshots.get(observation):null;
  const page=observation?.tool==='browser_snapshot'&&!observation.result?.isError?browserReceipt(observation):null;
  return entry&&page&&entry.fingerprint===createHash('sha256').update(JSON.stringify(page)).digest('hex')?entry:null;
}

// Excerpts help choose a subject; they are not exact observed values. Preserve
// upstream loss markers even when the upstream excerpt fits this smaller view.
function textField(key, value, limit, previouslyTruncated = false) {
  if (typeof value !== 'string') return {};
  return { [key]: text(value, limit), ...(value.length > limit || previouslyTruncated === true ? { [`${key}_truncated`]: true } : {}) };
}

function explicitTestId(candidate) {
  const source = candidate.trim();
  if (!/^(?:page\.)?getByTestId\s*\(/i.test(source)) return null;
  try {
    const node = parseExpressionAt(source, 0, { ecmaVersion: 'latest' });
    const callee = node.callee;
    const method = callee?.type === 'Identifier' ? callee.name : callee?.type === 'MemberExpression' && !callee.computed && !callee.optional
      && callee.object?.type === 'Identifier' && callee.object.name.toLowerCase() === 'page' ? callee.property.name : null;
    if (node.type !== 'CallExpression' || node.optional || node.end !== source.length || method?.toLowerCase() !== 'getbytestid'
      || node.arguments.length < 1 || node.arguments.length > 2 || node.arguments.length === 2 && (node.arguments[1].type !== 'ObjectExpression' || node.arguments[1].properties.length)) return null;
    const argument = node.arguments[0];
    const value = argument.type === 'Literal' && typeof argument.value === 'string' ? argument.value
      : argument.type === 'TemplateLiteral' && !argument.expressions.length ? argument.quasis[0].value.cooked : null;
    return typeof value === 'string' ? { value } : null;
  } catch { return null; }
}

function currentLocatorCandidates(element) {
  const observedTestId = element.attributes?.['data-testid'];
  const attributeComplete = !element.truncated_attributes?.includes('data-testid');
  const candidates = [...new Set(element.locator_candidates.filter(candidate => typeof candidate === 'string' && candidate.trim()
    && candidate.length <= 2_000 && !candidate.startsWith('ref:') && !privacyMask.test(candidate)))].filter(candidate => {
    const contract = explicitTestId(candidate);
    return !contract || typeof observedTestId !== 'string' || attributeComplete && contract.value === observedTestId;
  });
  // An observed record scope preserves the enclosing subject during playback;
  // it must itself be an exact validated candidate. Otherwise an explicit test
  // ID is an application-owned automation contract. Dynamic
  // accessible names remain useful to the actor and reviewer, but must not
  // displace an already grounded stable contract in the executable source.
  // Preserve exact bytes and all safe aliases; never invent a selector from an
  // attribute, or try a different target after an operation fails.
  const scoped = typeof element.record_scoped_locator === 'string' && candidates.includes(element.record_scoped_locator)
    ? element.record_scoped_locator : null;
  const preferred = scoped || candidates.find(candidate => explicitTestId(candidate)) || candidates[0];
  return { candidates, preferred };
}
function selectOptions(element) {
  if (String(element.tag).toLowerCase() !== 'select' || !Array.isArray(element.options)) return {};
  const options = [];
  let omitted = element.options.length > 12;
  for (const option of element.options.slice(0, 12)) {
    if (!option || typeof option !== 'object' || Array.isArray(option)) { omitted = true; continue; }
    const label = typeof option.label === 'string' ? { label: text(option.label, 80), ...(option.label.length > 80 || option.label_truncated === true ? { label_truncated: true } : {}) } : {};
    // A truncated value is evidence for discovery only, never a selectable
    // option value. Preserve exact captured bytes, including whitespace and an
    // empty value; do not normalize or turn an excerpt into an executable input.
    const exactValue = typeof option.value === 'string' && option.value.length <= 120 && option.value_truncated !== true;
    const excerpt = typeof option.value_excerpt === 'string' ? option.value_excerpt : typeof option.value === 'string' ? option.value : undefined;
    const value = exactValue ? { value: option.value } : typeof excerpt === 'string' ? { value_excerpt: text(excerpt, 120), value_truncated: true } : {};
    options.push({ ...label, ...value,
      ...(typeof option.selected === 'boolean' ? { selected: option.selected } : {}),
      ...(typeof option.disabled === 'boolean' ? { disabled: option.disabled } : {}) });
  }
  return { options, ...(typeof element.options_truncated === 'boolean' || omitted ? { options_truncated: omitted || element.options_truncated === true } : {}) };
}
function pageText(value) {
  if (typeof value !== 'string' || !value) return {};
  // Native accessibility contains outcome prose that is not necessarily an
  // actionable DOM target. Prefer the application main over decorative rails;
  // keep the tail too, where dialogs/status messages commonly appear.
  const main = value.search(/(?:^|\n)- main(?:[ :]|$)/);
  const relevant = main >= 0 ? value.slice(main).trimStart() : value;
  const limit = 3_500;
  return relevant.length <= limit ? { accessibility: relevant } : {
    accessibility: relevant.slice(0, 2_350) + '\n[page text excerpt]\n' + relevant.slice(-1_100),
    accessibility_truncated: true
  };
}

/** Relationships describe this bounded snapshot only. Missing targets can be
 * hidden, redacted or omitted; these edges never establish DOM validity or an
 * absent error. Native field_valid remains the selected-field predicate. */
function projectFieldRelationships(page, byElement) {
  const elements = page.elements.slice(0, MAX_TARGETS), ids = new Map();
  let availableEdges = 64;
  const completeId = value => typeof value === 'string' && value.length > 0 && value.length <= 256
    && !/[\u0000-\u0020\u007f]/.test(value) && !privacyMask.test(value);
  for (const element of elements) {
    const id = element?.attributes?.id;
    if (!completeId(id) || element.truncated_attributes?.includes('id')) continue;
    const matches = ids.get(id) || [];
    matches.push(element); ids.set(id, matches);
  }
  for (const [element, target] of byElement) {
    if (!['input', 'textarea', 'select'].includes(String(element.tag).toLowerCase())) continue;
    const attributes = ['aria-describedby', 'aria-errormessage'];
    if (!attributes.some(name => typeof element.attributes?.[name] === 'string' && element.attributes[name].length
      || element.truncated_attributes?.includes(name))) continue;
    const descriptions = new Set(), errors = new Set(), linked = new Set();
    let incomplete = Boolean(page.partial || page.truncated || page.elements_truncated || page.fields_truncated || page.elements.length > MAX_TARGETS), references = 0;
    for (const attribute of attributes) {
      const raw = element.attributes?.[attribute];
      if (element.truncated_attributes?.includes(attribute)) { incomplete = true;continue; }
      if (raw === undefined || raw === '') continue;
      if (typeof raw !== 'string' || raw.length > 8192 || privacyMask.test(raw)) { incomplete = true;continue; }
      const tokens = raw.split(/[\t\n\f\r ]+/).filter(Boolean);
      for (const id of tokens) {
        if (++references > 32) { incomplete = true;break; }
        const matches = completeId(id) ? ids.get(id) : null;
        const related = matches?.length === 1 ? byElement.get(matches[0]) : null;
        if (!related) { incomplete = true;continue; }
        if (!linked.has(related.ref)) {
          if (!availableEdges) { incomplete = true;continue; }
          linked.add(related.ref); availableEdges--;
        }
        if (attribute === 'aria-describedby') descriptions.add(related.ref);
        if (attribute === 'aria-errormessage' || related.role === 'alert') errors.add(related.ref);
      }
    }
    target.field_relationships = { evidence_scope: 'current_snapshot_targets_only', description_refs: [...descriptions], error_refs: [...errors], relationship_refs_incomplete: incomplete };
  }
}
const targetError = (code) => Object.assign(new Error(code === 'AUTOMATION_BROWSER_TARGET_REF_INVALID'
  ? 'The target reference is invalid. Choose a target reference from the current browser snapshot.'
  : 'The target reference is no longer current. Use the latest browser snapshot and replan the unfinished action.'), { code, retry_safe: true, action_outcome: 'not_attempted' });

function registry(observation) {
  if (!observation || typeof observation !== 'object' || observation.tool !== 'browser_snapshot' || observation.result?.isError) return null;
  const page = browserReceipt(observation);
  if (!page || typeof page !== 'object' || typeof page.observation_id !== 'string' || !page.observation_id || !Array.isArray(page.elements)) return null;
  // Receipts are normally immutable. A replaced receipt on the same object must
  // still invalidate references rather than silently retarget an old action.
  const fingerprint = createHash('sha256').update(JSON.stringify(page)).digest('hex');
  const previous = snapshots.get(observation);
  if (previous?.fingerprint === fingerprint) return previous;
  const epoch = randomBytes(6).toString('hex');
  const bindings = new Map(), aliases = new Map(), semanticAliases = new Map(), recordScopes = new Map(), targets = [], byElement = new Map();
  for (const element of page.elements.slice(0, MAX_TARGETS)) {
    if (!element || typeof element !== 'object' || element.locators_validated !== true || !Array.isArray(element.locator_candidates)) continue;
    const { candidates, preferred } = currentLocatorCandidates(element);
    if (!candidates.length) continue;
    const ref = `ref:${epoch}:${targets.length + 1}`;
    bindings.set(ref, preferred);
    if (element.record_scoped_locator === preferred) recordScopes.set(ref, preferred);
    for (const locator of candidates) if (!aliases.has(locator)) aliases.set(locator, ref);
    for(const locator of candidates){
      const key=semanticLocatorKey(locator);
      if(!key)continue;
      const prior=semanticAliases.get(key);
      if(!semanticAliases.has(key))semanticAliases.set(key,{ref,locator});
      else if(prior?.ref!==ref)semanticAliases.set(key,null);
    }
    const rawRole = element.accessible_role || element.role;
    const rawName = element.accessible_name || element.label;
    const role = text(rawRole, 60);
    const name = text(rawName);
    const tag = text(element.tag, 30);
    const input = ['input', 'textarea', 'select'].includes(tag.toLowerCase());
    const typedControl = input || tag.toLowerCase() === 'button';
    targets.push({ ref,
      ...(role ? textField('role', rawRole, 60, element.accessible_role_truncated || element.role_truncated) : {}),
      ...(name ? textField('name', rawName, 180, element.accessible_name ? element.accessible_name_truncated : element.label_truncated) : {}),
      ...(tag ? textField('tag', element.tag, 30, element.tag_truncated) : {}),
      ...(!name && input && element.attributes?.placeholder ? textField('placeholder', element.attributes.placeholder, 180, element.truncated_attributes?.includes('placeholder')) : {}),
      ...(typedControl && typeof element.attributes?.type === 'string' && element.attributes.type ? textField('input_type', element.attributes.type, 30, element.truncated_attributes?.includes('type')) : {}),
      ...(input && typeof element.attributes?.['aria-invalid'] === 'string' ? textField('aria_invalid', element.attributes['aria-invalid'], 30, element.truncated_attributes?.includes('aria-invalid')) : {}),
      ...(!input && element.text ? textField('text', element.text, 180, element.text_truncated) : {}),
      ...(element.evidence_kind === 'page_content' ? { evidence_kind: 'page_content' } : {}),
      ...(typeof element.context_text === 'string' && element.context_text ? textField('context_text', element.context_text, 180, element.context_text_truncated) : {}),
      ...((role === 'alert' || element.evidence_kind === 'page_content') && typeof element.visible_text === 'string' ? textField('visible_text', element.visible_text, 180, element.visible_text_truncated) : {}),
      ...(typeof element.displayed === 'boolean' ? { visible: element.displayed } : {}),
      ...(typeof element.in_viewport === 'boolean' ? { in_viewport: element.in_viewport } : {}),
      ...(typeof element.disabled === 'boolean' ? { disabled: element.disabled } : {}),
      ...(typeof element.checked === 'boolean' ? { checked: element.checked } : {}),
      ...(isNativeTextEntryControl(element) ? { assertion_subject: 'input_value', preferred_value_assertion: 'value' } : {}),
      ...selectOptions(element) });
    byElement.set(element, targets[targets.length - 1]);
  }
  projectFieldRelationships(page, byElement);
  const entry = { fingerprint, bindings, aliases, semanticAliases, recordScopes, model: {
    ...textField('observation_id', page.observation_id, 160),
    ...textField('url', typeof page.url === 'string' ? page.url : '', 2_000, page.url_truncated),
    ...textField('title', typeof page.title === 'string' ? page.title : '', 200, page.title_truncated),
    scope: text(page.scope, 200), ...pageText(page.accessibility), targets,
    ...(page.partial === true || page.elements_truncated === true ? { partial: true } : {}),
    ...(targets.length ? {} : { targets_unavailable: true })
  } };
  snapshots.set(observation, entry);
  return entry;
}

function projectModelSnapshot(observation) {
  const entry = registry(observation);
  // The projection is safe to mutate/serialize. It contains no authority that
  // can rewrite the private locator bindings.
  return entry ? structuredClone(entry.model) : null;
}

function resolveModelToolRequest(request, observation) {
  const locator = request?.arguments?.locator;
  if (typeof locator !== 'string') return request;
  if(!locator.startsWith('ref:')){
    // A formatting-only proposal cannot register its own copied page. Resolve
    // only against validated aliases of the already projected host snapshot.
    const entry=currentRegistry(observation);
    if(!entry)return request;
    const alias=entry.aliases.get(locator);
    // Preserve explicit absence/count scope. Positive observed-subject work
    // keeps its narrower record identity through source and reconciliation.
    const preserveScope=request.name==='browser_assert'&&['hidden','count'].includes(request.arguments?.assertion);
    const scoped=alias&&!preserveScope?entry.recordScopes.get(alias):null;
    if(alias)return scoped&&scoped!==locator?{...request,arguments:{...request.arguments,locator:scoped}}:request;
    const captured=entry.semanticAliases.get(semanticLocatorKey(locator));
    return captured?{...request,arguments:{...request.arguments,locator:!preserveScope&&entry.recordScopes.get(captured.ref)||captured.locator}}:request;
  }
  if (!/^ref:[a-f0-9]{12}:[1-9]\d{0,2}$/.test(locator)) throw targetError('AUTOMATION_BROWSER_TARGET_REF_INVALID');
  const entry = registry(observation);
  if (!entry || !entry.bindings.has(locator)) {
    const sameEpoch = entry && [...entry.bindings.keys()].some(ref => ref.split(':')[1] === locator.split(':')[1]);
    throw targetError(sameEpoch ? 'AUTOMATION_BROWSER_TARGET_REF_INVALID' : 'AUTOMATION_BROWSER_TARGET_REF_STALE');
  }
  return { ...request, arguments: { ...request.arguments, locator: entry.bindings.get(locator) } };
}

function modelTargetForLocator(locator, observation) {
  if (typeof locator !== 'string') return null;
  return registry(observation)?.aliases.get(locator) || null;
}

/** Host-only inspection of an already registered immutable observation. This
 * never registers a copied page and must not be included in model context. */
function browserBatchTargetEvidence(observation) {
  const entry = currentRegistry(observation);
  if (!entry) return null;
  const page = browserReceipt(observation), targets = [];
  for (const element of page.elements.slice(0, MAX_TARGETS)) {
    if (!element || typeof element !== 'object' || element.locators_validated !== true || !Array.isArray(element.locator_candidates)) continue;
    const { candidates } = currentLocatorCandidates(element);
    if (!candidates.length) continue;
    const target = entry.model.targets[targets.length];
    if (!target) return null;
    const stable = [];
    for (const locator of candidates) {
      const testId = explicitTestId(locator);
      if (testId && testId.value.trim() && testId.value.length <= 256 && !/[\x00-\x1f]/.test(testId.value)
        && !element.truncated_attributes?.includes('data-testid')
        && (element.attributes?.['data-testid'] === undefined || element.attributes['data-testid'] === testId.value)) {
        stable.push({ key: JSON.stringify(['testId', testId.value]), locator });
      } else if (/^#[A-Za-z_][A-Za-z0-9_-]{0,255}$/.test(locator)
        && !element.truncated_attributes?.includes('id')
        && (element.attributes?.id === undefined || element.attributes.id === locator.slice(1))) {
        stable.push({ key: JSON.stringify(['id', locator.slice(1)]), locator });
      }
    }
    const identityAttributes = { id: element.attributes?.id ?? null, test_id: element.attributes?.['data-testid'] ?? null };
    targets.push({ ...structuredClone(target), stable_aliases: stable, identity_key: JSON.stringify(identityAttributes),
      identity_complete: !['accessible_role_truncated', 'role_truncated', 'accessible_name_truncated', 'name_truncated', 'label_truncated', 'tag_truncated', 'context_text_truncated'].some(key => element[key] === true)
        && !element.truncated_attributes?.some(key => ['id', 'data-testid', 'type', 'placeholder'].includes(key))
        && Object.values(identityAttributes).every(value => value === null || typeof value === 'string' && value.length <= 256) });
  }
  return { fingerprint: entry.fingerprint, targets };
}

/** Private host capture for repository learning. This never registers a copied
 * snapshot, reads input values or derives a locator from an element name. */
function repositoryTargetEvidence(locator, observation) {
  const entry=currentRegistry(observation);
  if(!entry||typeof locator!=='string'||privacyMask.test(locator))return null;
  const ref=entry.aliases.get(locator)||entry.semanticAliases.get(semanticLocatorKey(locator))?.ref;
  const target=entry.model.targets.find(row=>row.ref===ref);
  if(!target||entry.model.url_truncated||privacyMask.test(entry.model.url))return null;
  let pageUrl,routeDigest;
  try{const url=new URL(entry.model.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;pageUrl=url.origin+url.pathname;
    if(url.search||url.hash)routeDigest=createHash('sha256').update(url.href).digest('hex');
  }catch{return null;}
  return {page_url:pageUrl,...(routeDigest?{observed_route_sha256:routeDigest}:{}),observation_id:entry.model.observation_id,
    ...(target.name&&!target.name_truncated&&!privacyMask.test(target.name)?{name:target.name}:{}),
    ...(target.role&&!target.role_truncated?{role:target.role}:{}),
    ...(target.tag&&!target.tag_truncated?{tag:target.tag}:{})};
}

/** A compact actor must select an observed target instead of guessing a role,
 * name or CSS selector. This is dispatch feedback, never target selection or
 * predicate proof. Discovery and absence/count checks retain their semantics. */
function browserObservedTargetFeedback({request,snapshot,execution}={}) {
  const args=request?.arguments;
  const targeted=new Set(['browser_click','browser_fill','browser_press_key','browser_select_option','browser_hover','browser_check','browser_uncheck']);
  const pageChecks=new Set(['url','url_contains','title','title_normalized']);
  if(!targeted.has(request?.name)&&request?.name!=='browser_assert'||typeof args?.locator!=='string')return null;
  if(request.name==='browser_assert'&&(pageChecks.has(args.assertion)||['hidden','count'].includes(args.assertion)))return null;
  // Only the actual host observation already projected into this actor turn
  // has a private registry entry. A JSON copy or supplied model targets cannot
  // manufacture authority; replacing its receipt also invalidates that entry.
  const entry=currentRegistry(snapshot),current=Boolean(entry);
  if(current&&(entry.bindings.has(args.locator)||entry.aliases.has(args.locator)||entry.semanticAliases.get(semanticLocatorKey(args.locator))))return null;
  return {code:'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED',step_id:execution?.step_id,tool:request.name,
    action_outcome:'not_attempted',retry_safe:true,evidence_scope:'current_snapshot_targets_only',
    ...(current&&entry.model.partial?{snapshot_partial:true}:{}),
    remaining_contract:'select_current_observed_target_or_request_scoped_discovery_without_replaying_actions',
    message:'This locator is not an exact validated target from the current browser snapshot. No browser call ran. Use a current target reference. If the required target is missing, request a scoped snapshot or locator validation for discovery. Preserve the authored goal and do not repeat completed actions.'};
}

/** A message paragraph is not the full innerText of its alert container when
 * that container also has visible controls. Explain the observed subject
 * mismatch without changing any matcher, required literal or manual clause. */
function browserContainerTextAssertionFeedback({request,snapshot,execution}={}){
  const args=request?.arguments;
  if(request?.name!=='browser_assert'||args?.assertion!=='text'||typeof args.value!=='string'
    ||require('./automationBrowserParameters').referenceKey(args.value))return null;
  const entry=registry(snapshot);if(!entry)return null;
  const normalize=value=>value.replace(/\s+/g,' ').trim();
  const wanted=normalize(args.value);if(!wanted)return null;
  const ref=entry.bindings.has(args.locator)?args.locator:entry.aliases.get(args.locator);
  const target=entry.model.targets.find(item=>item.ref===ref);
  // text is textContent discovery evidence and can contain hidden descendants.
  // Only a complete host innerText receipt establishes this visible mismatch.
  if(!target||target.role!=='alert'||target.visible!==true||typeof target.visible_text!=='string'
    ||target.visible_text_truncated||target.role_truncated)return null;
  const observed=normalize(target.visible_text);
  if(observed===wanted||!observed.includes(wanted)||!/\b(?:failed|failure|unsuccessful|unable|invalid|denied|error)\b/i.test(observed))return null;
  const pending=/\b(?:eventually|within|once|after|until|will be|retrying|loading|pending|processing|in progress|will retry)\b/i;
  if(pending.test(observed))return null;
  const sources=Array.isArray(execution?.source_obligations)?execution.source_obligations:[execution];
  const quoted=/"((?:\\.|[^"\\])+)"|`((?:\\.|[^`\\])+)`|“([^”]+)”|‘([^’]+)’|(?<![\p{L}\p{N}_])'((?:\\.|[^'\\])+)'(?![\p{L}\p{N}_])/gu;
  const supported=sources.some(row=>{
    if(typeof row?.expected_result!=='string'||pending.test(row.expected_result))return false;
    return [...row.expected_result.matchAll(quoted)].some(match=>{
      const value=match.slice(1).find(item=>item!==undefined),literal=normalize(value);
      return literal&&!privacyMask.test(literal)&&wanted.includes(literal)&&observed.includes(literal);
    });
  });
  if(!supported)return null;
  return {code:'AUTOMATION_BROWSER_ASSERTION_CONTAINER_TEXT_MISMATCH',step_id:execution?.step_id,tool:'browser_assert',attempted_assertion:'text',
    action_outcome:'not_attempted',retry_safe:true,evidence_refs:[target.ref],
    remaining_contract:'preserve_authored_literal_and_select_correct_message_subject_without_replaying_actions',
    message:'The selected alert has additional visible text beyond the requested message fragment. No assertion ran. Preserve every authored clause and quoted literal; use a current observed message child or a fragment predicate only when the original requirement allows it. Do not copy unrequested diagnostic suffixes or replay the completed action.'};
}

/** Identify one narrow category error, not the truth of an arbitrary expected
 * result: a copied, unquoted description of a message is used as literal UI
 * copy while the selected complete alert reports a different terminal error.
 * Pending outcomes and explicit literal/negative expectations keep the normal
 * retrying browser assertion. No other alert or omitted page text is inferred. */
function browserDescriptiveTextAssertionFeedback({ request, snapshot, execution } = {}) {
  const args=request?.arguments;
  if(request?.name!=='browser_assert'||!['text','text_contains'].includes(args?.assertion)
    ||typeof args.value!=='string'||require('./automationBrowserParameters').referenceKey(args.value))return null;
  const entry=registry(snapshot);
  if(!entry)return null;
  const normalized=value=>value.replace(/\s+/g,' ').trim();
  const comparison=value=>normalized(value).replace(/[.!?]+$/,'').toLowerCase();
  const expected=comparison(args.value);
  if(expected.length<40||expected.split(' ').length<8)return null;
  const source=Array.isArray(execution?.source_obligations)?execution.source_obligations:[execution];
  const authored=source.filter(row=>typeof row?.expected_result==='string'&&comparison(row.expected_result)===expected);
  if(!authored.length)return null;
  const failure=/\b(?:failed|failure|unsuccessful|unable|invalid|denied|error)\b/i;
  const pending=/\b(?:eventually|within|once|after|until|will be|retrying|loading|pending|processing|in progress|will retry)\b/i;
  const quoted=/"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}_])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}_])/u;
  const literal=/\b(?:literal|verbatim|exact(?:ly| text)?|following (?:text|message))\b|\b(?:text|message)\s*[:=]|\btext (?:equals|contains|matches)\b/i;
  // Original source alone supplies intent. Resolved parameter data and quoted
  // UI copy must not become new linguistic requirements or failure signals.
  if(authored.some(row=>quoted.test(row.expected_result)||literal.test([row.action,row.expected_result].join(' '))
    ||pending.test(row.expected_result)||failure.test(row.expected_result)))return null;
  if(!/^(?:a|an|the) (?:(?:success|confirmation) )?(?:message|notification|alert|confirmation) (?:is|should be|must be) (?:displayed|shown|visible|present) (?:indicating|stating|confirming|informing|notifying|to indicate|that|which)\b/i.test(normalized(args.value)))return null;
  const ref=entry.bindings.has(args.locator)?args.locator:entry.aliases.get(args.locator);
  const target=entry.model.targets.find(item=>item.ref===ref);
  if(!target||target.role!=='alert'||target.visible!==true||typeof target.text!=='string'||!target.text
    ||target.text_truncated||target.role_truncated||pending.test(target.text)||!failure.test(target.text))return null;
  const observed=normalized(target.text),wanted=normalized(args.value);
  if(args.assertion==='text'?observed===wanted:observed.includes(wanted))return null;
  return {code:'AUTOMATION_BROWSER_EXPECTED_PROSE_AS_TEXT',step_id:execution?.step_id,tool:'browser_assert',attempted_assertion:args.assertion,
    action_outcome:'not_attempted',retry_safe:true,evidence_refs:[target.ref],expected_result_kind:'descriptive_outcome',
    remaining_contract:'inspect_selected_feedback_or_report_current_section_issue_without_replaying_actions',
    message:'The requested text copies descriptive manual prose. The selected current alert instead has different failure wording. No assertion ran. Preserve the required outcome; inspect this alert and prerequisites or report section_issue using current evidence. Do not treat the error as success or replay the completed action.'};
}

/** Prevent an actor-created exact expectation from merely copying a shortened
 * observation. Authored expectations and parameter references retain their
 * meaning, including deliberate negative tests; this guard never replaces an
 * operator, chooses an expected value, or dispatches a browser request. */
function browserExcerptAssertionFeedback({ request, snapshot, execution } = {}) {
  const container=browserContainerTextAssertionFeedback({request,snapshot,execution});
  if(container)return container;
  const description=browserDescriptiveTextAssertionFeedback({request,snapshot,execution});
  if(description)return description;
  const args = request?.arguments;
  if (request?.name !== 'browser_assert' || !['text', 'title', 'title_normalized', 'url'].includes(args?.assertion)
    || typeof args.value !== 'string' || !args.value || require('./automationBrowserParameters').referenceKey(args.value)) return null;
  const entry = registry(snapshot);
  if (!entry) return null;
  const normalized = value => ['title', 'url'].includes(args.assertion) ? value : value.replace(/\s+/g, ' ').trim();
  const expected = normalized(args.value);
  if (!expected) return null;
  const authored = [execution?.action, execution?.expected_result,
    ...[execution?.source_obligations, execution?.obligations].flatMap(rows => Array.isArray(rows) ? rows.flatMap(row => [row?.action, row?.expected_result]) : [])];
  if (authored.some(value => typeof value === 'string' && normalized(value).includes(expected))) return null;
  let fields;
  if (args.assertion === 'text') {
    const ref = entry.bindings.has(args.locator) ? args.locator : entry.aliases.get(args.locator);
    const target = entry.model.targets.find(item => item.ref === ref);
    if (!target) return null;
    fields = ['text', 'name'].filter(field => target[`${field}_truncated`] === true
      && typeof target[field] === 'string' && normalized(target[field]) === expected);
  } else {
    const field = args.assertion === 'url' ? 'url' : 'title';
    fields = entry.model[`${field}_truncated`] === true && typeof entry.model[field] === 'string' && normalized(entry.model[field]) === expected ? [field] : [];
  }
  if (!fields.length) return null;
  return { code: 'AUTOMATION_BROWSER_ASSERTION_EXCERPT_NOT_EXACT', step_id: execution?.step_id, tool: 'browser_assert',
    attempted_assertion: args.assertion, excerpt_fields: fields, action_outcome: 'not_attempted', retry_safe: true,
    remaining_contract: 'preserve_authored_expectation_and_obtain_supported_exact_evidence',
    message: 'The selected observation field is a shortened excerpt, not an exact observed value. Do not turn that excerpt into a new exact expected value. Preserve the authored expected result; inspect supported fuller evidence or use its configured parameter reference. No assertion was attempted. Do not weaken or replace the predicate.' };
}

module.exports = { projectModelSnapshot, resolveModelToolRequest, modelTargetForLocator, browserBatchTargetEvidence, repositoryTargetEvidence, browserObservedTargetFeedback, browserExcerptAssertionFeedback, browserDescriptiveTextAssertionFeedback, browserContainerTextAssertionFeedback };
