const { createHash } = require('node:crypto');

const mutationTools = new Set(['browser_navigate', 'browser_click', 'browser_fill', 'browser_press_key', 'browser_select_option', 'browser_hover', 'browser_check', 'browser_uncheck']);
const transitionTools = new Set(['browser_click', 'browser_press_key', 'browser_select_option', 'browser_hover', 'browser_check', 'browser_uncheck']);
const targetReadTools = new Set(['browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_snapshot']);
const controlTags = new Set(['input', 'button', 'a', 'select', 'textarea']);
const controlRoles = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio']);
const identityAttributes = ['id', 'name', 'role', 'aria-label', 'aria-labelledby', 'placeholder', 'data-testid', 'type', 'title', 'alt', 'autocomplete',
  'href', 'multiple', 'size', 'aria-controls', 'aria-expanded', 'aria-haspopup', 'aria-disabled'];
const text = (value, limit = 2_000) => typeof value === 'string' ? value.slice(0, limit) : '';
const role = element => text(element.accessible_role || element.role || element.attributes?.role).toLowerCase().split(/\s+/)[0];
const controlName = element => element.accessible_name || element.name || element.label || element.text;

function selectChoices(element) {
  if (text(element.tag).toLowerCase() !== 'select') return null;
  // Selection is the control's input value, rather than its available choices.
  // Observe changed labels/values/disabled choices without making an ordinary
  // selection itself invalidate every remaining action in a stable form.
  return Array.isArray(element.options) ? element.options.slice(0, 12).map(option => [
    text(option?.label, 80), text(option?.value, 120), option?.disabled === true
  ]) : null;
}

function completeControl(element) {
  const name = controlName(element);
  if (element.accessible_role_truncated || element.role_truncated || element.accessible_name_truncated
    || element.name_truncated || element.label_truncated || element.text_truncated
    || typeof name === 'string' && name.length > 2_000
    || identityAttributes.some(name => typeof element.attributes?.[name] === 'string' && element.attributes[name].length > 2_000)
    || element.truncated_attributes?.some(name => identityAttributes.includes(name))) return false;
  if (text(element.tag).toLowerCase() !== 'select') return true;
  return Array.isArray(element.options) && element.options.length <= 12 && element.options_truncated !== true
    && element.options.every(option => option && typeof option === 'object' && !Array.isArray(option)
      && typeof option.label === 'string' && option.label.length <= 80 && option.label_truncated !== true
      && typeof option.value === 'string' && option.value.length <= 120 && option.value_truncated !== true);
}

/** Snapshot identity only: input values and page/result prose do not become
 * batch-state data. This is a host decision aid, never model execution proof. */
function captureBrowserBatchState(snapshot, fallback = {}) {
  const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const elements = Array.isArray(value.elements) ? value.elements : null;
  const observedControls = (elements || []).slice(0, 120).filter(element => element && typeof element === 'object').filter(element => {
    const attributes = element.attributes || {};
    return controlTags.has(text(element.tag).toLowerCase()) || controlRoles.has(role(element)) || attributes.contenteditable === 'true';
  });
  const controls = observedControls.map(element => {
    const attributes = element.attributes || {};
    return [text(element.tag), role(element), text(controlName(element)),
      identityAttributes.map(name => text(attributes[name])),
      Array.isArray(element.locator_candidates) ? element.locator_candidates.slice(0, 4).map(locator => text(locator)) : [],
      element.displayed !== false, element.disabled === true, typeof element.checked === 'boolean' ? element.checked : null,
      selectChoices(element)];
  });
  return {
    url: text(value.url || fallback.url),
    target_id: text(value.target_id || value.page_id || fallback.target_id || fallback.page_id, 200),
    controls_fingerprint: elements ? createHash('sha256').update(JSON.stringify(controls)).digest('hex') : null,
    controls_complete: Boolean(elements && elements.length <= 120 && observedControls.every(completeControl)
      && !value.partial && !value.truncated && !value.elements_truncated && !value.fields_truncated && (!value.scope || value.scope === 'body'))
  };
}

/** Ask for fresh controls after a transition-capable action before dispatching
 * a mutation or a read against an old target. URL/title assertions and unscoped
 * snapshots do not depend on stale target evidence. Once inspected, unchanged
 * controls allow the batch to continue. Normal form fills keep their batch
 * unless URL/target changes. */
function browserBatchBoundary({ tool, before = {}, after = {}, remainingTools = [], inspected = false } = {}) {
  const remainingTargetWork = Array.isArray(remainingTools) && remainingTools.some(item => {
    const name = typeof item === 'string' ? item : item?.name;
    return mutationTools.has(name) || targetReadTools.has(name) && typeof item?.arguments?.locator === 'string' && item.arguments.locator.trim().length > 0;
  });
  if (!mutationTools.has(tool) || !remainingTargetWork) return { pause: false, needs_snapshot: false };
  if (before.url && after.url && before.url !== after.url) return { pause: true, needs_snapshot: false, reason: 'page_changed' };
  if (before.target_id && after.target_id && before.target_id !== after.target_id) return { pause: true, needs_snapshot: false, reason: 'target_changed' };
  if (tool === 'browser_navigate' && (!before.url || !after.url)) return { pause: true, needs_snapshot: false, reason: 'navigation_action' };
  if (tool !== 'browser_navigate' && !transitionTools.has(tool)) return { pause: false, needs_snapshot: false };
  if (!inspected) return { pause: false, needs_snapshot: true, reason: tool === 'browser_navigate' ? 'inspect_after_navigation' : 'inspect_after_interaction' };
  if (!before.url || !after.url || !before.controls_complete || !after.controls_complete || !before.controls_fingerprint || !after.controls_fingerprint) {
    return { pause: true, needs_snapshot: false, reason: 'page_state_unavailable' };
  }
  if (before.controls_fingerprint !== after.controls_fingerprint) return { pause: true, needs_snapshot: false, reason: 'controls_changed' };
  return { pause: false, needs_snapshot: false };
}

module.exports = { captureBrowserBatchState, browserBatchBoundary };
