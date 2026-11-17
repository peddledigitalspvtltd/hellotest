import { useEffect, useRef, useState } from 'react';
import { getAutomationActivity, mergeAutomationActivity, streamAutomationBuildActivity, type AutomationActivity } from '../lib/automationActivityStream';

export function useAutomationActivityStream({ activityId, enabled = true, onActivity, onUnavailable }: { activityId?: string | null; enabled?: boolean; onActivity: (activity: AutomationActivity) => void; onUnavailable?: (error: Error) => void }) {
  const callback = useRef(onActivity); callback.current = onActivity;
  const unavailableCallback = useRef(onUnavailable); unavailableCallback.current = onUnavailable;
  const [state, setState] = useState<'idle' | 'connecting' | 'streaming' | 'polling' | 'unavailable'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (!enabled || !activityId) { setState('idle'); return; }
    setError(null);
    setResumed(false);
    const controller = new AbortController(); let snapshot: AutomationActivity | null = null, cursor = 0, failures = 0, reconnecting = false;
    const unavailable = (failure: unknown) => {
      snapshot = null;
      const error = failure instanceof Error ? failure : new Error('Automation activity is no longer available.');
      setError(error); setState('unavailable'); unavailableCallback.current?.(error);
    };
    const denied = (failure: unknown) => [401, 403, 404].includes(Number((failure as {statusCode?: number; status?: number})?.statusCode || (failure as {status?: number})?.status));
    const publish = (next: AutomationActivity) => {
      if (controller.signal.aborted) return;
      cursor = Math.max(cursor, next.events_next_offset || 0);
      snapshot = mergeAutomationActivity(snapshot, next); callback.current(snapshot);
    };
    const wait = (ms: number) => new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms); controller.signal.addEventListener('abort', done, { once: true });
    });
    void (async () => {
      while (!controller.signal.aborted) {
        setState(failures ? 'polling' : 'connecting');
        try {
          const result = await streamAutomationBuildActivity(activityId, next => { if (reconnecting) setResumed(true); failures = 0; setState('streaming'); publish(next); }, controller.signal, cursor);
          cursor = result.cursor; failures = 0;
          if (result.complete) { setState('idle'); return; }
          reconnecting = true;
          throw new Error('The activity connection ended; refreshing its authorized snapshot.');
        } catch (error) {
          if (controller.signal.aborted) return;
          if (denied(error) || error instanceof Error && error.name === 'AbortError') { unavailable(error); return; }
          reconnecting = true; failures++; setState('polling');
          try {
            const current = await getAutomationActivity(activityId, controller.signal); publish(current);
            if (!['queued', 'running'].includes(current.status)) { setState('idle'); return; }
          } catch (failure) {
            if (controller.signal.aborted) return;
            if (denied(failure) || failure instanceof Error && failure.name === 'AbortError') { unavailable(failure); return; }
            // A transient dependency failure retains the last authorized view.
          }
        }
        await wait(Math.min(15000, 1000 * 2 ** Math.min(failures, 4)));
      }
    })();
    return () => controller.abort();
  }, [activityId, enabled]);
  return { state, connected: state === 'streaming', error, resumed };
}
