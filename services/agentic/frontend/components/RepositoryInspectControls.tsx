import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconCloud, IconDeviceDesktop, IconPlugConnected } from "@tabler/icons-react";
import { CopyIcon, RefreshIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useSplitActionMenu } from "@hellotest/platform/frontend/src/shared/hooks/useSplitActionMenu";
import type { useRepositoryInspectAgent } from "../hooks/useRepositoryInspectAgent";
import "./ObjectRepositoryInspector.css";

export type InspectSessionMode = "local" | "remote";
type AgentConnection = ReturnType<typeof useRepositoryInspectAgent>;

export function RepositoryAgentStatus({ connection }: { connection: AgentConnection }) {
  const label = connection.state === "connected" ? "Connected" : connection.state === "checking" ? "Checking…" : connection.state === "unchecked" ? "Not checked" : "Not connected";
  return <button className={`ghost-button repository-agent-status ${connection.state === "connected" ? "is-connected" : ""}`} onClick={connection.openSetup} type="button" aria-label={`Local agent: ${label}. Setup and connection status`}>
    <IconPlugConnected size={16} /><span>Local agent</span><span className="repository-agent-status-dot" aria-hidden="true" /><small>{label}</small>
  </button>;
}

export function RepositoryAgentSetup({ connection, onUseRemote }: { connection: AgentConnection; onUseRemote?: () => void }) {
  const [platform, setPlatform] = useState<"shell" | "windows">(() => /Win/i.test(navigator.platform) ? "windows" : "shell");
  const [copyMessage, setCopyMessage] = useState("");
  const dialogRef = useDialogFocus<HTMLDivElement>({ active: connection.setupOpen, onClose: () => connection.setSetupOpen(false) });
  if (!connection.setupOpen) return null;
  const command = platform === "windows" ? connection.windowsCommand : connection.command;
  return createPortal(<div className="modal-backdrop repository-agent-setup-backdrop" role="presentation">
    <div className="modal-card repository-agent-setup" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="repository-agent-setup-title" tabIndex={-1}>
      <header className="dialog-header"><div><h2 id="repository-agent-setup-title">Connect local inspection agent</h2><p>Inspect private apps and use a visible browser on this computer.</p></div><DialogCloseButton label="Close local agent setup" onClick={() => connection.setSetupOpen(false)} /></header>
      <div className="repository-agent-setup-body">
        <div className={`repository-agent-connection ${connection.state === "connected" ? "is-connected" : ""}`} role="status"><IconPlugConnected size={20} /><div><strong>{connection.state === "connected" ? "Agent connected" : connection.state === "checking" ? "Checking agent…" : "Agent not connected"}</strong><p>{connection.message}</p></div></div>
        <ol><li>Open a terminal on this computer with Node.js 20 or newer and npm installed.</li><li>Run this command. It downloads the HelloTest agent, installs Playwright and Chromium, and starts a browser you can inspect.</li></ol>
        <div className="repository-agent-command-heading"><label>Terminal<select value={platform} onChange={event => { setPlatform(event.target.value as "shell" | "windows"); setCopyMessage(""); }}><option value="shell">macOS / Linux</option><option value="windows">Windows PowerShell</option></select></label><button className="ghost-button compact" disabled={!command || connection.preparingSetup || Boolean(connection.setupError)} onClick={async () => { try { await navigator.clipboard.writeText(command); setCopyMessage("Command copied"); } catch { setCopyMessage("Select and copy the command below."); } }} type="button"><CopyIcon size={14} />Copy command</button></div>
        {connection.preparingSetup ? <p role="status">Preparing your paired setup command…</p> : connection.setupError ? <div role="alert"><p>{connection.setupError}</p><button className="ghost-button compact" onClick={() => void connection.prepareSetup()} type="button">Retry setup command</button></div> : <pre className="repository-agent-command" tabIndex={0}><code>{command}</code></pre>}
        {copyMessage ? <span role="status">{copyMessage}</span> : null}
        <p className="repository-agent-setup-note">Keep the terminal open. This command pairs the agent with this browser and allows this workspace’s address. Allow local network access if your browser asks. You can use a remote browser without installing an agent.</p>
        {connection.state === "disconnected" ? <p className="repository-agent-setup-note">If another HelloTest agent is already running on port 4311, stop that agent before running this page’s command. An agent paired with localhost does not automatically allow a hosted workspace.</p> : null}
        {connection.expiresAt ? <p>The download link expires {new Date(connection.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Reopen this panel to get a fresh command.</p> : null}
      </div>
      <footer className="dialog-actions">{onUseRemote ? <button className="ghost-button repository-agent-remote-option" onClick={() => { connection.pauseChecks(); onUseRemote(); }} type="button"><IconCloud size={15} />Use remote browser</button> : null}<button className="ghost-button" onClick={() => connection.setSetupOpen(false)} type="button">Done</button><button className="primary-button" disabled={connection.state === "checking"} onClick={() => void connection.check()} type="button"><RefreshIcon size={15} />{connection.state === "checking" ? "Checking…" : "Check connection"}</button></footer>
    </div>
  </div>, document.body);
}

export function RepositoryInspectSessionControls({ mode, recommendedMode, remoteAvailable, remoteReason, localConnected, busy, disabled = false, running, onStart, onClose, onSetup }: {
  mode: InspectSessionMode;
  recommendedMode: InspectSessionMode;
  remoteAvailable: boolean;
  remoteReason?: string | null;
  localConnected: boolean;
  busy: boolean;
  disabled?: boolean;
  running: boolean;
  onStart: (mode: InspectSessionMode) => void;
  onClose: () => void;
  onSetup: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { menuStyle } = useSplitActionMenu(open, rootRef, menuRef);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); toggleRef.current?.focus({ preventScroll: true }); }
      else if (event.key === "Tab" && menuRef.current?.contains(event.target as Node)) { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); toggleRef.current?.focus({ preventScroll: true }); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && menuRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        const items = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    window.addEventListener("keydown", onKey, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("focusin", closeOutside); window.removeEventListener("keydown", onKey, true); };
  }, [open]);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  const choice = running ? mode : recommendedMode;
  return <div className="repository-session-controls">
    <div className="repository-session-split" ref={rootRef}>
      <button className="ghost-button compact" disabled={disabled || busy || (!running && choice === "remote" && !remoteAvailable)} onClick={() => running ? onClose() : onStart(choice)} type="button" title={!running && choice === "remote" ? remoteReason || "Start a browser in the Test Engine" : undefined}>
        {choice === "local" ? <IconDeviceDesktop size={16} /> : <IconCloud size={16} />}<span>{busy ? "Connecting…" : running ? "Close browser" : choice === "local" ? "Local session" : "Remote browser"}</span>
      </button>
      <button className="ghost-button compact repository-session-toggle" ref={toggleRef} disabled={disabled || busy || running} aria-label="Choose inspection browser session" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} id={`${menuId}-trigger`} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }} type="button"><IconChevronDown size={14} /></button>
    </div>
    {open ? createPortal(<div className="repository-session-menu" role="listbox" aria-label="Inspection browser sessions" id={menuId} ref={menuRef} style={menuStyle} data-dialog-popover-owner={`${menuId}-trigger`}>
      <button role="option" aria-selected={choice === "local"} onClick={() => { setOpen(false); if (localConnected) onStart("local"); else onSetup(); }} type="button"><IconDeviceDesktop size={18} /><span><strong>Local session {localConnected ? <small>Recommended</small> : null}</strong><span>{localConnected ? "Use your connected agent and local network." : "Connect the agent on this computer."}</span></span></button>
      <button role="option" aria-selected={choice === "remote"} disabled={!remoteAvailable} onClick={() => { setOpen(false); onStart("remote"); }} type="button"><IconCloud size={18} /><span><strong>Remote browser session {!localConnected && remoteAvailable ? <small>Recommended</small> : null}</strong><span>{remoteAvailable ? "Use the workspace Test Engine. No local setup." : remoteReason || "Remote browser is not available."}</span></span></button>
    </div>, document.body) : null}
  </div>;
}
