import type { KnowledgeAnswerContract, KnowledgeAssistantMessage, KnowledgeCitation } from "../types";

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, maximum = 20_000) => typeof value === "string" ? value.slice(0, maximum) : "";
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 100) : [];
export const KNOWLEDGE_PRESENTATIONS = ["TEXT", "TABLE", "TIMELINE", "COMPARISON", "RELATIONSHIP_GRAPH", "METRIC", "DOCUMENT_RESULTS", "IMAGE_RESULTS"] as const;
export type ValidatedKnowledgePresentation = { type: typeof KNOWLEDGE_PRESENTATIONS[number]; payload: Record<string, unknown> };

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

export function knowledgeCitationLocation(citation: KnowledgeCitation) {
  const location = citation.location;
  if (location?.page) return `Page ${location.page}`;
  if (typeof location?.timestamp_start_ms === "number") {
    const seconds = Math.floor(location.timestamp_start_ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return location?.heading || (location?.chunk_index !== undefined && location.chunk_index !== null ? `Passage ${location.chunk_index + 1}` : "");
}

export function validateKnowledgePresentation(input: unknown, evidenceIds: Set<string>): ValidatedKnowledgePresentation {
  const presentation = record(input);
  const type = String(presentation.recommended_type || "TEXT").toUpperCase();
  const payload = record(presentation.structured_payload);
  const fallback: ValidatedKnowledgePresentation = { type: "TEXT", payload: {} };
  const evidence = (item: Record<string, unknown>) => {
    const ids = strings(item.evidence_ids);
    return Array.isArray(item.evidence_ids) && ids.length === item.evidence_ids.length && ids.length > 0 && ids.every((id) => evidenceIds.has(id));
  };
  if (!KNOWLEDGE_PRESENTATIONS.includes(type as typeof KNOWLEDGE_PRESENTATIONS[number])) return fallback;
  if (type === "TABLE" || type === "COMPARISON") {
    if (!Array.isArray(payload.columns) || !Array.isArray(payload.rows) || !payload.columns.length || payload.columns.length > 12 || payload.rows.length > 100) return fallback;
    const columns = payload.columns.map(record).map((column) => ({ key: text(column.key, 100), label: text(column.label, 200) }));
    if (columns.some((column) => !column.key || !column.label) || new Set(columns.map((column) => column.key)).size !== columns.length) return fallback;
    const rows = payload.rows.map(record);
    if (rows.some((row) => !evidence(row) || columns.some((column) => typeof record(row.cells)[column.key] !== "string"))) return fallback;
    return { type, payload: { columns, rows: rows.map((row) => ({ cells: Object.fromEntries(columns.map((column) => [column.key, text(record(row.cells)[column.key], 5000)])), evidence_ids: strings(row.evidence_ids) })) } };
  }
  if (type === "TIMELINE" || type === "METRIC") {
    if (!Array.isArray(payload.items) || payload.items.length > 100) return fallback;
    const items = payload.items.map(record);
    const required = type === "TIMELINE" ? ["date", "title"] : ["label", "value"];
    if (items.some((item) => !evidence(item) || required.some((key) => typeof item[key] !== "string"))) return fallback;
    return { type, payload: { items: items.map((item) => ({ ...Object.fromEntries([...required, "description", "unit"].map((key) => [key, text(item[key], 5000)])), evidence_ids: strings(item.evidence_ids) })) } };
  }
  if (type === "DOCUMENT_RESULTS" || type === "IMAGE_RESULTS") {
    if (!Array.isArray(payload.items) || payload.items.length > 100) return fallback;
    if (payload.items.some((item) => !evidenceIds.has(String(record(item).evidence_id)))) return fallback;
    // Titles and URLs are read from authorized evidence by the renderer.
    return { type, payload: { items: payload.items.map((item) => ({ evidence_id: String(record(item).evidence_id) })) } };
  }
  if (type === "RELATIONSHIP_GRAPH") {
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges) || payload.nodes.length > 100 || payload.edges.length > 200) return fallback;
    const nodes = payload.nodes.map(record);
    const edges = payload.edges.map(record);
    const nodeIds = new Set(nodes.map((node) => text(node.id, 100)));
    if (nodes.some((node) => !text(node.id, 100) || !text(node.label, 500) || !evidence(node)) || nodeIds.size !== nodes.length || edges.some((edge) => !nodeIds.has(String(edge.source)) || !nodeIds.has(String(edge.target)) || !evidence(edge))) return fallback;
    return { type, payload: { nodes: nodes.map((node) => ({ id: text(node.id, 100), label: text(node.label, 500), type: text(node.type, 100), evidence_ids: strings(node.evidence_ids) })), edges: edges.map((edge) => ({ source: text(edge.source, 100), target: text(edge.target, 100), type: text(edge.type, 100), evidence_ids: strings(edge.evidence_ids) })) } };
  }
  return fallback;
}

