import type { ReactNode } from "react";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { resolveMetricIdentity } from "@hellotest/integration/frontend/lib/aiPromptRegistry";
import { EvidenceFlipCard } from "@hellotest/platform/frontend/src/shared/components/EvidenceFlipCard";

export type QualityMetricTone = "neutral" | "info" | "success" | "warning" | "danger";

export type QualityMetric = {
  actionLabel?: string;
  badge?: ReactNode;
  criteriaKey?: string;
  population?: string;
  unit?: string;
  detail?: ReactNode;
  disabled?: boolean;
  frontAccessory?: ReactNode;
  frontVisual?: ReactNode;
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
  autoResetMs?: number;
  className?: string;
  metrics: QualityMetric[];
  showCaptions?: boolean;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function QualityMetricStrip({
  ariaLabel,
  autoResetMs,
  className = "",
  metrics,
  showCaptions = true
}: QualityMetricStripProps) {
  const { getMetricCriteria } = useAiPromptRegistry();

  return (
    <section
      aria-label={ariaLabel}
      className={["quality-metric-strip", "metric-strip", "page-metric-strip", className].filter(Boolean).join(" ")}
      role="group"
    >
      {metrics.map((metric) => {
        const progress = typeof metric.progress === "number" ? clampPercent(metric.progress) : null;
        const tone = metric.tone || "neutral";
        const governedMetric = resolveMetricIdentity(metric);
        const methodology = metric.methodology || (governedMetric ? (
          <span className="metric-methodology-copy">
            <span><strong>Identity:</strong> {governedMetric.key} · {governedMetric.population} · {governedMetric.unit}</span>
            <span><strong>Formula:</strong> {governedMetric.formula}</span>
            <span><strong>Organization criteria:</strong> {getMetricCriteria(governedMetric.key)}</span>
          </span>
        ) : metric.title || "Methodology unavailable: no matching metric identity and population were supplied.");
        const identityEvidence = governedMetric ? `${governedMetric.key} · population: ${governedMetric.population} · unit: ${governedMetric.unit}` : `Methodology unavailable for ${metric.criteriaKey || "unmapped identity"} · population: ${metric.population || "unspecified"} · unit: ${metric.unit || "unspecified"}`;
        const evidence = [metric.detail, identityEvidence, methodology]
          .filter((item, index, items): item is ReactNode => Boolean(item) && items.indexOf(item) === index);
        const caption = progress !== null
          ? `${progress}% measured`
          : typeof metric.badge === "string" || typeof metric.badge === "number"
            ? String(metric.badge)
            : "Open for evidence";

        return (
          <EvidenceFlipCard
            autoResetMs={autoResetMs}
            actionDisabled={metric.disabled}
            actionLabel={metric.onClick ? metric.actionLabel || "Open metric details" : undefined}
            caption={showCaptions ? caption : undefined}
            className="quality-metric-card quality-metric-flip-card"
            evidence={evidence.length ? evidence : [metric.title || "No additional evidence is available for this metric."]}
            frontAccessory={metric.frontAccessory}
            frontVisual={metric.frontVisual}
            key={metric.label}
            label={metric.label}
            maxEvidenceItems={3}
            onAction={metric.onClick}
            tone={tone === "neutral" ? undefined : tone}
            value={metric.value}
          />
        );
      })}
    </section>
  );
}
