/** Mirrors the native Sprint resource request; the runtime rebinds scope at execution. */
export function sprintStoriesUrl(base: string, projectId: string, sprintId: string) {
  if (!base.trim()) return "";
  try {
    const url = new URL(base);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/requirements$/, "") + "/requirements";
    url.search = "";
    url.hash = "";
    url.searchParams.set("project_id", projectId);
    url.searchParams.set("sprint_id", sprintId || "SPRINT_TRIGGER_VALUE");
    url.searchParams.set("include_page", "true");
    url.searchParams.set("page_size", "20");
    return url.toString().replace("SPRINT_TRIGGER_VALUE", "{{ $request.sprint_id }}");
  } catch { return ""; }
}
