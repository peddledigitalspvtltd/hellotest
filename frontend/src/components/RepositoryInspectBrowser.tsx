import { LoadingState } from "./LoadingState";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { RefreshIcon } from "./AppIcons";
import { readRepositoryBrowserState, repositoryInspectFrameUrl, type RepositoryBrowserState } from "../lib/repositoryBrowserBridge";
import "./ObjectRepositoryInspector.css";

const EMPTY_STATE: RepositoryBrowserState = { width: 0, height: 0, actualSize: false, pending: 0, error: "" };
const EXTRA_KEYS = ["Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export function RepositoryInspectBrowser({ tabs, selectedTabId, onSelectTab, onRefreshTabs, isRefreshingTabs, sessionId, liveUrl, emptyMessage }: {
  tabs: Array<{ id: string | null; title: string | null; url: string; active?: boolean }>;
  selectedTabId: string;
  onSelectTab: (tabId: string) => void;
  onRefreshTabs: () => void;
  isRefreshingTabs: boolean;
  sessionId: string;
  liveUrl: string;
  emptyMessage?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const actionInputRef = useRef<HTMLInputElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const submittedActionRef = useRef<{ action: "navigate" | "type"; value: string; started: boolean } | null>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const [browserState, setBrowserState] = useState(EMPTY_STATE);
  const [isReady, setIsReady] = useState(false);
  const [action, setAction] = useState<"navigate" | "type" | null>(null);
  const [address, setAddress] = useState("");
  const [text, setText] = useState("");
  const frameId = useMemo(() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, [liveUrl]);
  const frameUrl = repositoryInspectFrameUrl(liveUrl, typeof window === "undefined" ? "" : window.location.origin, frameId);
  const frameOrigin = frameUrl ? new URL(frameUrl).origin : "";
  const currentTabs = tabs.filter((tab) => Boolean(tab.id));
  const selectedTab = currentTabs.find((tab) => tab.id === selectedTabId);
  const disabled = !frameUrl || !isReady || isRefreshingTabs;

  useEffect(() => {
    setBrowserState(EMPTY_STATE);
    setIsReady(false);
    setAction(null);
    submittedActionRef.current = null;
    const onMessage = (event: MessageEvent) => {
      const state = readRepositoryBrowserState(event, { origin: frameOrigin, source: iframeRef.current?.contentWindow, sessionId, frameId });
      if (state) {
        setBrowserState(state);
        setIsReady(true);
        const submitted = submittedActionRef.current;
        if (submitted && state.pending > 0) submitted.started = true;
        if (submitted && submitted.started && state.pending === 0) {
          submittedActionRef.current = null;
          if (state.error) {
            actionInputRef.current?.focus();
          } else {
            setAction((current) => current === submitted.action ? null : current);
            if (submitted.action === "type") setText((current) => current === submitted.value ? "" : current);
            iframeRef.current?.focus();
          }
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameUrl, frameOrigin, sessionId, frameId]);

  useEffect(() => {
    if (action) actionInputRef.current?.focus();
  }, [action]);

  const sendCommand = (command: "navigate" | "type" | "key" | "scale", value = "") => {
    if (disabled || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ type: "hellotest:recorder:command", session_id: sessionId, frame_id: frameId, command, value }, frameOrigin);
  };
  const closeAction = () => {
    submittedActionRef.current = null;
    setAction(null);
    actionTriggerRef.current?.focus();
  };
  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Node)) return;
      if (action && actionInputRef.current?.form?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        submittedActionRef.current = null;
        setAction(null);
        actionTriggerRef.current?.focus();
      } else if (moreRef.current?.open && moreRef.current.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        moreRef.current.open = false;
        moreRef.current.querySelector("summary")?.focus();
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [action]);
  const openAction = (next: "navigate" | "type", trigger: HTMLButtonElement) => {
    if (action === next) { closeAction(); return; }
    actionTriggerRef.current = trigger;
    if (next === "navigate") setAddress(selectedTab?.url === "about:blank" ? "" : selectedTab?.url || address);
    setAction(next);
  };
  const submitAction = (event: FormEvent) => {
    event.preventDefault();
    if (!action || disabled || browserState.pending > 0 || submittedActionRef.current) return;
    const value = action === "navigate" ? address.trim() : text;
    if (!value) return;
    submittedActionRef.current = { action, value, started: false };
    sendCommand(action, value);
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % currentTabs.length
      : event.key === "ArrowLeft" ? (index - 1 + currentTabs.length) % currentTabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? currentTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    tabRefs.current[next]?.focus();
    if (currentTabs[next]?.id) onSelectTab(currentTabs[next].id as string);
  };

  return <div className="repository-inspect-browser">
    <div className="repository-browser-command-row">
      <div className="object-repository-tab-picker object-repository-browser-tabs" role="tablist" aria-label="Open browser tabs">
        {currentTabs.length ? currentTabs.map((tab, index) => <button
          aria-selected={selectedTabId === tab.id}
          aria-controls="repository-browser-viewport"
          className={selectedTabId === tab.id ? "is-active" : ""}
          disabled={isRefreshingTabs}
          key={tab.id}
          onClick={() => onSelectTab(tab.id as string)}
          onKeyDown={(event) => handleTabKey(event, index)}
          ref={(node) => { tabRefs.current[index] = node; }}
          role="tab"
          tabIndex={selectedTabId === tab.id || (!selectedTabId && index === 0) ? 0 : -1}
          title={tab.url || "about:blank"}
          type="button"
        ><strong>{tab.title || "Untitled tab"}</strong>{selectedTabId === tab.id && browserState.width && browserState.height ? <span className="repository-browser-resolution" aria-label={`Viewport ${browserState.width} by ${browserState.height}`}>{browserState.width} × {browserState.height}</span> : null}</button>) : sessionId && isRefreshingTabs ? <LoadingState label="Loading browser tabs" /> : <span className="repository-browser-empty-tabs">{sessionId ? "No browser tabs available" : "Browser closed"}</span>}
      </div>
      <div className="repository-browser-commands" aria-label="Browser controls">
        <button aria-label="Refresh tabs and selected page content" className="ghost-button compact repository-browser-refresh" disabled={!sessionId || isRefreshingTabs} onClick={onRefreshTabs} title="Refresh tabs and selected page content" type="button"><RefreshIcon size={15} /></button>
        <button aria-expanded={action === "navigate"} aria-controls="repository-browser-action" className="ghost-button compact" disabled={disabled} onClick={(event) => openAction("navigate", event.currentTarget)} type="button">Go</button>
        <button aria-expanded={action === "type"} aria-controls="repository-browser-action" className="ghost-button compact" disabled={disabled} onClick={(event) => openAction("type", event.currentTarget)} type="button">Type</button>
        <button className="ghost-button compact" disabled={disabled} onClick={() => sendCommand("key", "Enter")} type="button">Enter</button>
        <button className="ghost-button compact" disabled={disabled} onClick={() => sendCommand("key", "Tab")} type="button">Tab</button>
        <details className="repository-browser-key-menu" ref={moreRef}><summary aria-label="More browser keys">More</summary><div>{EXTRA_KEYS.map((key) => <button className="ghost-button compact" disabled={disabled} key={key} onClick={() => { sendCommand("key", key); if (moreRef.current) moreRef.current.open = false; }} type="button">{key.replace("Arrow", "Arrow ")}</button>)}</div></details>
        <button aria-label={browserState.actualSize ? "Fit browser to available space" : "Show browser at actual size"} aria-pressed={browserState.actualSize} className="ghost-button compact" disabled={disabled} onClick={() => sendCommand("scale", "toggle")} type="button">{browserState.actualSize ? "Fit" : "100%"}</button>
      </div>
    </div>
    {action ? <form className="repository-browser-action" id="repository-browser-action" onSubmit={submitAction} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAction(); } }}>
      <input aria-label={action === "navigate" ? "Page URL" : "Text to type in the browser"} autoComplete="off" inputMode={action === "navigate" ? "url" : "text"} onChange={(event) => action === "navigate" ? setAddress(event.target.value) : setText(event.target.value)} placeholder={action === "navigate" ? "https://app.example.com" : "Text for the focused field"} ref={actionInputRef} required type="text" value={action === "navigate" ? address : text} />
      <button className="primary-button compact" disabled={disabled || browserState.pending > 0} type="submit">{action === "navigate" ? "Go" : "Type"}</button>
      <button className="ghost-button compact" onClick={closeAction} type="button">Cancel</button>
    </form> : null}
    {browserState.error ? <div className="repository-browser-error" role="alert">{browserState.error}</div> : null}
    <div className="repository-browser-viewport" id="repository-browser-viewport" role="tabpanel" aria-label={selectedTab?.title || "Browser page"} aria-busy={isRefreshingTabs}>
      {frameUrl ? <iframe ref={iframeRef} src={frameUrl} title="Inspect browser live view" /> : <div className="empty-state compact">{emptyMessage || "Choose a local session or a remote browser to start inspecting this page."}</div>}
    </div>
  </div>;
}
