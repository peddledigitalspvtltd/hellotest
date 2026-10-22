import { IconSettings } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontalIcon, MousePointerIcon, PlugIcon, RecordIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { automationApi } from "../api.client";

export type RecorderStartMode = "local" | "remote";

export type RecorderStartOptions = {
  recorder_mode: RecorderStartMode;
  recorder_target?: "web" | "mobile";
  engine_base_url?: string;
  recorder_public_base_url?: string;
};

type LocalCheckState = "idle" | "checking" | "ready" | "failed";

const DEFAULT_LOCAL_BROWSER_URL = "http://localhost:4313";
const DEFAULT_LOCAL_ENGINE_URL = "http://host.docker.internal:4313";
const DOCKER_LOCAL_BROWSER_URL = "http://localhost:4301";
const DOCKER_LOCAL_ENGINE_URL = "http://testengine:4301";

const isMobileOrTablet = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent || "";
  const touchPoints = navigator.maxTouchPoints || 0;
  return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent) || touchPoints > 1;
};

async function readJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed with status ${response.status}`);
  }

  return payload;
}

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
  const [localBrowserUrl, setLocalBrowserUrl] = useState(DEFAULT_LOCAL_BROWSER_URL);
  const [localEngineUrl, setLocalEngineUrl] = useState(DEFAULT_LOCAL_ENGINE_URL);
  const [checkState, setCheckState] = useState<LocalCheckState>("idle");
  const [checkMessage, setCheckMessage] = useState("Check your local Test Engine before starting the recorder.");
  const [isLaunchingAgent, setIsLaunchingAgent] = useState(false);
  const launchGeneration = useRef(0);
  useEffect(() => () => { launchGeneration.current++; }, []);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [moreMenuStyle, setMoreMenuStyle] = useState<CSSProperties>({});
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const setupDialogRef = useDialogFocus<HTMLDivElement>({
    active: isSetupOpen,
    onClose: () => setIsSetupOpen(false)
  });
  const normalizedBrowserUrl = localBrowserUrl.replace(/\/+$/, "");
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
    setCheckState("checking");
    setCheckMessage("Checking local Test Engine health and recorder capabilities...");

    try {
      const health = await readJson(`${normalizedBrowserUrl}/health`);
      const capabilities = await readJson(`${normalizedBrowserUrl}/api/v1/capabilities`);

      if (health?.ok !== true || !capabilities?.runner) {
        throw new Error("The local service responded, but it does not look like a HelloTest Test Engine.");
      }

      setCheckState("ready");
      setCheckMessage("Local Playwright recorder is ready. Start capture to learn objects, locators, steps, and network/API calls.");
      return true;
    } catch (error) {
      setCheckState("failed");
      setCheckMessage(error instanceof Error ? error.message : "Unable to reach the local Test Engine.");
      return false;
    }
  };

  const handleStartLocal = async () => {
    const isReady = checkState === "ready" || await handleCheckSetup();

    if (!isReady) {
      setIsSetupOpen(true);
      return;
    }

    onStart({
      recorder_mode: "local",
      recorder_target: "web",
      engine_base_url: localEngineUrl.trim() || DEFAULT_LOCAL_ENGINE_URL,
      recorder_public_base_url: normalizedBrowserUrl || DEFAULT_LOCAL_BROWSER_URL
    });
    setIsSetupOpen(false);
  };

  const handleLaunchLocalAgent = async () => {
    const generation = ++launchGeneration.current;
    setIsLaunchingAgent(true);
    setCheckState("checking");
    setCheckMessage("Requesting HelloTest local runner launch...");

    try {
      const result = await automationApi.localAgent.start({ target: "playwright" });
      if (launchGeneration.current !== generation) return;
      setCheckMessage(result.message || "Local runner launch requested.");
      if (!result.started && !result.already_running) {
        setCheckState("failed");
        return;
      }
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline && launchGeneration.current === generation) {
        const status = await automationApi.localAgent.status();
        if (launchGeneration.current !== generation) return;
        if (status.web.ready) {
          setLocalBrowserUrl(status.recommended.web_public_base_url || DEFAULT_LOCAL_BROWSER_URL);
          setLocalEngineUrl(status.web.base_url || DEFAULT_LOCAL_ENGINE_URL);
          setCheckState("ready");
          setCheckMessage("The local Playwright runner is ready. You can start recording or execute saved cases.");
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 2000));
      }
      if (launchGeneration.current === generation) {
        setCheckState("idle");
        setCheckMessage("The runner is still starting or needs attention. Check local-run/artifacts/host-recorder/launcher.log for installation progress and startup errors, then check the connection again.");
      }
    } catch (error) {
      if (launchGeneration.current !== generation) return;
      setCheckState("failed");
      setCheckMessage(error instanceof Error ? error.message : "Unable to request local runner launch.");
    } finally {
      if (launchGeneration.current === generation) setIsLaunchingAgent(false);
    }
  };

  const handleCheckAgentStatus = async () => {
    setCheckState("checking");
    setCheckMessage("Checking local Playwright, mobile engine, and Appium services...");

    try {
      const status = await automationApi.localAgent.status();
      const webReady = status.web.ready;
      const mobileReady = status.mobile.ready;
      const appiumReady = status.appium.ready;
      setLocalBrowserUrl(status.recommended.web_public_base_url || DEFAULT_LOCAL_BROWSER_URL);
      setCheckState(webReady ? "ready" : "failed");
      setCheckMessage([!webReady ? status.web.message : "",
        `Playwright ${webReady ? "ready" : "not reachable"}`,
        `Mobile engine ${mobileReady ? "ready" : "not reachable"}`,
        `Appium ${appiumReady ? "ready" : "not reachable"}`,
        status.launch_supported ? "one-click launch enabled" : "one-click launch disabled"
      ].join(" · "));
    } catch (error) {
      setCheckState("failed");
      setCheckMessage(error instanceof Error ? error.message : "Unable to check local runner services.");
    }
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
                  onStart({ recorder_mode: "local", recorder_target: "mobile", engine_base_url: "http://mobile-engine:4312", recorder_public_base_url: "http://localhost:4312" });
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
                    content="Run HelloTest local-run or a local Test Engine before recording on this computer."
                    label="Local recorder setup information"
                  />
                </div>
              </div>
              <DialogCloseButton label="Close local recorder setup" onClick={() => setIsSetupOpen(false)} />
            </div>

            <div className="detail-stack">
              <div className="empty-state compact">
                <span className="recorder-setup-copy-title-row">
                  <strong>Local setup</strong>
                  <InfoTooltip
                    content="Use Start local runner when HelloTest API is installed on this machine with HELLOTEST_ALLOW_LOCAL_AGENT_LAUNCH=true. It runs the fixed HelloTest script, uses the packaged recorder when available, or installs npm/Playwright packages and starts the local Playwright service."
                    label="Local setup information"
                  />
                </span>
              </div>
              <div className="empty-state compact">
                <span className="recorder-setup-copy-title-row">
                  <strong>Docker fallback</strong>
                  <InfoTooltip
                    content={`If one-click launch is disabled, run cd local-run, cp .env.example .env, then bin/start-host-recorder.sh on macOS/Linux or bin\\start-host-recorder.cmd on Windows. For Docker live view, use browser URL ${DOCKER_LOCAL_BROWSER_URL} and API/container URL ${DOCKER_LOCAL_ENGINE_URL}.`}
                    label="Docker fallback information"
                  />
                </span>
              </div>
              <label className="form-field">
                <span>Browser recorder URL</span>
                <input data-autofocus="true" value={localBrowserUrl} onChange={(event) => setLocalBrowserUrl(event.target.value)} />
              </label>
              <label className="form-field">
                <span>API/container engine URL</span>
                <input value={localEngineUrl} onChange={(event) => setLocalEngineUrl(event.target.value)} />
              </label>
              <div className={checkState === "ready" ? "inline-message success-message" : checkState === "failed" ? "inline-message error-message" : "empty-state compact"}>
                <span>{checkMessage}</span>
              </div>
              <div className="testops-recorder-actions">
                <button className="ghost-button" disabled={isLaunchingAgent || checkState === "checking"} onClick={() => void handleLaunchLocalAgent()} type="button">
                  <span>{isLaunchingAgent ? "Starting runner..." : "Start local runner"}</span>
                </button>
                <button className="ghost-button" disabled={checkState === "checking"} onClick={() => void handleCheckAgentStatus()} type="button">
                  <span>{checkState === "checking" ? "Checking..." : "Check all services"}</span>
                </button>
                <button className="ghost-button" disabled={checkState === "checking"} onClick={() => void handleCheckSetup()} type="button">
                  <span>{checkState === "checking" ? "Checking..." : "Check setup"}</span>
                </button>
                <button className="primary-button" disabled={checkState !== "ready" || disabled || isStarting || hasSession} onClick={() => void handleStartLocal()} type="button">
                  <span>{isStarting ? "Starting..." : "Start local Playwright"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        setupModalRoot
      ) : null}
    </div>
  );
}
