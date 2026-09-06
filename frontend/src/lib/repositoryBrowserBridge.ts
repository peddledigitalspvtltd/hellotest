export type RepositoryBrowserState = {
  width: number;
  height: number;
  actualSize: boolean;
  pending: number;
  error: string;
};

export function repositoryInspectFrameUrl(liveUrl: string, parentOrigin: string, frameId: string) {
  if (!liveUrl || !parentOrigin || !frameId) return "";
  try {
    const url = new URL(liveUrl);
    const parent = new URL(parentOrigin);
    if (!/^https?:$/.test(url.protocol) || !/^https?:$/.test(parent.protocol)) return "";
    url.searchParams.set("embedded", "repository-inspect");
    url.searchParams.set("parent_origin", parent.origin);
    url.searchParams.set("parent_frame", frameId);
    return url.href;
  } catch {
    return "";
  }
}

/** Only the current recorder frame can update the inspector's controls. */
export function readRepositoryBrowserState(event: {
  origin: string;
  source: unknown;
  data: unknown;
}, expected: { origin: string; source: unknown; sessionId: string; frameId: string }): RepositoryBrowserState | null {
  if (!expected.source || !expected.sessionId || !expected.frameId || event.origin !== expected.origin || event.source !== expected.source) return null;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data.type !== "hellotest:recorder:state" || data.session_id !== expected.sessionId || data.frame_id !== expected.frameId) return null;
  const dimension = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 32768 ? Math.round(value) : 0;
  return {
    width: dimension(data.width),
    height: dimension(data.height),
    actualSize: data.actual_size === true,
    pending: typeof data.pending === "number" && Number.isFinite(data.pending) ? Math.max(0, data.pending) : 0,
    error: typeof data.error === "string" ? data.error.slice(0, 500) : ""
  };
}
