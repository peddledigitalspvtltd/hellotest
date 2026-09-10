export function StatusBadge({ value }: { value: string | null | undefined }) {
  const className = `status-badge ${String(value || "default").toLowerCase()}`;
  const label = value === "pending" ? "Unexecuted" : value === "skipped" ? "N/A" : value === "paused" ? "Paused" : value || "unknown";
  return <span className={className}>{label}</span>;
}
