const { parseExpressionAt } = require('acorn');
const { recordedLocatorSource } = require('./automationRecordedProgram');

const syntax = value => Array.isArray(value) ? value.map(syntax) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'raw', 'loc'].includes(key)).map(([key, item]) => [key,
    key === 'properties' && value.type === 'ObjectExpression'
      ? [...item].sort((left, right) => String(left.key.name ?? left.key.value).localeCompare(String(right.key.name ?? right.key.value))).map(syntax)
      : syntax(item)])) : value;

/** Equivalent spellings of the closed native locator grammar only. This does
 * not equate an ID and a label, fuzzy and exact names, different indices or
 * different DOM nodes. Page/application/observed-route scope is a caller's
 * independent requirement, never inferred from a selector. */
function recordedLocatorIdentity(locator) {
  const source = recordedLocatorSource(locator);
  return source ? JSON.stringify(syntax(parseExpressionAt(source, 0, { ecmaVersion: 'latest' }))) : null;
}
function sameRecordedLocator(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left === right) return true;
  const identity = recordedLocatorIdentity(left);
  return Boolean(identity && identity === recordedLocatorIdentity(right));
}

module.exports = { recordedLocatorIdentity, sameRecordedLocator };
