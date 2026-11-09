const inputKind = action => ['fill', 'change'].includes(action?.type) ? 'fill' : ['select', 'check', 'uncheck', 'upload'].includes(action?.type) ? action.type : null;

// Only consecutive edits of the same field form one input burst. A submit,
// navigation, another field or a different tab is a replay boundary.
function supersedingInputAction(action, actions, index) {
  const next = actions[index + 1], kind = inputKind(action);
  if (!kind || !action.locator || inputKind(next) !== kind || next.locator !== action.locator || (next.page_id || '') !== (action.page_id || '')) return null;
  const currentTime = Date.parse(action.timestamp || ''), nextTime = Date.parse(next.timestamp || '');
  if (Number.isFinite(currentTime) && Number.isFinite(nextTime) && (nextTime < currentTime || nextTime - currentTime > 12000)) return null;
  return next;
}

module.exports = { supersedingInputAction };
