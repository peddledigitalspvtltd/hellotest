import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MousePointerIcon, PlayIcon, PlugIcon } from "./AppIcons";

export type RecorderStartMode = "local" | "remote";

export type RecorderStartOptions = {
  recorder_mode: RecorderStartMode;
  recorder_target?: "web" | "mobile";
  engine_base_url?: string;
  recorder_public_base_url?: string;
};

type LocalCheckState = "idle" | "checking" | "ready" | "failed";

const DEFAULT_LOCAL_BROWSER_URL = "http://localhost:4311";
const DEFAULT_LOCAL_ENGINE_URL = "http://host.docker.internal:4311";
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
  disabled,
  isStarting,
  hasSession,
  onStart,
  localLabel = "Start local recorder",
  remoteLabel = "Start remote recorder",
  mobileRemoteEnabled = false
}: {
  disabled: boolean;
  isStarting: boolean;
  hasSession: boolean;
  onStart: (options: RecorderStartOptions) => void;
  localLabel?: string;
  remoteLabel?: string;
  mobileRemoteEnabled?: boolean;
}) {
  const localAvailable = useMemo(() => !isMobileOrTablet(), []);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [localBrowserUrl, setLocalBrowserUrl] = useState(DEFAULT_LOCAL_BROWSER_URL);
  const [localEngineUrl, setLocalEngineUrl] = useState(DEFAULT_LOCAL_ENGINE_URL);
  const [checkState, setCheckState] = useState<LocalCheckState>("idle");
  const [checkMessage, setCheckMessage] = useState("Check your local Test Engine before starting the recorder.");
  const normalizedBrowserUrl = localBrowserUrl.replace(/\/+$/, "");
  const setupModalRoot = typeof document === "undefined" ? null : document.body;

  const handleCheckSetup = async () => {
    setCheckState("checking");
    setCheckMessage("Checking local Test Engine health and recorder capabilities...");

    try {
      const health = await readJson(`${normalizedBrowserUrl}/health`);
      const capabilities = await readJson(`${normalizedBrowserUrl}/api/v1/capabilities`);

      if (health?.ok !== true || !capabilities?.runner) {
        throw new Error("The local service responded, but it does not look like a QAira Test Engine.");
      }

      setCheckState("ready");
      setCheckMessage("Local recorder setup is ready. Start the recorder to capture UI actions, locators, and network/API calls.");
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

  return (
    <div className="recorder-control-pane">
      <div className="recorder-control-pane-head">
        <span className="recorder-control-icon">
          <MousePointerIcon size={16} />
        </span>
        <div>
          <strong>Recorder controls</strong>
          <span>{hasSession ? "Capture is active" : checkState === "ready" ? "Local recorder service ready" : "Check local service or use remote capture"}</span>
        </div>
      </div>
      <div className="testops-recorder-actions recorder-control-buttons">
        {localAvailable ? (
          <>
            <button
              className="ghost-button"
              disabled={disabled || isStarting || hasSession || checkState === "checking"}
              onClick={() => void handleCheckSetup()}
              type="button"
            >
              <PlugIcon size={16} />
              <span>{checkState === "checking" ? "Checking..." : checkState === "ready" ? "Service ready" : "Check service"}</span>
            </button>
            <button
              className="primary-button"
              disabled={disabled || isStarting || hasSession || checkState === "checking"}
              onClick={() => void handleStartLocal()}
              type="button"
            >
              <PlayIcon size={16} />
              <span>{isStarting ? "Starting..." : localLabel}</span>
            </button>
            <button
              className="ghost-button"
              disabled={disabled || isStarting || hasSession}
              onClick={() => setIsSetupOpen(true)}
              type="button"
            >
              <PlugIcon size={16} />
              <span>Setup</span>
            </button>
          </>
        ) : null}
        <button
          className={localAvailable ? "ghost-button" : "primary-button"}
          disabled={disabled || isStarting || hasSession}
          onClick={() => onStart({ recorder_mode: "remote", recorder_target: "web" })}
          type="button"
        >
          <MousePointerIcon size={16} />
          <span>{isStarting ? "Starting..." : remoteLabel}</span>
        </button>
        <button
          className="ghost-button"
          disabled={disabled || isStarting || hasSession}
          onClick={() => onStart({ recorder_mode: "local", recorder_target: "mobile", engine_base_url: "http://mobile-engine:4312", recorder_public_base_url: "http://localhost:4312" })}
          type="button"
        >
          <MousePointerIcon size={16} />
          <span>{isStarting ? "Starting..." : "Mobile local"}</span>
        </button>
        {mobileRemoteEnabled ? (
          <button
            className="ghost-button"
            disabled={disabled || isStarting || hasSession}
            onClick={() => onStart({ recorder_mode: "remote", recorder_target: "mobile" })}
            type="button"
          >
            <MousePointerIcon size={16} />
            <span>{isStarting ? "Starting..." : "Mobile remote"}</span>
          </button>
        ) : null}
      </div>

      {isSetupOpen && setupModalRoot ? createPortal(
        <div className="modal-backdrop" onClick={() => setIsSetupOpen(false)} role="presentation">
          <div
            aria-modal="true"
            className="modal-card recorder-setup-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="resource-modal-header">
              <div className="resource-modal-title">
                <h3>Local recorder setup</h3>
                <p>Run QAira local-run or a local Test Engine before recording on this computer.</p>
              </div>
              <button className="ghost-button" onClick={() => setIsSetupOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="detail-stack">
              <div className="empty-state compact">
                <strong>Local setup</strong>
                <span>For a visible local browser, run cd local-run, cp .env.example .env, then bin/start-host-recorder.sh on macOS/Linux or bin\start-host-recorder.cmd on Windows. Packaged Windows installs can run qaira-host-recorder.exe without sharing source files.</span>
              </div>
              <div className="empty-state compact">
                <strong>Docker fallback</strong>
                <span>If you want the embedded Docker live view instead, use browser URL {DOCKER_LOCAL_BROWSER_URL} and API/container URL {DOCKER_LOCAL_ENGINE_URL}.</span>
              </div>
              <label className="form-field">
                <span>Browser recorder URL</span>
                <input value={localBrowserUrl} onChange={(event) => setLocalBrowserUrl(event.target.value)} />
              </label>
              <label className="form-field">
                <span>API/container engine URL</span>
                <input value={localEngineUrl} onChange={(event) => setLocalEngineUrl(event.target.value)} />
              </label>
              <div className={checkState === "ready" ? "inline-message success-message" : checkState === "failed" ? "inline-message error-message" : "empty-state compact"}>
                <span>{checkMessage}</span>
              </div>
              <div className="testops-recorder-actions">
                <button className="ghost-button" disabled={checkState === "checking"} onClick={() => void handleCheckSetup()} type="button">
                  <span>{checkState === "checking" ? "Checking..." : "Check setup"}</span>
                </button>
                <button className="primary-button" disabled={checkState !== "ready" || disabled || isStarting || hasSession} onClick={() => void handleStartLocal()} type="button">
                  <span>{isStarting ? "Starting..." : "Start local recorder"}</span>
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
