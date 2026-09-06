import type { RecorderSessionResponse } from "../types";

export type InspectBrowserTab = { id: string | null; url: string; title: string | null; active?: boolean };
type RecorderRead = <T>(url: string, options?: RequestInit) => Promise<T | null>;

export function inspectSessionRequest(session: RecorderSessionResponse, path = "", options: RequestInit = {}) {
  const source = session.status_url || session.live_view_url || session.engine_base_url || "";
  const origin = source.match(/^(https?:\/\/[^/]+)/i)?.[1];
  if (!session.id || !origin) throw new Error("Connect an inspection browser first.");
  const headers = new Headers(options.headers);
  for (const url of [session.live_view_url, session.live_view_path, session.status_url]) {
    if (!url) continue;
    const token = new URL(url, origin).searchParams.get("token");
    if (token) { headers.set("X-HelloTest-Recorder-Token", token); break; }
  }
  return { url: `${origin}/api/v1/recorder/sessions/${encodeURIComponent(session.id)}${path}`, options: { ...options, headers } };
}

export function buildInspectLiveUrl(session: RecorderSessionResponse | null, pageId: string, revision: number) {
  if (!session?.live_view_url || session.status !== "running") return "";
  const url = new URL(session.live_view_url);
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
