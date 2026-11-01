import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { RecorderSessionResponse } from "../../types";
import { consumeApiResponse } from "../../lib/clientRequestTransport";

/** Sequential, visible-only telemetry polling; finishing remains authoritative. */
export function useRecorderStatus(
  session: RecorderSessionResponse | null,
  setSession: Dispatch<SetStateAction<RecorderSessionResponse | null>>
) {
  const id = session?.id;
  const url = session?.status_url;
  const status = session?.status;
  const agentToken = session?.recorder_mode === "local" ? session.inspector_agent_token : undefined;

  useEffect(() => {
    if (!id || !url || status !== "running") return;
    const lifetime = new AbortController();
    let timer: number | undefined;
    let inFlight = false;

    const refresh = async () => {
      if (inFlight || lifetime.signal.aborted) return;
      inFlight = true;
      try {
        if (document.hidden) return;
        const next = await consumeApiResponse<Partial<RecorderSessionResponse> | null>(
          url,
          { cache: "no-store", credentials: "omit", signal: lifetime.signal, ...(agentToken ? { headers: { "X-HelloTest-Agent-Token": agentToken } } : {}) },
          { timeoutMs: 5000, timeoutMessage: "Recorder status refresh timed out." },
          async response => {
            if (!response.ok) return null;
            const value = await response.json();
            if (!value || typeof value !== "object" || Array.isArray(value)) return null;
            return !value.id || value.id === id ? value : null;
          }
        );
        if (next && !lifetime.signal.aborted) {
          setSession(current => current?.id === id ? { ...current, ...next } : current);
        }
      } catch {
        // Telemetry failure must not replace the saved recording or interrupt capture.
      } finally {
        inFlight = false;
        if (!lifetime.signal.aborted) timer = window.setTimeout(() => void refresh(), 1000);
      }
    };
    const resume = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    void refresh();
    return () => {
      lifetime.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [id, url, status, agentToken, setSession]);
}
