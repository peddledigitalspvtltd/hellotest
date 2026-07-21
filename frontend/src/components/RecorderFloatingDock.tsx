import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { OpenIcon, PauseIcon, RecordIcon, TrashIcon } from "./AppIcons";
import type { RecorderSessionResponse } from "../types";

export function RecorderFloatingDock({
  session,
  isStopping,
  onStop
}: {
  session: RecorderSessionResponse | null;
  isStopping: boolean;
  onStop: (includedActionIndices: number[]) => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const [pendingPauseState, setPendingPauseState] = useState<boolean | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [orderedIndices, setOrderedIndices] = useState<number[]>([]);
  const [excludedIndices, setExcludedIndices] = useState<number[]>([]);
  const actions = useMemo(() => session?.actions || [], [session?.actions]);
  const actionByIndex = useMemo(() => new Map(actions.map((action) => [action.index, action])), [actions]);

  useEffect(() => {
    const incoming = actions.map((action) => action.index);
    setOrderedIndices((current) => [
      ...current.filter((index) => incoming.includes(index)),
      ...incoming.filter((index) => !current.includes(index))
    ]);
    setExcludedIndices((current) => current.filter((index) => incoming.includes(index)));
  }, [actions]);

  useEffect(() => {
    setIsCollapsed(false);
    setOrderedIndices([]);
    setExcludedIndices([]);
    setPendingPauseState(null);
    setPauseError(null);
  }, [session?.id]);

  useEffect(() => {
    setPendingPauseState(null);
  }, [session?.paused]);

  if (!session || typeof document === "undefined") return null;

  const includedIndices = orderedIndices.filter((index) => !excludedIndices.includes(index));
  const visibleIndices = orderedIndices.slice(-12);
  const isPaused = pendingPauseState ?? Boolean(session.paused);
  const move = (index: number, direction: "up" | "down") => {
    setOrderedIndices((current) => {
      const from = current.indexOf(index);
      const to = direction === "up" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };
  const togglePause = async () => {
    if (!session.status_url || isTogglingPause || session.status !== "running") return;
    const nextPaused = !isPaused;
    setIsTogglingPause(true);
    setPauseError(null);

    try {
      const response = await fetch(`${session.status_url}/${nextPaused ? "pause" : "resume"}`, {
        method: "POST",
        headers: { accept: "application/json" }
      });
      const payload = await response.json().catch(() => null) as Partial<RecorderSessionResponse> & { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message || `Recorder returned ${response.status}`);
      setPendingPauseState(Boolean(payload?.paused));
    } catch (error) {
      setPendingPauseState(null);
      setPauseError(error instanceof Error ? error.message : "Unable to change recorder capture state");
    } finally {
      setIsTogglingPause(false);
    }
  };

  return createPortal(
    <aside className={isCollapsed ? "recorder-floating-dock is-collapsed" : "recorder-floating-dock"} aria-label="Live recorder controls">
      <header>
        <span className={isPaused ? "recorder-floating-live is-paused" : "recorder-floating-live"}>
          {isPaused ? <PauseIcon size={15} /> : <RecordIcon size={15} />} {isPaused ? "Paused" : "Recording"}
        </span>
        <strong>{actions.length} action{actions.length === 1 ? "" : "s"}</strong>
        <button className="ghost-button compact" onClick={() => setIsCollapsed((current) => !current)} type="button">
          {isCollapsed ? "Review" : "Hide"}
        </button>
      </header>
      {!isCollapsed ? (
        <>
          <div className="recorder-floating-actions" aria-label="Captured recorder actions">
            {visibleIndices.map((index) => {
              const action = actionByIndex.get(index);
              if (!action) return null;
              const isExcluded = excludedIndices.includes(index);
              return (
                <article className={isExcluded ? "is-excluded" : ""} key={index}>
                  <label>
                    <input
                      checked={!isExcluded}
                      onChange={() => setExcludedIndices((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])}
                      type="checkbox"
                    />
                    <span><strong>{action.type}</strong><small>{action.text || action.value || action.locator || action.url || "Browser action"}</small></span>
                  </label>
                  <div>
                    <button aria-label={`Move action ${index} up`} className="ghost-button compact" onClick={() => move(index, "up")} type="button">↑</button>
                    <button aria-label={`Move action ${index} down`} className="ghost-button compact" onClick={() => move(index, "down")} type="button">↓</button>
                    <button aria-label={`Exclude action ${index}`} className="ghost-button compact danger" onClick={() => setExcludedIndices((current) => [...new Set([...current, index])])} type="button"><TrashIcon size={13} /></button>
                  </div>
                </article>
              );
            })}
            {!actions.length ? <span className="empty-state compact">Interact with the browser to capture the first action.</span> : null}
          </div>
          <footer>
            {session.live_view_url ? <a className="ghost-button compact" href={session.live_view_url} rel="noreferrer" target="_blank"><OpenIcon size={14} /> Open browser</a> : null}
            <button className="ghost-button compact" disabled={isStopping || isTogglingPause} onClick={() => void togglePause()} type="button">
              {isPaused ? <RecordIcon size={14} /> : <PauseIcon size={14} />}
              <span>{isTogglingPause ? "Updating…" : isPaused ? "Resume" : "Pause"}</span>
            </button>
            <button className="primary-button recorder-stop-button" disabled={isStopping} onClick={() => onStop(includedIndices)} type="button">
              <PauseIcon size={14} />
              <span>{isStopping ? "Mapping…" : `Stop & map ${includedIndices.length}`}</span>
            </button>
          </footer>
          {pauseError ? <p className="recorder-floating-error" role="alert">{pauseError}</p> : null}
        </>
      ) : null}
    </aside>,
    document.body
  );
}
