import { metricTitle } from "../lib/metricTitle";
import type { ReactNode } from "react";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { findAiMetricCriteriaByLabel } from "../lib/aiPromptRegistry";
import { MetricMethodologyInfo } from "./MetricMethodologyInfo";
import "./HierarchyQuickInsights.css";

export type HierarchyQuickInsight = {
  criteriaKey?: string;
  icon: ReactNode;
  label: string;
  methodology?: ReactNode;
  value: ReactNode;
  title?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

export function HierarchyQuickInsights({
  count,
  countLabel,
  metrics
}: {
  count: number | string;
  countLabel: string;
  metrics: HierarchyQuickInsight[];
}) {
  const { getMetricCriteria } = useAiPromptRegistry();

  return (
    <section
      aria-label={`${count} ${countLabel} and hierarchy metrics`}
      className="hierarchy-quick-insights"
    >
      <div className="hierarchy-quick-insights-grid">
        <span className="hierarchy-quick-insight hierarchy-quick-insight-count">
          <small>{metricTitle(countLabel)}</small>
          <strong>{count}</strong>
        </span>
        {metrics.map((metric) => {
          const governedMetric = metric.criteriaKey
            ? findAiMetricCriteriaByLabel(metric.criteriaKey)
            : findAiMetricCriteriaByLabel(metric.label);
          const evidence = metric.methodology || metric.title;
          return (
            <span
              className={`hierarchy-quick-insight tone-${metric.tone || "neutral"}`}
              key={metric.label}
              title={metric.title}
            >
              <span className="hierarchy-quick-insight-icon">{metric.icon}</span>
              <small className="hierarchy-quick-insight-label-row">
                <span>{metricTitle(metric.label)}</span>
                {governedMetric ? (
                  <MetricMethodologyInfo
                    criteriaKey={governedMetric.key}
                    evidence={evidence}
                    organizationCriteria={getMetricCriteria(governedMetric.key)}
                  />
                ) : null}
              </small>
              <strong>{metric.value}</strong>
            </span>
          );
        })}
      </div>
    </section>
  );
}
