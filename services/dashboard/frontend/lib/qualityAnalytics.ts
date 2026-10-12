export type AnalyticsWindow = 14 | 30 | 90;
export type AnalyticsSource =
  | "stories"
  | "cases"
  | "suites"
  | "runs"
  | "bugs"
  | "automation";
export type AnalyticsTrend = {
  date: string;
  runs: number;
  passed: number;
  failed: number;
  blocked: number;
};
export type QualityOverview = {
  project: { id: string; key: string; name: string };
  evaluated_at: string;
  window: { days: AnalyticsWindow; from: string; to: string };
  visibility: Record<AnalyticsSource, boolean>;
  inventory: Record<
    | "stories"
    | "covered_stories"
    | "cases"
    | "designed_cases"
    | "suites"
    | "automated_cases"
    | "open_defects",
    number | null
  >;
  execution: Record<
    | "passed"
    | "failed"
    | "blocked"
    | "pending"
    | "other"
    | "total"
    | "completed_runs"
    | "active_runs",
    number | null
  > & { latest_evidence_at: string | null };
  trend: AnalyticsTrend[];
  recent_runs: Array<{
    id: string;
    name: string;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    passed: number;
    failed: number;
    blocked: number;
    pending: number;
    other: number;
    total: number;
  }>;
  attention: Array<{
    id: string;
    type: AnalyticsSource;
    title: string;
    detail: string;
    to: string;
    tone: "danger" | "warning" | "info";
  }>;
  evidence: {
    complete: boolean;
    latest_at: string | null;
    limitations: string[];
  };
  methodology: Record<
    "inventory" | "execution" | "trend" | "availability",
    string
  >;
};
export const ANALYTICS_SECTIONS = [
  "activity",
  "attention",
  "runs",
  "inventory",
] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];
export type AnalyticsLayout = {
  order: AnalyticsSection[];
  hidden: AnalyticsSection[];
};
export function analyticsWindow(value: unknown): AnalyticsWindow {
  return value === "14" || value === 14
    ? 14
    : value === "90" || value === 90
      ? 90
      : 30;
}
export function normalizeAnalyticsLayout(value: unknown): AnalyticsLayout {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AnalyticsLayout>)
      : {};
  const valid = (ids: unknown) =>
    Array.isArray(ids)
      ? [
          ...new Set(
            ids.filter((id): id is AnalyticsSection =>
              ANALYTICS_SECTIONS.includes(id),
            ),
          ),
        ]
      : [];
  const order = valid(candidate.order);
  const hidden = valid(candidate.hidden);
  return {
    order: [
      ...order,
      ...ANALYTICS_SECTIONS.filter((id) => !order.includes(id)),
    ],
    hidden: hidden.length === ANALYTICS_SECTIONS.length ? [] : hidden,
  };
}
export function qualityRatio(
  numerator: number | null,
  denominator: number | null,
) {
  if (
    numerator === null ||
    denominator === null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    numerator < 0 ||
    numerator > denominator
  )
    return null;
  return numerator / denominator;
}
/** Keep the 90-day chart legible without dropping any days or outcome counts. */
export function groupAnalyticsTrend(
  trend: AnalyticsTrend[],
  days: AnalyticsWindow,
) {
  const size = days === 90 ? 7 : 1;
  const groups: Array<AnalyticsTrend & { end: string }> = [];
  for (let i = 0; i < trend.length; i += size) {
    const rows = trend.slice(i, i + size);
    groups.push(
      rows.reduce(
        (sum, row) => ({
          date: sum.date,
          end: row.date,
          runs: sum.runs + row.runs,
          passed: sum.passed + row.passed,
          failed: sum.failed + row.failed,
          blocked: sum.blocked + row.blocked,
        }),
        {
          date: rows[0].date,
          end: rows[0].date,
          runs: 0,
          passed: 0,
          failed: 0,
          blocked: 0,
        },
      ),
    );
  }
  return groups;
}
export function analyticsCsv(data: QualityOverview) {
  // Quote every cell and neutralize spreadsheet formulas, including user-entered project names.
  const cell = (value: unknown) => {
    const text = value == null ? "Unavailable" : String(value);
    return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [
    ["Quality Analytics", data.project.name],
    ["Evaluated at", data.evaluated_at],
    ["UTC window start", data.window.from],
    ["UTC window end", data.window.to],
    ["Metric", "Value", "Scope"],
  ];
  for (const [name, value] of Object.entries(data.inventory))
    rows.push([name, value, "Current project inventory"]);
  for (const [name, value] of Object.entries(data.execution))
    rows.push([name, value, "Selected run activity window"]);
  rows.push([], ["UTC date", "Runs", "Passed", "Failed", "Blocked"]);
  for (const point of data.trend)
    rows.push([
      point.date,
      point.runs,
      point.passed,
      point.failed,
      point.blocked,
    ]);
  for (const [name, value] of Object.entries(data.methodology))
    rows.push([name, value]);
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
