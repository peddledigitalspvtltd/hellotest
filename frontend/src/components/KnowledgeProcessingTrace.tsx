import type { KnowledgeRetrievalSummary } from "../types";

const readable = (value?: string) => {
  const label = String(value || "").replace(/_/g, " ").toLowerCase();
  return label ? label[0].toUpperCase() + label.slice(1) : "";
};

export function KnowledgeProcessingTrace({ items }: { items: NonNullable<KnowledgeRetrievalSummary["processing_trace"]> }) {
  return <>{items.map((item, index) => {
    const label = item.label || readable(item.stage || item.phase) || "Retrieval stage";
    const detail = item.message || item.detail || "";
    const status = readable(item.status);
    return <div className={`is-${String(item.status || "").toLowerCase().replace(/_/g, "-")}`} key={`${item.stage || item.phase || "stage"}-${index}`}>
      <i aria-hidden="true">{index + 1}</i>
      <span><strong>{label}</strong><small>{[detail, status].filter(Boolean).join(" · ")}</small></span>
    </div>;
  })}</>;
}
