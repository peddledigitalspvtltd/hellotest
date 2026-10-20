// Keep this browser-side reader identical to TestEngine's exported reader.
// It observes selected-field validation only, never form or business success.
function readFieldValidationState(element) {
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return null;
  if (element.tagName === 'INPUT' && !['text', 'search', 'tel', 'url', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(element.type)) return null;
  if (!('willValidate' in element) || element.willValidate !== true || !('validity' in element)) return null;
  const validity = element.validity;
  if (!validity || typeof validity !== 'object' || !('valid' in validity) || typeof validity.valid !== 'boolean') return null;
  const visible = node => {
    const style = getComputedStyle(node);
    return style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility) && Array.from(node.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
  };
  if (!visible(element) || !validity.valid) return false;
  const invalid = (element.getAttribute('aria-invalid') || '').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase();
  if (invalid && invalid !== 'false') return false;
  const root = element.getRootNode();
  if (!root || typeof root.querySelectorAll !== 'function') return null;
  let count = 0;
  for (const attribute of ['aria-errormessage', 'aria-describedby']) {
    const references = (element.getAttribute(attribute) || '').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
    if (!references) continue;
    if (references.length > 8192) return null;
    for (const id of references.split(/[\t\n\f\r ]+/)) {
      if (++count > 32 || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return null;
      const matches = root.querySelectorAll(`[id="${CSS.escape(id)}"]`);
      // Descriptions can reference optional, currently unmounted hints. ARIA
      // ignores unresolved descriptive IDs; an absent hint is not a field
      // error. Explicit error references must still be resolvable, and duplicate
      // IDs remain ambiguous. Continue so later associated alerts are checked.
      if (matches.length === 0 && attribute === 'aria-describedby') continue;
      if (matches.length !== 1) return null;
      const error = matches[0];
      const roles = (error.getAttribute('role') || '').toLowerCase();
      if (roles.length > 2048) return null;
      const knownRoles = 'alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem'.split(' ');
      const alert = roles.split(/[\t\n\f\r ]+/).find(role => knownRoles.includes(role)) === 'alert';
      if (attribute !== 'aria-errormessage' && !alert) continue;
      if (getComputedStyle(error).display === 'none') continue;
      const descendants = error.querySelectorAll('*');
      if (descendants.length > 32) return null;
      const named = (node) => Boolean((node.getAttribute('aria-label') || '').trim() || node.tagName === 'IMG' && (node.getAttribute('alt') || '').trim()
        || node.tagName.toLowerCase() === 'svg' && (node.querySelector('title')?.textContent || '').trim());
      for (const node of [error, ...Array.from(descendants)]) {
        const style = getComputedStyle(node);
        if (style.display === 'contents' && !['hidden', 'collapse'].includes(style.visibility) && (String(node.textContent || '').trim() || named(node))) return null;
        if (visible(node) && (String(node.innerText ?? node.textContent ?? '').trim() || named(node))) return false;
      }
    }
  }
  return true;
}

const fieldValidationStateSource = readFieldValidationState.toString();
// The one previously shipped reader differed only by treating unresolved
// descriptive hints as unsupported. Keep that exact syntax recognizable for
// extracting saved requirements during a rebuild, never arbitrary callbacks.
const legacyFieldValidationStateSource = fieldValidationStateSource.replace(
  "\n      if (matches.length === 0 && attribute === 'aria-describedby') continue;", ''
);
const { parseExpressionAt } = require('acorn');
const syntax = value => Array.isArray(value) ? value.map(syntax) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc', 'raw'].includes(key)).map(([key, item]) => [key, syntax(item)])) : value;
const currentSyntax = syntax(parseExpressionAt(fieldValidationStateSource, 0, { ecmaVersion: 'latest' }));
const legacySyntax = JSON.stringify(syntax(parseExpressionAt(legacyFieldValidationStateSource, 0, { ecmaVersion: 'latest' })));
function normalizeLegacyFieldValidationSyntax(value) {
  if (Array.isArray(value)) return value.map(normalizeLegacyFieldValidationSyntax);
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'FunctionExpression' && JSON.stringify(syntax(value)) === legacySyntax) return structuredClone(currentSyntax);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeLegacyFieldValidationSyntax(item)]));
}

module.exports = { readFieldValidationState, fieldValidationStateSource, legacyFieldValidationStateSource, normalizeLegacyFieldValidationSyntax };
