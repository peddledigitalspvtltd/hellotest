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
        <span>{label}</span>
        <InfoTooltip content={hint} label={`${label} information`} />
      </span>
      <strong>{value}</strong>
    </div>
  );
}
