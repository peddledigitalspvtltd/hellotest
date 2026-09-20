const DEFECT_KIND_LABELS: Record<string, string> = {
  issue: "Defect",
  issues: "Defects",
  bug: "Defect",
  bugs: "Defects",
  defect: "Defect",
  defects: "Defects"
};

/** Presentation only: record kinds remain unchanged in requests, links, and stored data. */
export function formatRecordKindLabel(value?: string | null, fallback = "Unknown") {
  const kind = String(value || "").trim();
  const key = kind.toLowerCase();
  return Object.prototype.hasOwnProperty.call(DEFECT_KIND_LABELS, key)
    ? DEFECT_KIND_LABELS[key]
    : kind.replace(/_/g, " ") || fallback;
}

const DEFECT_FIELD_LABELS: Record<string, string> = {
  bug_type: "Defect Type",
  issue_type: "Defect Type",
  bug_id: "Defect ID",
  issue_id: "Defect ID",
  bug_ids: "Defect IDs",
  issue_ids: "Defect IDs",
  jira_bug_key: "Defect Key",
  linked_bug_ids: "Linked Defect IDs",
  linked_issue_ids: "Linked Defect IDs"
};

/** Use only for defect field metadata; never rewrite user-authored record values. */
export function formatDefectFieldLabel(field: string, fallback = field.replace(/_/g, " ")) {
  return Object.prototype.hasOwnProperty.call(DEFECT_FIELD_LABELS, field) ? DEFECT_FIELD_LABELS[field] : fallback;
}
