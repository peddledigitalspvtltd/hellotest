const invalid = message => Object.assign(new Error(`${message} Existing instructions were retained. Review the recording or use Automation Engineer to author this flow.`), { code: 'AUTOMATION_RECORDER_REPLAY_UNSUPPORTED', statusCode: 422 });
const kind = action => String(action?.type || '').toLowerCase();
const lifecycle = action => kind(action) === 'tab' && (action.locator === 'browser.tab' || action.source === 'browser' && /^Tab (?:opened|closed)$/i.test(action.text || ''));
const samePage = (left, right) => !left?.page_id || !right?.page_id || left.page_id === right.page_id;
const mutation = action => ['click','dblclick','rightclick','fill','change','upload','select','check','uncheck','press','tab'].includes(kind(action)) && !lifecycle(action);
const present = (object, name) => Object.prototype.hasOwnProperty.call(object, name);

function scrollPosition(action) {
  let payload;
  try { payload = JSON.parse(action.value || ''); } catch { throw invalid('A recorded scroll has no valid position or wheel delta.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('A recorded scroll has no valid position or wheel delta.');
  const absolute = present(payload, 'x') || present(payload, 'y');
  const fields = absolute ? ['x','y'] : ['delta_x','delta_y'];
  if (!fields.some(name => present(payload, name))) throw invalid('A recorded scroll has no valid position or wheel delta.');
  const values = fields.map(name => present(payload, name) ? payload[name] : 0);
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100000000)) throw invalid('Recorded scroll coordinates must be finite numbers.');
  return { absolute, x: values[0], y: values[1], element: absolute && payload.target === 'element' };
}

/** Capture events are observations, not permission to invent another action.
 * This single-context compiler retains chronology and source indexes, drops
 * only known duplicate physical events, and rejects context it cannot replay. */
