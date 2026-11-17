import { metricTitle } from "@hellotest/platform/frontend/src/shared/lib/metricTitle";
import type { ReactNode } from "react";
import { AI_METRIC_CRITERIA_REGISTRY } from "@hellotest/integration/frontend/lib/aiPromptRegistry";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import "./MetricMethodologyInfo.css";

export function MetricMethodologyInfo({
  criteriaKey,
  evidence,
  population,
  unit,
  organizationCriteria,
  className = "",
  label,
  trigger = "button"
}: {
  criteriaKey: string;
  population?: string;
  unit?: string;
  evidence?: ReactNode;
  organizationCriteria?: string;
  className?: string;
  label?: string;
  trigger?: "button" | "span";
}) {
  const metric = AI_METRIC_CRITERIA_REGISTRY.find((item) => item.key === criteriaKey) || null;
  const identityMatches = metric && (!population || metric.population === population) && (!unit || metric.unit === unit);

  return (
    <InfoTooltip
      className={["metric-methodology-info", className].filter(Boolean).join(" ")}
      content={(
        <span className="metric-methodology-info-content">
          <span><strong>Identity:</strong> {criteriaKey} · {population || metric?.population || "unknown population"} · {unit || metric?.unit || "unknown unit"}</span>
          <span><strong>Calculation:</strong> {identityMatches ? metric.formula : "Methodology unavailable for this identity and population."}</span>
          {evidence ? <span><strong>Current evidence:</strong> {evidence}</span> : null}
          <span><strong>Organization criteria:</strong> {organizationCriteria || (identityMatches ? metric.criteria : "Supply a governed identity for this measurement.")}</span>
          <span className="metric-methodology-info-boundary">The deterministic value and its source evidence remain locked; configured criteria guide explanations and review priorities only.</span>
        </span>
      )}
      label={label || `How ${metricTitle(metric?.label || criteriaKey)} is calculated`}
      title={`${metricTitle(metric?.label || criteriaKey)} methodology`}
      trigger={trigger}
    />
  );
}
