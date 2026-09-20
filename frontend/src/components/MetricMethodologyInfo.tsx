import { metricTitle } from "../lib/metricTitle";
import type { ReactNode } from "react";
import { AI_METRIC_CRITERIA_REGISTRY } from "../lib/aiPromptRegistry";
import { InfoTooltip } from "./InfoTooltip";
import "./MetricMethodologyInfo.css";

export function MetricMethodologyInfo({
  criteriaKey,
  evidence,
  organizationCriteria,
  className = "",
  label,
  trigger = "button"
}: {
  criteriaKey: string;
  evidence?: ReactNode;
  organizationCriteria?: string;
  className?: string;
  label?: string;
  trigger?: "button" | "span";
}) {
  const metric = AI_METRIC_CRITERIA_REGISTRY.find((item) => item.key === criteriaKey) || null;
  if (!metric) return null;

  return (
    <InfoTooltip
      className={["metric-methodology-info", className].filter(Boolean).join(" ")}
      content={(
        <span className="metric-methodology-info-content">
          <span><strong>Calculation:</strong> {metric.formula}</span>
          {evidence ? <span><strong>Current evidence:</strong> {evidence}</span> : null}
          <span><strong>Organization criteria:</strong> {organizationCriteria || metric.criteria}</span>
          <span className="metric-methodology-info-boundary">The deterministic value and its source evidence remain locked; configured criteria guide explanations and review priorities only.</span>
        </span>
      )}
      label={label || `How ${metricTitle(metric.label)} is calculated`}
      title={`${metricTitle(metric.label)} methodology`}
      trigger={trigger}
    />
  );
}
