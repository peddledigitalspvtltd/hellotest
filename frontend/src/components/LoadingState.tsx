import { useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./LoadingState.css";

type LoadingMessage = { label: string; description?: string };

const SHOW_DELAY_MS = 160;
const MIN_VISIBLE_MS = 2_000;
// Keep this in sync with the opacity transition in LoadingState.css.
const FADE_OUT_MS = 180;

const activeLoaders = new Map<symbol, LoadingMessage>();
let overlayRoot: Root | null = null;
let overlayContainer: HTMLDivElement | null = null;
let visibleSince: number | null = null;
let showTimer: number | undefined;
let holdTimer: number | undefined;
let fadeTimer: number | undefined;
let lastMessage: LoadingMessage = { label: "Loading" };

function cancelDismissal() {
  window.clearTimeout(holdTimer);
  window.clearTimeout(fadeTimer);
  holdTimer = fadeTimer = undefined;
}

function removeIndicator() {
  const root = overlayRoot;
  const container = overlayContainer;
  overlayRoot = overlayContainer = null;
  visibleSince = null;
  lastMessage = { label: "Loading" };
  // Called from a timer, after the requesting components have committed.
  root?.unmount();
  container?.remove();
}

function finishLoading() {
  cancelDismissal();
  if (visibleSince === null) return;
  holdTimer = window.setTimeout(() => {
    holdTimer = undefined;
    if (activeLoaders.size) return;
    renderIndicator(true);
    fadeTimer = window.setTimeout(() => {
      fadeTimer = undefined;
      if (!activeLoaders.size) removeIndicator();
    }, FADE_OUT_MS);
  }, Math.max(0, MIN_VISIBLE_MS - (performance.now() - visibleSince)));
}

function onIndicatorVisible() {
  // Start the minimum at the actual DOM commit, not at request registration.
  if (visibleSince === null) visibleSince = performance.now();
  if (!activeLoaders.size) finishLoading();
}

function renderIndicator(exiting = false) {
  if (!overlayRoot) {
    // The presentation must survive the final LoadingState unmounting. A small
    // independent root also keeps standalone pages and the admin app covered.
    // Its body-level host avoids transformed dialogs becoming the fixed parent.
    overlayContainer = document.createElement("div");
    overlayContainer.dataset.loadingHost = "";
    document.body.appendChild(overlayContainer);
    overlayRoot = createRoot(overlayContainer);
  }
  const message = activeLoaders.values().next().value;
  if (message) lastMessage = message;
  overlayRoot.render(<LoadingIndicator {...lastMessage} exiting={exiting} />);
}

function registerLoader(id: symbol, message: LoadingMessage) {
  // Register immediately so a new request cancels a pending fade without
  // waiting for another display delay or resetting the original minimum.
  activeLoaders.set(id, message);
  cancelDismissal();
  if (overlayRoot) {
    renderIndicator();
  } else if (showTimer === undefined) {
    showTimer = window.setTimeout(() => {
      showTimer = undefined;
      if (activeLoaders.size) renderIndicator();
    }, SHOW_DELAY_MS);
  }
}

function unregisterLoader(id: symbol) {
  activeLoaders.delete(id);
  if (activeLoaders.size) {
    if (overlayRoot) renderIndicator();
    return;
  }
  window.clearTimeout(showTimer);
  showTimer = undefined;
  if (overlayRoot) finishLoading();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.clearTimeout(showTimer);
    cancelDismissal();
    activeLoaders.clear();
    removeIndicator();
  });
}

export function LoadingState({
  label = "Loading",
  description
}: {
  label?: string;
  description?: string;
}) {
  const [id] = useState(() => Symbol("loading"));

  useLayoutEffect(() => {
    registerLoader(id, { label, description });
    return () => unregisterLoader(id);
  }, [id]);

  useLayoutEffect(() => {
    activeLoaders.set(id, { label, description });
    if (overlayRoot) renderIndicator();
  }, [id, label, description]);

  return null;
}

function LoadingIndicator({ label, description, exiting }: LoadingMessage & { exiting: boolean }) {
  useLayoutEffect(onIndicatorVisible, []);

  return (
    <div aria-atomic="true" aria-label={label} aria-live="polite" className={`screen-loading-overlay${exiting ? " is-exiting" : ""}`} role="status">
      <svg aria-hidden="true" className="screen-loading-ring" viewBox="0 0 240 240" fill="none">
        <g className="screen-loading-orbit is-blue"><ellipse cx="120" cy="120" rx="99" ry="112" stroke="#4135db" strokeWidth="9" /></g>
        <g className="screen-loading-orbit is-purple"><ellipse cx="120" cy="120" rx="105" ry="99" stroke="#913fc5" strokeWidth="8" /></g>
        <g className="screen-loading-orbit is-gold"><ellipse cx="120" cy="120" rx="109" ry="98" stroke="#c6ac44" strokeWidth="8" /></g>
        <g className="screen-loading-orbit is-green"><ellipse cx="120" cy="120" rx="113" ry="97" stroke="#50ad83" strokeWidth="8" /></g>
        <g className="screen-loading-orbit is-red"><ellipse cx="120" cy="120" rx="98" ry="109" stroke="#e9564d" strokeWidth="9" /></g>
        <g className="screen-loading-orbit is-white"><ellipse cx="120" cy="120" rx="97" ry="114" stroke="#ffffff" strokeWidth="10" /></g>
      </svg>
      <span aria-hidden="true" className="screen-loading-label">Loading</span>
      <span className="screen-loading-description">{label}{description ? `. ${description}` : ""}</span>
    </div>
  );
}
