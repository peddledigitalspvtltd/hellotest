import { useId, useState } from "react";
import { createPortal } from "react-dom";
import "./RunResultChart.css";

const outcomes = [
  ["passed", "Passed", "var(--run-result-passed, #168a54)"],
  ["failed", "Failed", "var(--run-result-failed, #ce3855)"],
  ["blocked", "Blocked", "var(--run-result-blocked, #c48a15)"],
  ["running", "Running", "var(--run-result-running, #2563eb)"],
  ["paused", "Paused", "#a78bfa"],
  ["skipped", "Skipped / N/A", "#94a3b8"],
  ["aborted", "Aborted", "#f97316"],
  ["unexecuted", "Unexecuted", "var(--run-result-pending, #cbd5e1)"]
] as const;

export function RunResultChart({ counts, total }: { counts: Record<string, number>; total: number }) {
  const tooltipId = useId();
  const [active, setActive] = useState<{ label: string; left: number; top: number } | null>(null);
  let offset = 0;
  const segments = outcomes.map(([key, label, color]) => {
    const count = key === "unexecuted" ? (counts.queued || 0) + (counts.pending || 0) : counts[key] || 0;
    const percent = total > 0 ? count / total * 100 : 0;
    const segment = { key, color, count, percent, offset, label: `${label}: ${count} (${Math.round(percent)}%)` };
    offset += percent;
    return segment;
  }).filter(segment => segment.count > 0);
  const show = (element: SVGCircleElement, label: string) => {
    const bounds = element.closest("svg")!.getBoundingClientRect();
    setActive({ label, left: Math.max(12, Math.min(bounds.left + bounds.width / 2, window.innerWidth - 180)), top: Math.min(bounds.bottom + 8, window.innerHeight - 56) });
  };
  return <span className="execution-run-result-chart" role="group" aria-label="Run result distribution">
    <svg viewBox="0 0 100 100" aria-label={total ? `${total} case instances by outcome` : "No case results"}>
      <circle className="run-result-chart-track" cx="50" cy="50" r="43" fill="none" strokeWidth="13" />
      {segments.map(segment => <circle
        key={segment.key} className="run-result-chart-segment" data-outcome={segment.key}
        cx="50" cy="50" r="43" fill="none" stroke={segment.color} strokeWidth="13" pathLength="100"
        strokeDasharray={`${segment.percent} ${100 - segment.percent}`} strokeDashoffset={-segment.offset}
        transform="rotate(-90 50 50)" tabIndex={0} role="img" aria-label={segment.label}
        aria-describedby={active?.label === segment.label ? tooltipId : undefined}
        onMouseEnter={event => show(event.currentTarget, segment.label)}
        onMouseLeave={event => { if (event.currentTarget !== document.activeElement) setActive(null); }}
        onFocus={event => show(event.currentTarget, segment.label)} onBlur={() => setActive(null)}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setActive(null); } }}
      ><title>{segment.label}</title></circle>)}
    </svg>
    <span className="run-result-chart-core" aria-hidden="true"><b>{total}</b><span>instances</span></span>
    {active && createPortal(<span id={tooltipId} role="tooltip" className="run-result-chart-tooltip" style={{ left:active.left, top:active.top }}>{active.label}</span>, document.body)}
  </span>;
}