function prepareRecorderReplayActions(actions = []) {
  const pages = new Set(actions.map(action => action.page_id).filter(Boolean));
  if (pages.size > 1) throw invalid('This recording contains multiple browser tabs or popups whose runtime identity cannot be replayed safely.');
  if (actions.some(action => action.frame_scope === 'child' || action.frame_url)) throw invalid('This recording contains an embedded-frame interaction without a replayable frame locator.');
  const output = [];
  let lastMutation = null, hasNavigation = false;
  for (let index = 0; index < actions.length; index++) {
    let action = actions[index], type = kind(action);
    if (lifecycle(action)) continue;
    if (['drag','drop'].includes(type)) throw invalid('Drag-and-drop recording does not yet contain both replayable source and destination locators.');
    if (!['navigation','click','dblclick','rightclick','fill','change','upload','select','check','uncheck','submit','press','tab','scroll'].includes(type)) throw invalid('The recording contains an unsupported browser action.');
    if (['press','tab'].includes(type) && action.remote_input_id) {
      const key = action.text || action.value;
      const duplicate = output.findIndex(previous => previous.remote_input_id === action.remote_input_id && ['press','tab'].includes(kind(previous))
        && samePage(previous, action) && previous.source !== action.source
        && ['remote-control','page-recorder'].includes(previous.source) && ['remote-control','page-recorder'].includes(action.source));
      if (duplicate >= 0) {
        const previous = output[duplicate];
        if ((previous.text || previous.value) !== key) {
          // The host records the actual Playwright key chord; the DOM keydown
          // contains only its base key. Keep its original chronological slot.
          const host = action.source === 'remote-control' ? action : previous;
          const native = action.source === 'page-recorder' ? action : previous;
          const combined = { ...native, type: 'press', text: host.text || host.value, value: null };
          if (action.source === 'remote-control') { output[duplicate] = combined; continue; }
          output.splice(duplicate, 1); action = combined; type = 'press';
        } else if (action.source === 'remote-control') continue;
        else output.splice(duplicate, 1);
      }
    }
    if (type === 'click' && action.click_count === 0 && action.keyboard_activation_id && action.source === 'page-recorder'
      && output.some(previous => kind(previous) === 'press' && previous.keyboard_activation_id === action.keyboard_activation_id
        && /(?:^|\+)(?:Enter|Space)$/.test(previous.text || previous.value || '') && samePage(previous, action))) continue;
    if (type === 'submit') {
      // A DOM submit event is the result of the captured button/Enter action.
      if (lastMutation && samePage(lastMutation, action) && (['click','dblclick'].includes(kind(lastMutation)) || kind(lastMutation) === 'press' && /(?:^|\+)(?:Enter|Return|Space)$/i.test(lastMutation.text || lastMutation.value || ''))) continue;
      throw invalid('A recorded form submission has no captured button, Enter or Space action to replay.');
    }
    if (type === 'tab' && !/^Tab$/i.test(action.text || action.value || '')) throw invalid('A recorded tab event cannot be identified as a keyboard Tab press.');
    if (['fill','change','upload','select','check','uncheck','dblclick','rightclick'].includes(type) && !action.locator) throw invalid('A recorded input or pointer action is missing its original locator.');
    if (type === 'click' && (!action.locator || ['body','keyboard','viewport','location','browser.tab'].includes(action.locator)) && ![action.x, action.y].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw invalid('A recorded click has neither a locator nor valid viewport coordinates.');
    if (type === 'press' && !String(action.text || action.value || '').trim()) throw invalid('A recorded keyboard action is missing its original key.');
    if (['fill','change','upload','select','check','uncheck','dblclick','rightclick'].includes(type) && (!action.locator || ['body','keyboard','viewport','location','browser.tab'].includes(action.locator))) throw invalid('A recorded input has no replayable element locator.');
    if (type === 'dblclick' && action.click_count === 2) {
      const second = output.at(-1), first = output.at(-2);
      if (kind(second) === 'click' && second.click_count === 2 && second.locator === action.locator && samePage(second, action)) {
        output.pop();
        if (kind(first) === 'click' && first.click_count === 1 && first.locator === action.locator && samePage(first, action)) output.pop();
      }
    }
    if (type === 'scroll') {
      const position = scrollPosition(action);
      if (position.element && !action.locator) throw invalid('A recorded element scroll is missing its original locator.');
      let previous = output.at(-1);
      while (position.absolute && previous?.source === 'remote-control' && kind(previous) === 'scroll' && samePage(previous, action) && !scrollPosition(previous).absolute) {
        output.pop(); previous = output.at(-1);
      }
      output.push({ ...action, replay_scroll: position });
      continue;
    }
    if (type === 'navigation') {
      if (!action.url || action.url === 'about:blank') continue;
      const observed = action.source === 'browser' || action.source === 'page-recorder';
      const dependent = observed && Boolean(lastMutation) && samePage(lastMutation, action);
      if (observed && hasNavigation && !dependent) {
        const previous = output.at(-1);
        if (kind(previous) === 'navigation' && previous.url === action.url) continue;
        if (!previous || kind(previous) !== 'navigation') throw invalid('A browser navigation has no captured navigation action. Use the recorder URL control for explicit navigation.');
      }
      const next = { ...action, replay_navigation: dependent || observed && hasNavigation ? 'observed' : 'action' };
      const previous = output.at(-1);
      // Redirect observations before the next authored action establish only
      // the final route, which may already have passed intermediate URLs.
      if (next.replay_navigation === 'observed' && previous?.replay_navigation === 'observed' && samePage(previous, next)) output.pop();
      if (next.replay_navigation === 'observed' && kind(output.at(-1)) === 'navigation' && output.at(-1).url === next.url) continue;
      output.push(next); hasNavigation = true;
      continue;
    }
    output.push(action);
    if (mutation(action)) lastMutation = action;
  }
  return output;
}

module.exports = { prepareRecorderReplayActions, scrollPosition };
