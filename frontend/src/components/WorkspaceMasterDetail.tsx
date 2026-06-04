import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export function WorkspaceMasterDetail({
  browseView,
  className = "",
  detailView,
  isDetailOpen,
  variant = "switch"
}: {
  browseView: ReactNode;
  className?: string;
  detailView: ReactNode;
  isDetailOpen: boolean;
  variant?: "switch" | "split";
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflowingBrowseView, setHasOverflowingBrowseView] = useState(false);

  useEffect(() => {
    if (isDetailOpen) {
      setHasOverflowingBrowseView(false);
      return;
    }

    const updateOverflowState = () => {
      if (!panelRef.current) {
        setHasOverflowingBrowseView(false);
        return;
      }

      const availableHeight = Math.max(window.innerHeight - 160, 320);
      const contentHeight = panelRef.current.getBoundingClientRect().height;

      setHasOverflowingBrowseView(contentHeight > availableHeight);
    };

    updateOverflowState();

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            updateOverflowState();
          })
        : null;

    if (resizeObserver && panelRef.current) {
      resizeObserver.observe(panelRef.current);
    }

    window.addEventListener("resize", updateOverflowState);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverflowState);
    };
  }, [isDetailOpen]);

  const handleJumpToTop = () => {
    if (!rootRef.current) {
      return;
    }

    const workspaceMain = rootRef.current.closest(".workspace-main");

    if (workspaceMain instanceof HTMLElement && workspaceMain.scrollHeight > workspaceMain.clientHeight) {
      const workspaceRect = workspaceMain.getBoundingClientRect();
      const rootRect = rootRef.current.getBoundingClientRect();

      workspaceMain.scrollTo({
        top: Math.max(workspaceMain.scrollTop + rootRect.top - workspaceRect.top - 12, 0),
        behavior: "auto"
      });
      return;
    }

    const rootTop = window.scrollY + rootRef.current.getBoundingClientRect().top - 12;

    window.scrollTo({
      top: Math.max(rootTop, 0),
      behavior: "auto"
    });
  };

  if (variant === "split") {
    return (
      <div className={["workspace-master-detail workspace-master-detail--split", isDetailOpen ? "is-detail-open" : "is-browse-open", className].filter(Boolean).join(" ")} ref={rootRef}>
        <div className="workspace-master-detail-panel workspace-master-detail-browse-panel" ref={panelRef}>
          {browseView}
        </div>
        <div className="workspace-master-detail-panel workspace-master-detail-detail-panel">
          {detailView}
        </div>
      </div>
    );
  }

  return (
    <div className={["workspace-master-detail", isDetailOpen ? "is-detail-open" : "is-browse-open", className].filter(Boolean).join(" ")} ref={rootRef}>
      <div className="workspace-master-detail-panel" ref={panelRef}>
        {isDetailOpen ? detailView : browseView}
      </div>
      {!isDetailOpen && hasOverflowingBrowseView ? (
        <div className="workspace-master-detail-topbar">
          <button
            aria-label="Jump to the top of the list"
            className="workspace-master-detail-topbar-button ghost-button"
            onClick={handleJumpToTop}
            title="Jump to top"
            type="button"
          >
            <WorkspaceTopArrowIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceBackButton({
  label,
  onClick
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-label={label} className="ghost-button workspace-back-button" onClick={onClick} title="Back" type="button">
      <WorkspaceBackIcon />
      <span>Back</span>
    </button>
  );
}

function WorkspaceBackIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </svg>
  );
}

function WorkspaceTopArrowIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <path d="m18 15-6-6-6 6" />
      <path d="M12 9v9" />
    </svg>
  );
}
