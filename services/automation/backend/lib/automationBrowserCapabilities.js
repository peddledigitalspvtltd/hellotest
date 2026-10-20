// This is a model-facing projection of an already discovered catalog. It does
// not authorize tools or replace their schemas; dispatch must use the original
// catalog and disclose a deferred tool's schema before accepting its request.
const core = new Set([
  'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_assert',
  'browser_validate_locator', 'browser_press_key'
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function projectBrowserCapabilities({ tools = [], current = {}, action = '', expectedResult = '', expandedNames = [] } = {}) {
  const catalog = Array.isArray(tools) ? tools : [];
  const snapshot = current?.current_snapshot;
  // Bootstrap and missing page evidence must not hide the very capability
  // needed to inspect the page. Once evidence exists, deferred tools remain
  // discoverable even when that observation is explicitly partial.
  if (!record(snapshot)) return { tools: [...catalog], deferred_tool_names: [] };

  const selected = new Set(core);
  const known = new Set(catalog.map(tool => tool?.name));
  const expanded = typeof expandedNames !== 'string' && typeof expandedNames?.[Symbol.iterator] === 'function' ? expandedNames : [];
  for (const name of expanded) {
    if (typeof name === 'string' && known.has(name)) selected.add(name);
  }
  const targets = Array.isArray(snapshot.targets) ? snapshot.targets
    : Array.isArray(snapshot.elements) ? snapshot.elements : [];
  for (const target of targets) {
    if (!record(target)) continue;
    const role = String(target.accessible_role || target.role || '').toLowerCase();
    const tag = String(target.tag || '').toLowerCase();
    const type = String(target.input_type || target.attributes?.type || '').toLowerCase();
    if (['textbox', 'searchbox', 'combobox'].includes(role) || ['input', 'textarea'].includes(tag)) selected.add('browser_fill');
    if (tag === 'select' || ['combobox', 'listbox', 'option'].includes(role)) selected.add('browser_select_option');
    if (['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(role) || ['checkbox', 'radio'].includes(type)) {
      selected.add('browser_check'); selected.add('browser_uncheck');
    }
    if (['menuitem', 'menuitemcheckbox', 'menuitemradio'].includes(role)) selected.add('browser_hover');
  }

  const goal = [action, expectedResult].filter(value => typeof value === 'string').join('\n');
  if (/\b(?:fill|enter|type|typing|input|textarea|textbox|searchbox|paste|write|edit|search|credentials?)\b/i.test(goal)) selected.add('browser_fill');
  if (/\b(?:select|choose|dropdown|drop-down|combobox|listbox|options?)\b/i.test(goal)) selected.add('browser_select_option');
  if (/\b(?:check|uncheck|tick|untick|toggle|checkbox|radio|switch)\b|\bopt[ -](?:in|out)\b/i.test(goal)) {
    selected.add('browser_check'); selected.add('browser_uncheck');
  }
  if (/\b(?:hover|mouseover|menus?|submenu|tooltip)\b|\bmouse over\b/i.test(goal)) selected.add('browser_hover');
  if (/\b(?:screenshot|screen shot)\b|\bcapture (?:an? )?(?:image|screen)\b/i.test(goal)) selected.add('browser_screenshot');
  if (/\b(?:wait|waiting)\b/i.test(goal)) selected.add('browser_wait_for');

  // Preserve discovery order, exact object identities, complete conditional
  // schemas and annotations. Unknown tools are deferred unless explicitly
  // expanded; selection never manufactures a tool absent from discovery.
  return {
    tools: catalog.filter(tool => selected.has(tool?.name)),
    deferred_tool_names: [...new Set(catalog.filter(tool => !selected.has(tool?.name)).map(tool => tool?.name).filter(name => typeof name === 'string'))]
  };
}

module.exports = { projectBrowserCapabilities };
