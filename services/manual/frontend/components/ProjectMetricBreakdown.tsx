import { metricTitle } from "@hellotest/platform/frontend/src/shared/lib/metricTitle";
import { MetricStatusBar } from "@hellotest/platform/frontend/src/shared/components/MetricStatusBar";
type Segment = { key: string; label: string; count: number };

export function ProjectMetricBreakdown({ label, percent, total, segments, detail }: {
  label: string;
  percent: number | null;
  total: number;
  segments: Segment[];
  detail: string;
}) {
  const value = percent === null ? "—" : `${Math.round(percent)}%`;
  return <section className="project-metric-breakdown" aria-label={`${metricTitle(label)}: ${value}`} title={detail}>
    <div className="project-metric-breakdown-heading"><span>{metricTitle(label)}</span><strong>{value}</strong></div>
    <div className="project-metric-chart-row">
    <MetricStatusBar breakdown={{ total, segments }} className="project-metric-status-bar" detail={detail} label={metricTitle(label)} />
    </div>
  </section>;
}
