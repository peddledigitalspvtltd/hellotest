import { normalizeMetricBreakdown, type MetricBreakdown } from "../lib/metricBreakdown";
import "./MetricStatusBar.css";

export function MetricStatusBar({ breakdown, detail, className = "", label, value, valueText, progress = false }: {
  breakdown: MetricBreakdown;
  detail?: string;
  className?: string;
  label: string;
  value?: number | null;
  valueText?: string;
  progress?: boolean;
}) {
  const { segments, summary } = normalizeMetricBreakdown(breakdown);
  const available = breakdown.total > 0 && (!progress || value != null);
  const description = available && summary ? summary : detail || "No data";
  return <div
    className={`metric-status-bar ${className}`}
    role={progress ? (available ? "progressbar" : undefined) : "img"}
    aria-label={progress ? label : description}
    aria-valuemin={progress && available ? 0 : undefined}
    aria-valuemax={progress && available ? 100 : undefined}
    aria-valuenow={progress && available ? value ?? undefined : undefined}
    aria-valuetext={progress && available ? [valueText, description].filter(Boolean).join(". ") : undefined}
    title={description}
  >
    {available ? segments.map((segment, index) => <span
      key={`${segment.key}-${index}`}
      className={`metric-status-segment project-metric-status-segment is-${segment.key}`}
      style={{ width: `${segment.percent}%` }}
      title={`${segment.label}: ${segment.displayCount}`}
    ><b aria-hidden="true">{segment.displayCount}</b></span>) : null}
  </div>;
}
