import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconActivityHeartbeat, IconAlertTriangle, IconChartBar, IconChecklist, IconInfoCircle, IconLayoutGrid } from "@tabler/icons-react";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { DialogCloseButton } from "./DialogCloseButton";
import { QualityMetricStrip, type QualityMetric } from "./QualityMetricStrip";
import "./EntityHealthDialog.css";

export { EntityHealthButton } from "./EntityHealthButton";

type EntityType = "Sprint" | "Release" | "Module";
type MetricGroup = "all" | "delivery" | "testing" | "risk";
const groups = [
  { id: "all", label: "All Metrics", icon: IconLayoutGrid },
  { id: "delivery", label: "Delivery", icon: IconChecklist },
  { id: "testing", label: "Testing", icon: IconChartBar },
  { id: "risk", label: "Risks", icon: IconAlertTriangle }
] as const;

function metricGroup(label: string): Exclude<MetricGroup, "all"> {
  if (/risk|defect|slippage|pending review/i.test(label)) return "risk";
  if (/coverage|pass rate|traceability|executable|execution|executed|linked test cases/i.test(label)) return "testing";
  return "delivery";
}

function HealthMetricVisual({ value }: { value: ReactNode }) {
  // Show only an explicit percentage from the existing metric, never a derived score.
  const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)%$/.exec(value) : null;
  if (!match || Number(match[1]) > 100) return null;
  return <span className="entity-health-meter"><span style={{ width: `${Number(match[1])}%` }} /></span>;
}

export function EntityHealthDialog({ entityType, entityName, metrics, summary, onClose, footer }: {
  entityType: EntityType;
  entityName: string;
  metrics: QualityMetric[];
  summary?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const metricsId = useId();
  const [activeGroup, setActiveGroup] = useState<MetricGroup>("all");
  const dialogRef = useDialogFocus<HTMLElement>({ onClose });
  const visibleMetrics = metrics.filter(metric => activeGroup === "all" || metricGroup(metric.label) === activeGroup);
  const displayMetrics = visibleMetrics.map(metric => {
    const group = groups.find(group => group.id === metricGroup(metric.label))!;
    const Icon = group.icon;
    return {
      ...metric,
      // The short front-face context and the flip side share the same evidence.
      badge: typeof metric.detail === "string" ? metric.detail : metric.badge,
      frontAccessory: metric.frontAccessory || <span className={`entity-health-metric-icon is-${group.id}`}><Icon aria-hidden="true" size={18} stroke={1.7} /></span>,
      frontVisual: <HealthMetricVisual value={metric.value} />
    };
  });

  return createPortal(
    <div className="modal-backdrop entity-health-backdrop" onClick={onClose} role="presentation">
      <section
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-modal="true"
        className="modal-card entity-health-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="entity-health-header">
          <span aria-hidden="true" className="entity-health-icon"><IconActivityHeartbeat size={24} stroke={1.7} /></span>
          <div className="entity-health-heading">
            <span className="eyebrow">{entityType} Health</span>
            <h2 id={titleId}>{entityName}</h2>
            <p id={descriptionId}>Review delivery, testing, and risks with the evidence behind each metric.</p>
          </div>
          <DialogCloseButton label={`Close ${entityType} Health`} onClick={onClose} />
        </header>
        {summary ? <div className="entity-health-scope"><IconInfoCircle aria-hidden="true" size={17} stroke={1.7} /><div><strong>Assessment Scope</strong><div className="entity-health-summary">{summary}</div></div></div> : null}
        <div className="entity-health-toolbar">
          <div aria-label="Filter health metrics" className="entity-health-filters" role="group">
            {groups.map(group => {
              const count = group.id === "all" ? metrics.length : metrics.filter(metric => metricGroup(metric.label) === group.id).length;
              if (!count && group.id !== "all") return null;
              const Icon = group.icon;
              return <button aria-controls={metricsId} aria-pressed={activeGroup === group.id} className={activeGroup === group.id ? "is-active" : ""} key={group.id} onClick={() => setActiveGroup(group.id)} type="button"><Icon aria-hidden="true" size={15} /><span>{group.label}</span><small>{count}</small></button>;
            })}
          </div>
          <span aria-live="polite" className="entity-health-count">{visibleMetrics.length} {visibleMetrics.length === 1 ? "Metric" : "Metrics"}</span>
        </div>
        <div className="entity-health-body" id={metricsId}>
          {displayMetrics.length ? <QualityMetricStrip ariaLabel={`${entityType} Health metrics for ${entityName}`} autoResetMs={0} className="entity-health-metrics" metrics={displayMetrics} /> : <p className="entity-health-empty">No metrics are available in this category.</p>}
        </div>
        <footer className="entity-health-footer">
          <span className="entity-health-keyboard-hint"><kbd>Esc</kbd> to close</span>
          <div className="entity-health-footer-actions">{footer}<button className="ghost-button" onClick={onClose} type="button">Close</button></div>
        </footer>
      </section>
    </div>, document.body
  );
}
