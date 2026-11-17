const { setTimeout: pause } = require('node:timers/promises');

function activityCursor(value = 0) {
  if (!['string', 'number'].includes(typeof value) || !/^\d{1,7}$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 1000000) {
    throw Object.assign(new Error('Choose a valid automation activity cursor.'), { statusCode: 400 });
  }
  return Number(value);
}

/** A bounded connection observes durable rows; disconnect never cancels work.
 * The read port rechecks project/code permissions on every snapshot/page. */
async function* streamAutomationActivity({ read, cursor = 0, initial, signal, wait = pause, now = Date.now, maxDurationMs = 180000 }) {
  let offset = activityCursor(cursor), snapshot = initial, previous = '', heartbeat = now();
  const started = now();
  try {
    while (!signal?.aborted && now() - started < maxDurationMs) {
      snapshot ||= await read(offset);
      if (signal?.aborted) return;
      const next = activityCursor(snapshot.events_next_offset ?? offset + (snapshot.events?.length || 0));
      if (next < offset) throw new Error('Activity progress moved backwards.');
      const serialized = JSON.stringify(snapshot);
      if (serialized !== previous) {
        yield `id: ${next}\nevent: activity\ndata: ${serialized}\n\n`;
        offset = next; previous = serialized;
      }
      if (snapshot.events_has_more) { snapshot = undefined; continue; }
      if (!['queued', 'running'].includes(snapshot.status)) { yield 'event: complete\ndata: {}\n\n'; return; }
      if (now() - heartbeat >= 10000) { yield ': keepalive\n\n'; heartbeat = now(); }
      await wait(750, undefined, { signal });
      snapshot = undefined;
    }
    if (!signal?.aborted) yield 'event: reconnect\ndata: {}\n\n';
  } catch {
    if (!signal?.aborted) yield 'event: unavailable\ndata: {}\n\n';
  }
}

module.exports = { activityCursor, streamAutomationActivity };
