import { metricTitle } from "@hellotest/platform/frontend/src/shared/lib/metricTitle";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLayoutDashboard, IconChartBar, IconChartDonut, IconChartLine, IconTable, IconNumber, IconPlus, IconSearch, IconGripVertical, IconSettings, IconX, IconCheck, IconDots, IconArrowRight, IconBriefcase, IconBox, IconTestPipe, IconCopy } from "@tabler/icons-react";
import { buildQualityDashboardDrilldown, type QualityDashboardEvidenceRow } from "../lib/qualityDashboardDrilldown";
import { QUALITY_DASHBOARD_PRESETS, QUALITY_WIDGET_LIBRARY, QUALITY_QUERY_LIBRARY, compactDashboardSeries, createDashboardPreset, dashboardQueryGadgets, moveDashboardWidget, type QualityDashboardPresetId } from "../lib/qualityDashboardPresets";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { getJiraBrowseUrl, readAtlassianSiteUrl } from "@hellotest/integration/frontend/lib/jiraBrowseUrl";
import type { QualityDashboard, QualityDashboardBatchResponse, QualityDashboardGadget, QualityDashboardGadgetResult } from "@hellotest/platform/frontend/src/types";
import { OpenIcon, RefreshIcon, SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { MetricMethodologyInfo } from "@hellotest/ai/frontend/components/MetricMethodologyInfo";
import "./CustomQualityDashboard.metrics.css";
import "./CustomQualityDashboard.workspace.css";

const EMPTY_GADGET: QualityDashboardGadget = {
  id: "",
  title: "Test cases",
  data_source: "hellotest",
  type: "metric",
  jql: "",
  group_by: "status",
  metric: "testCases",
  accent: "blue"
};

const DEFAULT_COMPLEX_DASHBOARD_PROMPT = "Build a release-quality command center for QA leadership. Include release confidence, story traceability and coverage gaps, effective automation, open defect exposure and a 90-day defect trend, QA throughput over 30 days, actual test-run cycle time, execution workflow, test distribution by module, story flow, ownership/productivity, and a prioritized action table. Keep every signal project-scoped, explainable, drillable, and useful at a glance.";

function emptyDashboard(projectId: string): QualityDashboard {
  return {
    id: "",
    project_id: projectId,
    name: "Release quality",
    description: "",
    layout: "two-column",
    gadgets: []
  };
}

function migrateLegacyStoryTitle(value: string) {
  if (value === "Requirement traceability") return "Story traceability";
  if (value === "Requirement coverage") return "Story coverage";
  return value;
}

function normalizeDashboard(value: unknown, projectId: string): QualityDashboard {
  const candidate = value && typeof value === "object" ? value as Partial<QualityDashboard> : {};
  return {
    ...emptyDashboard(projectId),
    ...candidate,
    id: typeof candidate.id === "string" ? candidate.id : "",
    project_id: typeof candidate.project_id === "string" ? candidate.project_id : projectId,
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : "Release quality",
    description: typeof candidate.description === "string" ? candidate.description : "",
    layout: candidate.layout === "single" || candidate.layout === "three-column" ? candidate.layout : "two-column",
    gadgets: asArray<QualityDashboardGadget>(candidate.gadgets).map((gadget) => ({
      ...gadget,
      title: migrateLegacyStoryTitle(gadget.title)
    }))
  };
}

function resultTone(result?: QualityDashboardGadgetResult) {
  if (!result) return "neutral";
  return result.total ? "info" : "success";
}

const DASHBOARD_AUDIENCES = [
  { id: "executive", label: "Executive", detail: "Release exposure and go/no-go risk" },
  { id: "product", label: "Product", detail: "Scope, ownership and defect pressure" },
  { id: "quality", label: "QA", detail: "Execution, traceability and triage" },
  { id: "automation", label: "Automation", detail: "Reliability and maintenance demand" },
  { id: "traceability", label: "Traceability", detail: "Stories, tests, results and linked defects" },
  { id: "delivery", label: "Delivery", detail: "Development and QA progress by sprint and release" },
  { id: "triage", label: "Triage", detail: "Failing tests, defect relationships and arrivals" }
] as const;

const DASHBOARD_ACCENTS: Array<{ id: NonNullable<QualityDashboardGadget["accent"]>; label: string }> = [
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "purple", label: "Purple" },
  { id: "orange", label: "Orange" },
  { id: "red", label: "Red" },
  { id: "teal", label: "Teal" },
  { id: "slate", label: "Slate" }
];

const HELLOTEST_DERIVED_METRICS = new Set<QualityDashboardGadget["metric"]>(QUALITY_QUERY_LIBRARY.map(query => query.metric));

const DASHBOARD_METRIC_CRITERIA_KEYS: Partial<Record<NonNullable<QualityDashboardGadget["metric"]>, string>> = {
  releaseConfidence: "metric.dashboard.release_confidence",
  passRate: "metric.dashboard.pass_rate",
  executionCompletion: "metric.dashboard.execution_completion",
  evidenceConfidence: "metric.dashboard.evidence_confidence",
  requirementCoverage: "metric.story.coverage",
  automationCoverage: "metric.dashboard.automation_coverage",
  executionCycleHours: "metric.execution.cycle_time",
  resolutionRate: "metric.jira.resolution_rate",
  averageAgeDays: "metric.jira.average_age",
  averageResolutionDays: "metric.jira.average_resolution_time"
};

const GADGET_ACCENT_PALETTES: Record<NonNullable<QualityDashboardGadget["accent"]>, string[]> = {
  blue: ["#0c66e4", "#579dff", "#6cc3e0", "#85b8ff", "#cce0ff", "#1d7afc", "#09326c", "#94a3b8"],
  green: ["#1f845a", "#4bce97", "#7ee2b8", "#baf3db", "#22c55e", "#0f766e", "#14532d", "#94a3b8"],
  purple: ["#6e5dc6", "#9f8fef", "#c0b6f2", "#dfd8fd", "#a855f7", "#7c3aed", "#4c1d95", "#94a3b8"],
  orange: ["#fca700", "#e2b203", "#f5cd47", "#f8e6a0", "#fb923c", "#ea580c", "#7c2d12", "#94a3b8"],
  red: ["#c9372c", "#f87168", "#ff8f73", "#ffd5d2", "#ef4444", "#b91c1c", "#7f1d1d", "#94a3b8"],
  teal: ["#1d7f8c", "#6cc3e0", "#9dd9ee", "#c6edfb", "#14b8a6", "#0f766e", "#134e4a", "#94a3b8"],
  slate: ["#44546f", "#626f86", "#8590a2", "#b3b9c4", "#64748b", "#475569", "#1f2937", "#94a3b8"]
};

function quoteDashboardJqlValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").slice(0, 120)}"`;
}

function joinDashboardJql(clauses: string[], orderBy = "updated DESC") {
  const uniqueClauses = [...new Set(clauses.map((clause) => clause.trim()).filter(Boolean))];
  return `${uniqueClauses.length ? uniqueClauses.join(" AND ") : "updated >= -90d"} ORDER BY ${orderBy}`;
}

function defaultOrderByForGadget(gadget: QualityDashboardGadget) {
  if (gadget.type === "line" || gadget.group_by === "createdWeek" || gadget.group_by === "createdMonth") return "created ASC";
  if (gadget.group_by === "updatedWeek" || gadget.group_by === "updatedMonth") return "updated ASC";
  if (gadget.metric === "stale30d" || /stale|aging|oldest/i.test(gadget.title)) return "updated ASC";
  if (gadget.metric === "highPriority" || /blocker|critical|priority|risk/i.test(gadget.title)) return "priority DESC, updated DESC";
  return "updated DESC";
}

function buildDefaultDashboardJql(gadget: QualityDashboardGadget, release = "") {
  if (gadget.data_source === "hellotest") return "";
  const title = gadget.title.toLowerCase();
  const clauses: string[] = [];

  if (/bug|defect|incident|escaped/.test(title)) {
    clauses.push("issuetype = Bug");
  } else if (/automation|case|test case|maintenance/.test(title)) {
    clauses.push('issuetype = "HelloTest Test Case"');
  } else if (/execution|run/.test(title)) {
    clauses.push('issuetype = "HelloTest Test Run"');
  } else if (/requirement|story|scope|product/.test(title)) {
    clauses.push("issuetype in (Story, Epic)");
  } else if (/quality|test|qa/.test(title)) {
    clauses.push('issuetype in ("HelloTest Test Case", "HelloTest Test Run", Bug)');
  }

  if (gadget.metric === "resolved") clauses.push("resolution is not EMPTY");
  if (gadget.metric === "unresolved" || /open|unresolved|backlog/.test(title)) clauses.push("resolution = Unresolved");
  if (gadget.metric === "highPriority" || /blocker|critical|high|risk/.test(title)) clauses.push("priority in (Highest, High)");
  if (gadget.metric === "unassigned" || /unassigned|unowned|ownership/.test(title)) clauses.push("assignee is EMPTY");
  if (gadget.metric === "overdue" || /overdue/.test(title)) clauses.push("due <= now() AND resolution = Unresolved");
  if (gadget.metric === "stale30d" || /stale|aging|oldest/.test(title)) clauses.push("updated <= -30d AND resolution = Unresolved");
  if (gadget.metric === "created30d") clauses.push("created >= -30d");
  if (gadget.metric === "resolved30d") clauses.push("resolved >= -30d");
  if (gadget.metric === "resolutionRate" || gadget.metric === "averageResolutionDays") clauses.push("updated >= -90d");
  if (gadget.metric === "averageAgeDays") clauses.push("resolution = Unresolved");
  if (gadget.type === "line" || gadget.group_by === "createdWeek" || gadget.group_by === "createdMonth") clauses.push("created >= -90d");
  if (gadget.group_by === "updatedWeek" || gadget.group_by === "updatedMonth") clauses.push("updated >= -90d");
  if (release.trim()) clauses.push(`fixVersion = ${quoteDashboardJqlValue(release.trim())}`);

  return joinDashboardJql(clauses, defaultOrderByForGadget(gadget));
}

function dashboardGroupClause(result: QualityDashboardGadgetResult, groupLabel?: string) {
  const label = String(groupLabel || "").trim();
  if (!label) return "";
  const groupBy = result.gadget.group_by;
  const emptyLabel = /^(no |unassigned|unlabelled)/i.test(label);
  const fields: Partial<Record<QualityDashboardGadget["group_by"], string>> = {
    status: "status",
    statusCategory: "statusCategory",
    priority: "priority",
    issuetype: "issuetype",
    assignee: "assignee",
    reporter: "reporter",
    components: "component",
    fixVersion: "fixVersion",
    labels: "labels",
    sprint: "sprint",
    resolution: "resolution"
  };
  const field = fields[groupBy];
  if (field) return emptyLabel ? `${field} is EMPTY` : `${field} = ${quoteDashboardJqlValue(label)}`;
  if ((groupBy === "createdMonth" || groupBy === "updatedMonth") && /^\d{4}-\d{2}$/.test(label)) {
    const [year, month] = label.split("-").map(Number);
    const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    return `${groupBy === "createdMonth" ? "created" : "updated"} >= "${label}-01" AND ${groupBy === "createdMonth" ? "created" : "updated"} < "${next}"`;
  }
  return "";
}

function addDashboardDrilldownClause(jql: string, clause: string) {
  if (!clause) return jql;
  const match = jql.match(/\s+ORDER\s+BY\s+/i);
  if (!match?.index) return `${jql} AND (${clause})`;
  return `${jql.slice(0, match.index)} AND (${clause})${jql.slice(match.index)}`;
}

function openDashboardDrilldown(result: QualityDashboardGadgetResult, groupLabel?: string) {

  const siteUrl = readAtlassianSiteUrl();
  if (!siteUrl) throw new Error("connected site context is unavailable. Refresh HelloTest, then open the drill-down again.");
  const jql = addDashboardDrilldownClause(result.jql, dashboardGroupClause(result, groupLabel));
  window.open(`${siteUrl}/issues/?jql=${encodeURIComponent(jql)}`, "_blank", "noopener,noreferrer");
}

function waitForImage(image: HTMLImageElement) {
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to render dashboard snapshot."));
  });
}

async function fitDashboardSnapshotToForgePayload(dataUrl: string) {
  const maxDataUrlLength = 410_000;
  if (dataUrl.length <= maxDataUrlLength) return dataUrl;

  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await waitForImage(image);
  let scale = 1;
  let quality = 0.84;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Dashboard snapshot canvas is unavailable.");
    context.fillStyle = "#f7f8f9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL("image/jpeg", quality);
    if (compressed.length <= maxDataUrlLength) return compressed;
    if (quality > 0.58) quality -= 0.07;
    else scale *= 0.86;
  }
  throw new Error("The styled dashboard is too large to export. Reduce the number of large table gadgets and retry.");
}

async function captureDashboardSnapshot(node: HTMLElement, dashboardName: string) {
  const { toJpeg } = await import("html-to-image");
  await document.fonts?.ready;
  await Promise.all(Array.from(node.querySelectorAll("img")).map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));

  const rect = node.getBoundingClientRect();
  const width = Math.max(760, Math.ceil(rect.width || 0), Math.ceil(node.scrollWidth || 0));
  const height = Math.max(420, Math.ceil(node.scrollHeight || rect.height || 720));
  const maxPixels = 7_000_000;
  const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.6, Math.sqrt(maxPixels / Math.max(1, width * height))));
  const dataUrl = await toJpeg(node, {
    backgroundColor: "#f7f8f9",
    cacheBust: true,
    canvasHeight: Math.max(1, Math.round(height * pixelRatio)),
    canvasWidth: Math.max(1, Math.round(width * pixelRatio)),
    filter: (candidate) => {
      if (!(candidate instanceof HTMLElement)) return true;
      return !candidate.matches("input, select, textarea, .quality-gadget-actions, .quality-gadget-control, .quality-gadget-remove");
    },
    height,
    pixelRatio: 1,
    preferredFontFormat: "woff2",
    quality: 0.9,
    style: { boxSizing: "border-box", height: `${height}px`, margin: "0", width: `${width}px` },
    width
  });
  if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Dashboard snapshot could not be encoded.");
  return {
    rendered_snapshot_data_url: await fitDashboardSnapshotToForgePayload(dataUrl),
    rendered_snapshot_name: dashboardName || "HelloTest dashboard",
    rendered_snapshot_captured_at: new Date().toISOString()
  };
}

type DashboardEditorScope = { projectId: string; editorGeneration: number };

export function CustomQualityDashboard({ projectId, canManage, canUseAi, canUseAutomation }: { projectId: string; canManage: boolean; canUseAi: boolean; canUseAutomation: boolean }) {
  const queryClient = useQueryClient();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const { session } = useAuth();
  const { getMetricCriteria } = useAiPromptRegistry();
  const reportSurfaceRef = useRef<HTMLElement | null>(null);
  const [selectedId, setSelectedId] = useState("preset:quality");
  const [editorTab, setEditorTab] = useState<"build" | "preview" | "configure" | "ai">("build");
  const [widgetSearch, setWidgetSearch] = useState("");
  const [widgetCategory, setWidgetCategory] = useState("All");
  const [draggedWidgetId, setDraggedWidgetId] = useState("");
  const [chosenPreset, setChosenPreset] = useState<QualityDashboardPresetId | "">("quality");
  const projectScopeRef = useRef(projectId);
  projectScopeRef.current = projectId;
  const editorGenerationRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const isCurrentEditor = (scope: DashboardEditorScope) => scope.projectId === projectScopeRef.current && scope.editorGeneration === editorGenerationRef.current;
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [draft, setDraft] = useState<QualityDashboard>(() => emptyDashboard(projectId));
  const [gadgetDraft, setGadgetDraft] = useState<QualityDashboardGadget>(EMPTY_GADGET);
  const [editingGadgetId, setEditingGadgetId] = useState("");
  const [isGadgetJqlDirty, setIsGadgetJqlDirty] = useState(false);
  const [designerDraft, setDesignerDraft] = useState<{ stakeholder: typeof DASHBOARD_AUDIENCES[number]["id"]; release: string; prompt: string }>({ stakeholder: "quality", release: "", prompt: DEFAULT_COMPLEX_DASHBOARD_PROMPT });
  const [isReportEmailModalOpen, setIsReportEmailModalOpen] = useState(false);
  const [reportEmailDraft, setReportEmailDraft] = useState("");
  const [message, setMessage] = useState("");
  const [evidenceNotice, setEvidenceNotice] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [gadgetResultOverrides, setGadgetResultOverrides] = useState<Record<string, QualityDashboardBatchResponse["results"][number]>>({});
  const [refreshingGadgetIds, setRefreshingGadgetIds] = useState<string[]>([]);
  const activeGadgetRefreshesRef = useRef(new Map<string, symbol>());
  const activeDashboardScopeRef = useRef("");
  const dashboardAudiences = useMemo(
    () => canUseAutomation ? DASHBOARD_AUDIENCES : DASHBOARD_AUDIENCES.filter((audience) => audience.id !== "automation"),
    [canUseAutomation]
  );
  const dashboards = useQuery({
    queryKey: ["quality-dashboards", projectId],
    queryFn: async () => asArray(await api.qualityDashboards.list({ project_id: projectId }))
      .map((dashboard) => normalizeDashboard(dashboard, projectId)),
    enabled: Boolean(projectId)
  });
  const releaseOptions = useQuery({
    queryKey: ["dashboard-release-options", projectId],
    queryFn: async () => asArray(await api.requirementReleases.list({ project_id: projectId })),
    enabled: Boolean(projectId && canManage && editorMode && editorTab === "configure"),
    staleTime: 60_000
  });
  const builtInDashboards = useMemo(() => QUALITY_DASHBOARD_PRESETS.map(preset => createDashboardPreset(projectId, preset.id)), [projectId]);
  const selected = useMemo(
    () => [...builtInDashboards, ...(dashboards.data || [])].find(dashboard => dashboard.id === selectedId) || builtInDashboards[2],
    [builtInDashboards, dashboards.data, selectedId]
  );
  const isBuiltIn = selected?.id.startsWith("preset:");
  const availableWidgets = useMemo(() => QUALITY_WIDGET_LIBRARY.filter(widget => !widget.automation || canUseAutomation), [canUseAutomation]);
  const visibleWidgets = useMemo(() => availableWidgets.filter(widget => (widgetCategory === "All" || widget.category === widgetCategory) && `${widget.label} ${widget.description}`.toLowerCase().includes(widgetSearch.trim().toLowerCase())), [availableWidgets, widgetCategory, widgetSearch]);

  useEffect(() => {
    editorGenerationRef.current += 1;
    save.reset(); design.reset(); preview.reset(); remove.reset();
    setSelectedId("preset:quality");
    setEditorMode(null);
    setDraft(emptyDashboard(projectId));
    setMessage(""); setEvidenceNotice(""); setIsReportEmailModalOpen(false);
  }, [projectId]);

  useEffect(() => {
    if (!canUseAutomation && designerDraft.stakeholder === "automation") {
      setDesignerDraft((current) => ({ ...current, stakeholder: "quality" }));
    }
  }, [canUseAutomation, designerDraft.stakeholder]);

  const activeDashboard = editorMode && editorTab === "preview" ? draft : selected;
  const activeGadgets = asArray(activeDashboard?.gadgets);
  const evaluationKey = dashboardQueryGadgets(activeGadgets);
  const activeDashboardScope = `${projectId}:${activeDashboard?.id || "draft"}:${JSON.stringify(evaluationKey)}`;
  activeDashboardScopeRef.current = activeDashboardScope;
  const recommendedJql = useMemo(
    () => buildDefaultDashboardJql(gadgetDraft, designerDraft.release),
    [designerDraft.release, gadgetDraft.group_by, gadgetDraft.metric, gadgetDraft.title, gadgetDraft.type]
  );

  const dashboardResults = useQuery({
    queryKey: ["quality-dashboard-results", projectId, activeDashboard?.id || "draft", evaluationKey],
    queryFn: () => api.analytics.queryBatch({ project_id: projectId, gadgets: activeGadgets, limit: 100 }),
    enabled: Boolean(projectId && activeGadgets.length),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1
  });
  const resultByGadgetId = useMemo(
    () => {
      const entries = new Map<string, QualityDashboardBatchResponse["results"][number]>(
        asArray(dashboardResults.data?.results).map((entry) => [entry.gadget_id, entry])
      );
      Object.entries(gadgetResultOverrides).forEach(([gadgetId, entry]) => entries.set(gadgetId, entry));
      return entries;
    },
    [dashboardResults.data, gadgetResultOverrides]
  );
  const evaluatedWidget = (gadget: QualityDashboardGadget) => {
    const entry = resultByGadgetId.get(gadget.id);
    return entry?.result ? { ...entry, result: { ...entry.result, gadget } } : entry;
  };
  useEffect(() => {
    setGadgetResultOverrides({});
  }, [dashboardResults.dataUpdatedAt, projectId, selectedId]);
  useEffect(() => {
    activeGadgetRefreshesRef.current.clear();
    setRefreshingGadgetIds([]);
    setGadgetResultOverrides({});
  }, [activeDashboardScope]);
  useEffect(() => {
    if (!editorMode || isGadgetJqlDirty || !recommendedJql || gadgetDraft.jql === recommendedJql) return;
    setGadgetDraft((current) => ({ ...current, jql: recommendedJql }));
  }, [editorMode, gadgetDraft.jql, isGadgetJqlDirty, recommendedJql]);
  const gadgetDraftRef = useRef(gadgetDraft);
  gadgetDraftRef.current = gadgetDraft;
  const preview = useMutation({
    mutationFn: (request: DashboardEditorScope & { gadget: QualityDashboardGadget }) => api.analytics.query({ project_id: request.projectId, jql: request.gadget.jql, gadget: request.gadget, limit: 100 }),
    onError: (error, request) => {
      if (!isCurrentEditor(request) || JSON.stringify(request.gadget) !== JSON.stringify({ ...gadgetDraftRef.current, id: gadgetDraftRef.current.id || "preview" })) return;
      setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to preview the widget.");
    }
  });
  const previewIsCurrent = Boolean(preview.variables && isCurrentEditor(preview.variables) && JSON.stringify(preview.variables.gadget) === JSON.stringify({ ...gadgetDraft, id: gadgetDraft.id || "preview" }));
  const save = useMutation({
    mutationFn: async (request: DashboardEditorScope & { dashboard: QualityDashboard }) => {
      const dashboard = { ...request.dashboard, project_id: request.projectId };
      if (dashboard.id) return api.qualityDashboards.update(dashboard.id, dashboard);
      const { id: _id, ...input } = dashboard;
      return api.qualityDashboards.create(input);
    },
    onSuccess: async (saved, request) => {
      await queryClient.invalidateQueries({ queryKey: ["quality-dashboards", request.projectId] });
      if (!isCurrentEditor(request)) return;
      setMessageTone("success"); setMessage("Dashboard saved.");
      setSelectedId(saved.id); setEditorMode(null); editorGenerationRef.current += 1;
    },
    onError: (error, request) => {
      if (!isCurrentEditor(request)) return;
      setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to save the dashboard.");
    }
  });
  const remove = useMutation({
    mutationFn: (request: DashboardEditorScope & { id: string }) => api.qualityDashboards.delete(request.id),
    onSuccess: async (_response, request) => {
      await queryClient.invalidateQueries({ queryKey: ["quality-dashboards", request.projectId] });
      if (!isCurrentEditor(request) || selectedIdRef.current !== request.id) return;
      setSelectedId("preset:quality"); setDraft(emptyDashboard(request.projectId)); setEditorMode(null);
      setMessageTone("success"); setMessage("Dashboard deleted.");
    },
    onError: (error, request) => {
      if (!isCurrentEditor(request)) return;
      setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to delete the dashboard.");
    }
  });
  const downloadReport = useMutation({
    mutationFn: ({ dashboardId, snapshot }: { dashboardId: string; snapshot?: Awaited<ReturnType<typeof captureDashboardSnapshot>> }) =>
      api.qualityDashboards.downloadReportPdf(dashboardId, snapshot || undefined)
  });
  const shareReport = useMutation({
    mutationFn: ({ dashboardId, recipients, snapshot }: { dashboardId: string; recipients: string[]; snapshot?: Awaited<ReturnType<typeof captureDashboardSnapshot>> }) =>
      api.qualityDashboards.shareReport(dashboardId, { recipients, ...(snapshot || {}) })
  });
  const design = useMutation({
    mutationFn: (request: DashboardEditorScope & typeof designerDraft) => api.analytics.designDashboard({
      project_id: request.projectId, stakeholder: request.stakeholder,
      release: request.release.trim() || undefined, prompt: request.prompt.trim() || undefined
    }),
    onSuccess: (response, request) => {
      if (!isCurrentEditor(request)) return;
      const designedDashboard = normalizeDashboard(response.dashboard, request.projectId);
      setDraft(current => ({ ...designedDashboard, id: current.id, revision: current.revision, project_id: request.projectId }));
      setChosenPreset(""); setEditorTab("build"); setEditingGadgetId(""); setGadgetDraft(EMPTY_GADGET); setIsGadgetJqlDirty(false);
      setMessageTone("success"); setMessage(`Prepared ${designedDashboard.gadgets.length} widgets. Review the layout, then save.`);
    },
    onError: (error, request) => {
      if (!isCurrentEditor(request)) return;
      setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to design the dashboard.");
    }
  });

  const addGadget = () => {
    if (!gadgetDraft.title.trim()) return;
    const gadget = { ...gadgetDraft, accent: gadgetDraft.accent || "blue", id: editingGadgetId || `gadget-${crypto.randomUUID()}` };
    setDraft((current) => ({
      ...current,
      gadgets: editingGadgetId
        ? current.gadgets.map((item) => item.id === editingGadgetId ? gadget : item)
        : [...current.gadgets, gadget].slice(0, 12)
    }));
    setEditingGadgetId("");
    setGadgetDraft({ ...EMPTY_GADGET, title: "" });
    setIsGadgetJqlDirty(false);
    preview.reset();
    setEditorTab("build");
  };

  const moveGadget = (id: string, target: number) => setDraft(current => ({ ...current, gadgets: moveDashboardWidget(current.gadgets, id, target) }));
  const addPresetWidget = (widgetId: string) => {
    const preset = availableWidgets.find(item => item.id === widgetId);
    if (!preset || draft.gadgets.length >= 12) return;
    setDraft(current => current.gadgets.length >= 12 ? current : ({ ...current, gadgets: [...current.gadgets, { ...preset.gadget, id: `gadget-${crypto.randomUUID()}` }] }));
  };
  const applyPreset = (presetId: QualityDashboardPresetId) => {
    const template = createDashboardPreset(projectId, presetId);
    setDraft(current => ({ ...current, name: editorMode === "create" ? template.name : current.name, description: editorMode === "create" ? template.description : current.description, layout: template.layout, gadgets: template.gadgets }));
    setChosenPreset(presetId);
    setEditorTab("build");
  };
  const editGadget = (gadget: QualityDashboardGadget) => { setEditingGadgetId(gadget.id); setGadgetDraft(gadget); setIsGadgetJqlDirty(true); setEditorTab("configure"); preview.reset(); };
  const duplicateGadget = (gadget: QualityDashboardGadget) => setDraft(current => current.gadgets.length >= 12 ? current : ({ ...current, gadgets: [...current.gadgets, { ...gadget, id: `gadget-${crypto.randomUUID()}`, title: `${gadget.title} copy` }] }));

  const isEditorBusy = save.isPending || design.isPending;
  const closeReportEmailModal = () => {
    if (!shareReport.isPending) setIsReportEmailModalOpen(false);
  };
  const reportDialogRef = useDialogFocus<HTMLFormElement>({
    active: isReportEmailModalOpen && canManage,
    closeDisabled: shareReport.isPending,
    onClose: closeReportEmailModal
  });
  const closeEditor = () => {
    if (isEditorBusy) return;
    editorGenerationRef.current += 1;
    setEditorMode(null);
    setEditingGadgetId("");
    setGadgetDraft({ ...EMPTY_GADGET });
    setIsGadgetJqlDirty(false);
    preview.reset();
  };
  const editorDialogRef = useDialogFocus<HTMLDivElement>({
    active: Boolean(editorMode && canManage),
    closeDisabled: isEditorBusy,
    onClose: closeEditor
  });
  const openCreateEditor = () => {
    editorGenerationRef.current += 1;
    setMessage("");
    setDraft({ ...createDashboardPreset(projectId, "quality"), id: "" });
    setChosenPreset("quality");
    setEditorTab("build");
    setWidgetSearch("");
    setWidgetCategory("All");
    setEditingGadgetId("");
    setGadgetDraft({ ...EMPTY_GADGET });
    setIsGadgetJqlDirty(false);
    setDesignerDraft({ stakeholder: "quality", release: "", prompt: DEFAULT_COMPLEX_DASHBOARD_PROMPT });
    design.reset();
    preview.reset();
    setEditorMode("create");
  };
  const openEditEditor = () => {
    if (!selected) return;
    editorGenerationRef.current += 1;
    setMessage("");
    setDraft({ ...selected, id: isBuiltIn ? "" : selected.id, gadgets: selected.gadgets.map((gadget) => ({ ...gadget })) });
    setChosenPreset(isBuiltIn ? selected.id.slice(7) as QualityDashboardPresetId : "");
    setEditorTab("build");
    setWidgetSearch("");
    setWidgetCategory("All");
    setEditingGadgetId("");
    setGadgetDraft({ ...EMPTY_GADGET });
    setIsGadgetJqlDirty(false);
    preview.reset();
    setEditorMode(isBuiltIn ? "create" : "edit");
  };
  const deleteSelectedDashboard = async () => {
    if (!selected) return;
    const request = { id: selected.id, projectId, editorGeneration: editorGenerationRef.current };
    const confirmed = await confirmDelete({
      title: "Delete quality dashboard?",
      message: `${selected.name || "This dashboard"} and its gadget configuration will be removed from this project.`,
      confirmLabel: "Delete dashboard"
    });
    if (confirmed && isCurrentEditor(request) && selectedIdRef.current === request.id) remove.mutate(request);
  };
  const handleDownloadReport = async () => {
    if (!selected) return;
    try {
      if (isDashboardRefreshPending) throw new Error("Wait for every dashboard widget to finish refreshing before exporting.");
      if (!reportSurfaceRef.current) throw new Error("The live custom dashboard is not ready to export. Refresh and retry.");
      const snapshot = await captureDashboardSnapshot(reportSurfaceRef.current, selected.name);
      const blob = await downloadReport.mutateAsync({ dashboardId: selected.id, snapshot });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(selected.name || "HelloTest-dashboard-report").replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessageTone("success");
      setMessage("Dashboard report PDF exported.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to export dashboard report.");
    }
  };
  const handleOpenReportEmailModal = () => {
    setReportEmailDraft(session?.user.email || "");
    setIsReportEmailModalOpen(true);
  };
  const handleShareReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const recipients = reportEmailDraft.split(/[,\n;]/).map((entry) => entry.trim()).filter(Boolean);
    if (!recipients.length) {
      setMessageTone("error");
      setMessage("Enter at least one dashboard report recipient.");
      return;
    }
    try {
      if (isDashboardRefreshPending) throw new Error("Wait for every dashboard widget to finish refreshing before emailing the report.");
      if (!reportSurfaceRef.current) throw new Error("The live custom dashboard is not ready to email. Refresh and retry.");
      const snapshot = await captureDashboardSnapshot(reportSurfaceRef.current, selected.name);
      const response = await shareReport.mutateAsync({ dashboardId: selected.id, recipients, snapshot });
      setIsReportEmailModalOpen(false);
      setMessageTone("success");
      setMessage(`Dashboard report emailed to ${response.recipients} recipient${response.recipients === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to email dashboard report.");
    }
  };
  const handleGadgetDrilldown = (result: QualityDashboardGadgetResult, groupLabel?: string, row?: QualityDashboardEvidenceRow) => {
    try {
      if (result.gadget.data_source === "hellotest") {
        const target = buildQualityDashboardDrilldown(result, { projectId, groupLabel, row });
        setEvidenceNotice(target.notice || "");
        window.open(target.url, "_blank", "noopener,noreferrer");
      } else openDashboardDrilldown(result, groupLabel);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to open the dashboard drill-down.");
    }
  };
  const refreshGadget = async (gadget: QualityDashboardGadget) => {
    if (!projectId || dashboardResults.isFetching || activeGadgetRefreshesRef.current.has(gadget.id)) return;
    if (activeGadgetRefreshesRef.current.size >= 2) {
      setMessageTone("error");
      setMessage("Two dashboard widgets are already refreshing. Wait for one to finish, then retry.");
      return;
    }
    const requestToken = Symbol(gadget.id);
    const requestScope = activeDashboardScopeRef.current;
    activeGadgetRefreshesRef.current.set(gadget.id, requestToken);
    setRefreshingGadgetIds((current) => [...new Set([...current, gadget.id])]);
    try {
      const result = await api.analytics.query({ project_id: projectId, jql: gadget.jql, gadget, limit: 100 });
      if (activeDashboardScopeRef.current === requestScope && activeGadgetRefreshesRef.current.get(gadget.id) === requestToken) {
        setGadgetResultOverrides((current) => ({
          ...current,
          [gadget.id]: { gadget_id: gadget.id, result }
        }));
      }
    } catch (error) {
      if (activeDashboardScopeRef.current === requestScope && activeGadgetRefreshesRef.current.get(gadget.id) === requestToken) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : `Unable to refresh ${gadget.title}.`);
      }
    } finally {
      if (activeGadgetRefreshesRef.current.get(gadget.id) === requestToken) {
        activeGadgetRefreshesRef.current.delete(gadget.id);
        setRefreshingGadgetIds((current) => current.filter((gadgetId) => gadgetId !== gadget.id));
      }
    }
  };
  const refreshDashboards = async () => {
    setGadgetResultOverrides({});
    await Promise.all([
      dashboards.refetch(),
      activeGadgets.length ? dashboardResults.refetch() : Promise.resolve()
    ]);
  };
  const isDashboardRefreshPending = dashboards.isFetching || dashboardResults.isFetching || refreshingGadgetIds.length > 0;
  const isGadgetRefreshPending = (gadgetId: string) => dashboardResults.isFetching || refreshingGadgetIds.includes(gadgetId);



  return (
    <div className="custom-dashboard-workspace">
      <header className="dashboard-page-header">
        <div className="dashboard-page-title"><span className="dashboard-page-icon"><IconLayoutDashboard size={23} /></span><div><h1>Custom Dashboards</h1><p>Turn project evidence into the next decision.</p></div></div>
        {canManage ? (<button className="primary-button" disabled={!canManage} onClick={openCreateEditor} type="button"><IconPlus size={17} />Create dashboard</button>) : null}
      </header>
      <nav className="dashboard-preset-navigation" aria-label="Preloaded dashboards">
        {QUALITY_DASHBOARD_PRESETS.map((preset, index) => {
          const Icon = [IconBriefcase, IconBox, IconTestPipe, IconLayoutDashboard, IconChartBar, IconSearch][index] || IconLayoutDashboard;
          const descriptions = { executive: "Confidence & release risk", product: "Coverage & product health", quality: "Execution & investigation", traceability: "Stories, tests & evidence", delivery: "Development & QA progress", triage: "Defects & failing tests" };
          return <button key={preset.id} type="button" aria-pressed={selectedId === `preset:${preset.id}`} className={selectedId === `preset:${preset.id}` ? "is-active" : ""} onClick={() => setSelectedId(`preset:${preset.id}`)}><Icon size={21} /><span><strong>{preset.label}</strong><small>{descriptions[preset.id]}</small></span><IconArrowRight size={16} /></button>;
        })}
      </nav>
      <div className="custom-dashboard-toolbar">
        <FormField className="custom-dashboard-selector-field" label="Current dashboard"><select value={selected.id} onChange={event => setSelectedId(event.target.value)}><optgroup label="Ready to use">{builtInDashboards.map(dashboard => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}</optgroup>{dashboards.data?.length ? <optgroup label="Saved in this project">{dashboards.data.map(dashboard => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}</optgroup> : null}</select></FormField>
        <div className="custom-dashboard-toolbar-actions">
          <span className="dashboard-freshness" role="status">{isDashboardRefreshPending ? "Updating project evidence…" : dashboardResults.data?.evaluated_at ? `Updated ${new Date(dashboardResults.data.evaluated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Project evidence"}</span>
          {canManage ? (<button className="ghost-button" disabled={!canManage} onClick={openEditEditor} type="button"><IconSettings size={16} />{isBuiltIn ? "Customize" : "Edit layout"}</button>) : null}
          <button aria-label={isDashboardRefreshPending ? "Refreshing dashboards" : "Refresh dashboards"} aria-busy={isDashboardRefreshPending} className={`ghost-button compact custom-dashboard-refresh${isDashboardRefreshPending ? " is-loading" : ""}`} disabled={isDashboardRefreshPending} onClick={() => void refreshDashboards()} title="Refresh dashboard evidence" type="button">{isDashboardRefreshPending ? <LoadingState label="Refreshing dashboard evidence" /> : <RefreshIcon size={17} />}</button>
          {!isBuiltIn ? <details className="dashboard-actions-menu" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label="Dashboard actions"><IconDots size={19} /></summary><div><button disabled={downloadReport.isPending || isDashboardRefreshPending} onClick={() => void handleDownloadReport()} type="button">{downloadReport.isPending ? "Exporting…" : "Export PDF"}</button>{canManage ? (<button disabled={!canManage || shareReport.isPending || isDashboardRefreshPending} onClick={handleOpenReportEmailModal} type="button">Email report</button>) : null}{canManage ? (<button className="danger" disabled={!canManage || remove.isPending} onClick={() => void deleteSelectedDashboard()} type="button">{remove.isPending ? "Deleting…" : "Delete dashboard"}</button>) : null}</div></details> : null}
        </div>
      </div>
      {dashboards.isError ? <div className="inline-message error-message" role="alert">Saved dashboards could not be loaded. Starter dashboards are still available. <button type="button" onClick={() => void dashboards.refetch()}>Retry saved dashboards</button></div> : null}
      {evidenceNotice ? <p className="dashboard-evidence-notice" role="status">{evidenceNotice}<button type="button" aria-label="Dismiss evidence notice" onClick={() => setEvidenceNotice("")}><IconX size={15} /></button></p> : null}
      <section className="custom-dashboard-view custom-dashboard-report-surface" aria-label={selected.name} ref={reportSurfaceRef}>
        <div className="custom-dashboard-view-head"><div><h2>{selected.name}</h2><span>{selected.description}</span></div><span className="dashboard-scope-badge">{isBuiltIn ? "Starter dashboard" : "Project dashboard"}<span>{selected.gadgets.length} widgets</span></span></div>
        {dashboardResults.isError ? <div className="dashboard-gadget-error" role="alert"><strong>Project evidence could not be loaded</strong><span>{dashboardResults.error instanceof Error ? dashboardResults.error.message : "Refresh to try again."}</span><button className="ghost-button" onClick={() => void dashboardResults.refetch()} type="button">Retry dashboard</button></div> : null}
        <div className={`quality-gadget-grid layout-${selected.layout}`}>
          {selected.gadgets.map(gadget => {
            const evaluated = evaluatedWidget(gadget);
            return <div className={`quality-gadget-shell kind-${gadget.type}`} key={gadget.id}>
              {dashboardResults.isLoading || !evaluated && !dashboardResults.isError ? <LoadingState label={`Loading project evidence for ${gadget.title}`} /> : null}
              {evaluated?.result ? <QualityGadget isRefreshing={isGadgetRefreshPending(gadget.id)} onDrilldown={groupLabel => handleGadgetDrilldown(evaluated.result!, groupLabel)} onRefresh={() => void refreshGadget(gadget)} onRowDrilldown={row => handleGadgetDrilldown(evaluated.result!, undefined, row)} result={evaluated.result} /> : null}
              {evaluated?.error ? <div className="dashboard-gadget-error" role="alert"><strong>{gadget.title}</strong><span>{evaluated.error.message}</span><button className="ghost-button compact" disabled={isGadgetRefreshPending(gadget.id)} onClick={() => void refreshGadget(gadget)} type="button">{isGadgetRefreshPending(gadget.id) ? "Refreshing…" : "Retry widget"}</button></div> : null}
            </div>;
          })}
        </div>
      </section>

      {editorMode && canManage ? (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={closeEditor} role="presentation">
          <div
            aria-labelledby="custom-dashboard-dialog-title"
            aria-modal="true"
            className="modal-card custom-dashboard-modal"
            onClick={(event) => event.stopPropagation()}
            ref={editorDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="modal-card-head custom-dashboard-modal-head">
              <div><span className="eyebrow">Quality intelligence</span><h3 id="custom-dashboard-dialog-title">{editorMode === "create" ? "Create dashboard" : "Edit dashboard"}</h3><p>Choose a starting point, arrange the signals, and make it yours.</p></div>
              <DialogCloseButton disabled={isEditorBusy} label={`Close ${editorMode} dashboard dialog`} onClick={closeEditor} />
            </div>

            <div className="custom-dashboard-modal-body">
              <fieldset className="dashboard-editor-fields" disabled={isEditorBusy}>
              <div className="dashboard-editor-identity"><FormField label="Dashboard name" required><input required data-autofocus="true" maxLength={120} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></FormField><FormField label="Description"><input maxLength={500} placeholder="What decisions should this dashboard support?" value={draft.description || ""} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></FormField></div>
              {editorMode === "create" ? <section className="dashboard-starting-points" aria-label="Dashboard starting points"><span>Start with</span>{QUALITY_DASHBOARD_PRESETS.map(preset => <button key={preset.id} aria-pressed={chosenPreset === preset.id} className={chosenPreset === preset.id ? "is-active" : ""} onClick={() => applyPreset(preset.id)} type="button">{chosenPreset === preset.id ? <IconCheck size={15} /> : null}{preset.label}<small>{preset.widgets.length} widgets</small></button>)}<button aria-pressed={chosenPreset === "" && !draft.gadgets.length} onClick={() => { setDraft(current => ({ ...current, gadgets: [] })); setChosenPreset(""); }} type="button">Blank canvas</button></section> : null}
              <div className="dashboard-editor-tabs" role="tablist" aria-label="Dashboard editor" onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')); const index = tabs.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; event.preventDefault(); tabs[next]?.click(); tabs[next]?.focus(); }}><button type="button" role="tab" aria-selected={editorTab === "build"} tabIndex={editorTab === "build" ? 0 : -1} aria-controls="dashboard-builder-panel" onClick={() => setEditorTab("build")}><IconLayoutDashboard size={16} />Build layout</button><button type="button" role="tab" aria-selected={editorTab === "preview"} tabIndex={editorTab === "preview" ? 0 : -1} aria-controls="dashboard-preview-panel" disabled={!draft.gadgets.length} onClick={() => setEditorTab("preview")}><IconChartBar size={16} />Preview data</button>{editorTab === "configure" ? <button type="button" role="tab" aria-selected aria-controls="dashboard-configure-panel"><IconSettings size={16} />Configure widget</button> : null}{canUseAi ? <button type="button" role="tab" aria-selected={editorTab === "ai"} tabIndex={editorTab === "ai" ? 0 : -1} aria-controls="dashboard-ai-panel" onClick={() => setEditorTab("ai")}><SparkIcon size={16} />AI designer</button> : null}</div>
              {editorTab === "build" ? <div className="dashboard-builder-grid" id="dashboard-builder-panel" role="tabpanel" aria-label="Build layout">
                <section className="dashboard-widget-library" aria-label="Quality dashboard widget library">
                  <div className="dashboard-builder-section-head"><div><h4>Widget library</h4><span>Useful signals, ready to add.</span></div><span>{availableWidgets.length} widgets</span></div>
                  <label className="dashboard-widget-search"><IconSearch size={17} /><input aria-label="Search widgets" placeholder="Search coverage, defects, runs…" value={widgetSearch} onChange={event => setWidgetSearch(event.target.value)} /></label>
                  <div className="dashboard-widget-categories" aria-label="Widget categories">{["All", "Release", "Product", "Execution", "Coverage"].map(category => <button type="button" key={category} aria-pressed={widgetCategory === category} className={widgetCategory === category ? "is-active" : ""} onClick={() => setWidgetCategory(category)}>{category}</button>)}</div>
                  <div className="dashboard-widget-preset-grid">{visibleWidgets.map(preset => {
                    const count = draft.gadgets.filter(gadget => gadget.metric === preset.gadget.metric && gadget.type === preset.gadget.type && gadget.group_by === preset.gadget.group_by).length;
                    return <button className="dashboard-widget-preset" key={preset.id} disabled={draft.gadgets.length >= 12} onClick={() => addPresetWidget(preset.id)} aria-label={`Add ${preset.label}`} type="button"><span className={`dashboard-widget-symbol accent-${preset.gadget.accent}`}><WidgetIcon type={preset.gadget.type} /></span><span className="dashboard-widget-preset-copy"><strong>{preset.label}</strong><span>{preset.description}</span><small>{preset.category} · {widgetTypeLabel(preset.gadget.type)}</small></span><span className="dashboard-widget-add">{count ? <><IconCheck size={14} /><small>{count}</small></> : <IconPlus size={17} />}</span></button>;
                  })}</div>
                  {!visibleWidgets.length ? <div className="empty-state compact">No widgets match this search. Try a broader term.</div> : null}
                  <button className="ghost-button dashboard-custom-widget" onClick={() => { setEditingGadgetId(""); setGadgetDraft({ ...EMPTY_GADGET }); setIsGadgetJqlDirty(false); setEditorTab("configure"); preview.reset(); }} type="button"><IconSettings size={16} />Configure a custom widget</button>
                </section>
                <section className="dashboard-arrangement" aria-label="Dashboard layout">
                  <div className="dashboard-builder-section-head"><div><h4>Your layout</h4><span>Drag to reorder, or choose a position.</span></div><strong className={draft.gadgets.length >= 12 ? "is-full" : ""}>{draft.gadgets.length} / 12</strong></div>
                  <div className="dashboard-layout-options" role="group" aria-label="Layout density">{([{ id: "single", label: "Focused", description: "One column" }, { id: "two-column", label: "Balanced", description: "Metrics + two columns" }, { id: "three-column", label: "Dense", description: "Three columns" }] as const).map(layout => <button type="button" key={layout.id} aria-pressed={draft.layout === layout.id} className={draft.layout === layout.id ? "is-active" : ""} onClick={() => setDraft(current => ({ ...current, layout: layout.id }))}><IconLayoutDashboard size={16} /><strong>{layout.label}</strong><small>{layout.description}</small></button>)}</div>
                  <ol className="dashboard-widget-order">{draft.gadgets.map((gadget, index) => <li key={gadget.id} draggable={!isEditorBusy} className={draggedWidgetId === gadget.id ? "is-dragging" : ""} onDragStart={event => { setDraggedWidgetId(gadget.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", gadget.id); }} onDragEnd={() => setDraggedWidgetId("")} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={event => { event.preventDefault(); if (draggedWidgetId) moveGadget(draggedWidgetId, index); setDraggedWidgetId(""); }}>
                    <IconGripVertical className="dashboard-drag-handle" size={16} aria-hidden="true" /><select aria-label={`Position of ${gadget.title}`} value={index} onChange={event => moveGadget(gadget.id, Number(event.target.value))}>{draft.gadgets.map((item, position) => <option key={item.id} value={position}>{position + 1}</option>)}</select><span className="dashboard-order-copy"><strong>{gadget.title}</strong><small>{widgetTypeLabel(gadget.type)}</small></span><button aria-label={`Configure ${gadget.title}`} title="Configure widget" onClick={() => editGadget(gadget)} type="button"><IconSettings size={16} /></button><button aria-label={`Duplicate ${gadget.title}`} title="Duplicate widget" disabled={draft.gadgets.length >= 12} onClick={() => duplicateGadget(gadget)} type="button"><IconCopy size={15} /></button><button aria-label={`Remove ${gadget.title}`} title="Remove widget" onClick={() => setDraft(current => ({ ...current, gadgets: current.gadgets.filter(item => item.id !== gadget.id) }))} type="button"><IconX size={16} /></button>
                  </li>)}</ol>
                  {!draft.gadgets.length ? <div className="dashboard-empty-layout"><IconLayoutDashboard size={30} /><strong>Make room for the right signals</strong><span>Add widgets from the library to build your dashboard.</span></div> : null}
                  <p className="dashboard-layout-note">{draft.gadgets.length >= 12 ? "Your layout is full. Remove a widget to add another." : "Preview data when the layout is ready. Changes stay in this draft until you save."}</p>
                </section>
              </div> : null}
              {editorTab === "preview" ? <section id="dashboard-preview-panel" role="tabpanel" aria-label="Preview data"><div className="dashboard-builder-section-head"><div><h4>{draft.name || "Dashboard preview"}</h4><span>Current project evidence in your selected layout.</span></div></div>{dashboardResults.isError ? <div className="dashboard-gadget-error" role="alert"><strong>Preview could not be loaded</strong><span>{dashboardResults.error instanceof Error ? dashboardResults.error.message : "Try again."}</span><button type="button" className="ghost-button" onClick={() => void dashboardResults.refetch()}>Retry preview</button></div> : null}<div className={`quality-gadget-grid layout-${draft.layout}`}>{draft.gadgets.map(gadget => {
                const evaluated = evaluatedWidget(gadget);
                return <div className={`quality-gadget-shell kind-${gadget.type}`} key={gadget.id}>{dashboardResults.isLoading ? <LoadingState label={`Loading project evidence for ${gadget.title}`} /> : null}{evaluated?.result ? <QualityGadget result={evaluated.result} onRowDrilldown={row => handleGadgetDrilldown(evaluated.result!, undefined, row)} onDrilldown={groupLabel => handleGadgetDrilldown(evaluated.result!, groupLabel)} /> : null}{evaluated?.error ? <div className="dashboard-gadget-error" role="alert"><strong>{gadget.title}</strong><span>{evaluated.error.message}</span></div> : null}</div>;
              })}</div></section> : null}
              {editorTab === "configure" ? <section id="dashboard-configure-panel" className="dashboard-configure-panel" role="tabpanel" aria-label="Configure widget"><div className="dashboard-builder-section-head"><div><h4>{editingGadgetId ? "Configure widget" : "Create a custom widget"}</h4><span>Choose a signal and presentation, then apply it to your layout.</span></div></div>
                  <div className="custom-gadget-builder">
                    <div className="form-grid">
                      <FormField label="Gadget title" required><input maxLength={100} value={gadgetDraft.title} onChange={(event) => setGadgetDraft((current) => ({ ...current, title: event.target.value }))} /></FormField>
                      <div className="record-grid">
                        <FormField label="Data source">
                          <select
                            value={gadgetDraft.data_source || "jira"}
                            onChange={(event) => {
                              const dataSource = event.target.value as NonNullable<QualityDashboardGadget["data_source"]>;
                              setIsGadgetJqlDirty(false);
                              setGadgetDraft((current) => {
                                const next = {
                                  ...current,
                                  data_source: dataSource,
                                  metric: dataSource === "hellotest" && !HELLOTEST_DERIVED_METRICS.has(current.metric) ? "testCases" as const : current.metric
                                };
                                return { ...next, jql: dataSource === "hellotest" ? "" : buildDefaultDashboardJql(next, designerDraft.release) };
                              });
                            }}
                          >
                            <option value="jira" disabled>Legacy JQL · source unavailable</option>
                            <option value="hellotest">HelloTest derived quality</option>
                          </select>
                        </FormField>
                        <FormField label="Visualization"><select value={gadgetDraft.type} onChange={(event) => setGadgetDraft((current) => ({ ...current, type: event.target.value as QualityDashboardGadget["type"] }))}><option value="metric">Metric</option><option value="donut">Donut</option><option value="bar">Horizontal Bar</option><option value="column">Column Chart</option><option value="stacked-bar">Stacked bar</option><option value="line">Trend Line</option><option value="area">Area Chart</option><option value="table">Evidence List</option></select></FormField>
                        <FormField label="Group by"><select value={gadgetDraft.group_by} onChange={(event) => setGadgetDraft((current) => ({ ...current, group_by: event.target.value as QualityDashboardGadget["group_by"] }))}><option value="status">Status</option><option value="statusCategory">Status category</option><option value="priority">Priority</option><option value="issuetype">Work Type</option><option value="assignee">Assignee</option><option value="reporter">Reporter</option><option value="components">Component</option><option value="release">Release</option>{gadgetDraft.group_by === "fixVersion" ? <option value="fixVersion">Release (Legacy Grouping)</option> : null}<option value="story">Linked Story</option><option value="sprint">Sprint</option><option value="module">HelloTest module</option><option value="labels">Labels</option><option value="resolution">Resolution</option><option value="createdWeek">Created week</option><option value="updatedWeek">Updated week</option><option value="createdMonth">Created month</option><option value="updatedMonth">Updated month</option></select></FormField>
                        <FormField label="Query / Metric">
                          <select
                            value={gadgetDraft.metric || "count"}
                            onChange={(event) => {
                              const metric = event.target.value as QualityDashboardGadget["metric"];
                              setIsGadgetJqlDirty(false);
                              setGadgetDraft((current) => ({
                                ...current,
                                metric,
                                ...(HELLOTEST_DERIVED_METRICS.has(metric) ? { data_source: "hellotest" as const, jql: "" } : {})
                              }));
                            }}
                          >
                            {!HELLOTEST_DERIVED_METRICS.has(gadgetDraft.metric) ? <option value={gadgetDraft.metric || "count"} disabled>Legacy metric · select a supported signal</option> : null}
                            {[...new Set(QUALITY_QUERY_LIBRARY.map(query => query.category))].map(category => <optgroup key={category} label={category}>{QUALITY_QUERY_LIBRARY.filter(query => query.category === category && (!query.automation || canUseAutomation)).map(query => <option key={query.metric} value={query.metric}>{metricTitle(query.label)}</option>)}</optgroup>)}
                          </select>
                        </FormField>
                        <FormField label="Accent"><select value={gadgetDraft.accent || "blue"} onChange={(event) => setGadgetDraft((current) => ({ ...current, accent: event.target.value as QualityDashboardGadget["accent"] }))}>{DASHBOARD_ACCENTS.map((accent) => <option key={accent.id} value={accent.id}>{accent.label}</option>)}</select></FormField>
                        <FormField label="Release Scope" hint={releaseOptions.isError ? "Release options could not be loaded. The current scope is preserved." : "All project records, or stories and runs linked to one release."}><select value={gadgetDraft.release || ""} onChange={event => setGadgetDraft(current => ({ ...current, release: event.target.value || undefined }))}><option value="">Entire Project</option>{gadgetDraft.release && !releaseOptions.data?.some(release => release.id === gadgetDraft.release) ? <option value={gadgetDraft.release}>{gadgetDraft.release} (Saved Scope)</option> : null}{releaseOptions.data?.map(release => <option key={release.id} value={release.id}>{release.name}</option>)}</select></FormField>
                      </div>
                      {gadgetDraft.data_source !== "hellotest" ? <><FormField label="JQL" hint="Auto-filled from the gadget title, chart, metric, grouping and release; HelloTest always adds the active project server-side."><textarea maxLength={2000} rows={4} value={gadgetDraft.jql} onChange={(event) => { setIsGadgetJqlDirty(true); setGadgetDraft((current) => ({ ...current, jql: event.target.value })); }} /></FormField><div className="dashboard-jql-recommendation"><span>Suggested JQL: <code>{recommendedJql}</code></span><button className="ghost-button compact" onClick={() => { setIsGadgetJqlDirty(false); setGadgetDraft((current) => ({ ...current, jql: recommendedJql })); }} type="button">Use suggested JQL</button></div></> : <div className="dashboard-derived-note"><strong>{QUALITY_QUERY_LIBRARY.find(query => query.metric === gadgetDraft.metric)?.relationship || "Saved Project Evidence"}</strong><span>{QUALITY_QUERY_LIBRARY.find(query => query.metric === gadgetDraft.metric)?.description} Every query uses the active project and selected release. Shared relationships count each record once in the total.</span></div>}
                      <div className="action-row"><button className="ghost-button" disabled={preview.isPending} onClick={() => preview.mutate({ gadget: { ...gadgetDraft, id: gadgetDraft.id || "preview" }, projectId, editorGeneration: editorGenerationRef.current })} type="button">{preview.isPending ? "Running…" : "Preview"}</button><button className="primary-button" disabled={!gadgetDraft.title.trim() || gadgetDraft.data_source !== "hellotest" || !HELLOTEST_DERIVED_METRICS.has(gadgetDraft.metric) || (!editingGadgetId && draft.gadgets.length >= 12)} onClick={addGadget} type="button">{editingGadgetId ? "Apply widget changes" : "Add widget"}</button>{editingGadgetId ? <button className="ghost-button" onClick={() => { setEditingGadgetId(""); setGadgetDraft({ ...EMPTY_GADGET, title: "" }); setIsGadgetJqlDirty(false); setEditorTab("build"); }} type="button">Cancel edit</button> : null}</div>
                    </div>
                    {preview.data && previewIsCurrent ? <QualityGadget onDrilldown={(groupLabel) => handleGadgetDrilldown(preview.data!, groupLabel)} onRowDrilldown={row => handleGadgetDrilldown(preview.data!, undefined, row)} result={preview.data} /> : null}
                  </div>

              </section> : null}
              {editorTab === "ai" && canUseAi ? <section id="dashboard-ai-panel" role="tabpanel" aria-label="AI dashboard designer">
                <section className="dashboard-designer card" aria-label="AI-assisted dashboard designer">
                  <div className="dashboard-designer-head"><span className="dashboard-designer-icon"><SparkIcon /></span><div><strong>AI-assisted dashboard designer</strong><span>Creates an explainable, editable draft from quality-engineering patterns. Review and adjust the suggested layout before saving.</span></div></div>
                  <div className="dashboard-audience-grid">
                    {dashboardAudiences.map((audience) => (
                      <button className={designerDraft.stakeholder === audience.id ? "dashboard-audience-card is-active" : "dashboard-audience-card"} key={audience.id} onClick={() => setDesignerDraft((current) => ({ ...current, stakeholder: audience.id }))} type="button"><strong>{audience.label}</strong><span>{audience.detail}</span></button>
                    ))}
                  </div>
                  <div className="dashboard-designer-fields">
                    <FormField label="Release / Fix version" hint="Optional; safely added to generated JQL."><input value={designerDraft.release} onChange={(event) => setDesignerDraft((current) => ({ ...current, release: event.target.value }))} /></FormField>
                    <FormField className="dashboard-designer-prompt" label="Dashboard build prompt" hint="Use this rich default, erase it, or write your own bounded quality-dashboard brief."><textarea maxLength={2000} rows={5} value={designerDraft.prompt} onChange={(event) => setDesignerDraft((current) => ({ ...current, prompt: event.target.value }))} /></FormField>
                    {canManage ? (<button className="primary-button" disabled={!canManage || design.isPending} onClick={() => design.mutate({ ...designerDraft, projectId, editorGeneration: editorGenerationRef.current })} type="button"><SparkIcon />{design.isPending ? "Designing…" : "Design draft"}</button>) : null}
                  </div>
                  {design.data ? <>
                    <div className="dashboard-design-assurance"><span>{design.data.generation_mode === "llm" ? "Model draft" : "Stakeholder template"}</span><span>{asArray(design.data.dashboard?.gadgets).length} supported widgets</span><span>Review before saving</span></div>
                    <p className="helper-text">{design.data.provenance?.design_basis || "Review metric choices and layout against your question. No design accuracy score is calculated."}</p>
                    {design.data.fallback_used && design.data.fallback_reason ? <p className="helper-text">{design.data.fallback_reason}</p> : null}
                  </> : null}
                </section>
              </section> : null}
              </fieldset>
            </div>

            <div className="action-row custom-dashboard-modal-actions"><span>{draft.gadgets.length} widgets · {editorTab === "configure" ? "Apply widget changes to continue" : "Changes are saved to this project"}</span><button className="ghost-button" disabled={isEditorBusy} onClick={closeEditor} type="button">Cancel</button>{canManage ? (<button className="primary-button" disabled={!canManage || !draft.name.trim() || !draft.gadgets.length || isEditorBusy || editorTab === "configure"} onClick={() => save.mutate({ dashboard: draft, projectId, editorGeneration: editorGenerationRef.current })} type="button">{save.isPending ? "Saving…" : editorMode === "create" ? "Create dashboard" : "Save changes"}</button>) : null}</div>
          </div>
        </div>
      ) : null}
      {selected && isReportEmailModalOpen && canManage ? (
        <div className="modal-backdrop" onClick={closeReportEmailModal} role="presentation">
          <form
            aria-labelledby="dashboard-report-email-title"
            aria-modal="true"
            className="modal-card report-email-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void handleShareReport(event)}
            ref={reportDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="modal-card-head">
              <div>
                <h3 id="dashboard-report-email-title">Email dashboard report</h3>
                <p>Send {selected.name} as a PDF attachment to the specified recipients.</p>
              </div>
              <DialogCloseButton disabled={shareReport.isPending} label="Close report email dialog" onClick={closeReportEmailModal} />
            </div>
            <FormField label="Recipients" hint="Use workspace account IDs or visible email addresses, separated by comma, semicolon, or new line.">
              <textarea data-autofocus="true" rows={4} value={reportEmailDraft} onChange={(event) => setReportEmailDraft(event.target.value)} />
            </FormField>
            <div className="action-row">
              <button className="ghost-button" disabled={shareReport.isPending} onClick={closeReportEmailModal} type="button">Cancel</button>
              <button className="primary-button" disabled={shareReport.isPending || isDashboardRefreshPending || !reportEmailDraft.trim()} type="submit">{shareReport.isPending ? "Sending…" : "Send report"}</button>
            </div>
          </form>
        </div>
      ) : null}
      {message ? <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} /> : null}
      {confirmationDialog}
    </div>
  );
}

function widgetTypeLabel(type: QualityDashboardGadget["type"]) { return ({ metric: "Metric", donut: "Donut chart", bar: "Bar chart", "stacked-bar": "Stacked bar", line: "Trend", area: "Area Chart", column: "Column Chart", table: "Evidence list" })[type]; }
function WidgetIcon({ type }: { type: QualityDashboardGadget["type"] }) { const Icon = ({ metric: IconNumber, donut: IconChartDonut, bar: IconChartBar, "stacked-bar": IconChartBar, line: IconChartLine, area: IconChartLine, column: IconChartBar, table: IconTable })[type]; return <Icon size={19} aria-hidden="true" />; }

function QualityGadget({
  result,
  onDrilldown,
  onRowDrilldown,
  onRefresh,
  isRefreshing = false
}: {
  result: QualityDashboardGadgetResult;
  onDrilldown?: (groupLabel?: string) => void;
  onRowDrilldown?: (row: QualityDashboardEvidenceRow) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const { getMetricCriteria } = useAiPromptRegistry();
  const gadget = result.gadget && typeof result.gadget === "object" ? result.gadget : EMPTY_GADGET;
  const allSeries = asArray(result.series);
  const series = ["donut", "stacked-bar", "column"].includes(gadget.type) ? compactDashboardSeries(allSeries, gadget.type === "column" ? 12 : 8) : allSeries;
  const rows = asArray(result.rows);
  const maximum = Math.max(...series.map((item) => Number(item.value) || 0), 1);
  const accent = gadget.accent || "blue";
  const palette = GADGET_ACCENT_PALETTES[accent] || GADGET_ACCENT_PALETTES.blue;
  const gadgetStyle = {
    "--hellotest-gadget-accent": palette[0],
    "--hellotest-gadget-accent-soft": `${palette[0]}18`
  } as CSSProperties;
  const seriesTotal = Math.max(series.reduce((sum, item) => sum + (Number(item.value) || 0), 0), 1);
  let cursor = 0;
  const donutStops = series.map((item, index) => {
    const start = cursor;
    cursor += (item.value / seriesTotal) * 100;
    return `${palette[index % palette.length]} ${start}% ${cursor}%`;
  }).join(", ");
  const linePoints = series.map((item, index) => {
    const x = series.length <= 1 ? 150 : (index / (series.length - 1)) * 280 + 10;
    const y = 108 - (item.value / maximum) * 92;
    return `${x},${y}`;
  }).join(" ");
  const isPercentageMetric = ["resolutionRate", "requirementCoverage", "automationCoverage", "passRate", "executionCompletion", "evidenceConfidence", "releaseConfidence", "devStoryCompletion", "qaStoryCompletion", "storyTestPassRate", "storyExecutionCoverage", "defectTraceability"].includes(gadget.metric || "");
  const criteriaKey = gadget.metric ? DASHBOARD_METRIC_CRITERIA_KEYS[gadget.metric] : undefined;
  return (
    <article className={`quality-gadget type-${gadget.type} tone-${resultTone(result)} accent-${accent}`} style={gadgetStyle}>
      <div className="quality-gadget-head">
        <strong>{metricTitle(gadget.title)}</strong>
        <div className="quality-gadget-controls">
          <span className="quality-widget-type"><WidgetIcon type={gadget.type} /></span>
          {onRefresh ? (
            <button aria-busy={isRefreshing} aria-label={isRefreshing ? `Refreshing ${gadget.title}` : `Refresh ${gadget.title}`} className={`quality-gadget-control${isRefreshing ? " is-loading" : ""}`} disabled={isRefreshing} onClick={onRefresh} title={`Refresh ${gadget.title}`} type="button">
              {isRefreshing ? <LoadingState label={`Refreshing ${gadget.title}`} /> : <RefreshIcon size={15} />}
            </button>
          ) : null}
          {onDrilldown ? (
            <button aria-label={`Open ${gadget.title} drill-down in a new tab`} className="quality-gadget-control quality-gadget-open" onClick={() => onDrilldown()} title="Open drill-down in a new tab" type="button">
              <OpenIcon size={14} />
              <span>Open</span>
            </button>
          ) : null}
        </div>
      </div>
      {gadget.type === "metric" ? <div className="quality-metric-value"><strong>{isPercentageMetric ? `${Number(result.value) || 0}%` : Number(result.value) || 0}</strong><span className="quality-metric-value-label">{metricTitle(result.value_label || "Result")}{criteriaKey ? <MetricMethodologyInfo criteriaKey={criteriaKey} evidence={`${result.methodology || "Project-scoped evaluated evidence"} ${Number(result.returned) || 0}${result.truncated ? "+" : ""} records were inspected.`} organizationCriteria={getMetricCriteria(criteriaKey)} /> : null}</span></div> : null}
      {gadget.type === "bar" ? (
        <div className="quality-series-list">{series.map((item) => <button disabled={!onDrilldown} key={item.label} onClick={() => onDrilldown?.(item.label)} title={gadget.data_source === "hellotest" ? "Open the project evidence list; chart filters are not applied" : `Open ${item.label} in a new tab`} type="button"><span>{item.label}</span><i><em style={{ width: `${Math.round(((Number(item.value) || 0) / maximum) * 100)}%` }} /></i><strong>{item.value}</strong></button>)}</div>
      ) : null}
      {gadget.type === "column" ? <div className="quality-column-chart" role="group" aria-label={`${gadget.title} column chart`}>{series.map((item, index) => <button key={item.label} type="button" disabled={!onDrilldown} onClick={() => onDrilldown?.(item.label)} title={`${item.label}: ${item.value}`}><span className="quality-column-value">{item.value}</span><span className="quality-column-track"><i style={{ height: `${Math.max(0, Number(item.value)) / maximum * 100}%`, background: palette[index % palette.length] }} /></span><span className="quality-column-label">{item.label}</span></button>)}</div> : null}
      {gadget.type === "donut" ? (
        <div className="quality-donut-layout">
          <div className="quality-donut" style={{ background: series.length ? `conic-gradient(${donutStops})` : "var(--ds-background-neutral, #dfe1e6)" }}><span><strong>{Number(result.total) || 0}</strong><small>Total</small></span></div>
          <div className="quality-chart-legend">{series.slice(0, 8).map((item, index) => <button disabled={!onDrilldown} key={item.label} onClick={() => onDrilldown?.(item.label)} title={gadget.data_source === "hellotest" ? "Open the project evidence list; chart filters are not applied" : `Open ${item.label} in a new tab`} type="button"><i style={{ background: palette[index % palette.length] }} /><small>{item.label}</small><strong>{item.value}</strong></button>)}</div>
        </div>
      ) : null}
      {gadget.type === "stacked-bar" ? (
        <div className="quality-stacked-chart">
          <div>{series.slice(0, 8).map((item, index) => <span key={item.label} style={{ background: palette[index % palette.length], width: `${((Number(item.value) || 0) / seriesTotal) * 100}%` }} title={`${item.label}: ${item.value}`} />)}</div>
          <div className="quality-chart-legend">{series.slice(0, 8).map((item, index) => <button disabled={!onDrilldown} key={item.label} onClick={() => onDrilldown?.(item.label)} title={gadget.data_source === "hellotest" ? "Open the project evidence list; chart filters are not applied" : `Open ${item.label} in a new tab`} type="button"><i style={{ background: palette[index % palette.length] }} /><small>{item.label}</small><strong>{item.value}</strong></button>)}</div>
        </div>
      ) : null}
      {["line", "area"].includes(gadget.type) ? (
        <button className="quality-line-chart quality-chart-drilldown" disabled={!onDrilldown} onClick={() => onDrilldown?.()} title="Open trend drill-down in a new tab" type="button">
          <svg aria-label={`${gadget.title} trend`} role="img" viewBox="0 0 300 120"><path d="M10 108 H290" />{gadget.type === "area" && series.length ? <polygon className="quality-area-fill" points={`${series.length <= 1 ? 150 : 10},108 ${linePoints} ${series.length <= 1 ? 150 : 290},108`} /> : null}<polyline points={linePoints} /></svg>
          <div><span>{series[0]?.label || "—"}</span><strong>{series.map((item) => item.value).join(" · ") || "No data"}</strong><span>{series[series.length - 1]?.label || "—"}</span></div>
        </button>
      ) : null}
      {gadget.type === "table" ? (
        <div className="quality-table-wrap">{!rows.length ? <div className="dashboard-empty-evidence"><IconCheck size={21} /><strong>No matching records</strong><span>There is nothing to review for this signal.</span></div> : <table><thead><tr><th>Key</th><th>Title</th><th>Type</th><th>Priority</th><th>Status</th><th>Owner</th></tr></thead><tbody>{rows.map((row) => { const issueUrl = gadget.data_source !== "hellotest" ? getJiraBrowseUrl(row.key) : null; return <tr key={row.id}><td>{issueUrl ? <a href={issueUrl} rel="noreferrer" target="_blank">{row.key}</a> : row.key}</td><td>{issueUrl ? <a href={issueUrl} rel="noreferrer" target="_blank">{row.title}</a> : <button className="quality-table-drilldown" onClick={() => onRowDrilldown ? onRowDrilldown(row) : onDrilldown?.()} type="button">{row.title}</button>}</td><td>{row.type || "—"}</td><td>{row.priority || "—"}</td><td>{row.status || "—"}</td><td>{row.assignee || "Unassigned"}</td></tr>; })}</tbody></table>}</div>
      ) : null}
      <small className="quality-gadget-foot" title={result.methodology}>{gadget.data_source === "hellotest" ? "Project evidence" : "Work items"} · {Number(result.returned).toLocaleString() || 0} records{result.truncated ? " · First 100 Records; Full Scope Used For Calculation" : ""}</small>
    </article>
  );
}
