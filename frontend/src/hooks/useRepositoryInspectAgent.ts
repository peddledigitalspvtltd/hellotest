import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export type RepositoryLocalAgent = { publicBaseUrl: string; token: string };
export type RepositoryAgentState = "unchecked" | "checking" | "connected" | "disconnected";
const AGENT_BASE_URL = "http://127.0.0.1:4311";
const TOKEN_KEY = "hellotest.repository-inspection.agent-token.v1";

export function useRepositoryInspectAgent(enabled: boolean, projectId: string) {
  const [state, setState] = useState<RepositoryAgentState>("unchecked");
  const [agent, setAgent] = useState<RepositoryLocalAgent | null>(null);
  const [message, setMessage] = useState("Connect the inspection agent on this computer to use a local browser.");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<{ download_url: string; expires_at: string; projectId: string } | null>(null);
  const [setupError, setSetupError] = useState("");
  const [preparingSetup, setPreparingSetup] = useState(false);
  const [optedIn, setOptedIn] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const setupControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const scopeRef = useRef({ enabled, projectId });
  scopeRef.current = { enabled, projectId };
  const tokenRef = useRef("");

  const isCurrentScope = useCallback(() => mountedRef.current && enabled && Boolean(projectId)
    && scopeRef.current.enabled === enabled && scopeRef.current.projectId === projectId, [enabled, projectId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      setupControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    setupControllerRef.current?.abort();
    setAgent(null);
    setState("unchecked");
    setMessage("Connect the inspection agent on this computer to use a local browser.");
    setSetup(null);
    setSetupError("");
    setPreparingSetup(false);
    setSetupOpen(false);
    setOptedIn(false);
    return () => {
      controllerRef.current?.abort();
      setupControllerRef.current?.abort();
    };
  }, [enabled, projectId]);

  const ensureToken = useCallback(() => {
    if (tokenRef.current) return tokenRef.current;
    let saved = "";
    try { saved = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* Memory pairing works when storage is unavailable. */ }
    if (!/^[a-f0-9]{64}$/.test(saved)) {
      saved = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");
      try { localStorage.setItem(TOKEN_KEY, saved); } catch { /* Keep this tab's pairing token. */ }
    }
    tokenRef.current = saved;
    return saved;
  }, []);

  const check = useCallback(async (silent = false): Promise<RepositoryLocalAgent | null> => {
    if (!isCurrentScope()) return null;
    const pairingToken = ensureToken();
    setOptedIn(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (!silent) setState("checking");
    try {
      const response = await fetch(`${AGENT_BASE_URL}/api/v1/recorder/agent/status`, {
        cache: "no-store", credentials: "omit",
        headers: { "X-HelloTest-Agent-Token": pairingToken },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3500)])
      });
      const status = await response.json().catch(() => null);
      if (!response.ok || status?.ready !== true || status?.service !== "hellotest-inspection-agent" || status?.protocol_version !== 1) {
        throw new Error(response.status === 401 || response.status === 403
          ? "The agent is not paired with this workspace. Restart it with the command below."
          : status?.message || "The agent responded but its inspection browser is not ready. Restart it with the command below.");
      }
      if (controller.signal.aborted || !isCurrentScope()) return null;
      const connected = { publicBaseUrl: AGENT_BASE_URL, token: pairingToken };
      setAgent(connected);
      setState("connected");
      setMessage("Connected to the paired inspection agent on this computer. Local session is recommended.");
      return connected;
    } catch (error) {
      if (controller.signal.aborted || !isCurrentScope()) return null;
      setAgent(null);
      setState("disconnected");
      setMessage(error instanceof Error && !["TypeError", "TimeoutError"].includes(error.name)
        ? error.message
        : "Local agent is not reachable. Run the setup command, allow local network access in your browser if prompted, then check again.");
      return null;
    }
  }, [isCurrentScope, ensureToken]);

  const prepareSetup = useCallback(async () => {
    if (!isCurrentScope()) return;
    setupControllerRef.current?.abort();
    const controller = new AbortController();
    setupControllerRef.current = controller;
    const isCurrentRequest = () => !controller.signal.aborted && isCurrentScope() && setupControllerRef.current === controller;
    setPreparingSetup(true);
    setSetup(null);
    setSetupError("");
    try {
      const result = await api.repositoryInspection.localAgentSetup({ project_id: projectId, origin: window.location.origin, agent_token: ensureToken() }, { signal: controller.signal });
      if (isCurrentRequest()) setSetup({ ...result, projectId });
    } catch (error) {
      if (isCurrentRequest()) setSetupError(error instanceof Error ? error.message : "Unable to prepare the local agent setup. Try again, or use a remote session.");
    } finally { if (isCurrentRequest()) setPreparingSetup(false); }
  }, [isCurrentScope, projectId, ensureToken]);

  const openSetup = useCallback(() => {
    if (!isCurrentScope()) return;
    setSetupOpen(true);
    void prepareSetup();
    void check();
  }, [check, prepareSetup, isCurrentScope]);

  useEffect(() => {
    if (!enabled || !optedIn) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      if (disposed || !isCurrentScope()) return;
      if (document.visibilityState !== "visible" || !navigator.onLine) {
        controllerRef.current?.abort();
        setAgent(null);
        setState("disconnected");
        setMessage("Connection checks are paused while this workspace is hidden or offline.");
        return;
      }
      timer = setTimeout(async () => { await check(true); schedule(); }, setupOpen ? 4000 : 15000);
    };
    const resume = () => {
      if (disposed || !isCurrentScope()) return;
      if (document.visibilityState === "visible" && navigator.onLine) void check(true);
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", schedule);
    };
  }, [enabled, optedIn, setupOpen, check, isCurrentScope]);

  const currentSetup = enabled && setup?.projectId === projectId ? setup : null;
  const url = currentSetup?.download_url || "";
  const command = url ? `curl --fail --location '${url.replace(/'/g, "'\\''")}' --output "\${TMPDIR:-/tmp}/hellotest-inspection-agent.mjs" && node "\${TMPDIR:-/tmp}/hellotest-inspection-agent.mjs"` : "";
  const windowsCommand = url ? `$agentFile = Join-Path $env:TEMP 'hellotest-inspection-agent.mjs'; Invoke-WebRequest -Uri '${url.replace(/'/g, "''")}' -OutFile $agentFile; if ($?) { node $agentFile }` : "";
  return { state, agent, message, setupOpen: enabled && setupOpen, setSetupOpen, openSetup, check, command, windowsCommand, setupError, preparingSetup, prepareSetup, expiresAt: currentSetup?.expires_at };
}
