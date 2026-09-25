import type { AnalyticsWindow, QualityOverview } from "./lib/qualityAnalytics";
import type { QualityDashboard, QualityDashboardBatchResponse, QualityDashboardDesignPreviewResponse, QualityDashboardGadget, QualityDashboardGadgetResult } from "@hellotest/platform/frontend/src/types";
import { DashboardStyledReportPayload, request, requestBlob, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";



export const dashboardApi = {
analytics: {
    overview: (input: { project_id: string; days: AnalyticsWindow }, options?: { signal?: AbortSignal }) =>
      request<QualityOverview>(`/analytics/overview${toQueryString(input)}`, { signal: options?.signal, cache: "no-store" }),
    query: (input: { project_id: string; jql: string; gadget: QualityDashboardGadget; limit?: number }) =>
      request<QualityDashboardGadgetResult>("/analytics/jql", { method: "POST", body: JSON.stringify(input) }),
    queryBatch: (input: { project_id: string; gadgets: QualityDashboardGadget[]; limit?: number }) =>
      request<QualityDashboardBatchResponse>("/analytics/jql-batch", { method: "POST", body: JSON.stringify(input) }),
    designDashboard: (input: { project_id: string; stakeholder: "executive" | "product" | "quality" | "automation" | "traceability" | "delivery" | "triage"; release?: string; goal?: string; prompt?: string; name?: string; additional_context?: string }) =>
      request<QualityDashboardDesignPreviewResponse>("/analytics/dashboard-design-preview", { method: "POST", body: JSON.stringify(input) })
  },
qualityDashboards: {
    list: (query?: { project_id?: string }) => request<QualityDashboard[]>(`/quality-dashboards${toQueryString(query)}`),
    create: (input: Omit<QualityDashboard, "id" | "project_id"> & { project_id: string }) =>
      request<QualityDashboard>("/quality-dashboards", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<QualityDashboard>) =>
      request<QualityDashboard>(`/quality-dashboards/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    downloadReportPdf: (id: string, input?: DashboardStyledReportPayload) =>
      input?.rendered_snapshot_data_url
        ? requestBlob(`/quality-dashboards/${id}/report.pdf`, { method: "POST", body: JSON.stringify(input) })
        : requestBlob(`/quality-dashboards/${id}/report.pdf`),
    shareReport: (id: string, input: { recipients: string[] } & DashboardStyledReportPayload) =>
      request<{ sent: boolean; recipients: number }>(`/quality-dashboards/${id}/share-report`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/quality-dashboards/${id}`, { method: "DELETE" })
  }
};

