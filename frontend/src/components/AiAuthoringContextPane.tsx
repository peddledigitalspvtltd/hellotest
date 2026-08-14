import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { ChevronRightIcon } from "./AppIcons";

export const AI_AUTHORING_CONTEXT_PANE_MIN_WIDTH = 280;
export const AI_AUTHORING_CONTEXT_PANE_MAX_WIDTH = 480;
export const AI_AUTHORING_CONTEXT_PANE_DEFAULT_WIDTH = 332;

// Keep the existing Story studio preference so all authoring modes inherit
// the same context-pane width without invalidating a user's saved layout.
const AI_AUTHORING_CONTEXT_PANE_STORAGE_KEY = "qaira:story-ai-context-pane-width:v1";

const clampContextPaneWidth = (value: number) =>
  Math.min(
    AI_AUTHORING_CONTEXT_PANE_MAX_WIDTH,
    Math.max(AI_AUTHORING_CONTEXT_PANE_MIN_WIDTH, Math.round(value))
  );

const readContextPaneWidth = () => {
  if (typeof window === "undefined") {
    return AI_AUTHORING_CONTEXT_PANE_DEFAULT_WIDTH;
  }

  try {
    const storedValue = Number(window.localStorage.getItem(AI_AUTHORING_CONTEXT_PANE_STORAGE_KEY));
    return Number.isFinite(storedValue)
      ? clampContextPaneWidth(storedValue)
      : AI_AUTHORING_CONTEXT_PANE_DEFAULT_WIDTH;
  } catch {
    return AI_AUTHORING_CONTEXT_PANE_DEFAULT_WIDTH;
  }
};

export function useAiAuthoringContextPaneWidth() {
  const [width, setWidthState] = useState(readContextPaneWidth);
  const setWidth = (nextWidth: number) => setWidthState(clampContextPaneWidth(nextWidth));

  useEffect(() => {
    try {
      window.localStorage.setItem(AI_AUTHORING_CONTEXT_PANE_STORAGE_KEY, String(width));
    } catch {
      // The pane still resizes for the current session when storage is blocked.
    }
  }, [width]);

  return {
    width,
    setWidth,
    style: { "--ai-authoring-context-pane-width": `${width}px` } as CSSProperties
  };
}

export function AiAuthoringContextPaneToggle({
  isCollapsed,
  onToggle
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const actionLabel = isCollapsed ? "Expand AI context pane" : "Collapse AI context pane";

  return (
    <button
      aria-expanded={!isCollapsed}
      aria-label={actionLabel}
      className={`ghost-button ai-studio-sidebar-toggle ai-authoring-context-pane-toggle${isCollapsed ? "" : " is-expanded"}`}
      onClick={onToggle}
      title={actionLabel}
      type="button"
    >
      <ChevronRightIcon size={17} />
    </button>
  );
}

export function AiAuthoringContextPaneHeading({
  description,
  icon,
  onCollapse,
  title
}: {
  description: string;
  icon: ReactNode;
  onCollapse: () => void;
  title: string;
}) {
  return (
    <div className="ai-authoring-context-pane-heading">
      <span className="ai-authoring-context-pane-heading-icon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <AiAuthoringContextPaneToggle isCollapsed={false} onToggle={onCollapse} />
    </div>
  );
}

export function AiAuthoringSidebarSectionHeading({
  description,
  icon,
  title
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="ai-authoring-sidebar-section-heading">
      <span className="ai-authoring-sidebar-section-heading-icon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}

export function AiAuthoringContextPaneResizer({
  onWidthChange,
  width
}: {
  onWidthChange: (width: number) => void;
  width: number;
}) {
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    onWidthChange(resizeState.startWidth + event.clientX - resizeState.startX);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const resizeStep = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidthChange(width - resizeStep);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidthChange(width + resizeStep);
    } else if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(AI_AUTHORING_CONTEXT_PANE_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      onWidthChange(AI_AUTHORING_CONTEXT_PANE_MAX_WIDTH);
    }
  };

  return (
    <div
      aria-label="Resize AI context pane"
      aria-orientation="vertical"
      aria-valuemax={AI_AUTHORING_CONTEXT_PANE_MAX_WIDTH}
      aria-valuemin={AI_AUTHORING_CONTEXT_PANE_MIN_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      className="ai-authoring-context-pane-resizer"
      onDoubleClick={() => onWidthChange(AI_AUTHORING_CONTEXT_PANE_DEFAULT_WIDTH)}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={() => {
        resizeRef.current = null;
      }}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      role="separator"
      tabIndex={0}
      title="Drag to resize AI context. Double-click to reset."
    >
      <span aria-hidden="true" />
    </div>
  );
}
