import { requestAiPreview } from "@hellotest/platform/frontend/src/lib/aiHttpClient";
import type { AiArtifactAssuranceInput, AiDesignImageInput, AiDesignPreviewResponse, AiEvidenceSource, AiProcessingSnapshot, AiRequirementDescriptionRephraseResponse, Issue, QualityGateAssessmentPreviewResponse, Requirement, RequirementImpactPreviewResponse, RequirementIteration, RequirementIterationHealthResponse, StoryGroomingPreviewResponse, TestCaseDefectLink, TestStep } from "@hellotest/platform/frontend/src/types";
import { BatchQueueResponse, PagedResult, request, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";

export type AiStoryEvidenceSource = AiEvidenceSource & {
  label?: string;
  citation_allowed?: boolean;
  limitation?: string | null;
};

type AiRequirementCreationSuggestion = {
  client_id: string;
  title: string;
  description: string;
  external_references: string[];
  priority: number;
  status: string;
  acceptance_criteria: string[];
  risks: string[];
  open_questions: string[];
  change_summary: string[];
  quality_score: number;
  evaluation?: { score: number; grounding: string; completeness: string; testability: string };
  rationale: string;
  evidence_refs?: string[];
  field_evidence?: Record<string, string[]>;
  unsupported_fields?: string[];
  limitations?: string[];
  gherkin_scenarios?: string[];
};

type AiRequirementCreationPreviewResponse = {
  requirement: null;
  integration: { id: string; name: string; type: string; model?: string | null } | null;
  suggestion: (AiRequirementCreationSuggestion & { client_id?: string }) | null;
  requirements: AiRequirementCreationSuggestion[];
  generated: number;
  fallback_used: boolean;
  fallback_reason?: string | null;
  context_reduced?: boolean;
  context_reduction_reason?: string | null;
  request_id?: string;
  input_fingerprint?: string;
  evidence?: AiStoryEvidenceSource[];
  limitations?: string[];
  processing?: AiProcessingSnapshot;
  review_status?: "awaiting_review" | "accepted" | "discarded" | string;
  generation_mode?: "llm" | "deterministic" | "hybrid" | string;
  requires_human_review?: boolean;
  preview_only?: boolean;
  provenance?: Record<string, unknown>;
  status?: string;
};

type AiRequirementGenerationJobResponse = Partial<AiRequirementCreationPreviewResponse> & {
  id: string;
  job_id?: string;
  queued?: boolean;
  project_id: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  input_payload?: Record<string, unknown>;
  last_error?: string | null;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string;
};

import type { JiraIssueCreateMetadata, JiraBugCreateMetadata, JiraWorkflowStatusCatalog } from "@hellotest/integration/frontend/lib/jiraIssueContracts";
export const manualApi = {
requirements: {
    updateReadiness: (id: string, input: { expected_revision: number; checks: Record<string, { status: "met" | "not_met" | "unverified"; evidence: string; attachment_id?: string }> }) =>
      request<{ updated: true; revision: number }>(`/requirements/${id}/readiness`, { method: "PUT", body: JSON.stringify(input) }),
    metrics: (query: { project_id: string; include_sprints?: boolean } & import("./lib/requirementCatalog").RequirementCatalogFilters) =>
      request<import("./lib/requirementCatalog").RequirementCatalogMetricsResponse>(`/requirements/metrics${toQueryString({ ...query })}`),
    list: (query?: import("./lib/requirementCatalog").RequirementCatalogFilters & { project_id?: string; status?: string; priority?: number; sprint_id?: string; unassigned?: boolean; page_size?: number; limit?: number; cursor?: string; projection?: "summary" | "detail" }, options?: { signal?: AbortSignal }) =>
      request<Requirement[]>(`/requirements${toQueryString({ ...query })}`, { signal: options?.signal }),
    listPage: (query?: import("./lib/requirementCatalog").RequirementCatalogFilters & { project_id?: string; status?: string; priority?: number; sprint_id?: string; unassigned?: boolean; page_size?: number; cursor?: string; projection?: "summary" | "detail" }) =>
      request<PagedResult<Requirement>>(`/requirements${toQueryString({ ...query, include_page: true })}`),
    createMetadata: (query?: { project_id?: string }) =>
      request<JiraIssueCreateMetadata>(`/requirements/create-metadata${toQueryString(query)}`),
    editMetadata: (id: string, query?: { project_id?: string }) =>
      request<JiraIssueCreateMetadata>(`/requirements/${id}/edit-metadata${toQueryString(query)}`),
    create: (input: { project_id: string; title: string; description?: string; acceptance_criteria?: string[]; gherkin_scenarios?: string[]; external_references?: string[]; labels?: string[]; sprint?: string; fix_version?: string; release?: string; release_id?: string; iteration_id?: string; dev_completion_target_date?: string; qa_completion_target_date?: string; scrum_team?: string; specification_format?: "gherkin" | "speckit"; specification_content?: string; priority?: number; status?: string; additional_fields?: Record<string, unknown>; related_requirement_ids?: string[] }) =>
      request<{ id: string; related_requirement_ids?: string[]; status_warning?: { code: string; message: string; requested_status?: string | null; current_status?: string | null; issue_key?: string | null } }>("/requirements", { method: "POST", body: JSON.stringify(input) }),
    get: (id: string, query?: { project_id?: string; include_execution?: boolean }) =>
      request<Requirement>(`/requirements/${id}${toQueryString(query)}`),
    previewGrooming: (id: string, input: { project_id: string; integration_id?: string; prompt_guidance?: string; additional_context?: string; proposed_change?: Record<string, unknown> }) =>
      request<StoryGroomingPreviewResponse>(`/requirements/${id}/ai-groom-preview`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewImpact: (id: string, input: AiArtifactAssuranceInput) =>
      request<RequirementImpactPreviewResponse>(`/requirements/${id}/ai-impact-preview`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    rephraseDescription: (input: {
      project_id: string;
      integration_id?: string;
      description?: string;
      description_html?: string;
      additional_context?: string;
      requirement?: {
        id?: string | null;
        display_id?: string | null;
        title?: string | null;
        status?: string | null;
        priority?: number | null;
        labels?: string[];
        sprint?: string | null;
        fix_version?: string | null;
        release?: string | null;
        iteration_id?: string | null;
        external_references?: string[];
      };
    }) =>
      request<AiRequirementDescriptionRephraseResponse>("/requirements/ai-description-rephrase", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    bulkImport: (input: { project_id: string; rows: Array<Record<string, unknown>> }) =>
      request<BatchQueueResponse>("/requirements/import", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    exportRequirements: (input: { project_id: string; requirement_ids?: string[]; format?: "csv" | "json" }) =>
      request<BatchQueueResponse>("/requirements/export", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewCreation: (input: { prompt_guidance?: string; project_id: string; integration_id?: string; model?: string; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[]; priority?: number; status?: string; max_requirements?: number }) =>
      requestAiPreview<AiRequirementCreationPreviewResponse>("/requirements/ai-create-preview", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewGherkin: (input: { project_id: string; integration_id?: string; model?: string; requirements: Array<{ client_id?: string; title: string; description: string; acceptance_criteria?: string[] }> }) =>
      request<{ requirements: Array<{ client_id: string; gherkin_scenarios: string[] }>; fallback_used: boolean; fallback_reason?: string | null; validation?: { story_count: number; scenario_count: number; repaired_story_count: number; skipped_story_count?: number; exact_story_draft_used: boolean } }>("/requirements/ai-gherkin-preview", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    createGenerationJob: (input: { prompt_guidance?: string; project_id: string; integration_id?: string; model?: string; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[]; priority?: number; status?: string; max_requirements?: number }) =>
      requestAiPreview<AiRequirementGenerationJobResponse>("/requirements/ai-create-jobs", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    getGenerationJob: (id: string, query?: { project_id?: string }) =>
      request<AiRequirementGenerationJobResponse>(`/requirements/ai-create-jobs/${id}${toQueryString(query)}`),
    listGenerationJobs: (query?: { project_id?: string; status?: string; limit?: number }) =>
      request<AiRequirementGenerationJobResponse[]>(`/requirements/ai-create-jobs${toQueryString(query)}`),
    previewDesignedTestCases: (id: string, input: { app_type_id: string; integration_id?: string; max_cases?: number; authoring_mode?: "structured" | "gherkin"; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[] }, options?: { signal?: AbortSignal }) =>
      requestAiPreview<AiDesignPreviewResponse>(`/requirements/${id}/design-test-cases-preview`, {
        method: "POST",
        signal: options?.signal,
        body: JSON.stringify(input)
      }),
    acceptDesignedTestCases: (id: string, input: { app_type_id: string; status?: string; cases: Array<{ title: string; description?: string | null; priority?: number; requirement_ids?: string[]; authoring_mode?: "structured" | "gherkin"; gherkin_document?: string | null; parameter_values?: Record<string, string>; steps?: Array<{ step_order?: number; step_type?: TestStep["step_type"]; action?: string | null; expected_result?: string | null }> }> }) =>
      request<{ accepted: number; created: Array<{ id: string; title: string; step_count: number; requirement_ids: string[] }> }>(`/requirements/${id}/design-test-cases-accept`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewOptimization: (id: string, input?: { prompt_guidance?: string; integration_id?: string; model?: string; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[]; requirement_id?: string; selected_requirement_id?: string; single_requirement_only?: boolean; requirement_context?: Record<string, unknown> }) =>
      requestAiPreview<{
        requirement: { id: string; title: string; description?: string; status?: string; priority?: number; external_references?: string[] };
        integration: { id: string; name: string; type: string; model?: string | null } | null;
        suggestion: {
          title: string;
          description: string;
          external_references: string[];
          priority: number;
          status: string;
          acceptance_criteria: string[];
          risks: string[];
          open_questions: string[];
          change_summary: string[];
          gherkin_scenarios?: string[];
          evidence_refs?: string[];
          field_evidence?: Record<string, string[]>;
          unsupported_fields?: string[];
          no_changes_proposed?: boolean;
        };
        evidence?: AiStoryEvidenceSource[];
        limitations?: string[];
        evaluation?: { score: number; grounding: string; completeness: string; testability: string };
        processing?: AiProcessingSnapshot;
        review_status?: "awaiting_review" | "accepted" | "discarded" | string;
        generation_mode?: "llm" | "deterministic" | "hybrid" | string;
        fallback_used: boolean;
        fallback_reason?: string | null;
        context_reduced?: boolean;
        context_reduction_reason?: string | null;
        request_id?: string;
        input_fingerprint?: string;
        requires_human_review?: boolean;
        preview_only?: boolean;
        provenance?: Record<string, unknown>;
      }>(`/requirements/${id}/ai-optimize-preview`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    generateTestCases: (id: string, input: { app_type_id: string; integration_id?: string; max_cases?: number; status?: string; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[] }) =>
      requestAiPreview<{ generated: number; created: Array<{ id: string; title: string; step_count: number }>; integration: { id: string; name: string; type: string; model?: string | null } }>(`/requirements/${id}/generate-test-cases`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<{ project_id: string; title: string; description: string; acceptance_criteria: string[]; gherkin_scenarios: string[]; external_references: string[]; labels: string[]; sprint: string; fix_version: string; release: string; release_id: string; iteration_id: string; dev_completion_target_date: string; qa_completion_target_date: string; scrum_team: string; specification_format: "gherkin" | "speckit"; specification_content: string; priority: number; status: string; additional_fields: Record<string, unknown>; expected_revision: number }>) =>
      request<{
        updated: boolean;
        revision: number;
        sprint_assignment?: { id: string; jira_sprint_id: string; name: string; state?: string | null } | null;
      }>(`/requirements/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    replaceRelatedRequirements: (id: string, requirement_ids: string[]) => request<{ updated: boolean; related_requirement_ids: string[] }>(`/requirements/${id}/related-requirements`, { method: "PUT", body: JSON.stringify({ requirement_ids }) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/requirements/${id}`, { method: "DELETE" })
  },
requirementIterations: {
    list: (query?: { project_id?: string }) =>
      request<RequirementIteration[]>(`/requirement-iterations${toQueryString(query)}`),
    health: (sprintIds: string[], query?: { project_id?: string; include_backlog?: boolean }) =>
      request<RequirementIterationHealthResponse>(
        `/requirement-iterations/health${toQueryString({ ...query, sprint_ids: sprintIds.join(",") })}`
      ),
    get: (id: string) =>
      request<RequirementIteration>(`/requirement-iterations/${id}`),
    listRequirements: (id: string, query?: import("./lib/requirementCatalog").RequirementCatalogFilters & { page_size?: number; cursor?: string; projection?: "summary" | "detail" }) =>
      request<PagedResult<Requirement>>(`/requirement-iterations/${id}/requirements${toQueryString({ ...query, include_page: true })}`),
    create: (input: { project_id: string; name: string; description?: string; goal?: string; labels?: string[]; external_references?: string[]; start_date?: string; end_date?: string; assignee_id?: string; effort_points?: number; original_dev_id?: string; original_qa_id?: string; state: "future" | "active"; requirement_ids?: string[] }) =>
      request<{
        id: string;
        sprint: RequirementIteration;
        assignment: {
          assigned: number;
          assigned_issue_ids: string[];
          assigned_issue_keys: string[];
        } | null;
      }>("/requirement-iterations", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; description: string; goal: string; labels: string[]; external_references: string[]; state: "future" | "active" | "closed"; start_date: string; end_date: string; assignee_id: string; effort_points: number | null; original_dev_id: string; original_qa_id: string; requirement_ids: string[]; jira_sprint_id: string; jira_sprint_name: string }>) =>
      request<{ updated: boolean; sprint: RequirementIteration }>(`/requirement-iterations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    assignRequirements: (id: string, requirement_ids: string[], append = true) =>
      request<{
        updated: boolean;
        assigned: number;
        total?: number;
        assigned_issue_ids: string[];
        assigned_issue_keys: string[];
        sprint: { id: string; jira_sprint_id?: string | null; name: string; state?: string | null };
      }>(`/requirement-iterations/${id}/requirements`, {
        method: "PUT",
        body: JSON.stringify({ requirement_ids, append })
      }),
    removeRequirements: (id: string, requirement_ids: string[]) =>
      request<{ updated: boolean; removed: number }>(`/requirement-iterations/${id}/requirements`, {
        method: "DELETE",
        body: JSON.stringify({ requirement_ids })
      }),
    delete: (id: string) => request<{ deleted: boolean; id: string; unassigned: number }>(`/requirement-iterations/${id}`, { method: "DELETE" })
  },
requirementReleases: {
    list: (query?: { project_id?: string }) => request<import("@hellotest/platform/frontend/src/types").RequirementRelease[]>(`/requirement-releases${toQueryString(query)}`),
    listReadiness: (query: { project_id: string }) => request<import("@hellotest/platform/frontend/src/types").RequirementReleaseReadiness[]>(`/requirement-releases/readiness${toQueryString(query)}`),
    get: (id: string) => request<import("@hellotest/platform/frontend/src/types").RequirementRelease>(`/requirement-releases/${id}`),
    readiness: (id: string) => request<import("@hellotest/platform/frontend/src/types").RequirementReleaseReadiness>(`/requirement-releases/${id}/readiness`),
    create: (input: { project_id: string; name: string; description?: string; fix_version: string; target_date_label?: string; plan_date?: string; target_date?: string; external_link?: string; state?: "planned" | "in_progress" | "released"; sprint_ids?: string[]; requirement_ids?: string[] }) =>
      request<{ id: string; release: import("@hellotest/platform/frontend/src/types").RequirementRelease }>("/requirement-releases", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; description: string; fix_version: string; target_date_label: string; plan_date: string; target_date: string; external_link: string; state: "planned" | "in_progress" | "released"; sprint_ids: string[]; requirement_ids: string[] }>) =>
      request<{ updated: boolean; release: import("@hellotest/platform/frontend/src/types").RequirementRelease }>(`/requirement-releases/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    appendScope: (id: string, input: { requirement_ids?: string[]; sprint_ids?: string[] }) =>
      request<{ updated: boolean; appended_requirement_ids: string[]; appended_sprint_ids: string[]; release: import("@hellotest/platform/frontend/src/types").RequirementRelease }>(`/requirement-releases/${id}/scope`, { method: "POST", body: JSON.stringify(input) }),
    generateNotes: (id: string) =>
      request<import("@hellotest/platform/frontend/src/types").RequirementReleaseNotes>(`/requirement-releases/${id}/release-notes`, { method: "POST", body: JSON.stringify({}) }),
    delete: (id: string) => request<{ deleted: boolean; id: string }>(`/requirement-releases/${id}`, { method: "DELETE" })
  },
requirementTestCases: {
    list: (query?: { requirement_id?: string; test_case_id?: string }) =>
      request<Array<{ requirement_id: string; test_case_id: string }>>(`/requirement-test-cases${toQueryString(query)}`),
    replace: (requirement_id: string, test_case_ids: string[]) =>
      request<{ updated: boolean; mapped: number }>(`/requirement-test-cases/replace`, {
        method: "PUT",
        body: JSON.stringify({ requirement_id, test_case_ids })
      })
  },
requirementDefects: {
    list: (query?: { requirement_id?: string; issue_id?: string }) =>
      request<Array<{ requirement_id: string; issue_id: string; link_source: string; created_at?: string }>>(`/requirement-defects${toQueryString(query)}`),
    replace: (requirement_id: string, issue_ids: string[]) =>
      request<{ updated: boolean; mapped: number }>("/requirement-defects/replace", {
        method: "PUT",
        body: JSON.stringify({ requirement_id, issue_ids })
      })
  },
qualityGates: {
    previewAssessment: (id: string, input: { project_id: string; thresholds?: Record<string, number> }) =>
      request<QualityGateAssessmentPreviewResponse>(`/quality-gates/${id}/ai-assessment`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  }
};

