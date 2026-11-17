import type { KnowledgeCitation } from "../../types";

/** Build a safe route from a stored Knowledge citation for any capability UI. */
export function knowledgeCitationHref(citation: KnowledgeCitation) {
  const uri = String(citation.uri || citation.source_uri || "").trim();
  if (!uri && citation.source_id && !["live_project", "product_help"].includes(String(citation.source_kind))) {
    const query = new URLSearchParams({ source_id: citation.source_id });
    if (citation.freshness?.current === false && citation.knowledge_id) query.set("revision_id", citation.knowledge_id);
    return `/knowledge-repo?${query.toString()}`;
  }
  if (/^\/(?!\/)/.test(uri) && !/[\\\r\n]/.test(uri)) return uri;
  try {
    const url = new URL(uri);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}
