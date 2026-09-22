import type { RequirementCatalogMetrics } from "../lib/requirementCatalog";
import "./BacklogGrowthValue.css";

export function BacklogGrowthValue({ growth }: { growth: RequirementCatalogMetrics["growth"] }) {
  if (!growth) return <>—</>;
  const state = !growth.added && !growth.departures ? "idle" : growth.added > growth.departures ? "growing" : "healthy";
  const description = `${growth.added} intake : ${growth.departures} outflow. ${state === "idle" ? "No recorded activity" : state === "healthy" ? "Healthy: outflow keeps pace with intake" : "Growing: intake exceeds outflow"}.`;
  return <span className={`backlog-growth-value is-${state}`} aria-label={description} title={description}>
    <span className="backlog-growth-intake">{growth.added}</span><span className="backlog-growth-separator" aria-hidden="true">:</span><span className="backlog-growth-outflow">{growth.departures}</span>
  </span>;
}
