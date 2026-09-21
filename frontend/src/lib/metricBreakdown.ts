export type MetricBreakdown = {
  total: number;
  segments: Array<{ key: string; label: string; count: number }>;
  unit?: "count" | "percent";
};

/** Keep widths tied to the stated denominator and retain missing evidence as
 * unreported rather than silently counting it as passed or failed. */
export function normalizeMetricBreakdown(breakdown: MetricBreakdown) {
  if (!Number.isFinite(breakdown.total) || breakdown.total <= 0) return { segments: [], summary: "" };
  const segments = breakdown.segments.filter(segment => Number.isFinite(segment.count) && segment.count > 0);
  const reported = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (reported > breakdown.total + 0.000001) return { segments: [], summary: "Breakdown unavailable: reported counts exceed the total." };
  const remainder = breakdown.total - reported;
  const complete = remainder > 0.000001
    ? [...segments, { key: "unreported", label: "Unreported", count: remainder }]
    : segments;
  const normalized = complete.map(segment => ({
    ...segment,
    percent: segment.count / breakdown.total * 100,
    displayCount: `${Number(segment.count.toFixed(1))}${breakdown.unit === "percent" ? "%" : ""}`
  }));
  return { segments: normalized, summary: normalized.map(segment => `${segment.displayCount} ${segment.label}`).join(", ") };
}
