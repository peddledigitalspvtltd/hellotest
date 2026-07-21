import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { RecorderSessionResponse } from "../types";

const collectionTail = (value: unknown) => {
  if (!Array.isArray(value) || !value.length) return "0";
  const tail = value[value.length - 1] as Record<string, unknown> | undefined;
  return `${value.length}:${tail?.id || tail?.index || ""}:${tail?.timestamp || ""}`;
};

const sessionSignature = (session: Partial<RecorderSessionResponse> | null) => session ? [
  session.id,
  session.status,
  session.paused,
  session.action_count,
  session.network_count,
  session.live_view_url,
  collectionTail(session.actions),
  collectionTail(session.network)
].join("|") : "";

export function useRecorderSessionPolling(
  session: RecorderSessionResponse | null,
  setSession: Dispatch<SetStateAction<RecorderSessionResponse | null>>,
  { intervalMs = 1000, onError }: { intervalMs?: number; onError?: (error: unknown) => void } = {}
) {
  useEffect(() => {
    const statusUrl = session?.status_url;
    if (!statusUrl || session.status !== "running") return undefined;

    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    let controller: AbortController | null = null;

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        schedule(Math.max(5000, intervalMs));
        return;
      }

      controller = new AbortController();
      try {
        const response = await fetch(statusUrl, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Recorder status returned ${response.status}`);
        const next = await response.json() as Partial<RecorderSessionResponse>;
        failures = 0;
        if (!cancelled) {
          setSession((current) => {
            if (!current || current.id !== session.id) return current;
            const merged = { ...current, ...next };
            return sessionSignature(current) === sessionSignature(merged) ? current : merged;
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          failures += 1;
          onError?.(error);
        }
      } finally {
        controller = null;
        schedule(Math.min(10000, intervalMs * (2 ** Math.min(failures, 4))));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [intervalMs, onError, session?.id, session?.status, session?.status_url, setSession]);
}
