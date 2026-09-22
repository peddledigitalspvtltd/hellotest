import { useLocalization } from "../context/LocalizationContext";
export function StatusBadge({ value, label: displayLabel }: { value: string | null | undefined; label?: string }) {
  const { t } = useLocalization();
  const className = `status-badge ${String(value || "default").toLowerCase()}`;
  const label = displayLabel || (value === "pending" ? "Unexecuted" : value === "skipped" ? "N/A" : value === "paused" ? "Paused" : value || "unknown");
  return <span className={className}>{t(`status.${value || "unknown"}`, label)}</span>;
}
