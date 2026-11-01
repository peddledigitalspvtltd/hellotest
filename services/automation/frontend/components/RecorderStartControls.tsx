import { IconSettings } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontalIcon, MousePointerIcon, PlugIcon, RecordIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { probePairedLocalAgent } from "@hellotest/agentic/frontend/lib/pairedLocalAgent";

export type RecorderStartMode = "local" | "remote";

export type RecorderStartOptions = {
  recorder_mode: RecorderStartMode;
  recorder_target?: "web" | "mobile";
  engine_base_url?: string;
  recorder_public_base_url?: string;
};

type LocalCheckState = "idle" | "checking" | "ready" | "failed";

const isMobileOrTablet = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent || "";
  const touchPoints = navigator.maxTouchPoints || 0;
  return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent) || touchPoints > 1;
};

export function RecorderStartControls({
  platform = "unified",
  disabled,
  isStarting,
  hasSession,
  onStart,
  localLabel = "Local Playwright",
  remoteLabel = "Remote browser",
  mobileRemoteEnabled = false,
  mobileAppiumEnabled = false,
  primaryAction,
  moreActions
}: {
  platform?: "web" | "api" | "android" | "ios" | "unified";
  disabled: boolean;
  isStarting: boolean;
  hasSession: boolean;
  onStart: (options: RecorderStartOptions) => void;
  localLabel?: string;
  remoteLabel?: string;
  mobileRemoteEnabled?: boolean;
  mobileAppiumEnabled?: boolean;
  primaryAction?: ReactNode;
  moreActions?: ReactNode;
}) {
  const localAvailable = useMemo(() => !isMobileOrTablet(), []);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [checkState, setCheckState] = useState<LocalCheckState>("idle");
  const [checkMessage, setCheckMessage] = useState("Check the paired browser on this computer before starting the recorder.");
  const checkGeneration = useRef(0);
  useEffect(() => () => { checkGeneration.current++; }, []);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [moreMenuStyle, setMoreMenuStyle] = useState<CSSProperties>({});
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const setupDialogRef = useDialogFocus<HTMLDivElement>({
    active: isSetupOpen,
    onClose: () => setIsSetupOpen(false)
  });
  const setupModalRoot = typeof document === "undefined" ? null : document.body;
  const overlayRoot = typeof document === "undefined" ? null : document.body;

  const updateMoreMenuPosition = () => {
    const trigger = moreButtonRef.current;
    if (!trigger || typeof window === "undefined") return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 24);
    const menuHeight = moreMenuRef.current?.offsetHeight || 280;
    const viewportPadding = 12;
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const shouldOpenAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, shouldOpenAbove ? spaceAbove - 8 : spaceBelow - 8);
    const top = shouldOpenAbove
      ? Math.max(viewportPadding, rect.top - Math.min(menuHeight, maxHeight) - 8)
      : Math.min(rect.bottom + 8, window.innerHeight - viewportPadding - Math.min(menuHeight, maxHeight));

    setMoreMenuStyle({ left, top, width, maxHeight, overflowY: "auto" });
  };

  const handleCheckSetup = async () => {
    const generation = ++checkGeneration.current;
    setCheckState("checking");
    setCheckMessage("Checking the paired browser on this computer…");
    try {
      await probePairedLocalAgent();
      if (generation !== checkGeneration.current) return false;
      setCheckState("ready"); setCheckMessage("The paired browser is ready to record on this computer."); return true;
    } catch (error) {
      if (generation !== checkGeneration.current) return false;
      setCheckState("failed"); setCheckMessage(error instanceof Error ? error.message : "Open Local agent setup to connect this computer."); return false;
    }
  };

  const handleStartLocal = async () => {
    if (!await handleCheckSetup()) { setIsSetupOpen(true); return; }
    onStart({ recorder_mode: "local", recorder_target: "web" });
    setIsSetupOpen(false);
  };

  useEffect(() => {
    if (!isMoreOpen) return undefined;

    updateMoreMenuPosition();
    const handleReposition = () => updateMoreMenuPosition();
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreButtonRef.current?.contains(target)) return;
      if (target instanceof HTMLElement && target.closest(".recorder-more-menu-popover")) return;
      setIsMoreOpen(false);
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMoreOpen]);

  if (platform === "api") return <p className="muted">Use the request editor to add API requests, assertions and response captures. Browser recording belongs to Web tests.</p>;
  if (platform === "android" || platform === "ios") return (
    <div className="recorder-control-pane">
      <p className="muted">{platform === "ios" ? "Connect an iOS device or simulator through an XCUITest host, or use a configured device cloud." : "Connect an Android device or emulator through Appium, or use a configured device cloud."}</p>
      <div className="testops-recorder-actions recorder-control-buttons">
        {mobileAppiumEnabled ? <button className="primary-button" disabled={disabled || isStarting || hasSession} onClick={() => onStart({ recorder_mode: "local", recorder_target: "mobile" })} type="button"><RecordIcon size={16} />{isStarting ? "Connecting…" : `Record on ${platform === "ios" ? "iOS" : "Android"} device`}</button> : null}
        {mobileAppiumEnabled && mobileRemoteEnabled ? <button className="ghost-button" disabled={disabled || isStarting || hasSession} onClick={() => onStart({ recorder_mode: "remote", recorder_target: "mobile" })} type="button"><RecordIcon size={16} />Record on device cloud</button> : null}
        {primaryAction}{moreActions}
      </div>
    </div>
  );

  return (
    <div className="recorder-control-pane">
      <div className="testops-recorder-actions recorder-control-buttons">
        {localAvailable ? (
          <button
            className="primary-button"
            disabled={disabled || isStarting || hasSession || checkState === "checking"}
            onClick={() => void handleStartLocal()}
            type="button"
          >
            <RecordIcon size={16} />
            <span>{isStarting ? "Starting..." : localLabel}</span>
          </button>
        ) : null}
        <button
          className={localAvailable ? "ghost-button" : "primary-button"}
          disabled={disabled || isStarting || hasSession}
          onClick={() => onStart({ recorder_mode: "remote", recorder_target: "web" })}
          type="button"
        >
          <RecordIcon size={16} />
          <span>{isStarting ? "Starting..." : remoteLabel}</span>
        </button>
        {primaryAction}
            {localAvailable ? (
              <>
                <button
                  className="ghost-button compact"
                  disabled={disabled || isStarting || hasSession || checkState === "checking"}
                  onClick={() => {
                    setIsMoreOpen(false);
                    void handleCheckSetup();
                  }}

                  type="button"
                >
                  <PlugIcon size={16} />
                  <span>{checkState === "checking" ? "Checking..." : checkState === "ready" ? "Local ready" : "Check local"}</span>
                </button>
                {moreActions}
                <button
                  className="ghost-button compact"
                  disabled={disabled || isStarting || hasSession}
                  onClick={() => {
                    setIsMoreOpen(false);
                    setIsSetupOpen(true);
                  }}

                  type="button"
                >
                  <IconSettings size={16} />
                  <span>Settings</span>
                </button>
              </>
            ) : null}
        <div className="recorder-more-menu" hidden={platform !== "unified" || !mobileAppiumEnabled}>
          <button
            aria-expanded={isMoreOpen}
            aria-haspopup="menu"
            aria-label="Choose recorder start mode"
            className="recorder-more-trigger"
            onClick={() => setIsMoreOpen((current) => !current)}
            ref={moreButtonRef}
            type="button"
          >
            <MoreHorizontalIcon size={18} />
          </button>
          {isMoreOpen && overlayRoot ? createPortal(
            <div className="recorder-more-menu-popover" ref={moreMenuRef} role="menu" style={moreMenuStyle}>
            {platform === "unified" && mobileAppiumEnabled ? (
              <button
                className="ghost-button"
                disabled={disabled || isStarting || hasSession}
                onClick={() => {
                  setIsMoreOpen(false);
                  onStart({ recorder_mode: "local", recorder_target: "mobile" });
                }}
                role="menuitem"
                type="button"
              >
                <MousePointerIcon size={16} />
                <span>{isStarting ? "Starting..." : "Mobile Appium"}</span>
              </button>
            ) : null}
            {platform === "unified" && mobileAppiumEnabled && mobileRemoteEnabled ? (
              <button
                className="ghost-button"
                disabled={disabled || isStarting || hasSession}
                onClick={() => {
                  setIsMoreOpen(false);
                  onStart({ recorder_mode: "remote", recorder_target: "mobile" });
                }}
                role="menuitem"
                type="button"
              >
                <MousePointerIcon size={16} />
                <span>{isStarting ? "Starting..." : "Mobile cloud"}</span>
              </button>
            ) : null}
            </div>,
            overlayRoot
          ) : null}
        </div>
      </div>

      {isSetupOpen && setupModalRoot ? createPortal(
        <div className="modal-backdrop" onClick={() => setIsSetupOpen(false)} role="presentation">
          <div
            aria-labelledby="local-recorder-setup-title"
            aria-modal="true"
            className="modal-card recorder-setup-modal"
            onClick={(event) => event.stopPropagation()}
            ref={setupDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="resource-modal-header">
              <div className="resource-modal-title">
                <div className="modal-title-info-row">
                  <h2 className="dialog-title" id="local-recorder-setup-title">Local recorder setup</h2>
                  <InfoTooltip
                    content="Use Local agent setup in HelloTest to pair the browser on this computer before recording."
                    label="Local recorder setup information"
                  />
                </div>
              </div>
              <DialogCloseButton label="Close local recorder setup" onClick={() => setIsSetupOpen(false)} />
            </div>

            <div className="detail-stack">
              <p>Open <strong>Local agent</strong> in the Automation workspace, run its setup command on this computer, and keep that terminal open. The same pairing supports inspection, recording and local execution.</p>
              <div className={checkState === "ready" ? "inline-message success-message" : checkState === "failed" ? "inline-message error-message" : "empty-state compact"}>
                <span>{checkMessage}</span>
              </div>
              <div className="testops-recorder-actions">
                <button className="ghost-button" disabled={checkState === "checking"} onClick={() => void handleCheckSetup()} type="button"><span>{checkState === "checking" ? "Checking…" : "Check paired browser"}</span></button>
              </div>
            </div>
          </div>
        </div>,
        setupModalRoot
      ) : null}
    </div>
  );
}
