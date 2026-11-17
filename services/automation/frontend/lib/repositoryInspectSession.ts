import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";

export type InspectBrowserTab = { id: string | null; url: string; title: string | null; active?: boolean };
type RecorderRead = <T>(url: string, options?: RequestInit) => Promise<T | null>;

/** Page-object names and match patterns are never navigation destinations. */
export function normalizeRepositoryInspectStartUrl(value: string | null | undefined) {
  const input = String(value || "").trim();
  if (!input) return undefined;
  const invalid = () => new Error("Enter a full HTTP or HTTPS page URL, or leave Page URL empty to open a blank browser. Screen names and URL match patterns cannot be opened.");
  if (/[\u0000-\u0020\u007f\\]/.test(input) || input.startsWith("/")) throw invalid();
  const absolute = /^https?:\/\//i.test(input);
  try {
    const url = new URL(absolute ? input : `https://${input}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) throw invalid();
    // Preserve explicitly entered intranet URLs, while refusing bare screen identifiers.
    if (!absolute && !(url.hostname === "localhost" || url.hostname.includes(".") || /^\[.+\]$/.test(url.hostname))) throw invalid();
    if (!url.hostname.startsWith("[") && !url.hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) throw invalid();
    return url.href;
  } catch { throw invalid(); }
}

export function repositoryInspectLegacyPageUrl(value: string | null | undefined) {
  if (!/^https?:\/\//i.test(String(value || "").trim())) return "";
  try { return normalizeRepositoryInspectStartUrl(value) || ""; } catch { return ""; }
}

export function inspectSessionRequest(session: RecorderSessionResponse, path = "", options: RequestInit = {}) {
  const source = session.status_url || (session.engine_base_url ? `${session.engine_base_url.replace(/\/$/, "")}/api/v1/recorder/sessions/${encodeURIComponent(session.id)}` : "");
  if (!session.id || !source) throw new Error("Connect an inspection browser first.");
  const endpoint = new URL(source, typeof window === "undefined" ? undefined : window.location.origin);
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("The inspection browser returned an invalid session address.");
  const headers = new Headers(options.headers);
  if (session.recorder_mode === "local" && session.inspector_agent_token) headers.set("X-HelloTest-Agent-Token", session.inspector_agent_token);
  for (const url of [session.live_view_url, session.live_view_path, session.status_url]) {
    if (!url) continue;
    const token = new URL(url, endpoint).searchParams.get("token");
    if (token) { headers.set("X-HelloTest-Recorder-Token", token); break; }
  }
  const suffix = new URL(`https://inspection.invalid${path || "/"}`);
  endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + (path ? suffix.pathname : "");
  suffix.searchParams.forEach((value, key) => endpoint.searchParams.set(key, value));
  return { url: endpoint.href, options: { ...options, headers } };
}

export function buildInspectLiveUrl(session: RecorderSessionResponse | null, pageId: string, revision: number) {
  if (!session?.live_view_url || session.status !== "running") return "";
  const url = new URL(session.live_view_url, typeof window === "undefined" ? undefined : window.location.origin);
  if (pageId) url.searchParams.set("page_id", pageId);
  else url.searchParams.delete("page_id");
  url.searchParams.set("refresh", String(revision));
  return url.href;
}

export async function loadRepositoryInspectTabs(session: RecorderSessionResponse, selectedPageId: string, read: RecorderRead, activate = false) {
  const list = inspectSessionRequest(session, "/tabs");
  const response = await read<{ active_page_id?: string | null; tabs: InspectBrowserTab[] }>(list.url, list.options);
  const tabs = (response?.tabs || []).filter((tab) => typeof tab.id === "string" && Boolean(tab.id));
  const preferred = [selectedPageId, response?.active_page_id, tabs.find((tab) => tab.active)?.id, tabs[0]?.id];
  const pageId = preferred.find((id) => id && tabs.some((tab) => tab.id === id)) || "";
  if (activate && pageId) {
    const request = inspectSessionRequest(session, "/tabs/activate", { method: "POST", body: JSON.stringify({ page_id: pageId }) });
    await read(request.url, request.options);
  }
  return { tabs: activate ? tabs.map((tab) => ({ ...tab, active: tab.id === pageId })) : tabs, pageId };
}

export async function stopRepositoryInspectSession(session: RecorderSessionResponse, read: RecorderRead) {
  const request = inspectSessionRequest(session, "/stop", { method: "POST" });
  try { return await read<RecorderSessionResponse>(request.url, request.options); }
  catch (error) {
    if ([404, 410].includes(Number((error as { status?: number })?.status))) return null;
    throw error;
  }
}
