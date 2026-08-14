import type { CSSProperties, ReactNode } from "react";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { findAiMetricCriteriaByLabel } from "../lib/aiPromptRegistry";
import { InfoTooltip } from "./InfoTooltip";

export type QualityMetricTone = "neutral" | "info" | "success" | "danger";

export type QualityMetric = {
  badge?: ReactNode;
  criteriaKey?: string;
  detail?: ReactNode;
  disabled?: boolean;
  label: string;
  methodology?: ReactNode;
  onClick?: () => void;
  progress?: number | null;
  title?: string;
  tone?: QualityMetricTone;
  value: ReactNode;
};

type QualityMetricStripProps = {
  ariaLabel: string;
  className?: string;
  metrics: QualityMetric[];
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function QualityMetricStrip({
  ariaLabel,
  className = "",
  metrics
}: QualityMetricStripProps) {
  const { getMetricCriteria } = useAiPromptRegistry();
  const layoutStyle = {
    "--quality-metric-columns": Math.max(1, Math.min(metrics.length, 5))
  } as CSSProperties;

  return (
    <section
      aria-label={ariaLabel}
      className={["quality-metric-strip", className].filter(Boolean).join(" ")}
      role="group"
      style={layoutStyle}
    >
      {metrics.map((metric) => {
        const progress = typeof metric.progress === "number" ? clampPercent(metric.progress) : null;
        const tone = metric.tone || "neutral";
        const governedMetric = metric.criteriaKey
          ? findAiMetricCriteriaByLabel(metric.criteriaKey) || null
          : findAiMetricCriteriaByLabel(metric.label);
        const methodology = metric.methodology || metric.title || (governedMetric ? (
          <span className="metric-methodology-copy">
            <span><strong>Formula:</strong> {governedMetric.formula}</span>
            <span><strong>Organization criteria:</strong> {getMetricCriteria(governedMetric.key)}</span>
          </span>
        ) : null);
        const content = (
          <>
            <span className="quality-metric-label-row">
              <span className="quality-metric-label">{metric.label}</span>
              {methodology ? (
                <InfoTooltip
                  content={methodology}
                  label={`${metric.label} calculation`}
                  title={`${metric.label} methodology`}
                  trigger={metric.onClick ? "span" : "button"}
                />
              ) : null}
            </span>
            <div className="quality-metric-value-row">
              <strong className="quality-metric-value">{metric.value}</strong>
              {progress !== null ? (
                <span
                  aria-label={`${metric.label}: ${progress}%`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress}
                  className="quality-metric-progress"
                  role="progressbar"
                >
                  <span style={{ width: `${progress}%` }} />
                </span>
              ) : null}
              {metric.badge ? <span className="quality-metric-badge">{metric.badge}</span> : null}
              {metric.detail ? <span className="quality-metric-detail">{metric.detail}</span> : null}
            </div>
          </>
        );

        return metric.onClick ? (
          <button
            className={`quality-metric-card tone-${tone}`}
            disabled={metric.disabled}
            key={metric.label}
            onClick={metric.onClick}
            title={metric.title}
            type="button"
          >
            {content}
          </button>
        ) : (
          <article className={`quality-metric-card tone-${tone}`} key={metric.label}>
            {content}
          </article>
        );
      })}
    </section>
  );
}