export function validateKnowledgeAnswer(message: KnowledgeAssistantMessage) {
  const contract = message.answer_contract || message.retrieval?.answer_contract;
  const packet = message.context_packet || message.retrieval?.context_packet;
  if (!contract || !["1.0", "AnswerContract.v1"].includes(contract.contract_version) || (contract.contract_type && contract.contract_type !== "AnswerContract")) return null;
  if (!Array.isArray(contract.claims) || typeof contract.status !== "string" || (typeof contract.summary !== "string" && typeof contract.answer?.summary !== "string")) return null;
  if (packet && !["1.0", "ContextPacket.v1"].includes(packet.contract_version)) return null;
  const packetEvidence = Array.isArray(packet?.evidence) ? packet.evidence : [];
  const citations = new Map<string, KnowledgeCitation>();
  for (const source of packetEvidence) {
    if (!source || typeof source !== "object") continue;
    if (source.visibility?.state && !["FULL", "PARTIAL"].includes(source.visibility.state.toUpperCase())) continue;
    const id = source.evidence_id || source.id;
    if (!id || typeof id !== "string") continue;
    const citation = (message.citations || []).find((item) => item && typeof item === "object" && (item.evidence_id || item.id) === id);
    citations.set(id, { ...citation, ...source, id, evidence_id: id, location: source.location || source.locator || citation?.location });
  }
  // Legacy packets did not carry evidence; their source IDs are the citation boundary.
  if (!Array.isArray(packet?.evidence) && contract.contract_version === "AnswerContract.v1") for (const source of message.citations || []) citations.set(source.evidence_id || source.id, source);
  const evidenceIds = new Set(citations.keys());
  const claims = (Array.isArray(contract.claims) ? contract.claims : []).slice(0, 100).filter((claim) => {
    if (!claim || typeof claim !== "object") return false;
    const ids = strings(claim.evidence_ids);
    return text(claim.text || claim.statement) && Array.isArray(claim.evidence_ids) && ids.length === claim.evidence_ids.length && ids.length > 0 && ids.every((id) => evidenceIds.has(id)) && ["SUPPORTED", "INTERPRETATION"].includes(claim.classification || "SUPPORTED");
  }).map((claim, index) => {
    const evidenceIds = strings(claim.evidence_ids);
    // The numbered source controls carry these exact references. Avoid
    // displaying a second, opaque citation token from older saved answers.
    const displayText = text(claim.text || claim.statement).replace(/\[([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/g, (token, id: string) => evidenceIds.includes(id) ? "" : token).trim();
    return { id: claim.claim_id || `claim-${index}`, text: displayText, classification: claim.classification || "SUPPORTED", evidenceIds };
  });
  const rejectedClaims = Math.max(0, (contract.claims?.length || 0) - claims.length);
  const limitations = record(contract.limitations);
  const gaps = strings(contract.evidence_gaps);
  if (rejectedClaims) gaps.push(`${rejectedClaims} claim${rejectedClaims === 1 ? " was" : "s were"} omitted because its evidence could not be verified.`);
  const partial = String(limitations.retrieval_status).toUpperCase() === "PARTIAL" || limitations.authorization_partial === true || limitations.budget_partial === true || Number(limitations.unavailable_sources) > 0 || String(packet?.retrieval?.status).toUpperCase() === "PARTIAL" || packet?.coverage?.context_budget_exhausted === true || message.grounding_status === "partially_grounded" || rejectedClaims > 0;
  return {
    summary: rejectedClaims ? "Some statements could not be verified against the returned evidence. The supported statements are shown below." : text(contract.answer?.summary || contract.summary),
    claims, citations, gaps, partial,
    limitations: limitations as NonNullable<KnowledgeAnswerContract["limitations"]>,
    presentation: validateKnowledgePresentation(contract.presentation, evidenceIds),
    terminationReason: text(contract.termination_reason || packet?.retrieval?.termination_reason, 200)
  };
}
