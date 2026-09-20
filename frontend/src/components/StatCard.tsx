import { metricTitle } from "../lib/metricTitle";
import { InfoTooltip } from "./InfoTooltip";

export function StatCard({
  label,
  value,
  hint
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="stat-card card">
      <span className="stat-card-label-row">
        <span>{metricTitle(label)}</span>
        <InfoTooltip content={hint} label={`${metricTitle(label)} information`} />
      </span>
      <strong>{value}</strong>
    </div>
  );
}
