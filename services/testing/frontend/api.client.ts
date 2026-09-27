import type { Issue, TestCaseDefectLink } from "@hellotest/platform/frontend/src/types";
import type { JiraIssueCreateMetadata, JiraBugCreateMetadata, JiraWorkflowStatusCatalog } from "@hellotest/integration/frontend/lib/jiraIssueContracts";
type IssuePayload = {
  user_id: string;
  title: string;
  message: string;
  steps_to_reproduce?: string;
  expected_result?: string;
  actual_result?: string;
  severity?: string;
  priority?: string;
  environment?: string;
  build?: string;
  jira_bug_key?: string;
  linked_test_run_id?: string;
  linked_test_case_ids?: string[];
  linked_test_suite_ids?: string[];
  linked_module_ids?: string[];
  linked_requirement_ids?: string[];
  assignee_id?: string;
  root_cause?: string;
  qa_root_cause?: string;
  bug_type?: string;
  regression?: boolean;
  status?: string;
  labels?: string[];
  sprint?: string;
  fix_version?: string;
  release?: string;
  additional_fields?: Record<string, unknown>;
  expected_revision?: number;
};

import { requestAiPreview } from "@hellotest/platform/frontend/src/lib/aiHttpClient";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import type { ExecutionCaseIdentity, ExecutionCaseLifecycleAction } from "./lib/executionCaseLifecycle";
import type { AiArtifactAssuranceInput, ApiRequestPreview, AiCaseAuthoringPreviewResponse, AiDesignImageInput, AiDesignPreviewResponse, AiStepRephraseResponse, AiTestDataGenerationPreviewResponse, AiTestCaseGenerationJob, AutomationBuildResponse, AutomationLearningCacheEntry, ObjectRepositoryImportEntry, ObjectRepositoryImportResult, ObjectRepositoryContext, Execution, ExecutionResult, ExecutionSchedule, ExecutionResultAttachment, KeyValueEntry, ReleaseReadinessExecutionEvidence, RecorderSessionResponse, SharedStepGroup, SharedStepMetrics, SmartExecutionPreviewResponse, TestConfiguration, TestCase, TestCaseImpactPreviewResponse, TestCaseModule, TestCaseVersionSnapshot, TestCaseVersionSummary, TestDataSet, TestDataSetMode, TestEnvironment, TestStep, TestSuite, ExecutionFailureClusterPreviewResponse, WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";
import type { ExecutionStartResponse } from "./lib/executionStartSummary";
import type { ExecutionAiAnalysis } from "./lib/executionLogs";
import { BatchQueueResponse, PagedResult, request, requestBlob, requestForm, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";

type TestCaseImportSourceValue = "csv" | "junit_xml" | "testng_xml" | "postman_collection";

type TestCaseImportBatchInput = {
  row_offset?: number;
  file_name?: string;
  import_source: TestCaseImportSourceValue;
  rows: Array<Record<string, unknown>>;
};

const MAX_IMPORT_REQUEST_BYTES = 4 * 1024 * 1024;

const MAX_IMPORT_ROWS_PER_BATCH = 250;

const splitRowsForImport = (rows: Array<Record<string, unknown>>) => {
  const chunks: Array<Array<Record<string, unknown>>> = [];
  let current: Array<Record<string, unknown>> = [];
  let currentBytes = 0;

  rows.forEach((row) => {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).length + 2;
    if (rowBytes > MAX_IMPORT_REQUEST_BYTES) throw new Error("One import row exceeds 4 MB. Reduce embedded step/code content before importing.");
    const shouldStartNext =
      current.length > 0
      && (current.length >= MAX_IMPORT_ROWS_PER_BATCH || currentBytes + rowBytes > MAX_IMPORT_REQUEST_BYTES);

    if (shouldStartNext) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(row);
    currentBytes += rowBytes;
  });

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
};

const splitTestCaseImportInput = (input: {
  app_type_id: string;
  requirement_id?: string;
  import_source?: TestCaseImportSourceValue;
  rows?: Array<Record<string, unknown>>;
  batches?: TestCaseImportBatchInput[];
}) => {
  const payloads: Array<typeof input> = [];

  if (input.batches?.length) {
    input.batches.forEach((batch) => {
      let rowOffset = batch.row_offset || 0;
      splitRowsForImport(batch.rows || []).forEach((rows, index) => {
        payloads.push({
          app_type_id: input.app_type_id,
          requirement_id: input.requirement_id,
          import_source: input.import_source,
          batches: [{
            file_name: index ? `${batch.file_name || "import"} part ${index + 1}` : batch.file_name,
            import_source: batch.import_source,
            row_offset: rowOffset,
            rows
          }]
        });
        rowOffset += rows.length;
      });
    });
  } else if (input.rows?.length) {
    splitRowsForImport(input.rows).forEach((rows) => {
      payloads.push({
        app_type_id: input.app_type_id,
        requirement_id: input.requirement_id,
        import_source: input.import_source,
        rows
      });
    });
  }

  return payloads.length ? payloads : [input];
};

export const testingApi = {
testCaseDefects: {
    list: (query?: { test_case_id?: string; issue_id?: string }) =>
      request<Array<{ test_case_id: string; issue_id: string; link_source: string; created_at?: string }>>(`/test-case-defects${toQueryString(query)}`),
    listIssues: (test_case_id: string) =>
      request<TestCaseDefectLink[]>(`/test-case-defects/${test_case_id}/issues`),
    replace: (test_case_id: string, issue_ids: string[]) =>
      request<{ updated: boolean; mapped: number }>("/test-case-defects/replace", {
        method: "PUT",
        body: JSON.stringify({ test_case_id, issue_ids })
      })
  },

issues: {
    list: (query?: import("./lib/issueCatalog").IssueCatalogFilters & { page_size?: number; cursor?: string; projection?: "summary" | "detail" }, options?: { signal?: AbortSignal }) =>
      request<Issue[]>(`/feedback${toQueryString(query)}`, { signal: options?.signal }),
    listPage: (query?: import("./lib/issueCatalog").IssueCatalogFilters & { page_size?: number; cursor?: string; projection?: "summary" | "detail" }) =>
      request<PagedResult<Issue>>(`/feedback${toQueryString({ ...query, include_page: true })}`),
    catalogPage: (query: import("./lib/issueCatalog").IssueCatalogFilters & { page_size?: number; cursor?: string }, options?: { signal?: AbortSignal }) =>
      request<import("./lib/issueCatalog").IssueCatalogPage>(`/feedback${toQueryString({ ...query, include_page: true, include_total: false, projection: "summary" })}`, { signal: options?.signal }),
    metrics: (query: import("./lib/issueCatalog").IssueCatalogFilters, options?: { signal?: AbortSignal }) =>
      request<import("./lib/issueCatalog").IssueCatalogMetrics>(`/feedback/metrics${toQueryString(query)}`, { signal: options?.signal }),
    get: (id: string, query?: { project_id?: string }) =>
      request<Issue>(`/feedback/${id}${toQueryString(query)}`),
    history: (id: string) => request<import("@hellotest/platform/frontend/src/types").IssueHistoryEntry[]>(`/feedback/${id}/history`),
    createMetadata: (query?: { project_id?: string }) =>
      request<JiraBugCreateMetadata>(`/feedback/create-metadata${toQueryString(query)}`),
    editMetadata: (id: string, query?: { project_id?: string }) =>
      request<JiraBugCreateMetadata>(`/feedback/${id}/edit-metadata${toQueryString(query)}`),
    create: (input: IssuePayload) =>
      request<{ id: string; display_id?: string; status_warning?: { code: string; message: string; requested_status?: string | null; current_status?: string | null; issue_key?: string | null } }>("/feedback", { method: "POST", body: JSON.stringify(input) }),
    previewAiDraft: (input: {
      project_id: string;
      intent: string;
      additional_context?: string;
      evidence?: string;
      external_links?: string[];
      reference_photos?: AiDesignImageInput[];
      linked_test_run_id?: string;
      linked_test_case_ids?: string[];
      linked_requirement_ids?: string[];
      integration_id?: string;
      prompt_guidance?: string;
    }) => request<import("@hellotest/platform/frontend/src/types").AiBugDraftPreview>("/feedback/ai-draft-preview", {
      method: "POST",
      body: JSON.stringify(input)
    }),
    previewAiTriage: (input: {
      project_id: string;
      issue_ids: string[];
      integration_id?: string;
      prompt_guidance?: string;
      smart_context?: { query?: string; source_ids?: string[]; source_kinds?: string[]; reviewed_context?: string };
    }) =>
      request<import("@hellotest/platform/frontend/src/types").AiBugTriagePreview>("/feedback/ai-triage-preview", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    export: (input: { project_id: string; issue_ids: string[] }) =>
      request<{ bugs: Issue[]; exported: number }>("/feedback/export", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    bulkDelete: (input: { project_id: string; issue_ids: string[] }) =>
      request<{
        requested: number;
        deleted: number;
        deleted_ids: string[];
        failed: number;
        failures: Array<{ issue_id: string; display_id: string; code: string; message: string }>;
      }>("/feedback/bulk-delete", {
        method: "DELETE",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<IssuePayload>) =>
      request<{ updated: boolean }>(`/feedback/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/feedback/${id}`, { method: "DELETE" })
  },

executionResultAttachments: {
    list: (resultId: string) => request<ExecutionResultAttachment[]>(`/execution-results/${encodeURIComponent(resultId)}/attachments`),
    upload: (resultId: string, file: File, options: { stepId?: string; expectedRevision?: number } = {}) => {
      const form = new FormData();
      if (options.stepId) form.append("step_id", options.stepId);
      if (options.expectedRevision !== undefined) form.append("expected_revision", String(options.expectedRevision));
      form.append("file", file, file.name);
      return requestForm<{ attachment: ExecutionResultAttachment; revision: number; evidence?: import("./lib/executionLogs").ExecutionStepEvidence }>(`/execution-results/${encodeURIComponent(resultId)}/attachments`, form);
    },
    delete: (resultId: string, attachmentId: string) => request<{ deleted: boolean; id: string; revision: number }>(`/execution-results/${encodeURIComponent(resultId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" })
  },
testCaseModules: {
    list: (query?: { app_type_id?: string; project_id?: string; projection?: "summary" | "detail" }, options?: { signal?: AbortSignal }) =>
      request<TestCaseModule[]>(`/test-case-modules${toQueryString(query)}`, { signal: options?.signal }),
    get: (id: string) =>
      request<TestCaseModule>(`/test-case-modules/${id}`),
    listCases: (id: string, query?: import("./lib/testCaseCatalog").TestCaseCatalogFilters & { page_size?: number; cursor?: string; projection?: "summary" | "detail" }) =>
      request<PagedResult<TestCase>>(`/test-case-modules/${id}/test-cases${toQueryString({ ...query, include_page: true })}`),
    create: (input: { app_type_id: string; name: string; description?: string; test_case_ids?: string[]; requirement_ids?: string[] }) =>
      request<{ id: string }>("/test-case-modules", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; description: string; test_case_ids: string[]; requirement_ids: string[] }>) =>
      request<{ updated: boolean }>(`/test-case-modules/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    assignCases: (id: string, test_case_ids: string[], append = true) =>
      request<{ updated: boolean; assigned: number }>(`/test-case-modules/${id}/test-cases`, {
        method: "PUT",
        body: JSON.stringify({ test_case_ids, append })
      }),
    removeCases: (id: string, test_case_ids: string[]) =>
      request<{ updated: boolean; removed: number; retained_test_case_ids?: string[]; message?: string }>(`/test-case-modules/${id}/test-cases`, {
        method: "DELETE",
        body: JSON.stringify({ test_case_ids })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-case-modules/${id}`, { method: "DELETE" })
  },
testSuites: {
    list: (query?: { app_type_id?: string; project_id?: string; projection?: "picker" | "summary"; case_search?: string; module_id?: string; requirement_id?: string; label?: string; shared_step_group_id?: string }, options?: { signal?: AbortSignal }) =>
      request<TestSuite[]>(`/test-suites${toQueryString(query)}`, { signal: options?.signal }),
    create: (input: { app_type_id: string; name: string; description?: string; labels?: string[]; parameter_values?: Record<string, string>; test_data_options?: TestDataOptions; test_data_set_id?: string | null; test_case_ids?: string[]; parallel_enabled?: boolean; parallel_count?: number }) =>
      request<{ id: string }>("/test-suites", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; description: string; labels: string[]; parameter_values: Record<string, string>; test_data_options: TestDataOptions; test_data_set_id: string | null; test_case_ids: string[]; parallel_enabled: boolean; parallel_count: number; expected_revision: number }>) =>
      request<{ updated: boolean; revision: number }>(`/test-suites/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    assignTestCases: (id: string, test_case_ids: string[], expected_revision?: number, append = true) =>
      request<{ updated: boolean; assigned: number; revision: number }>(`/test-suites/${id}/assign-test-cases`, {
        method: "PUT",
        body: JSON.stringify({ test_case_ids, expected_revision, append })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-suites/${id}`, { method: "DELETE" })
  },
testCases: {
    reviewSummary: (query: { project_id?: string; app_type_id?: string }, options?: { signal?: AbortSignal }) =>
      request<{ pending: number; overall_pending: number }>(`/test-cases/review-summary${toQueryString(query)}`, { signal: options?.signal }),
    metrics: (query?: import("./lib/testCaseCatalog").TestCaseCatalogFilters & { app_type_id?: string; project_id?: string }) =>
      request<import("./lib/testCaseCatalog").TestCaseCatalogMetrics>(`/test-cases/metrics${toQueryString(query)}`),
    list: (query?: { project_id?: string; suite_id?: string; requirement_id?: string; module_id?: string; unassigned_module?: boolean; status?: string; app_type_id?: string; page_size?: number; limit?: number; cursor?: string; projection?: "summary" | "detail" }, options?: { signal?: AbortSignal }) =>
      request<TestCase[]>(`/test-cases${toQueryString(query)}`, { signal: options?.signal }),
    listPage: (query?: import("./lib/testCaseCatalog").TestCasePickerFilters & { projection?: "summary" | "detail" | "picker" }, options?: { signal?: AbortSignal }) =>
      request<PagedResult<TestCase>>(`/test-cases${toQueryString({ ...query, include_page: true })}`, { signal: options?.signal }),
    listPicker: (query?: import("./lib/testCaseCatalog").TestCasePickerFilters, options?: { signal?: AbortSignal }) =>
      request<PagedResult<TestCase>>(`/test-cases${toQueryString({ page_size: 25, ...query, projection: "picker", include_page: true, include_total: false })}`, { signal: options?.signal }),
    resolveRequirementCases: (input: { app_type_id: string; requirement_ids: string[] }) =>
      request<TestCase[]>("/test-cases/resolve-requirements", { method: "POST", body: JSON.stringify(input) }),
    get: (id: string, query?: { project_id?: string }, options?: { signal?: AbortSignal }) =>
      request<TestCase>(`/test-cases/${id}${toQueryString(query)}`, { signal: options?.signal }),
    create: (input: { ai_generation_source?: "interactive"; app_type_id?: string; source_issue_id?: string; suite_id?: string; suite_ids?: string[]; title: string; description?: string; external_references?: string[]; labels?: string[]; parameter_values?: Record<string, string>; automated?: "yes" | "no"; automation_status?: "not_automated" | "ready" | "incomplete"; manual_test_case_id?: string | null; manual_test_case_ids?: string[]; authoring_mode?: "structured" | "gherkin"; test_case_type?: TestCase["test_case_type"]; gherkin_document?: string | null; test_data_set_ids?: string[]; test_data_options?: TestDataOptions; priority?: number; status?: string; requirement_id?: string; requirement_ids?: string[]; author_id?: string; reviewer_id?: string | null; review_status?: TestCase["review_status"]; ai_quality_score?: number | null; steps?: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"]; group_id?: string; group_name?: string; group_kind?: "local" | "reusable"; reusable_group_id?: string }> }) =>
      request<{ id: string }>("/test-cases", { method: "POST", body: JSON.stringify(input) }),
    previewImpact: (id: string, input: AiArtifactAssuranceInput) =>
      request<TestCaseImpactPreviewResponse>(`/test-cases/${id}/ai-impact-preview`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewCaseAuthoring: (input: {
      app_type_id: string;
      requirement_id: string;
      authoring_mode?: "structured" | "gherkin";
      integration_id?: string;
      additional_context?: string;
      external_links?: string[];
      images?: AiDesignImageInput[];
      test_case?: {
        title?: string;
        description?: string;
        authoring_mode?: "structured" | "gherkin";
        gherkin_document?: string | null;
        parameter_values?: Record<string, string>;
        steps?: Array<{
          step_order?: number;
          step_type?: TestStep["step_type"];
          action?: string | null;
          expected_result?: string | null;
        }>;
      };
    }) =>
      requestAiPreview<AiCaseAuthoringPreviewResponse>("/test-cases/ai-authoring-preview", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    rephraseStep: (input: {
      app_type_id: string;
      requirement_id?: string;
      integration_id?: string;
      additional_context?: string;
      test_case?: {
        title?: string;
        description?: string;
        parameter_values?: Record<string, string>;
      };
      step: {
        step_order?: number;
        step_type?: TestStep["step_type"];
        action?: string | null;
        expected_result?: string | null;
      };
    }) =>
      request<AiStepRephraseResponse>("/test-cases/ai-step-rephrase", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewDesignedCases: (input: { app_type_id: string; requirement_ids: string[]; integration_id?: string; max_cases?: number; authoring_mode?: "structured" | "gherkin"; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[] }) =>
      requestAiPreview<AiDesignPreviewResponse>("/test-cases/design-test-cases-preview", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    acceptDesignedCases: (input: { app_type_id: string; requirement_ids: string[]; status?: string; cases: Array<{ title: string; description?: string | null; priority?: number; requirement_ids?: string[]; authoring_mode?: "structured" | "gherkin"; gherkin_document?: string | null; parameter_values?: Record<string, string>; steps?: Array<{ step_order?: number; step_type?: TestStep["step_type"]; action?: string | null; expected_result?: string | null }> }> }) =>
      request<{ accepted: number; created: Array<{ id: string; title: string; step_count: number; requirement_ids: string[] }> }>("/test-cases/design-test-cases-accept", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    listGenerationJobs: (query: { app_type_id: string; status?: string }) =>
      request<AiTestCaseGenerationJob[]>(`/test-cases/ai-generation-jobs${toQueryString(query)}`),
    createGenerationJob: (input: {
      app_type_id: string;
      requirement_ids: string[];
      integration_id?: string;
      max_cases_per_requirement?: number;
      parallel_requirement_limit?: number;
      additional_context?: string;
      external_links?: string[];
      images?: AiDesignImageInput[];
      authoring_mode?: "structured" | "gherkin";
    }) =>
      requestAiPreview<{ id: string }>("/test-cases/ai-generation-jobs", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    acceptGeneratedCase: (id: string) =>
      request<{ accepted: boolean }>(`/test-cases/${id}/accept-generated`, {
        method: "POST"
      }),
    rejectGeneratedCase: (id: string) =>
      request<{ deleted: boolean }>(`/test-cases/${id}/reject-generated`, {
        method: "DELETE"
      }),
    bulkImport: async (input: {
      app_type_id: string;
      requirement_id?: string;
      import_source?: TestCaseImportSourceValue;
      rows?: Array<Record<string, unknown>>;
      batches?: TestCaseImportBatchInput[];
    }) => {
      const payloads = splitTestCaseImportInput(input);

      const responses: BatchQueueResponse[] = [];
      for (const [index, payload] of payloads.entries()) {
        try {
          responses.push(await request<BatchQueueResponse>("/test-cases/import", { method: "POST", body: JSON.stringify(payload) }));
        } catch (error) {
          if (!responses.length) throw error;
          throw Object.assign(new Error(`${responses.length} batch process${responses.length === 1 ? "" : "es"} queued. Remaining batches could not be queued: ${error instanceof Error ? error.message : "request failed"}. Track accepted batches in TestOps: ${responses.map(response => response.transaction_id).join(", ")}`), {
            remaining_payloads: payloads.slice(index), queued_transaction_ids: responses.map(response => response.transaction_id)
          });
        }
      }
      return { ...responses[0], transaction_ids: responses.map(response => response.transaction_id),
        job_ids: responses.map(response => response.job_id).filter(Boolean) as string[], split_count: responses.length };

    },
    exportCases: (input: { app_type_id: string; test_case_ids?: string[] }) =>
      request<BatchQueueResponse>("/test-cases/export", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    learningCache: (query?: { project_id?: string; app_type_id?: string; limit?: number; offset?: number }, options?: { signal?: AbortSignal }) =>
      request<AutomationLearningCacheEntry[]>(`/test-cases/automation/learning-cache${toQueryString(query)}`, { signal: options?.signal }),
    repositoryContext: (query?: { project_id?: string; app_type_id?: string; limit?: number }) =>
      request<ObjectRepositoryContext>(`/test-cases/automation/repository-context${toQueryString(query)}`),
    exportLearningCacheCsv: (query: { app_type_id: string }) =>
      requestBlob(`/test-cases/automation/learning-cache/export.csv${toQueryString(query)}`),
    importLearningCacheEntries: async (input: {
      app_type_id: string;
      import_source?: string;
      entries: ObjectRepositoryImportEntry[];
    }) =>
      request<ObjectRepositoryImportResult>("/test-cases/automation/learning-cache/import", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    extractLearningCacheFields: (input: {
      app_type_id?: string;
      screen_name: string;
      page_url?: string;
      dom_structure?: string;
      screenshot_url?: string;
      business_meaning?: string;
      candidate_fields?: unknown[];
      integration_id?: string;
    }) =>
      request<{
        screen_summary?: string | null;
        intended_flows: string[];
        fields: Array<{
          name: string;
          tag: string;
          role: string;
          locator: string;
          locatorKind: string;
          dom: string;
          fallbackLocators: Array<{ locator: string; strategy: string; confidenceScore: number }>;
          description?: string | null;
          businessMeaning?: string | null;
          usageKeywords?: string[];
        }>;
        ai_used: boolean;
        fallback_used: boolean;
        fallback_reason?: string | null;
      }>("/test-cases/automation/learning-cache/extract-fields", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    createLearningCacheEntry: (input: Partial<{
      project_id: string;
      app_type_id: string;
      page_url: string;
      page_key: string;
      locator_intent: string;
      locator: string;
      locator_kind: string;
      confidence: number;
      source: string;
      screen_name: string;
      object_name: string;
      object_role: string;
      target_criteria: string[];
      dom_structure: string;
      screenshot_url: string;
      fallback_strategy: string;
      screen_dom_compressed: string;
      screen_screenshot_url: string;
      metadata: Record<string, unknown>;
    }>) =>
      request<AutomationLearningCacheEntry>("/test-cases/automation/learning-cache", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    updateLearningCacheEntry: (id: string, input: Partial<{
      page_url: string;
      page_key: string;
      locator_intent: string;
      locator: string;
      locator_kind: string;
      confidence: number;
      source: string;
      screen_name: string;
      object_name: string;
      object_role: string;
      target_criteria: string[];
      dom_structure: string;
      dom_path: string;
      screenshot_url: string;
      screenshot_path: string;
      fallback_strategy: string;
      platform: string;
      url_pattern_type: string;
      url_pattern_value: string;
      screen_fingerprint: string;
      accessibility_tree: string;
      fallback_locators: Array<Record<string, unknown>>;
      description: string;
      business_meaning: string;
      usage_keywords: string[];
      stability_score: number;
      last_validated_at: string;
      validation_history: Array<Record<string, unknown>>;
      ancestor_dom: string;
      ancestor_screenshot_url: string;
      element_screenshot_url: string;
      metadata: Record<string, unknown>;
    }>) =>
      request<AutomationLearningCacheEntry>(`/test-cases/automation/learning-cache/${id}`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    improveLearningCacheEntry: (id: string, input?: { integration_id?: string; guidance?: string }) =>
      request<{
        entry: AutomationLearningCacheEntry;
        suggestion: { locator?: string; strategy?: string; confidence?: number; reason?: string };
        fallback_used: boolean;
        fallback_reason?: string | null;
        generation_mode?: "deterministic" | "llm";
        generated_at?: string;
        request_id?: string;
        requires_human_review?: boolean;
        provenance?: { provider?: string; model?: string | null; evidence?: string[]; confidence?: number };
      }>(`/test-cases/automation/learning-cache/${id}/ai-improve`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    applyLearningCacheImprovement: (id: string, input: { confirmed: true; locator: string; strategy: string; confidence?: number; request_id?: string }) =>
      request<{ entry: AutomationLearningCacheEntry; applied: boolean }>(`/test-cases/automation/learning-cache/${id}/ai-improve/apply`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    learningCacheUsage: (id: string) =>
      request<Array<{ id: string; display_id?: string | null; title: string; automated?: "yes" | "no" | null }>>(`/test-cases/automation/learning-cache/${id}/usage`),
    learningCacheScreenUsage: (screenName: string, query: { app_type_id?: string }) =>
      request<Array<{ id: string; display_id?: string | null; title: string; automated?: "yes" | "no" | null }>>(`/test-cases/automation/learning-cache/screens/${encodeURIComponent(screenName)}/usage${toQueryString(query)}`),
    deleteLearningCacheEntry: (id: string, confirmed = false) =>
      request<{ deleted: boolean; requires_confirmation: boolean; usage: Array<{ id: string; display_id?: string | null; title: string; automated?: "yes" | "no" | null }>; invalidated_cases: Array<{ id: string; title: string }> }>(`/test-cases/automation/learning-cache/${id}${toQueryString(confirmed ? { confirm: "true" } : undefined)}`, { method: "DELETE" }),
    deleteLearningCacheScreen: (screenName: string, query: { app_type_id?: string; confirm?: string }) =>
      request<{ deleted: boolean; requires_confirmation: boolean; usage: Array<{ id: string; display_id?: string | null; title: string; automated?: "yes" | "no" | null }>; invalidated_cases: Array<{ id: string; title: string }> }>(`/test-cases/automation/learning-cache/screens/${encodeURIComponent(screenName)}${toQueryString(query)}`, { method: "DELETE" }),
    renameLearningCacheScreen: (screenName: string, input: { app_type_id?: string; new_name: string }) =>
      request<{ renamed: boolean; screen_name: string; updated_fields: number; updated_step_references: number }>(`/test-cases/automation/learning-cache/screens/${encodeURIComponent(screenName)}`, {
        method: "PUT",
        body: JSON.stringify({ ...input, screen_name: input.new_name })
      }),
    buildAutomation: (id: string, input?: { allow_browser_actions?: boolean; integration_id?: string; start_url?: string; additional_context?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; captured_actions?: unknown[]; captured_network?: unknown[] }) =>
      request<AutomationBuildResponse>(`/test-cases/${id}/automation/build`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    automationBuildStatus: (transactionId: string) =>
      request<WorkspaceTransaction>(`/test-cases/automation/jobs/${encodeURIComponent(transactionId)}`),
    queueAutomationGenerator: (id: string, input?: { allow_browser_actions?: boolean; scheduled_at?: string; integration_id?: string; start_url?: string; additional_context?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; ai_requested?: boolean }) =>
      request<BatchQueueResponse>(`/test-cases/${id}/automation/generator-jobs`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    buildAutomationBatch: (input: { allow_browser_actions?: boolean; scheduled_at?: string; app_type_id: string; test_case_ids?: string[]; integration_id?: string; start_url?: string; additional_context?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; failure_threshold?: number; ai_requested?: boolean }) =>
      request<BatchQueueResponse>("/test-cases/automation/build-batch", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    startRecorderSession: (id: string, input?: { start_url?: string; recorder_mode?: "local" | "remote"; recorder_target?: "web" | "mobile"; engine_base_url?: string; recorder_public_base_url?: string; reuse_existing?: boolean; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; target_step_id?: string }) =>
      request<RecorderSessionResponse>(`/test-cases/${id}/automation/recorder-session`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    finishRecorderSession: (id: string, sessionId: string, input?: { transaction_id?: string; integration_id?: string; additional_context?: string; recorder_mode?: "local" | "remote"; recorder_target?: "web" | "mobile"; engine_base_url?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; target_step_id?: string }) =>
      request<AutomationBuildResponse & { recorder_session?: { id: string; action_count: number; network_count: number } }>(`/test-cases/${id}/automation/recorder-session/${sessionId}/finish`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    update: (id: string, input: Partial<{ app_type_id: string; suite_id: string; suite_ids: string[]; title: string; description: string; external_references: string[]; labels: string[]; parameter_values: Record<string, string>; automated: "yes" | "no"; automation_status: "not_automated" | "ready" | "incomplete"; manual_test_case_id: string | null; manual_test_case_ids: string[]; authoring_mode: "structured" | "gherkin"; test_case_type: TestCase["test_case_type"]; gherkin_document: string | null; test_data_set_ids: string[]; test_data_options: TestDataOptions; priority: number; status: string; requirement_id: string; requirement_ids: string[]; author_id: string; reviewer_id: string | null; review_status: TestCase["review_status"]; review_history: TestCase["review_history"]; ai_quality_score: number | null; expected_revision: number; steps: Array<{ id?: string; test_case_id?: string; step_order?: number; action?: string | null; expected_result?: string | null; step_type?: TestStep["step_type"]; automation_code?: string | null; api_request?: TestStep["api_request"]; group_id?: string | null; group_name?: string | null; group_kind?: "local" | "reusable" | null; reusable_group_id?: string | null }> }>) =>
      request<{ updated: boolean; revision: number }>(`/test-cases/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    review: (id: string, input: { review_status: "accepted" | "changes_requested"; comment?: string; expected_updated_at?: string; expected_revision?: number }) =>
      request<{ updated: boolean; review: NonNullable<TestCase["review_history"]>[number] }>(`/test-cases/${id}/review`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    listVersions: (id: string) =>
      request<{ current_revision: number; retained_limit: number; versions: TestCaseVersionSummary[] }>(`/test-cases/${id}/versions`),
    getVersion: (id: string, revision: number) =>
      request<TestCaseVersionSnapshot>(`/test-cases/${id}/versions/${revision}`),
    restoreVersion: (id: string, revision: number, expectedRevision?: number) =>
      request<{ restored: boolean; restored_from_revision: number; revision: number }>(`/test-cases/${id}/versions/${revision}/restore`, {
        method: "POST",
        body: JSON.stringify({ expected_revision: expectedRevision })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-cases/${id}`, { method: "DELETE" })
  },
suiteTestCases: {
    list: (query?: { suite_id?: string; test_case_id?: string }) =>
      request<Array<{ suite_id: string; test_case_id: string; sort_order: number }>>(`/suite-test-cases${toQueryString(query)}`),
    reorder: (suite_id: string, test_case_ids: string[], expected_revision?: number) =>
      request<{ reordered: boolean; revision: number }>(`/suite-test-cases/reorder`, {
        method: "PUT",
        body: JSON.stringify({ suite_id, test_case_ids, expected_revision })
      })
  },
testSteps: {
    list: (query?: { test_case_id?: string; test_case_ids?: string }, options?: { signal?: AbortSignal }) =>
      request<TestStep[]>(`/test-steps${toQueryString(query)}`, { signal: options?.signal }),
    runApiRequest: (input: { api_request: TestStep["api_request"] }) =>
      request<ApiRequestPreview>("/test-steps/run-api-request", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    create: (input: { test_case_id: string; step_order: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"]; group_id?: string; group_name?: string; group_kind?: "local" | "reusable"; reusable_group_id?: string }) =>
      request<{ id: string }>("/test-steps", { method: "POST", body: JSON.stringify(input) }),
    createMany: (input: {
      test_case_id: string;
      insertion_index: number;
      steps: Array<{ action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"]; group_id?: string; group_name?: string; group_kind?: "local" | "reusable"; reusable_group_id?: string }>;
    }) => request<{ ids: string[]; created: number }>("/test-steps/bulk", { method: "POST", body: JSON.stringify(input) }),
    deleteMany: (input: { test_case_id: string; step_ids: string[] }) =>
      request<{ deleted: number }>("/test-steps/bulk-delete", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ test_case_id: string; step_order: number; action: string; expected_result: string; step_type: TestStep["step_type"] | null; automation_code: string; api_request: TestStep["api_request"]; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null }>) =>
      request<{ updated: boolean }>(`/test-steps/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    reorder: (test_case_id: string, step_ids: string[]) =>
      request<{ reordered: boolean }>(`/test-steps/reorder`, {
        method: "PUT",
        body: JSON.stringify({ test_case_id, step_ids })
      }),
    duplicate: (input: { test_case_id: string; step_ids: string[]; insert_after_step_id?: string }) =>
      request<{ duplicated: boolean }>("/test-steps/duplicate", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    group: (input: { test_case_id: string; step_ids: string[]; name: string; kind?: "local" | "reusable"; group_id?: string; reusable_group_id?: string }) =>
      request<{ grouped: boolean; group_id: string }>("/test-steps/group", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    ungroup: (input: { test_case_id: string; group_id: string }) =>
      request<{ updated: boolean }>("/test-steps/ungroup", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    insertSharedGroup: (input: { test_case_id: string; shared_step_group_id: string; insert_after_step_id?: string }) =>
      request<{ inserted: boolean }>("/test-steps/insert-shared-group", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-steps/${id}`, { method: "DELETE" })
  },
sharedStepGroups: {
    metrics: (query: { app_type_id: string }, options?: { signal?: AbortSignal }) =>
      request<SharedStepMetrics>(`/shared-step-groups/metrics${toQueryString(query)}`, { signal: options?.signal }),
    list: (query?: { app_type_id?: string; project_id?: string }, options?: { signal?: AbortSignal }) =>
      request<SharedStepGroup[]>(`/shared-step-groups${toQueryString(query)}`, { signal: options?.signal }),
    get: (id: string) =>
      request<SharedStepGroup>(`/shared-step-groups/${id}`),
    create: (input: { app_type_id: string; name: string; description?: string; authoring_mode?: "structured" | "gherkin"; gherkin_document?: string; parameter_values?: Record<string, string>; test_data_set_id?: string | null; test_data_row_index?: number; steps?: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"] }> }) =>
      request<{ id: string }>("/shared-step-groups", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ app_type_id: string; name: string; description: string; authoring_mode: "structured" | "gherkin"; gherkin_document: string; parameter_values: Record<string, string>; test_data_set_id: string | null; test_data_row_index: number; steps: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"] }> }>) =>
      request<SharedStepGroup>(`/shared-step-groups/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/shared-step-groups/${id}`, { method: "DELETE" })
  },
testEnvironments: {
    list: (query?: { project_id?: string; app_type_id?: string }) =>
      request<TestEnvironment[]>(`/test-environments${toQueryString(query)}`),
    create: (input: { project_id: string; app_type_id?: string; name: string; description?: string; base_url?: string; variables?: KeyValueEntry[] }) =>
      request<{ id: string }>("/test-environments", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; app_type_id: string; name: string; description: string; base_url: string; variables: KeyValueEntry[] }>) =>
      request<TestEnvironment>(`/test-environments/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-environments/${id}`, { method: "DELETE" })
  },
testConfigurations: {
    list: (query?: { project_id?: string; app_type_id?: string }) =>
      request<TestConfiguration[]>(`/test-configurations${toQueryString(query)}`),
    create: (input: { project_id: string; app_type_id?: string; name: string; description?: string; browser?: string; mobile_os?: string; platform_version?: string; targets?: TestConfiguration["targets"]; variables?: KeyValueEntry[] }) =>
      request<{ id: string }>("/test-configurations", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; app_type_id: string; name: string; description: string; browser: string; mobile_os: string; platform_version: string; targets: TestConfiguration["targets"]; variables: KeyValueEntry[] }>) =>
      request<TestConfiguration>(`/test-configurations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-configurations/${id}`, { method: "DELETE" })
  },
testDataSets: {
    list: (query?: { project_id?: string; app_type_id?: string }, options?: { signal?: AbortSignal }) =>
      request<TestDataSet[]>(`/test-data-sets${toQueryString(query)}`, { signal: options?.signal }),
    create: (input: { project_id: string; app_type_id?: string; name: string; description?: string; mode: TestDataSetMode; columns?: string[]; rows?: Array<Record<string, string>> }) =>
      request<{ id: string }>("/test-data-sets", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; app_type_id: string; name: string; description: string; mode: TestDataSetMode; columns: string[]; rows: Array<Record<string, string>> }>) =>
      request<TestDataSet>(`/test-data-sets/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    previewAiData: (input: { project_id: string; app_type_id?: string; prompt: string; field_context?: string; sample_count?: number; prompt_instruction?: string; integration_id?: string; additional_context?: string }) =>
      request<AiTestDataGenerationPreviewResponse>("/test-data-sets/ai-generate-preview", { method: "POST", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-data-sets/${id}`, { method: "DELETE" })
  },
executions: {
    parameterPlan: (input: { suite_context_id?: string; data_scope?: "suite" | "run"; parameter_values?: Record<string, string>; project_id: string; app_type_id: string; execution_id?: string; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_options?: TestDataOptions; test_data_set_id?: string }) =>
      request<{ expected_instance_count: number; case_count: number; suite_count: number; suite_ids: string[]; data_set_validation?: import("@hellotest/platform/frontend/src/types").DataSetValidation | null; parameters: Array<{ name: string; token: string; scope: "t" | "s" | "r"; case_count: number }> }>("/executions/parameter-plan", { method: "POST", body: JSON.stringify(input) }),
    list: (query?: { project_id?: string; app_type_id?: string; status?: string; test_case_id?: string; page_size?: number }, options?: { signal?: AbortSignal }) =>
      request<Execution[]>(`/executions${toQueryString(query)}`, { signal: options?.signal }),
    history: (query: { project_id: string; app_type_id?: string; requirement_id?: string; test_case_id?: string; page_size?: number }) =>
      request<import("@hellotest/platform/frontend/src/types").TraceabilityRunHistoryItem[]>(`/executions/history${toQueryString(query)}`),
    get: (id: string) =>
      request<Execution>(`/executions/${id}`),
    previewFailureClusters: (id: string, input: { project_id: string; scope?: string }) =>
      request<ExecutionFailureClusterPreviewResponse>(`/executions/${id}/ai-failure-clusters`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewSmartPlan: (input: { project_id: string; app_type_id: string; integration_id?: string; release?: string; sprint?: string; release_id?: string; iteration_id?: string; build?: string; scope_description?: string; additional_context?: string; prompt_guidance?: string; impacted_requirement_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_options?: TestDataOptions; test_data_set_id?: string }) =>
      request<SmartExecutionPreviewResponse>("/executions/smart-plan-preview", { method: "POST", body: JSON.stringify(input) }),
    create: (input: { project_id: string; app_type_id?: string; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_options?: TestDataOptions; test_data_set_id?: string; execution_hooks?: Array<Record<string, unknown>>; parallel_enabled?: boolean; parallel_count?: number; execution_mode?: "manual" | "remote" | "local"; engine_base_url?: string; assigned_to?: string; assigned_to_ids?: string[]; release?: string; sprint?: string; release_id?: string; iteration_id?: string; build?: string; name?: string; start_date?: string; end_date?: string; scope_source?: "smart-run"; smart_plan?: { acceptance_token: string; request_id: string; input_fingerprint: string; selected_test_case_ids: string[] }; created_by: string }) =>
      request<{ id: string; transaction_id?: string; audit_status?: "completed" | "acceptance-recorded" }>("/executions", { method: "POST", body: JSON.stringify(input) }),
    createLocalRun: (input: { project_id: string; app_type_id: string; test_case_ids: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_options?: TestDataOptions; test_data_set_id?: string; execution_hooks?: Array<Record<string, unknown>>; assigned_to?: string; assigned_to_ids?: string[]; release?: string; sprint?: string; release_id?: string; iteration_id?: string; build?: string; name?: string; start_date?: string; end_date?: string; created_by: string; engine_base_url?: string }) =>
      request<ExecutionStartResponse & { id: string; execution_mode: "local"; engine_base_url: string }>("/executions/local-run", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: { name?: string; start_date?: string | null; end_date?: string | null; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string | null; test_configuration_id?: string | null; test_data_options?: TestDataOptions; test_data_set_id?: string | null; execution_mode?: "manual" | "remote" | "local"; parallel_enabled?: boolean; parallel_count?: number; assigned_to?: string; assigned_to_ids?: string[]; release?: string; sprint?: string; release_id?: string; iteration_id?: string; build?: string; expected_revision?: number }) =>
      request<{ updated: boolean; revision: number }>(`/executions/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    runApiStep: (executionId: string, testCaseId: string, stepId: string, input?: { data_set_iteration_index?: number }) =>
      request<{
        execution_id: string;
        test_case_id: string;
        step_id: string;
        step_status: "passed" | "failed" | null;
        case_status: ExecutionResult["status"];
        execution_status: Execution["status"];
        note: string;
        detail: import("./lib/executionLogs").ExecutionStepApiDetail | null;
        captures?: Record<string, string>;
        execution_result_id: string;
        queued_for_engine?: boolean;
        job_id?: string;
        engine_run_id?: string;
        transaction_id?: string;
        active_web_engine?: "playwright" | "selenium" | string;
        live_view_url?: string | null;
      }>(`/executions/${executionId}/cases/${testCaseId}/steps/${stepId}/run`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    analyzeCase: (executionId: string, testCaseId: string, input?: { instruction?: string; interaction_mode?: "chat" | "agent" }) =>
      request<{ recorded: boolean; execution_result_id?: string; analysis?: ExecutionAiAnalysis }>(
        `/executions/${executionId}/cases/${testCaseId}/ai-analysis`,
        { method: "POST", body: JSON.stringify(input || {}) }
      ),
    updateCaseAssignment: (executionId: string, testCaseId: string, input: { assigned_to?: string; expected_revision?: number }) =>
      request<{ updated: boolean; revision: number }>(`/executions/${executionId}/cases/${testCaseId}/assignment`, { method: "PUT", body: JSON.stringify(input) }),
    updateScopeAssignment: (executionId: string, level: "suites" | "modules" | "cases", scopeId: string, input: { assigned_to_ids?: string[]; assigned_to?: string; expected_revision?: number }) =>
      request<{ updated: boolean; revision: number }>(`/executions/${executionId}/${level}/${scopeId}/assignment`, { method: "PUT", body: JSON.stringify(input) }),
    rerun: (id: string, input: { failed_only?: boolean; created_by: string; name?: string }) =>
      request<{ id: string }>(`/executions/${id}/rerun`, { method: "POST", body: JSON.stringify(input) }),
    start: (id: string, input?: { execution_mode?: "local" | "remote"; engine_base_url?: string; expected_revision?: number }) =>
      request<ExecutionStartResponse>(`/executions/${id}/start`, { method: "POST", body: JSON.stringify(input || {}) }),
    downloadReportHtml: (id: string) => requestBlob(`/executions/${id}/report.html`),
    downloadReportPdf: (id: string) => requestBlob(`/executions/${id}/report.pdf`),
    downloadCaseReportPdf: (executionId: string, testCaseId: string) =>
      requestBlob(`/executions/${executionId}/cases/${testCaseId}/report.pdf`),
    shareReport: (id: string, input: { recipients: string[] }) =>
      request<{ sent: boolean; recipients: number }>(`/executions/${id}/share-report`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    shareCaseReport: (executionId: string, testCaseId: string, input: { recipients: string[] }) =>
      request<{ sent: boolean; recipients: number }>(`/executions/${executionId}/cases/${testCaseId}/share-report`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    complete: (id: string, input: { status: "completed" | "failed" | "blocked" | "partially_completed" | "aborted"; expected_revision?: number }) =>
      request<{ completed: boolean; revision: number; status: Execution["status"]; counts?: { passed: number; failed: number; blocked: number; running: number; paused?: number; skipped?: number; aborted?: number; not_run: number; total: number } }>(`/executions/${id}/complete`, { method: "POST", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/executions/${id}`, { method: "DELETE" })
  },
executionSchedules: {
    list: (query?: { project_id?: string; app_type_id?: string; is_active?: boolean }) =>
      request<ExecutionSchedule[]>(`/execution-schedules${toQueryString(query)}`),
    get: (id: string) =>
      request<ExecutionSchedule>(`/execution-schedules/${id}`),
    create: (input: { project_id: string; app_type_id?: string; name?: string; cadence?: string; next_run_at?: string; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_options?: TestDataOptions; test_data_set_id?: string; release?: string; sprint?: string; build?: string; assigned_to?: string; assigned_to_ids?: string[]; created_by: string }) =>
      request<{ id: string }>("/execution-schedules", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: { project_id?: string; app_type_id?: string; name?: string; cadence?: string; next_run_at?: string; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_options?: TestDataOptions; test_data_set_id?: string; release?: string; sprint?: string; build?: string; assigned_to?: string; assigned_to_ids?: string[] }) =>
      request<ExecutionSchedule>(`/execution-schedules/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    run: (id: string) =>
      request<{ id: string }>(`/execution-schedules/${id}/run`, { method: "POST" }),
    delete: (id: string) => request<{ deleted: boolean }>(`/execution-schedules/${id}`, { method: "DELETE" })
  },
executionResults: {
    ensure: (input: ExecutionCaseIdentity) => request<ExecutionResult>("/execution-results/ensure", { method: "POST", body: JSON.stringify(input) }),
    transition: (input: ExecutionCaseIdentity & { action: ExecutionCaseLifecycleAction; expected_revision?: number; expected_result_id?: string }) =>
      request<ExecutionResult>("/execution-results/lifecycle", { method: "POST", body: JSON.stringify(input) }),
    list: (query?: { project_id?: string; execution_id?: string; test_case_id?: string; app_type_id?: string; run_limit?: number; limit?: number; projection?: "summary" | "detail" }, options?: { signal?: AbortSignal }) =>
      request<ExecutionResult[]>(`/execution-results${toQueryString(query)}`, { signal: options?.signal }),
    releaseReadiness: (query: { project_id: string; release?: string; sprint?: string; release_id?: string; iteration_id?: string; run_limit?: number; result_limit?: number }) =>
      request<ReleaseReadinessExecutionEvidence>(`/execution-results/release-readiness${toQueryString(query)}`),
    create: (input: { execution_id: string; test_case_id: string; app_type_id: string; status: ExecutionResult["status"]; duration_ms?: number; error?: string; logs?: string; test_data_set_id?: string; test_data_set_name?: string; data_set_iteration_index?: number; data_set_iteration_key?: string; data_set_row_snapshot?: Record<string, string>; external_references?: string[]; defects?: string[]; executed_by?: string }) =>
      request<{ id: string; revision: number }>("/execution-results", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ status: ExecutionResult["status"]; duration_ms: number; error: string; logs: string; external_references: string[]; defects: string[]; expected_revision: number }>) =>
      request<{ updated: boolean; revision: number; case_defects: string[]; defects: string[] }>(`/execution-results/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    linkStepDefects: (id: string, input: { step_id: string; defect_ids: string[]; expected_revision?: number }) =>
      request<{ updated: boolean; revision: number; defects: string[]; step_defects: Record<string, string[]> }>(`/execution-results/${id}/defect-links`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/execution-results/${id}`, { method: "DELETE" })
  }
};
