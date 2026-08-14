import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { findAiMetricCriteriaByLabel } from "../lib/aiPromptRegistry";
import { InfoTooltip } from "./InfoTooltip";

export type HierarchyMetric = {
  criteriaKey?: string;
  label: string;
  methodology?: string;
  value: string | number;
  tone?: "neutral" | "success" | "info" | "warning" | "danger";
  title?: string;
};

export function HierarchyMetricStrip({
  count,
  countLabel,
  countTitle,
  noun,
  metrics
}: {
  count: number | string;
  countLabel?: string;
  countTitle?: string;
  noun: string;
  metrics: HierarchyMetric[];
}) {
  const { getMetricCriteria } = useAiPromptRegistry();
  const numericCount = typeof count === "number" ? count : Number.NaN;
  const resolvedCountLabel = countLabel || `${noun}${numericCount === 1 ? "" : "s"}`;
  return (
    <div className="hierarchy-metric-strip" aria-label={`${count} ${resolvedCountLabel} and derived health metrics`}>
      <span className="hierarchy-record-count" title={countTitle}>
        <strong>{count}</strong>
        <small>{resolvedCountLabel}</small>
      </span>
      {metrics.map((metric) => {
        const governedMetric = metric.criteriaKey
          ? findAiMetricCriteriaByLabel(metric.criteriaKey)
          : findAiMetricCriteriaByLabel(metric.label);
        const methodology = metric.methodology || metric.title || (governedMetric
          ? `${governedMetric.formula} Organization criteria: ${getMetricCriteria(governedMetric.key)}`
          : "");
        return (
          <span
            className={`hierarchy-metric tone-${metric.tone || "neutral"}`}
            key={metric.label}
          >
            <span className="hierarchy-metric-label-row">
              <small>{metric.label}</small>
              {methodology ? <InfoTooltip content={methodology} label={`${metric.label} calculation`} trigger="span" /> : null}
            </span>
            <strong>{metric.value}</strong>
          </span>
        );
      })}
    </div>
  );
}
