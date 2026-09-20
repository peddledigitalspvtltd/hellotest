import { metricTitle } from "../lib/metricTitle";
type Segment = { key: string; label: string; count: number };

export function ProjectMetricBreakdown({ label, percent, total, segments, detail }: {
  label: string;
  percent: number | null;
  total: number;
  segments: Segment[];
  detail: string;
}) {
  const value = percent === null ? "—" : `${Math.round(percent)}%`;
  const breakdown = segments.map(segment => `${segment.count} ${segment.label}`).join(", ");
  return <section className="project-metric-breakdown" aria-label={`${metricTitle(label)}: ${value}`} title={detail}>
    <div className="project-metric-breakdown-heading"><span>{metricTitle(label)}</span><strong>{value}</strong></div>
    <div className="project-metric-chart-row">
    <div className="project-metric-status-bar" role="img" aria-label={total ? breakdown : detail} title={total ? breakdown : detail}>
      {total > 0 ? segments.filter(segment => segment.count > 0).map(segment => <span key={segment.key} className={`project-metric-status-segment is-${segment.key}`} style={{ width: `${segment.count / total * 100}%` }} title={`${segment.label}: ${segment.count}`}><b aria-hidden="true">{segment.count}</b></span>) : null}
    </div>
    </div>
  </section>;
}
