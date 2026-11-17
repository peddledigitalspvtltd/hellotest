// Development fallback only. Production durability belongs to Temporal and
// its delivery outbox. Waiting entries have not dispatched any node effects.
function createLocalRunQueue({ concurrency = 2, maxQueued = 20 } = {}) {
  const waiting = [], running = new Map();
  const cancelled = () => Object.assign(new Error('Queued workflow cancelled before execution.'), { name: 'AbortError', statusCode: 499 });
  const notify = (entry, state, position) => {
    entry.notifications = entry.notifications.then(() => entry.onPosition?.({ state, position }));
    entry.notifications.catch(() => {});
  };
  const positions = () => waiting.forEach((entry, index) => { if (entry.wasQueued) notify(entry, 'queued', index + 1); });
  const pump = () => {
    while (running.size < concurrency && waiting.length) {
      const entry = waiting.shift();
      if (entry.signal?.aborted) { entry.reject(cancelled()); entry.cleanup(); continue; }
      running.set(entry.id, entry); entry.started = true;
      notify(entry, 'running', 0);
      Promise.resolve().then(async () => {
        await entry.notifications;
        if (entry.signal?.aborted) throw cancelled();
        return entry.execute({ queued: entry.wasQueued });
      }).then(entry.resolve, entry.reject).finally(() => { running.delete(entry.id); entry.cleanup(); positions(); pump(); });
    }
  };
  return {
    enqueue(id, execute, { signal, onPosition } = {}) {
      if (waiting.length >= maxQueued && running.size >= concurrency) throw Object.assign(new Error(`The development workflow queue is full (${maxQueued} waiting runs). Use Temporal for durable unattended execution.`), { statusCode: 429, code: 'WORKFLOW_LOCAL_QUEUE_FULL' });
      if (running.has(id) || waiting.some(entry => entry.id === id)) throw new Error('This local workflow is already queued.');
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {});
      const entry = { id, execute, signal, onPosition, resolve, reject, promise, wasQueued: running.size >= concurrency, notifications: Promise.resolve(), started: false };
      const abort = () => {
        if (entry.started) return;
        const index = waiting.indexOf(entry); if (index >= 0) waiting.splice(index, 1);
        reject(cancelled()); entry.cleanup(); positions(); pump();
      };
      entry.cleanup = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      waiting.push(entry); positions(); pump();
      return { promise, queued: entry.wasQueued };
    },
    position: id => { const index = waiting.findIndex(entry => entry.id === id); return index < 0 ? 0 : index + 1; },
    get running() { return running.size; }, get queued() { return waiting.length; },
  };
}
module.exports = { createLocalRunQueue };
