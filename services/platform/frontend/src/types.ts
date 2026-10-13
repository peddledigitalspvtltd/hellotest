export type TestDataOptions = { override_lower_scopes?: boolean; override_test_case_data?: boolean; override_suite_data?: boolean; override_shared_steps?: boolean; runtime_policy?: { version: number; case?: TestDataOptions; suite?: TestDataOptions; run?: TestDataOptions } };
export type DataSetValidation = { valid: boolean; missing_parameters: string[]; required_parameters: string[]; available_parameters: string[]; iteration_count?: number; reason?: string; test_data_set_id?: string; data_set_id?: string };
export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_data_url?: string | null;
  role?: "admin" | "member";
  status?: "active" | "suspended";
  role_id?: string;
  role_name?: string;
  permissions?: string[];
  workspace_permissions?: string[];
  project_permissions?: Record<string, string[]>;
  auth_provider?: "local" | "google";
  email_verified?: boolean;
  created_at?: string;
};

export type Role = {
  id: string;
  name: string;
  system?: boolean;
  permission_count?: number;
};

export type Permission = {
  id: string;
  code: string;
  description: string | null;
  level?: "read" | "write" | "manage";
  features?: Array<{ key: string; label: string; group: string; group_label: string; enabled?: boolean | null }>;
};

export type PermissionGroup = {
  key: string;
  label: string;
  permissions: Permission[];
};

export type ApiKeyScope =
  | "user"
  | "read"
  | "design"
  | "automation"
  | "runs"
  | "environment"
  | "integrations"
  | "admin";

export type ApiKeyScopeOption = {
  value: ApiKeyScope;
  label: string;
  description: string;
};

export type UserApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  scope: ApiKeyScope;
  is_active: boolean;
  created_at?: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

export type FeatureFlagDefinition = {
  key: string;
  label: string;
  description?: string;
  permissions?: string[];
  routes?: string[];
  default_enabled?: boolean;
  group: string;
  group_label: string;
};

export type FeatureFlagGroup = {
  key: string;
  label: string;
  description: string;
  features: Array<Omit<FeatureFlagDefinition, "group" | "group_label">>;
};

export type FeatureFlagSnapshot = {
  capability_availability?: Record<string, boolean>;
  groups: FeatureFlagGroup[];
  flags: Record<string, boolean>;
  local_flags: Record<string, boolean>;
  dependencies?: Record<string, string[]>;
  optional_dependencies?: Record<string, string[]>;
  permission_features?: Record<string, string[]>;
  provider: {
    type: string;
    name?: string;
    source?: string;
    configured: boolean;
    connected: boolean;
    last_updated?: string | null;
  };
  updated_at?: string | null;
};

export type JiraAttachment = {
  id: string;
  filename: string;
  size: number;
  storedSize?: number;
  compression?: "gzip" | "none" | string;
  savedBytes?: number;
  mimeType: string;
  created?: string | null;
  content?: string | null;
  thumbnail?: string | null;
  author?: {
    accountId?: string;
    displayName?: string;
    avatarUrls?: Record<string, string>;
  } | null;
};

export type ExecutionResultAttachment = JiraAttachment & {
  entity_type: "execution_result";
  entity_id: string;
  project_id: string;
  step_id?: string | null;
  checksum?: string | null;
};

export type QualityDashboardGadget = {
  id: string;
  title: string;
  data_source?: "jira" | "hellotest";
  release?: string;
  type: "metric" | "donut" | "bar" | "column" | "stacked-bar" | "line" | "area" | "table";
  jql: string;
  group_by: "status" | "statusCategory" | "priority" | "issuetype" | "assignee" | "reporter" | "components" | "fixVersion" | "release" | "story" | "labels" | "sprint" | "resolution" | "module" | "createdWeek" | "updatedWeek" | "createdMonth" | "updatedMonth";
  metric?: "count" | "resolved" | "unresolved" | "highPriority" | "unassigned" | "overdue" | "stale30d" | "created30d" | "resolved30d" | "resolutionRate" | "averageAgeDays" | "averageResolutionDays" | "releaseConfidence" | "requirementCoverage" | "coverageGaps" | "automationCoverage" | "openDefects" | "failedRuns" | "executionCycleHours" | "completedRuns30d" | "testCases" | "testSuites" | "testRuns" | "moduleCaseCount" | "passRate" | "executionCompletion" | "evidenceConfidence" | "stories" | "devStoryCompletion" | "qaStoryCompletion" | "storyTestPassRate" | "storyExecutionCoverage" | "storiesWithOpenDefects" | "linkedTestCases" | "unlinkedTestCases" | "unassignedModuleCases" | "linkedDefects" | "defectTraceability" | "failedCases" | "blockedCases" | "unexecutedCases";
  accent?: "blue" | "green" | "purple" | "orange" | "red" | "teal" | "slate";
};

export type QualityDashboard = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  layout: "single" | "two-column" | "three-column";
  gadgets: QualityDashboardGadget[];
  revision?: number;
  created_at?: string;
  updated_at?: string;
};

export type QualityDashboardGadgetResult = {
  project: { id: string; key: string; name: string };
  jql: string;
  evaluated_at: string;
  gadget: QualityDashboardGadget;
  total: number;
  value: number;
  value_label: string;
  returned: number;
  truncated: boolean;
  series: Array<{ label: string; value: number }>;
  rows: Array<{ id: string; key: string; title: string; status: string | null; priority: string | null; type: string | null; assignee: string | null; updated: string | null }>;
  drilldown_target?: string;
  methodology?: string;
};

export type QualityDashboardBatchResponse = {
  project: { id: string; key: string; name: string };
  evaluated_at: string;
  results: Array<{
    gadget_id: string;
    result?: QualityDashboardGadgetResult;
    error?: { code: string; message: string; status: number };
  }>;
};

export type QualityDashboardDesignPreviewResponse = AiAssistedPreviewBase & {
  provenance: AiAssistanceProvenance & {
    design_method?: "stakeholder_template" | "model_draft";
    design_basis?: string;
  };
  dashboard: QualityDashboard;
  templates: Array<{ id: "executive" | "product" | "quality" | "automation"; name: string; description: string; gadget_count: number }>;
  rationale: string[];
  preview_only: true;
  decision_requires_human_approval: true;
};

export type AdminHealthStatus = "ready" | "degraded" | "blocked";

export type AdminHealthCheck = {
  key: string;
  label: string;
  critical?: boolean;
  status: AdminHealthStatus;
  summary?: string | null;
  detail?: string | null;
  remediation?: string | null;
  metrics?: Record<string, string | number | boolean | null>;
};

export type AdminHealthSnapshot = {
  status: AdminHealthStatus;
  checked_at?: string | null;
  version?: string | null;
  checks?: AdminHealthCheck[];
  registry?: Omit<AdminHealthCheck, "key" | "label">;
  schema?: Omit<AdminHealthCheck, "key" | "label">;
  storage?: Omit<AdminHealthCheck, "key" | "label">;
  attachments?: Omit<AdminHealthCheck, "key" | "label">;
  permissions?: Omit<AdminHealthCheck, "key" | "label">;
};

export type OpsTelemetryEvent = {
  id?: string | null;
  event_type?: string | null;
  service_name?: string | null;
  environment?: string | null;
  status?: string | null;
  summary?: string | null;
  received_at?: string | null;
  execution?: { id?: string | null; name?: string | null } | null;
  test_case?: { id?: string | null; title?: string | null } | null;
  suite?: { id?: string | null; name?: string | null } | null;
  step?: { id?: string | null; action?: string | null } | null;
  payload?: Record<string, unknown> | null;
};

export type OpsTelemetrySnapshot = {
  checked_at: string;
  project_id: string;
  workers?: { state: "available" | "unavailable"; total: number; items: OpsTelemetryEvent[] };
  events: { items: OpsTelemetryEvent[]; total: number };
  services: { items: Array<{ service_name?: string | null; count?: number | null }> };
};

export type AppNotification = {
  id: string;
  user_id: string;
  session_id?: string | null;
  project_id?: string | null;
  run_id?: string | null;
  target_url?: string | null;
  type: string;
  preference?: string | null;
  title: string;
  message: string;
  tone?: "error" | "warning" | "success" | "info" | "neutral" | string;
  status: "unread" | "read" | string;
  created_at?: string;
};

export type Project = {
  id: string;
  display_id?: string | null;
  name: string;
  description: string | null;
  visibility?: "private" | "public";
  created_by: string | null;
  created_at?: string;
  has_access?: boolean;
  is_favorite?: boolean;
  story_count?: number | null;
  module_count?: number | null;
  case_count?: number | null;
  bug_count?: number | null;
};

export type WorkspaceProjectScope = Pick<Project, "id" | "display_id" | "name" | "has_access">;

export type ProjectDeletionJob = {
  id: string;
  project_id: string;
  project_name: string;
  status: "queued" | "running" | "cleanup" | "completed" | "failed";
  phase: string;
  processed_rows: number;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ProjectDeletionResponse = { accepted: true; job: ProjectDeletionJob } | { deleted: true };

export type ProjectPortfolioImpact = {
  total: number;
  top: Array<{ id: string; name: string; count: number }>;
};

export type ProjectPortfolioAnalyticsItem = {
  project_id: string;
  display_id: string;
  name: string;
  counts: { members: number; app_types: number; stories: number; modules: number; cases: number; suites?: number; bugs: number; open_bugs: number };
  members: Array<{ user_id: string; name: string }>;
  app_types: AppType[];
  story_coverage: { total: number; covered: number; percent: number };
  automation_coverage: { total: number; automated: number; percent: number };
  pass_confidence: {
    total: number;
    passed: number;
    percent: number;
    case_total: number;
    case_passed: number;
    bug_total: number;
    bug_resolved: number;
  };
  execution_evidence: { total: number; evidenced: number; missing: number; percent: number; threshold: number; violates: boolean };
  latest_run_pass_rate?: {
    execution: Execution | null;
    total: number;
    passed: number;
    percent: number | null;
    counts: Record<string, number>;
  };
  latest_execution: Execution | null;
  latest_failed_count: number;
  latest_blocked_count: number;
  bug_count: number;
  open_bug_count: number;
  failure_impacts: { modules: ProjectPortfolioImpact; requirements: ProjectPortfolioImpact };
  bug_impacts: { modules: ProjectPortfolioImpact; requirements: ProjectPortfolioImpact };
  readiness_score: number;
  health_tone: "success" | "warning" | "danger" | "neutral";
  health_label: string;
  readiness_label: string;
  attention_reasons: string[];
  insight: string;
};

export type ProjectPortfolioAnalytics = {
  evaluated_at: string;
  configuration: Record<string, Record<string, number>>;
  summary: {
    total_projects: number;
    accessible_projects: number;
    locked_projects: number;
    risky_projects: number;
    watch_projects: number;
    release_ready_projects: number;
    assessed_projects: number;
    attention_projects: number;
    overall_health: number;
    average_story_coverage: number;
    average_automation_coverage: number;
    average_pass_confidence: number;
    total_stories: number;
    covered_stories: number;
    total_cases: number;
    automated_cases: number;
    evidence_missing_projects: number;
    execution_failure_cases: number;
    execution_blocked_cases: number;
    bug_count: number;
    open_bug_count: number;
    failure_impacts: { modules: ProjectPortfolioImpact; requirements: ProjectPortfolioImpact };
    bug_impacts: { modules: ProjectPortfolioImpact; requirements: ProjectPortfolioImpact };
  };
  projects: ProjectPortfolioAnalyticsItem[];
};

export type ProjectActivationStatus =
  | "inactive"
  | "queued"
  | "provisioning"
  | "active"
  | "failed"
  | "blocked";

export type ProjectActivationRecovery = {
  type: "jira-screen-field-reconciliation" | "jira-global-field-context-reconciliation" | "jira-installation-scope-upgrade" | string;
  action?: "retry" | "adopt-existing" | "retry-reconciliation" | "upgrade-installation" | "none" | string | null;
  field_id?: string | null;
};

export type ProjectActivationProject = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  project_type?: string | null;
  simplified?: boolean | null;
  archived?: boolean | null;
  configuration_model?: "company-managed" | "team-managed" | "unknown" | string;
  activation_supported?: boolean;
  activation_unavailable_reason?: "archived" | "team-managed" | "unverified-project-type" | string | null;
  activation_status?: ProjectActivationStatus | "ready" | "not-prepared" | "needs-review" | string | null;
  is_configured?: boolean;
  can_bulk_enable?: boolean;
  mapping_required?: boolean;
  activation_error?: {
    code?: string | null;
    message?: string | null;
    retryable?: boolean;
    recovery?: ProjectActivationRecovery | null;
  } | string | null;
};

export type ProjectActivationCatalog = {
  items: ProjectActivationProject[];
  total: number;
  supported_count?: number;
  unavailable_count?: number;
  supported_configuration_model?: "company-managed" | string;
};

export type ProjectActivationSourceMapping = {
  requirement_issue_type_ids: string[];
  defect_issue_type_ids: string[];
};

export type ProjectActivationSiteStatus =
  | "not-prepared"
  | "queued"
  | "provisioning"
  | "ready"
  | "failed"
  | "needs-review";

export type ProjectActivationResourceKind = "issueTypes" | "linkTypes" | "fields" | "screenSchemes";

export type ProjectActivationResourceResolutions = Record<
  ProjectActivationResourceKind,
  Record<string, string>
>;

export type ProjectActivationSiteConflictCandidate = {
  id: string;
  name?: string | null;
  type?: string | null;
  description?: string | null;
  references?: number;
  sources?: string[];
};

export type ProjectActivationSiteConflict = {
  code: string;
  resource_type: string;
  logical_key: string;
  candidate_ids: string[];
  candidates?: ProjectActivationSiteConflictCandidate[];
  message: string;
};

export type ProjectActivationSiteSnapshot = {
  schema: "hellotest.siteSchema.v1";
  status: ProjectActivationSiteStatus;
  is_ready: boolean;
  phase: string | null;
  progress: {
    completed: number;
    total: number;
    percent: number;
  };
  resource_counts: {
    issue_types: number;
    link_types: number;
    fields: number;
    screen_schemes: number;
  };
  warning_count: number;
  warnings?: string[];
  conflicts?: ProjectActivationSiteConflict[];
  error: {
    code?: string | null;
    message: string;
    retryable?: boolean;
    automatic_retry?: boolean;
    phase?: string | null;
    recovery?: ProjectActivationRecovery | null;
  } | string | null;
  job: {
    id?: string | null;
    attempt?: number;
    requested_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
  } | null;
};

export type ProjectActivationBatchItem = {
  project_id: string;
  project_key?: string | null;
  status: string;
  message?: string | null;
};

export type ProjectActivationBatchResult = {
  schema: "hellotest.projectActivationBatch.v1";
  batch_id: string | null;
  requested: number;
  total: number;
  accepted: number;
  already_ready: number;
  needs_mapping: number;
  rejected: number;
  items: ProjectActivationBatchItem[];
};

export type ProjectActivationSnapshot = {
  schema: "hellotest.projectActivation.v1";
  project: ProjectActivationProject;
  status: ProjectActivationStatus;
  schema_ready?: boolean;
  feature_ready?: boolean;
  native_mapping_ready?: boolean;
  is_configured: boolean;
  legacy_adopted: boolean;
  can_enable: boolean;
  can_retry: boolean;
  stalled?: boolean;
  phase: string | null;
  progress: {
    completed: number;
    total: number;
    percent: number;
  };
  eligibility: {
    eligible: boolean;
    global_admin: boolean;
    project_admin: boolean;
    project_type: string | null;
    blockers: string[];
    warnings: string[];
  };
  feature_policy: {
    configured: boolean;
    valid: boolean;
    revision: number | null;
    updated_at: string | null;
    missing_keys: string[];
    unknown_keys: string[];
  };
  registry: {
    present: boolean;
    version: string | null;
    mode: string | null;
    property_model_version: string | null;
  };
  native_issue_types?: {
    available: Array<{
      id: string;
      name: string;
      subtask: boolean;
    }>;
    recommended: ProjectActivationSourceMapping;
    selected: ProjectActivationSourceMapping;
    mapping_required: boolean;
  };
  job: {
    id: string;
    attempt: number;
    requested_at: string | null;
    started_at: string | null;
    completed_at: string | null;
  } | null;
  last_heartbeat_at?: string | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    automatic_retry?: boolean;
    phase: string | null;
    recovery?: ProjectActivationRecovery | null;
  } | null;
  next_action: string | null;
};

export type ProjectMember = {
  id: string;
  project_id: string;
  user_id: string;
  role_id: string;
  user_name?: string | null;
  user_email?: string | null;
  fallback_role_id?: string;
  assignment_source?: "jira-permission" | string;
  system_managed?: boolean;
  jira_admin_verified_at?: string;
  created_at?: string;
};

export type AppType = {
  id: string;
  project_id: string;
  name: string;
  type: "web" | "api" | "android" | "ios" | "unified";
  is_unified: number;
  created_at?: string;
};

export type Requirement = {
  release_id?: string | null;
  acceptance_criteria?: string[];
  catalog_metrics?: import("@hellotest/manual/frontend/lib/requirementCatalog").RequirementRecordMetrics;
  id: string;
  display_id?: string | null;
  jira_url?: string | null;
  project_id: string;
  iteration_id?: string | null;
  title: string;
  description: string | null;
  gherkin_scenarios?: string[];
  external_references?: string[];
  detail_complete?: boolean;
  labels?: string[];
  sprint?: string | null;
  sprint_id?: string | null;
  sprint_state?: string | null;
  sprint_start_date?: string | null;
  sprint_end_date?: string | null;
  sprint_complete_date?: string | null;
  fix_version?: string | null;
  release?: string | null;
  dev_completion_target_date?: string | null;
  qa_completion_target_date?: string | null;
  scrum_team?: string | null;
  specification_format?: "gherkin" | "speckit";
  specification_content?: string | null;
  priority: number | null;
  status: string | null;
  status_category?: string | null;
  additional_fields?: Record<string, unknown>;
  test_case_ids?: string[];
  defect_ids?: string[];
  defects?: RequirementDefectLink[];
  related_items?: RequirementRelatedItem[];
  release_membership_source?: "manual" | "sprint";
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  revision?: number;
};

export type RequirementRelatedItem = {
  id: string;
  display_id?: string | null;
  title: string;
  description?: string | null;
  sprint?: string | null;
  issue_type: string;
  relation: string;
  direction: "inward" | "outward";
  status?: string | null;
  status_category?: string | null;
  priority?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  jira_url?: string | null;
  hellotest_kind?: "test-case" | "test-suite" | "test-run" | "bug" | "requirement" | null;
};

export type RequirementIteration = {
  id: string;
  display_id?: string | null;
  project_id: string;
  name: string;
  description?: string | null;
  goal?: string | null;
  jira_sprint_id?: string | null;
  jira_sprint_name?: string | null;
  source?: "jira" | "hellotest" | string;
  state?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  assignee_id?: string | null;
  effort_points?: number | null;
  original_dev_id?: string | null;
  original_qa_id?: string | null;
  complete_date?: string | null;
  labels?: string[];
  external_references?: string[];
  requirement_count?: number;
  requirement_ids?: string[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RequirementRelease = {
  id: string;
  display_id?: string | null;
  project_id: string;
  name: string;
  description?: string | null;
  fix_version: string;
  target_date_label?: string | null;
  plan_date?: string | null;
  target_date?: string | null;
  external_link?: string | null;
  state: "planned" | "in_progress" | "released" | "overdue";
  persisted_state?: "planned" | "in_progress" | "released";
  sprint_ids: string[];
  requirement_ids: string[];
  requirement_count: number | null;
  story_scope_visible?: boolean;
  requirements?: Requirement[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RequirementReleaseNotes = {
  release_id: string;
  release_name: string;
  fix_version: string;
  generated_at: string;
  generation_mode: "llm" | "deterministic";
  executive_summary: string;
  highlights: string[];
  risks: string[];
  change_groups: Array<{ title: string; items: string[] }>;
  known_limitations: string[];
  validation_summary: string;
  scope_summary: {
    scoped_changes: number;
    delivered_changes: number;
    change_categories: number;
  };
  quality_summary: {
    readiness_score: number | null;
    readiness_state: RequirementReleaseReadiness["readiness_state"];
    story_completion: string;
    test_coverage_percent: number | null;
    pass_rate_percent: number | null;
    open_bugs: number;
  };
  story_evaluations: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
    sprint: string | null;
    completed: boolean;
    linked_cases: number;
    total_bugs: number;
    open_bugs: number;
    health: "healthy" | "attention" | "at_risk";
    outcome: string | null;
    acceptance_scope: string | null;
    summary: string;
  }>;
};

export type RequirementReleaseReadiness = {
  release_id: string;
  total_stories: number;
  covered_stories: number;
  test_coverage_percent: number | null;
  linked_cases: number;
  executed_cases: number;
  passed_cases: number;
  pass_rate_percent: number | null;
  total_bugs: number;
  open_bugs: number;
  bug_density: number | null;
  automated_cases?: number;
  automation_coverage_percent: number | null;
  readiness_score: number | null;
  readiness_state: "ready" | "at_risk" | "not_ready";
  methodology?: Record<string, string | number | boolean>;
};

export type RequirementIterationHealthSourceState =
  | "complete"
  | "partial"
  | "unavailable"
  | "not_needed";

export type RequirementIterationHealth = {
  blocked_stories?: number | null;
  comment_count?: number | null;
  iteration_id: string;
  jira_sprint_id: string | null;
  name: string;
  state: string | null;
  total_stories: number | null;
  completed_stories: number | null;
  completed_percent: number | null;
  covered_stories: number | null;
  coverage_percent: number | null;
  linked_cases: number | null;
  executed_linked_cases: number | null;
  passed_cases: number | null;
  pass_percent: number | null;
  at_risk_stories: number | null;
  slippage_stories?: number | null;
  on_course_stories?: number | null;
  open_p1_p2_bugs: number | null;
  total_bugs: number | null;
  observed: {
    stories_scanned: number;
    completed_stories: number;
    covered_stories: number;
    linked_cases: number;
    executed_linked_cases: number;
    passed_cases: number;
    at_risk_stories: number;
    slippage_stories?: number;
    on_course_stories?: number;
    open_p1_p2_bugs: number;
    total_bugs: number;
  };
  exact_fields: string[];
  completeness: {
    complete: boolean;
    partial: boolean;
    reasons: string[];
    exact_fields: string[];
    stories: {
      state: RequirementIterationHealthSourceState;
      scanned: number;
      limit: number;
    };
    executions: {
      state: RequirementIterationHealthSourceState;
      linked_cases_scoped: number;
      runs_scanned: number;
      results_scanned: number;
      case_limit: number;
      run_limit: number;
      result_limit: number;
    };
    bugs: {
      state: RequirementIterationHealthSourceState;
      bugs_scanned: number;
      limit: number;
    };
  };
};

export type RequirementIterationHealthResponse = {
  items: RequirementIterationHealth[];
  backlog: RequirementIterationHealth | null;
  partial: boolean;
  requested_ids: string[];
  skipped_ids: string[];
  unavailable_ids?: string[];
  generated_at: string;
  completeness: {
    complete: boolean;
    partial: boolean;
    reasons: string[];
  };
  metric_methodology: {
    scope_population: {
      definition: string;
      completeness_boundary: string;
    };
    counting_units: {
      linked_cases: string;
      bugs: string;
    };
    completed_percent: {
      numerator: string;
      denominator: string;
      zero_denominator: null;
    };
    coverage_percent: {
      numerator: string;
      denominator: string;
      zero_denominator: null;
      covered_definition: string;
    };
    pass_percent: {
      numerator: string;
      denominator: string;
      zero_denominator: null;
      execution_definition: string;
    };
    defect_density: {
      numerator: string;
      denominator: string;
      zero_denominator: null;
      bug_definition: string;
    };
    at_risk_stories: {
      denominator: string;
      definition: string;
    };
    bounded_evidence: {
      exact_rule: string;
      partial_rule: string;
    };
  };
  limits: {
    sprints: number;
    stories_per_sprint: number;
    linked_cases: number;
    runs: number;
    execution_results: number;
    bugs: number;
  };
};

export type RequirementDefectLink = {
  id: string;
  title: string;
  status: string | null;
  status_category?: string | null;
  severity?: string | null;
  priority?: string | null;
  link_source?: "manual" | "automatic" | string;
  created_at?: string;
};

export type TestCaseDefectLink = {
  id: string;
  title: string;
  status: string | null;
  severity?: string | null;
  priority?: string | null;
  link_source?: "manual" | "automatic" | string;
  created_at?: string;
};

export type TestCaseReviewStatus = "not_requested" | "pending" | "accepted" | "changes_requested";

export type TestCaseReviewEvent = {
  id: string;
  status: TestCaseReviewStatus;
  comment?: string | null;
  user_id?: string | null;
  created_at?: string;
};

export type Issue = {
  id: string;
  display_id?: string | null;
  jira_url?: string | null;
  user_id: string;
  user_name?: string | null;
  user_email?: string | null;
  title: string;
  message: string;
  labels?: string[];
  sprint?: string | null;
  fix_version?: string | null;
  release?: string | null;
  steps_to_reproduce?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  severity?: string | null;
  priority?: string | null;
  environment?: string | null;
  build?: string | null;
  jira_bug_key?: string | null;
  linked_test_run_id?: string | null;
  linked_test_case_ids?: string[];
  has_converted_test_cases?: boolean;
  linked_test_suite_ids?: string[];
  linked_module_ids?: string[];
  linked_requirement_ids?: string[];
  traceability_truncated?: boolean;
  assignee_id?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
  root_cause?: string | null;
  qa_root_cause?: string | null;
  bug_type?: string | null;
  regression?: boolean;
  status: string | null;
  status_category?: string | null;
  revision?: number;
  created_at?: string;
  updated_at?: string;
};

export type IssueHistoryEntry = {
  id: string;
  issue_id: string;
  actor_id: string | null;
  actor_name: string;
  actor_email: string | null;
  action: "created" | "updated";
  created_at: string;
  legacy?: boolean;
  changes: Array<{
    field: string;
    label: string;
    old_value: string | string[] | boolean | null;
    new_value: string | string[] | boolean | null;
    old_display?: string | null;
    new_display?: string | null;
  }>;
};

export type AiProcessingStage = {
  id: "intake" | "context" | "guardrails" | "specialist" | "outcome" | "evaluation" | "review";
  status: "queued" | "running" | "complete" | "failed" | "current";
  detail?: string;
  evidence?: string;
  item_count?: number;
  duration_ms?: number;
};

export type AiProcessingSnapshot = {
  active_stage_id?: AiProcessingStage["id"];
  completed_stage_count?: number;
  total_stage_count?: number;
  status_label?: string;
  progress_mode?: "determinate" | "indeterminate";
  stages?: AiProcessingStage[];
};

export type AiEvidenceSource = {
  ref: string;
  type: string;
  id: string;
  title: string;
  excerpt?: string | null;
  status?: string | null;
  field?: string | null;
  related_id?: string | null;
  url?: string | null;
  trust?: "workspace" | "user-provided" | "pointer-only" | string;
};

export type AiEvidenceGap = {
  field: string;
  reason: string;
  question?: string | null;
};

export type AiBugDraftEditableField =
  | "title"
  | "message"
  | "steps_to_reproduce"
  | "expected_result"
  | "actual_result"
  | "severity"
  | "priority"
  | "environment"
  | "build"
  | "labels";

export type AiBugDraftClientReviewState = {
  human_edited_fields: AiBugDraftEditableField[];
  stale_field_evidence: Partial<Record<AiBugDraftEditableField, string[]>>;
  stale_gaps: Partial<Record<AiBugDraftEditableField, AiEvidenceGap[]>>;
  stale_fallback_fields: AiBugDraftEditableField[];
};

export type AiBugDraftPreview = {
  draft: {
    title: string;
    message: string;
    steps_to_reproduce: string;
    expected_result: string;
    actual_result: string;
    severity: "critical" | "high" | "medium" | "low";
    priority: "Highest" | "High" | "Medium" | "Low" | "Lowest";
    environment: string;
    build: string;
    labels: string[];
    linked_test_run_id: string;
    linked_test_case_ids: string[];
    linked_requirement_ids: string[];
    rationale: string;
  };
  citations: Array<{ type: string; id: string; title?: string | null }>;
  evidence_sources: AiEvidenceSource[];
  field_evidence: Record<string, string[]>;
  gaps: AiEvidenceGap[];
  assumptions: string[];
  boundaries: {
    limits: Record<string, number>;
    requested: Record<string, number>;
    included: Record<string, number>;
    omitted: Record<string, number>;
    content_limits: Record<string, number>;
    content_omissions: Array<{ source_ref: string; field: string; unit: "characters" | "items" | string; omitted: number }>;
    partial_sources: boolean;
  };
  fallback_fields: string[];
  processing: AiProcessingSnapshot;
  provenance: AiAssistanceProvenance & { usage?: Record<string, number> | null };
  client_review?: AiBugDraftClientReviewState;
};

export type AiBugTriageSignal = {
  code: string;
  label: string;
  value: string;
  supports: Array<"category" | "priority" | "context" | string>;
  evidence_refs: string[];
};

export type AiBugTriageRecommendation = {
  issue_id: string;
  display_id: string;
  title: string;
  category: string;
  current_priority: "Highest" | "High" | "Medium" | "Low" | "Lowest";
  recommended_priority: "Highest" | "High" | "Medium" | "Low" | "Lowest";
  explanation: string;
  signals: AiBugTriageSignal[];
  evidence_refs: string[];
  readiness: {
    status: "needs-evidence" | "ready-for-review" | string;
    completed_field_count: number;
    total_field_count: number;
    missing_fields: string[];
    linked_evidence: boolean;
    review_actions: string[];
  };
  review_actions: string[];
};

export type AiBugTriagePreview = AiAssistedPreviewBase & {
  scope: {
    project_id: string;
    project_key: string;
    issue_count: number;
    maximum_issue_count: number;
  };
  summary: string;
  triage: AiBugTriageRecommendation[];
  evidence_sources: AiEvidenceSource[];
  boundaries: {
    limits: Record<string, number>;
    omissions: Array<{ issue_id: string; field: string; unit: "characters" | "items" | string; omitted: number }>;
    partial_sources: boolean;
  };
  processing: AiProcessingSnapshot;
  review_sequence: string[];
  limitations: string[];
  partial_sources: boolean;
  preview_only: true;
  decision_requires_human_approval: true;
};

export type IntegrationType =
  | "mcp"
  | "http"
  | "llm"
  | "jira"
  | "email"
  | "google_auth"
  | "google_drive"
  | "github"
  | "testengine"
  | "cloudrun"
  | "ops"
  | "local-desktop";

export type Integration = {
  id: string;
  type: IntegrationType;
  name: string;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  project_key: string | null;
  username: string | null;
  config: Record<string, unknown> | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DomainOption = {
  id?: string | null;
  value: string;
  label: string;
  description?: string;
  active?: boolean;
  builtin?: boolean;
  icon?: string;
  defaults?: Record<string, unknown>;
  category_key?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  current?: boolean;
  can_transition?: boolean;
  transition_id?: string | null;
};

export type DomainMetadata = {
  dropdowns?: {
    revision: number | string;
    fields: Record<string, {
      options: DomainOption[];
      default_value?: string | null;
      label?: string;
      description?: string;
    }>;
  };
  app_types: {
    default_type: string;
    types: DomainOption[];
  };
  integrations: {
    default_type: string;
    types: DomainOption[];
  };
  requirements: {
    default_status: string;
    statuses: DomainOption[];
    workflow_source?: string;
    priority_scale: number[];
    labels?: DomainOption[];
    scrum_teams?: DomainOption[];
    story_points?: DomainOption[];
  };
  test_cases: {
    default_status: string;
    default_automated: string;
    statuses: DomainOption[];
    automated_options: DomainOption[];
    priority_scale: number[];
    types?: DomainOption[];
    labels?: DomainOption[];
  };
  test_suites?: { labels?: DomainOption[] };
  test_steps: {
    group_kinds: DomainOption[];
    types?: DomainOption[];
  };
  test_data_sets: {
    default_mode: string;
    modes: DomainOption[];
  };
  test_environments: {
    browsers: DomainOption[];
    mobile_os: DomainOption[];
  };
  test_configurations?: {
    operating_systems: DomainOption[];
    browsers: DomainOption[];
    mobile_os: DomainOption[];
  };
  executions: {
    statuses: DomainOption[];
    final_statuses: DomainOption[];
    result_statuses: DomainOption[];
    impact_levels: DomainOption[];
  };
  issues: {
    default_status: string;
    statuses: DomainOption[];
    workflow_source?: string;
    root_causes?: DomainOption[];
    qa_root_causes?: DomainOption[];
    bug_types?: DomainOption[];
    labels?: DomainOption[];
  };
  feedback?: {
    default_status: string;
    statuses: DomainOption[];
    workflow_source?: string;
  };
  access?: {
    default_permissions?: string[];
    pages?: Record<string, string[]>;
    permission_groups?: PermissionGroup[];
    route_permissions?: Array<{
      method: string;
      path: string;
      permission: string;
    }>;
  };
  feature_flags?: {
    groups?: FeatureFlagGroup[];
  };
  field_catalogs?: Record<string, {
    label: string;
    description?: string;
    sections?: string[];
    fields: Array<{
      key: string;
      jira_key: string;
      label: string;
      description?: string;
      type: "shortText" | "paragraph" | "number" | "select" | "multiSelect" | "user" | "labels" | "date" | "dateTime" | string;
      options?: DomainOption[];
      required?: boolean;
      system_managed?: boolean;
    }>;
  }>;
  jira?: {
    sprint_field_id: string | null;
    sprint_lookup_unavailable?: boolean;
    sprint_lookup_partial?: boolean;
    sprints: Array<{ id: string; name: string; state?: string | null; start_date?: string | null; end_date?: string | null; complete_date?: string | null; goal?: string | null }>;
    versions: Array<{ id: string; name: string; released: boolean; archived: boolean; release_date?: string | null }>;
  };
};

export type AiDesignImageInput = {
  name?: string | null;
  url: string;
};

export type AiAssistanceProvenance = {
  capability: string;
  generation_mode: "deterministic" | "llm" | string;
  provider: string;
  model: string | null;
  request_id: string;
  input_fingerprint: string;
  generated_at: string;
  confidence: number;
  evidence: string[];
  fallback_used: boolean;
  fallback_reason?: string | null;
  fallback_sections?: string[];
  fallback_fields?: string[];
  partial_sources?: boolean;
  confidence_basis?: string;
  requires_human_review: boolean;
};

export type AiAssistedPreviewBase = {
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
    generation_mode?: string;
    direct_model_invocation?: boolean;
  };
  provenance: AiAssistanceProvenance;
  generation_mode: string;
  generated_at: string;
  request_id: string;
  input_fingerprint: string;
  confidence: number | null;
  fallback_used: boolean;
  fallback_reason?: string | null;
  fallback_sections?: string[];
  requires_human_review: boolean;
  preview_only: true;
  context_reduced?: boolean;
  context_reduction_reason?: string | null;
};

export type StoryGroomingEvidenceSource = {
  type: "story" | "comment" | "attachment" | "linked-ticket" | "related-project-record" | string;
  ref: string;
  id: string;
  title: string;
  excerpt?: string | null;
  issue_type?: string | null;
  status?: string | null;
  jira_url?: string | null;
};

export type StoryGroomingReadinessStatus = "ready-for-planning" | "needs-clarification" | "not-ready" | (string & {});

export type StoryGroomingReadinessCheckStatus = "met" | "partial" | "missing" | (string & {});

export type StoryGroomingReadinessCheck = {
  id?: string;
  label: string;
  status: StoryGroomingReadinessCheckStatus;
  detail?: string;
  evidence_refs?: string[];
};

export type StoryGroomingScope = {
  in_scope: string[];
  out_of_scope: string[];
  evidence_refs?: string[];
};

export type StoryGroomingReadiness = {
  status: StoryGroomingReadinessStatus;
  summary: string;
  checks?: StoryGroomingReadinessCheck[];
  gaps: string[];
  next_actions: string[];
  evidence_refs?: string[];
};

export type StoryGroomingWalkthrough = {
  purpose: {
    summary: string;
    why_needed: string;
    expected_outcomes: string[];
    evidence_refs: string[];
  };
  user_journey: {
    summary: string;
    actors: string[];
    trigger: string;
    steps: string[];
    use_cases?: string[];
    alternate_paths: string[];
    evidence_refs: string[];
  };
  business_impact: {
    summary: string;
    stakeholders: string[];
    value_outcomes: string[];
    success_measures: string[];
    evidence_refs: string[];
  };
  solution_design: {
    overview: string;
    behaviors: string[];
    rules: string[];
    dependencies: string[];
    constraints: string[];
    evidence_refs: string[];
  };
  implementation: {
    overview: string;
    components: string[];
    data: string[];
    integrations: string[];
    quality_requirements: string[];
    evidence_refs: string[];
  };
  validation: {
    summary: string;
    acceptance_criteria: string[];
    test_scenarios: string[];
    edge_cases?: string[];
    linked_test_coverage: string[];
    evidence_refs: string[];
  };
  remaining: {
    summary: string;
    gaps: string[];
    questions: string[];
    decisions: string[];
    actions: string[];
    risks: string[];
    evidence_refs: string[];
  };
};

export type StoryGroomingPreviewResponse = AiAssistedPreviewBase & {
  requirement: {
    id: string;
    display_id?: string | null;
    title: string;
    status?: string | null;
    priority?: number | null;
  };
  grooming: {
    layman: {
      explanation: string;
      analogy: string;
      evidence_refs: string[];
    };
    business: {
      context: string;
      roles_and_flow: string[];
      use_cases: string[];
      stakeholders?: string[];
      outcomes?: string[];
      success_measures?: string[];
      evidence_refs: string[];
    };
    technical: {
      overview: string;
      functional_requirements: string[];
      data_and_integrations: string[];
      non_functional_requirements: string[];
      testability_notes: string[];
      acceptance_criteria?: string[];
      dependencies?: string[];
      constraints?: string[];
      edge_cases?: string[];
      security_and_privacy?: string[];
      observability?: string[];
      evidence_refs: string[];
    };
    walkthrough?: StoryGroomingWalkthrough;
    scope?: StoryGroomingScope;
    readiness?: StoryGroomingReadiness;
    assumptions: string[];
    open_questions: string[];
    risks: string[];
    review_evidence_refs: string[];
  };
  context: {
    scope: { project_id: string; project_key: string };
    bounded: true;
    limits: {
      comments: number;
      attachments: number;
      attachment_text_files: number;
      attachment_text_bytes: number;
      attachment_text_chars: number;
      linked_tickets: number;
      related_project_records: number;
      external_references: number;
      comment_chars: number;
      description_chars: number;
    };
    included: {
      comments: number;
      attachments: number;
      attachment_text_files: number;
      linked_tickets: number;
      related_project_records: number;
      external_references: number;
    };
    omitted: {
      comments: number;
      attachments: number;
      attachment_text: number;
      linked_tickets: number;
      related_project_records?: number;
      external_references: number;
    };
    partial_sources: string[];
    unavailable_sources: string[];
    sources: StoryGroomingEvidenceSource[];
  };
};

export type AiImpactReference = {
  id: string;
  display_id?: string | null;
  title?: string | null;
  name?: string | null;
  status?: string | null;
  priority?: number | null;
  release?: string | null;
  build?: string | null;
  automation_status?: string | null;
  locator_intent?: string | null;
  locator_kind?: string | null;
  confidence?: number | null;
};

export type AiAssuranceDimensionStatus = "strong" | "developing" | "needs-attention";

export type AiArtifactAssuranceDimension = {
  id: string;
  label: string;
  score: number;
  status: AiAssuranceDimensionStatus;
  explanation: string;
  evidence: string[];
  recommendation: string;
  frameworks?: string[];
};

export type AiArtifactAssuranceInsight = {
  id: string;
  priority: "high" | "medium" | "opportunity";
  title: string;
  explanation: string;
  evidence: string[];
  recommendation: string;
};

export type AiArtifactAssuranceAnalysis = {
  artifact_type: "story" | "test-case";
  overall_score: number;
  score_label: string;
  verdict: string;
  summary: string;
  dimensions: AiArtifactAssuranceDimension[];
  insights: AiArtifactAssuranceInsight[];
  limitations: string[];
  evidence_count: number;
  benchmark: {
    mode: "market-pattern" | "source-grounded";
    label: string;
    disclosure: string;
  };
};

export type AiArtifactAssuranceReview = {
  summary?: string;
  verdict?: string;
  dimensions?: Array<Pick<AiArtifactAssuranceDimension, "id"> & Partial<Pick<AiArtifactAssuranceDimension, "explanation" | "evidence" | "recommendation">>>;
  insights?: AiArtifactAssuranceInsight[];
  limitations?: string[];
};

export type AiArtifactAssuranceInput = {
  project_id: string;
  proposed_change?: Record<string, unknown>;
  integration_id?: string;
  prompt_guidance?: string;
  assurance_baseline?: Pick<AiArtifactAssuranceAnalysis, "overall_score" | "dimensions">;
  additional_context?: string;
};

export type RequirementImpactPreviewResponse = AiAssistedPreviewBase & {
  scope?: { project_id: string; unavailable_sources?: string[] };
  requirement: {
    id: string;
    display_id: string;
    title: string;
    priority: number | null;
    risk_score: number;
  };
  impact: {
    risk_level: "low" | "medium" | "high";
    test_cases: AiImpactReference[];
    test_suites: AiImpactReference[];
    test_runs: AiImpactReference[];
    automation_assets: AiImpactReference[];
    totals: {
      test_cases: number;
      test_suites: number;
      test_runs: number;
      automation_assets: number;
    };
  };
  assurance?: AiArtifactAssuranceAnalysis;
  assurance_review?: AiArtifactAssuranceReview;
  explanation: string;
  recommended_actions: string[];
};

export type TestCaseImpactPreviewResponse = AiAssistedPreviewBase & {
  scope?: { project_id: string; unavailable_sources?: string[] };
  test_case: {
    id: string;
    display_id: string;
    title: string;
    status: string | null;
    priority: number | null;
    automation_status: string | null;
    step_count: number;
  };
  impact: {
    risk_level: "low" | "medium" | "high";
    requirements: AiImpactReference[];
    test_suites: AiImpactReference[];
    test_runs: AiImpactReference[];
    automation_assets: AiImpactReference[];
    object_repository_items: AiImpactReference[];
    totals: {
      requirements: number;
      test_suites: number;
      test_runs: number;
      automation_assets: number;
      object_repository_items: number;
    };
  };
  assurance?: AiArtifactAssuranceAnalysis;
  assurance_review?: AiArtifactAssuranceReview;
  risk_signals: string[];
  explanation: string;
  recommended_actions: string[];
};

export type ExecutionFailureClusterPreviewResponse = AiAssistedPreviewBase & {
  execution: {
    id: string;
    display_id: string;
    name: string | null;
    status: string | null;
    release?: string | null;
    build?: string | null;
  };
  total_results: number;
  failed_or_blocked_results: number;
  clusters: Array<{
    id: string;
    label: string;
    count: number;
    confidence: number | null;
    explanation: string;
    recommended_action: string;
    evidence_refs: string[];
    members: Array<{
      execution_result_id: string;
      test_case_id?: string | null;
      status: string;
      error_excerpt?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>;
  }>;
  unclassified_count: number;
  explanation: string;
  recommended_actions: string[];
};

export type QualityInsightPreviewResponse = AiAssistedPreviewBase & {
  project: {
    id: string;
    key: string;
    name?: string;
  };
  scope: { kind: "project"; project_key: string } | { kind: "release"; release: string };
  metrics: Record<string, number | string | null>;
  release_summary: string;
  insights: Array<{
    id: string;
    severity: "info" | "low" | "medium" | "high" | string;
    title: string;
    explanation: string;
    recommended_action: string;
    evidence: Array<AiImpactReference & { kind?: string }>;
  }>;
  generated_from: string[];
  limitations: string[];
};

export type QualityGateAssessmentPreviewResponse = AiAssistedPreviewBase & {
  quality_gate: {
    id: string;
    display_id: string;
    title: string;
    revision: number;
  };
  scope:
    | { kind: "test_plan"; id: string; display_id: string; title: string }
    | { kind: "release"; release: string }
    | { kind: "project"; project_key: string };
  assessment: "pass" | "fail";
  checks: Array<{
    key: string;
    label: string;
    actual: number;
    operator: ">=" | "<=";
    threshold: number;
    unit: string;
    passed: boolean;
    explanation: string;
  }>;
  failed_check_count: number;
  explanation: string;
  recommendations: string[];
  metrics_snapshot: Record<string, number | string | null>;
  decision_requires_human_approval: true;
  evaluated_at: string;
};

export type AiPromptTemplate = {
  id: string;
  project_id: string | null;
  app_type_id?: string | null;
  scope: string;
  name: string;
  description?: string | null;
  domain?: string | null;
  role?: string | null;
  test_type?: string | null;
  test_format?: string | null;
  test_count?: number | null;
  prompt_text: string;
  applies_to: string[];
  tags: string[];
  built_in?: boolean;
  is_active?: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AiDesignedTestCaseCandidate = {
  client_id: string;
  title: string;
  description: string | null;
  priority: number;
  authoring_mode?: "structured" | "gherkin";
  test_case_type?: TestCase["test_case_type"];
  test_data_set_ids?: string[];
  gherkin_document?: string | null;
  parameter_values?: Record<string, string>;
  parameter_count?: number;
  applicable_domain?: string | null;
  requirement_ids: string[];
  requirement_titles: string[];
  steps: Array<{
    step_order: number;
    step_type?: "web" | "api" | "android" | "ios" | null;
    action: string | null;
    expected_result: string | null;
  }>;
  step_count: number;
};

export type AiDesignPreviewResponse = {
  generated: number;
  cases: AiDesignedTestCaseCandidate[];
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  requirements: Array<{
    id: string;
    title: string;
  }>;
  app_type: {
    id: string;
    name: string;
  };
};

export type AiAuthoredTestCasePreview = {
  summary?: string | null;
  title: string;
  description: string | null;
  authoring_mode?: "structured" | "gherkin";
  gherkin_document?: string | null;
  parameter_values: Record<string, string>;
  steps: Array<{
    step_order: number;
    step_type?: "web" | "api" | "android" | "ios" | null;
    action: string | null;
    expected_result: string | null;
  }>;
  step_count: number;
  parameter_count: number;
};

export type AiCaseAuthoringPreviewResponse = {
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  requirement: {
    id: string;
    title: string;
  } | null;
  app_type: {
    id: string;
    name: string;
  };
  case: AiAuthoredTestCasePreview;
};

export type AiStepRephraseResponse = {
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  step: {
    step_order: number;
    step_type?: "web" | "api" | "android" | "ios" | null;
    action: string | null;
    expected_result: string | null;
  };
};

export type AiRequirementDescriptionRephraseResponse = {
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  requirement: {
    id?: string | null;
    display_id?: string | null;
    title?: string | null;
  };
  description: string;
};

export type AiRichTextRephraseResponse = {
  content: string;
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  provenance?: Record<string, unknown>;
};

export type AiTestCaseGenerationJob = {
  id: string;
  project_id: string;
  app_type_id: string;
  integration_id?: string | null;
  requirement_ids: string[];
  max_cases_per_requirement: number;
  parallel_requirement_limit: number;
  additional_context?: string | null;
  external_links: string[];
  images: AiDesignImageInput[];
  authoring_mode?: "structured" | "gherkin";
  status: "queued" | "running" | "completed" | "failed" | string;
  total_requirements: number;
  processed_requirements: number;
  generated_preview_count?: number;
  generated_cases_count: number;
  error?: string | null;
  last_error?: string | null;
  candidate_cases?: AiDesignedTestCaseCandidate[];
  created_cases?: Array<{ id: string; title: string; step_count: number; requirement_ids: string[]; source_client_id?: string | null; created_at?: string }>;
  created_by: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string;
};

export type WorkspaceTransaction = {
  id: string;
  project_id: string | null;
  app_type_id: string | null;
  category: string;
  action: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  related_kind: string | null;
  related_id: string | null;
  created_by: string | null;
  created_user: User | null;
  event_count?: number;
  latest_event_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WorkspaceTransactionEvent = {
  id: string;
  transaction_id: string;
  level: "info" | "success" | "warning" | "error" | string;
  phase: string | null;
  message: string;
  details: Record<string, unknown>;
  created_at?: string;
};

export type WorkspaceTransactionArtifact = {
  id: string;
  transaction_id: string;
  file_name: string;
  mime_type: string;
  created_at?: string;
};

export type SmartExecutionImpactCase = {
  test_case_id: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  suite_names: string[];
  module_names?: string[];
  requirement_titles: string[];
  step_count: number;
  reason: string;
  reason_source?: "model" | "deterministic";
  signals?: string[];
  risk_score?: number;
  impact_level: "critical" | "high" | "medium" | "low";
  failure_count?: number;
  blocked_count?: number;
  bug_count?: number;
  last_failure_at?: string | null;
  selection_basis?: string[];
  evidence_refs?: string[];
  explanation_evidence_refs?: string[];
  evidence?: {
    result_ids: string[];
    bug_ids: string[];
    requirement_ids: string[];
    run_ids: string[];
  };
};

export type SmartExecutionEvidenceSummary = {
  scoped_requirement_count: number;
  scoped_bug_count: number;
  scoped_run_count: number;
  failed_case_count: number;
  blocked_case_count: number;
  candidate_case_count: number;
  returned_case_count: number;
  scanned_case_count: number;
  scan_truncated: boolean;
};

export type SmartExecutionPreviewResponse = {
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  app_type: {
    id: string;
    name: string;
  };
  default_suite: {
    id: string;
    name: string;
  };
  delivery_scope?: {
    release: string | null;
    sprint: string | null;
    build: string | null;
  };
  source_case_count: number;
  matched_case_count: number;
  evidence_summary?: SmartExecutionEvidenceSummary;
  query_strategy?: string[];
  retrieved_context_count?: number;
  execution_name: string;
  summary: string;
  cases: SmartExecutionImpactCase[];
  evidence?: Array<AiEvidenceSource & {
    summary?: string | null;
    observed_at?: string | null;
    test_case_id?: string;
    run_id?: string;
  }>;
  request_id?: string;
  acceptance_token: string;
  generation_mode?: "hybrid" | "deterministic" | string;
  fallback_used?: boolean;
  fallback_reason?: string | null;
  fallback_sections?: string[];
  input_fingerprint?: string;
  generated_at?: string;
  requires_human_review?: boolean;
  processing?: AiProcessingSnapshot;
  context?: {
    limits: Record<string, number>;
    totals: Record<string, number>;
    included: Record<string, number>;
    omitted: Record<string, number>;
    partial_sources: string[];
  };
  provenance?: {
    capability: "ai-smart-run" | string;
    request_id: string;
    input_fingerprint: string;
    generated_at: string;
    generation_mode: string;
    provider?: string | null;
    model?: string | null;
    direct_model_invocation?: boolean;
    bounded: boolean;
    limits: Record<string, number>;
    included: Record<string, number>;
    omitted: Record<string, number>;
    partial_sources: string[];
    fallback_used: boolean;
    fallback_reason?: string | null;
    requires_human_review: boolean;
  };
};

export type TestSuite = {
  test_data_options?: TestDataOptions;
  id: string;
  display_id?: string | null;
  app_type_id: string;
  name: string;
  description?: string | null;
  parent_id: string | null;
  test_case_ids?: string[];
  test_case_count?: number;
  automated_case_count?: number;
  step_count?: number;
  total_step_count?: number;
  story_linked_case_count?: number;
  labels?: string[];
  parameter_values?: Record<string, string>;
  test_data_set_id?: string | null;
  parallel_enabled?: boolean | null;
  parallel_count?: number | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  revision?: number;
};

export type TestCase = {
  test_data_options?: TestDataOptions;
  linked_requirements?: Array<{ id: string; display_id?: string | null; title: string }>;
  id: string;
  display_id?: string | null;
  app_type_id?: string | null;
  source_issue_id?: string | null;
  suite_id: string | null;
  suite_ids?: string[];
  requirement_ids?: string[];
  module_ids?: string[];
  defect_ids?: string[];
  title: string;
  description: string | null;
  external_references?: string[];
  labels?: string[];
  parameter_values?: Record<string, string>;
  automated: "yes" | "no" | null;
  automation_status?: "not_automated" | "ready" | "incomplete" | null;
  manual_test_case_id?: string | null;
  manual_test_case_ids?: string[];
  authoring_mode?: "structured" | "gherkin";
  test_case_type?: string;
  gherkin_document?: string | null;
  test_data_set_ids?: string[];
  test_data_sets?: Array<Pick<TestDataSet, "id" | "app_type_id" | "name" | "description" | "mode" | "columns" | "rows">>;
  author_id?: string | null;
  author?: { id: string; name?: string | null; email?: string | null } | null;
  priority: number | null;
  status: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
  requirement_id: string | null;
  reviewer_id?: string | null;
  review_status?: TestCaseReviewStatus | null;
  review_history?: TestCaseReviewEvent[];
  ai_quality_score?: number | null;
  ai_generation_source?: "scheduler" | "interactive" | "repository" | null;
  ai_generation_review_status?: "pending" | "accepted" | "rejected" | null;
  ai_generation_job_id?: string | null;
  ai_generated_at?: string | null;
  step_count?: number;
  step_types?: TestStepType[];
  api_only?: boolean;
  detail_complete?: boolean;
  summary_complete?: boolean;
  external_reference_count?: number;
  external_references_truncated?: boolean;
  [key: string]: unknown;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  revision?: number;
};

export type JiraComment = {
  id: string;
  body: string;
  created: string | null;
  updated: string | null;
  author: {
    accountId?: string;
    displayName?: string;
    avatarUrls?: Record<string, string>;
  } | null;
};

export type TestCaseVersionSummary = {
  revision: number;
  captured_at: string | null;
  captured_by: string | null;
  reason: string;
  title: string;
  status: string | null;
  step_count: number;
};

export type TestCaseVersionContent = {
  app_type_id?: string | null;
  suite_id?: string | null;
  suite_ids?: string[];
  requirement_id?: string | null;
  requirement_ids?: string[];
  title: string;
  description?: string | null;
  external_references?: string[];
  labels?: string[];
  parameter_values?: Record<string, string>;
  automated?: "yes" | "no" | null;
  automation_status?: "not_automated" | "ready" | "incomplete" | null;
  manual_test_case_id?: string | null;
  manual_test_case_ids?: string[];
  authoring_mode?: "structured" | "gherkin";
  gherkin_document?: string | null;
  priority?: number | null;
  status?: string | null;
  author_id?: string | null;
  reviewer_id?: string | null;
  ai_quality_score?: number | null;
  steps?: TestStep[];
};

export type TestCaseVersionSnapshot = {
  schema: "hellotest.testCaseVersion.v1";
  revision: number;
  captured_at: string;
  captured_by: string | null;
  reason: string;
  content: TestCaseVersionContent;
};

export type TestCaseModule = {
  id: string;
  display_id?: string | null;
  app_type_id: string;
  name: string;
  description?: string | null;
  test_case_count?: number;
  test_case_ids?: string[];
  requirement_ids?: string[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TestStep = {
  id: string;
  test_case_id: string;
  step_order: number;
  action: string | null;
  expected_result: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
  group_id?: string | null;
  group_name?: string | null;
  group_kind?: "local" | "reusable" | null;
  reusable_group_id?: string | null;
};

export type AutomationLearningCacheEntry = {
  id: string;
  project_id?: string | null;
  app_type_id?: string | null;
  test_case_id?: string | null;
  page_url?: string | null;
  page_key: string;
  locator_intent: string;
  locator: string;
  locator_kind?: string | null;
  confidence: number;
  source: string;
  metadata?: Record<string, unknown>;
  hit_count: number;
  created_at?: string;
  updated_at?: string;
};

export type ObjectRepositoryImportEntry = {
  screen_name: string;
  record_type: "screen" | "field";
  page_url?: string;
  page_key?: string;
  locator_intent?: string;
  locator?: string;
  locator_kind?: string;
  confidence?: number;
  source?: string;
  object_name?: string;
  object_role?: string;
  metadata?: Record<string, unknown>;
};

export type ObjectRepositoryImportResult = {
  created: number;
  updated: number;
  failed: number;
  transaction_id?: string;
  errors: Array<{
    index: number;
    screen_name?: string | null;
    object_name?: string | null;
    message: string;
  }>;
};

export type ObjectRepositoryContext = {
  repositoryType: "ui_intelligence_repository";
  generatedAt: string;
  screens: Array<{
    screen: string;
    appType: string | null;
    urlPattern: { type: string; value: string | null };
    fingerprint: string | null;
    fields: Array<{
      name: string;
      type: string;
      primaryLocator: string;
      primaryStrategy: string | null;
      confidenceScore: number;
      fallbackLocators: unknown[];
      description: string | null;
      businessMeaning: string | null;
      usageKeywords: unknown[];
      stabilityScore: number;
      lastValidatedDate: string | null;
    }>;
  }>;
};

export type AutomationBuildResponse = {
  test_case_id: string;
  title: string;
  automated: "yes" | "no";
  automation_status?: "not_automated" | "ready" | "incomplete";
  generated_step_count: number;
  created_step_count?: number;
  updated_step_count?: number;
  learned_locator_count: number;
  cache_hits: number;
  fallback_used: boolean;
  fallback_reason?: string | null;
  summary: string;
  transaction_id?: string;
  artifact_id?: string | null;
  api_test_case?: {
    id: string;
    title: string;
    step_count: number;
  } | null;
};

export type RecorderSessionResponse = {
  id: string;
  recorder_mode?: "local" | "remote";
  inspector_agent_token?: string;
  purpose?: "automation-recording" | "repository-inspect" | null;
  status: "running" | "stopped" | "failed";
  reused?: boolean;
  started_at?: string;
  stopped_at?: string | null;
  last_activity_at?: string | null;
  start_url?: string | null;
  display_mode?: "browser-live-view" | "local-browser-with-live-view" | string | null;
  live_view_path?: string | null;
  action_count?: number;
  network_count?: number;
  actions?: Array<{
    index: number;
    type: string;
    locator?: string | null;
    text?: string | null;
    value?: string | null;
    url?: string | null;
    page_id?: string | null;
    page_title?: string | null;
    source?: string | null;
    timestamp?: string | null;
  }>;
  network?: Array<{
    index: number;
    method: string;
    url: string;
    status?: number | null;
    resource_type?: string | null;
    content_type?: string | null;
    page_id?: string | null;
    page_title?: string | null;
    timestamp?: string | null;
  }>;
  transaction_id?: string;
  engine_base_url?: string;
  status_url?: string;
  live_view_url?: string | null;
  capture?: {
    actions?: boolean;
    network?: boolean;
    duplicate_typing_suppression?: boolean;
    injection?: string;
    extension_ready?: boolean;
    remote_control?: boolean;
    screenshot_stream?: boolean;
    screencast_stream?: boolean;
  };
};

export type TestStepType = "web" | "api" | "android" | "ios";

export type StepApiRequestHeader = {
  key: string;
  value: string;
};

export type StepApiValidationKind = "status" | "header" | "header_present" | "body_contains" | "body_not_contains" | "json_path" | "json_schema" | "response_time";
export type StepApiValidationOperator = "eq" | "ne" | "contains" | "matches" | "exists" | "lt" | "lte" | "gt" | "gte";

export type StepApiValidation = {
  kind: StepApiValidationKind;
  operator?: StepApiValidationOperator;
  target?: string | null;
  expected?: string | null;
};

export type StepApiResponseCapture = {
  path?: string | null;
  parameter?: string | null;
};

export type StepApiRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url?: string | null;
  headers?: StepApiRequestHeader[];
  query_params?: StepApiRequestHeader[];
  cookies?: StepApiRequestHeader[];
  auth?: {
    type: "none" | "bearer" | "api_key" | "basic" | "oauth2_ref";
    credential_reference?: string | null;
    key_name?: string | null;
    location?: "header" | "query";
  };
  timeout_ms?: number;
  follow_redirects?: boolean;
  body_mode?: "none" | "json" | "text" | "xml" | "form";
  body?: string | null;
  validations?: StepApiValidation[];
  captures?: StepApiResponseCapture[];
};

export type ApiRequestPreview = {
  request: {
    method: NonNullable<StepApiRequest["method"]>;
    url: string;
  };
  response: {
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    content_type?: string | null;
    body_text: string;
    body_json?: unknown;
    duration_ms: number;
  };
  ai_suggestions?: {
    summary: string;
    assertions: StepApiValidation[];
    captures: StepApiResponseCapture[];
    notes?: string[];
  };
};

export type SharedStepGroupStep = {
  id?: string;
  step_order: number;
  action: string | null;
  expected_result: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
};

export type SharedStepMetrics = {
  evaluated_at: string;
  window_start: string;
  window_days: number;
  execution_visible: boolean;
  execution_evidence_reason?: string | null;
  total_repository_steps: number;
  reused_case_count: number;
  shared_step_references: number;
  shared_steps_executed: number | null;
  /** Shared-group reference occurrences / all authored case step rows * 100; null when no steps exist. */
  reusability_index: number | null;
  failure_cluster_count: number | null;
  defects_visible?: boolean;
  open_defect_count?: number | null;
  defect_evidence_reason?: string | null;
  open_defect_evidence?: Array<{
    issue_id: string; display_id: string | null; title: string; status: string;
    group_id: string; group_name: string; execution_id: string; test_case_id: string; snapshot_step_id: string;
  }>;
  mtti_ms: number | null;
  isolation_sample_count: number;
  mtti_unavailable_reason: string;
  groups: Array<{
    id: string; name: string; case_count: number; execution_visible: boolean;
    execution_evidence_reason?: string | null; ambiguous_step_identity_count?: number;
    executed_steps?: number | null; passed_steps?: number | null; failed_steps?: number | null; failed_cases?: number; run_count?: number;
    open_defect_count?: number | null;
    history?: Array<{execution_id: string; status: string; isFinalized: boolean; created_at: string}>;
    failure_evidence?: Array<{execution_id: string; test_case_id: string; snapshot_step_id: string; observed_at: string}>;
  }>;
};

export type SharedStepGroup = {
  test_data_set_id?: string | null;
  test_data_row_index?: number;
  test_data_set?: TestDataSet | null;
  id: string;
  display_id?: string;
  app_type_id: string;
  name: string;
  description: string | null;
  authoring_mode?: "structured" | "gherkin";
  gherkin_document?: string | null;
  steps: SharedStepGroupStep[];
  parameter_values?: Record<string, string>;
  step_count?: number;
  usage_count?: number;
  used_test_cases?: Array<{
    id: string;
    title: string;
    status: string | null;
    referenced_step_count: number;
  }>;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type KeyValueEntry = {
  id?: string;
  key: string;
  value: string;
  is_secret?: boolean;
  has_stored_value?: boolean;
};

export type TestEnvironment = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  base_url: string | null;
  browser: string | null;
  notes: string | null;
  variables: KeyValueEntry[];
  created_at?: string;
};

export type TestConfigurationTarget = {
  id: string;
  os: string;
  browser: string;
  mobile_os: string;
  version: string;
};

export type TestConfiguration = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  browser: string | null;
  mobile_os: string | null;
  platform_version: string | null;
  targets: TestConfigurationTarget[];
  variables: KeyValueEntry[];
  created_at?: string;
};

export type TestDataSetMode = "key_value" | "table";

export type TestDataSetRow = Record<string, string>;

export type AiTestDataGenerationPreviewResponse = {
  prompt: string;
  field_context: string | null;
  summary: string;
  suggestions: Array<{ id: string; value: string }>;
  randomized_template: string;
  randomization_strategy: "reviewed-value-pool";
  runtime_llm_invocation: boolean;
  generation_mode: "llm" | "deterministic";
  integration?: { id: string; name: string; model?: string | null } | null;
  fallback_used: boolean;
  fallback_reason?: string | null;
  generated_at: string;
  requires_human_review: boolean;
  provenance?: Record<string, unknown>;
};

export type TestDataSet = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  mode: TestDataSetMode;
  columns: string[];
  rows: TestDataSetRow[];
  template_rows?: TestDataSetRow[];
  created_at?: string;
};

export type ExecutionEnvironmentSnapshot = {
  id: string;
  name: string;
  description: string | null;
  base_url: string | null;
  browser: string | null;
  notes: string | null;
  variables: KeyValueEntry[];
};

export type ExecutionConfigurationSnapshot = {
  id: string;
  name: string;
  description: string | null;
  browser: string | null;
  mobile_os: string | null;
  platform_version: string | null;
  targets: TestConfigurationTarget[];
  variables: KeyValueEntry[];
};

export type ExecutionDataSetSnapshot = {
  data_scope_policy?: { version?: number; case?: TestDataOptions; suite?: TestDataOptions; run?: TestDataOptions; row_strategy?: string };
  parameter_data_layers?: Partial<Record<"case" | "suite" | "run", { rows: Record<string, string>[]; template_rows?: Record<string, string>[]; sensitive_names?: string[] } | null>>;
  shared_rows?: Array<Record<string, string>>;
  shared_template_rows?: Array<Record<string, string>>;
  sensitive_names?: string[];
  id: string;
  name: string;
  description: string | null;
  mode: TestDataSetMode;
  columns: string[];
  rows: TestDataSetRow[];
  template_rows?: TestDataSetRow[];
  generated_at?: string;
  generated_field_count?: number;
};

export type ExecutionStatus = "queued" | "running" | "retrying" | "completed" | "passed" | "failed" | "blocked" | "skipped" | "cancelled" | "aborted" | "partially_completed";

export type ExecutionScopeUser = {
  id: string;
  email: string;
  name: string | null;
  avatar_data_url?: string | null;
};

export type ExecutionScopeSnapshot = {
  id: string;
  display_id?: string | null;
  name: string;
  parameter_values?: Record<string, string>;
  revision?: number;
  suite_ids?: string[];
  test_case_count?: number;
  assigned_to?: string | null;
  assigned_to_ids?: string[];
  assigned_user?: ExecutionScopeUser | null;
  assigned_users?: ExecutionScopeUser[];
  assignment_source?: "run" | "suite" | "module" | "case" | null;
  suite_id?: string | null;
};

export type Execution = {
  live_sessions?: { engine_run_id: string; provider: string; url: string }[];
  test_data_options?: TestDataOptions;
  release_id?: string | null;
  iteration_id?: string | null;
  parameter_scope_default?: "t" | "r";
  id: string;
  revision?: number;
  run_mode?: "manual" | "remote" | "local";
  metrics?: {
    total_cases: number;
    passed_cases: number;
    failed_cases: number;
    blocked_cases: number;
    running_cases: number;
    pending_cases: number;
    paused_cases?: number;
    aborted_cases?: number;
    skipped_cases?: number;
    duration_ms?: number;
    defect_count: number;
    story_count: number;
    failed_story_count: number;
  };
  display_id?: string | null;
  project_id: string;
  app_type_id: string | null;
  test_case_ids: string[];
  suite_ids: string[];
  suite_snapshots?: ExecutionScopeSnapshot[];
  module_snapshots?: ExecutionScopeSnapshot[];
  case_snapshots?: ExecutionCaseSnapshot[];
  step_snapshots?: ExecutionStepSnapshot[];
  requirement_snapshots?: Array<{ id: string; display_id?: string | null; title: string; priority?: number | null; status?: string | null }>;
  scope_case_count?: number;
  scope_step_count?: number;
  scope_requirement_count?: number;
  requirement_snapshots_truncated?: boolean;
  direct_test_case_ids?: string[];
  scope_source?: string | null;
  scope_fingerprint?: string | null;
  name: string | null;
  trigger: "manual" | "ci" | "local" | null;
  status: ExecutionStatus | null;
  test_environment?: {
    id: string | null;
    name: string;
    snapshot: ExecutionEnvironmentSnapshot | null;
  } | null;
  test_configuration?: {
    id: string | null;
    name: string;
    snapshot: ExecutionConfigurationSnapshot | null;
  } | null;
  test_data_set?: {
    id: string | null;
    name: string;
    snapshot: ExecutionDataSetSnapshot | null;
  } | null;
  release?: string | null;
  sprint?: string | null;
  build?: string | null;
  assigned_to?: string | null;
  assigned_to_ids?: string[];
  parallel_enabled?: boolean | null;
  parallel_count?: number | null;
  assigned_user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  } | null;
  assigned_users?: Array<{
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  }>;
  suite_assignments?: Record<string, string[]>;
  module_assignments?: Record<string, string[]>;
  case_assignments?: Record<string, string[]>;
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
  start_date?: string | null;
  end_date?: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export type ExecutionSchedule = {
  test_data_options?: TestDataOptions;
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  cadence: "once" | "daily" | "weekly" | "monthly" | string;
  next_run_at: string | null;
  last_run_at?: string | null;
  suite_ids: string[];
  test_case_ids: string[];
  test_environment_id?: string | null;
  test_configuration_id?: string | null;
  test_data_set_id?: string | null;
  release?: string | null;
  sprint?: string | null;
  build?: string | null;
  assigned_to?: string | null;
  assigned_to_ids?: string[];
  assigned_users?: Array<{
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  }>;
  assigned_user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  } | null;
  created_by: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AgenticWorkflowStatus = "draft" | "active" | "paused" | "archived";

export type AgenticWorkflowTriggerKind = "manual" | "webhook" | "schedule" | "release" | "event";

export type AgenticWorkflowNodeData = {
  label?: string;
  name?: string;
  kind?: "trigger" | "agent" | "tool" | "condition" | "transform" | "output" | string;
  summary?: string;
  prompt?: string;
  inputKey?: string;
  outputKey?: string;
  sampleOutput?: string;
  model?: string;
  tool?: string;
  [key: string]: unknown;
};

export type AgenticWorkflowNode = {
  id: string;
  type?: string;
  position: {
    x: number;
    y: number;
  };
  data: AgenticWorkflowNodeData;
};

export type AgenticWorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  animated?: boolean;
  type?: string;
  label?: string;
  [key: string]: unknown;
};

export type AgenticWorkflow = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  status: AgenticWorkflowStatus;
  trigger_kind: AgenticWorkflowTriggerKind;
  nodes: AgenticWorkflowNode[];
  edges: AgenticWorkflowEdge[];
  settings: Record<string, unknown>;
  n8n_payload: Record<string, unknown>;
  run_count?: number;
  latest_run_at?: string | null;
  latest_run_status?: AgenticWorkflowRun["status"] | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AgenticWorkflowRun = {
  id: string;
  summary_only?: boolean;
  execution_mode?: "preview" | "review";
  workflow_id: string | null;
  project_id: string;
  app_type_id: string | null;
  workflow_name: string;
  status: ExecutionStatus | "needs_review" | "interrupted";
  trigger_kind: AgenticWorkflowTriggerKind;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown> | null;
  workflow_snapshot: Record<string, unknown>;
  node_results: Array<Record<string, unknown>>;
  created_by?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AgenticWorkflowReadiness = {
  target_node_id?: string | null;
  ready: boolean;
  execution_mode: "review";
  blockers: Array<{ node_id: string | null; node_name: string | null; message: string }>;
  warnings: string[];
  limits: { max_steps: number; max_specialists: number; timeout_ms: number; input_limit_bytes: number };
  steps: Array<{ node_id: string; name: string; kind: string; specialist_id: string | null }>;
};

export type AgenticAssistantMode = "chat" | "agent";

export type AgenticAssistantCitation = {
  scope: string;
  id: string;
  label: string;
  source_id?: string;
  source_kind?: string;
  chunk_id?: string;
  score?: number;
};

export type AgenticAssistantEvaluation = {
  label?: string;
  method?: "deterministic" | "model_assessment";
  grounding: number;
  completeness: number;
  traceability: number;
  risk_control: number;
  maturity_score: number;
  rationale: string;
};

export type QualityEvidenceReport = {
  persistence?: { snapshot_id: string; content_hash: string; observed_at: string; mode: string; refresh: string; freshness?: 'current' | 'stale' | 'changes_pending' | 'unavailable'; invalidated_at?: string | null };
  feature_id: string; verifier_version: string; snapshot_hash: string; as_of: string;
  scope: Record<string, string | null>; execution_status: string; publication_status: string;
  readiness: string; evidence_complete: boolean; limitations: string[];
  data: {
    status?: string; band?: string; method?: string; obligation_count?: number; unknown_weight?: number;
    designed_percent?: number | null; executable_percent?: number | null; observed_percent?: number | null;
    policy_version?: number | null;
    approved_policy?: {name:string;version:number;hash:string;approved_by:string;approved_at:string;waivable_gates:string[]};
    gates?: Array<{ id: string; label: string; status: string; detail: string; evidence: string[]; evidence_hash?:string; observed_status?:string; waiver_id?:string }>;
    nodes?: Array<{ id: string; kind: string; title: string; revision: string }>;
    edges?: Array<{ id: string; source: string; target: string; relation: string }>;
    rows?: Array<Record<string, unknown>>; paths?: Array<{ node_id: string; edge_ids: string[] }>;
    scenarios?: Array<{ gate_id: string; assumption: string; projected_status: string; required_evidence: string }>;
    indicators?: Array<{ id: string; status: string; detail: string }>;
    graph?: QualityEvidenceReport["data"]; limitations?: string[];
    incomparable_attempt_count?: number; complete?: boolean; truncated?: boolean;
  };
};

export type AutomationRepairSummary = {id?:string;project_id?:string;status:string;detail:string;patch?:{before:string;after:string;rationale:string;hash:string}};
export type AgentStructuredArtifact = {target_id?:string;target_revision?:number;kind:"story"|"test_case"|"defect"|"run";title:string;description:string;priority:string;citation_ids:string[];acceptance_criteria?:string[];authoring_mode?:"structured"|"gherkin";gherkin_document?:string;test_case_ids?:string[];exit_criteria?:string[];prerequisites?:string[];requirement_ids?:string[];test_data?:string[];cleanup?:string[];steps?:Array<{action:string;expected_result:string;step_type?:"web"|"api"|"android"|"ios"}>;reproduction_steps?:string[];expected_result?:string;actual_result?:string;severity?:string};
export type AgenticAssistantResult = {
  artifacts?: AgentStructuredArtifact[];
  model_call_records?: Array<{name:string;trace_id:string|null;status:string;attempt:number}>;
  agent_chain?: Array<{agent_id:string;name:string;status:string;trace_id?:string|null;kind?:AgentStructuredArtifact["kind"];reason?:string;detail?:string;artifact_count?:number}>;
  automation_repair?: AutomationRepairSummary;
  quality_assessment?: QualityEvidenceReport;
  execution_status?: string;
  publication_status?: string;
  verification?: { verifier_version: string; status: "passed" | "needs_input"; checks: Array<{ id: string; passed: boolean; label: string }>; semantic_review: string; limitations: string[] };
  model_execution?: { trace_id?: string | null; trace_capture?: string | null; effective_model: string; prompt_hash: string; model_calls: number; max_model_calls: number; agent_version: number; agent_definition_hash?: string; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } };

  readiness?: {
    status: "ready_for_review" | "limited_evidence" | "insufficient_evidence";
    evidence_count: number;
    task_evidence_count: number;
    missing_scopes: string[];
    limitations: string[];
  };
  headline?: string;
  executive_summary?: string;
  response: string;
  activity_summary: string;
  findings?: Array<{
    observation?: string; gap?: string; impact?: string; proposed_action?: string; acceptance_check?: string;
    title: string;
    detail: string;
    priority?: "critical" | "high" | "medium" | "low" | "info" | string;
    citation_ids?: string[];
  }>;
  deliverables?: Array<{
    type?: string;
    title: string;
    detail: string;
    citation_ids?: string[];
  }>;
  recommendations: string[];
  assumptions: string[];
  evidence_gaps?: string[];
  suggested_handoffs: string[];
  citation_ids?: string[];
  grounding_status?: "grounded" | "insufficient_context";
  evaluation: AgenticAssistantEvaluation;
};

export type AgenticAssistantSessionResponse = {
  transaction: WorkspaceTransaction;
  events: WorkspaceTransactionEvent[];
  result: AgenticAssistantResult;
  citations: AgenticAssistantCitation[];
  guardrails: string[];
  provenance: {
    provider: string;
    degraded?: boolean;
    readiness?: AgenticAssistantResult["readiness"];
    model?: string | null;
    generation_mode: string;
    fallback_reason?: string | null;
    context_route?: {
      agent_id?: string | null;
      input_type?: string;
      matched_intents?: string[];
      mode?: "chat" | "agent" | string;
      priority_scopes?: string[];
      effective_scopes?: string[];
      live_scopes?: string[];
      retrieval_focus?: string;
      outcome_sections?: string[];
      resolved_query?: string;
      conversation_reference_used?: boolean;
      decision_question?: string;
      deliverable_contract?: string;
    } | null;
    input_fingerprint: string;
    requires_human_review: boolean;
  };
};

export type AgenticAssistantSavedSessionResponse = Omit<AgenticAssistantSessionResponse, "result" | "provenance"> & {
  result: AgenticAssistantResult | null;
  session_state: "completed" | "running" | "failed" | "unavailable";
  message: string;
  provenance: Omit<AgenticAssistantSessionResponse["provenance"], "input_fingerprint"> & {
    input_fingerprint: string | null;
    cancelled?: boolean;
  };
};

export type KnowledgeSourceKind =
  | "requirement"
  | "test_case"
  | "execution"
  | "bug"
  | "file"
  | "text"
  | "chat"
  | "url"
  | "product_help"
  | "knowledge_item";

export type KnowledgeProcessingStatus =
  | "draft"
  | "queued"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "partial"
  | "failed";

export type KnowledgeChunkingConfig = {
  strategy: "semantic" | "recursive" | "fixed";
  chunk_size: number;
  chunk_overlap: number;
};

export type KnowledgeIngestionInput = {
  kind: Extract<KnowledgeSourceKind, "text" | "chat" | "url">;
  title: string;
  content: string;
  source_uri?: string | null;
  metadata?: Record<string, unknown>;
};

export type KnowledgeSelectedRecords = {
  requirements: string[];
  test_cases: string[];
  executions: string[];
  bugs: string[];
};

export type KnowledgeIngestionRequest = {
  project_id: string;
  app_type_id?: string | null;
  collection_id?: string | null;
  title?: string;
  chunking?: KnowledgeChunkingConfig;
  inputs?: KnowledgeIngestionInput[];
  selected_records?: KnowledgeSelectedRecords;
};

export type KnowledgeSource = {
  id: string;
  canonical_id?: string;
  project_id: string;
  app_type_id?: string | null;
  source_kind: KnowledgeSourceKind | string;
  source_ref_id?: string | null;
  title: string;
  source_uri?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  attachment_id?: string | null;
  extraction_status: "pending" | "processing" | "ready" | "needs_extraction" | "failed" | "archived" | string;
  extraction_strategy?: string | null;
  metadata?: Record<string, unknown>;
  risk_flags?: string[];
  collection_ids?: string[];
  document_count?: number;
  chunk_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type KnowledgeSourceRevision = {
  id: string;
  knowledge_id?: string;
  canonical_id?: string;
  version?: number | string;
  title?: string;
  checksum_sha256?: string;
  is_current?: boolean;
  effective_from?: string;
  effective_to?: string | null;
  index_state?: { lexical_state?: string; dense_state?: string; required_indexes_ready?: boolean; vector_provider?: string; indexed_chunk_count?: number };
};

export type KnowledgeSourceDetail = {
  source: KnowledgeSource;
  revision?: KnowledgeSourceRevision | null;
  fragments: Array<{ id: string; fragment_id?: string; knowledge_id?: string; canonical_id?: string; chunk_index?: number; heading?: string; content?: string; token_count?: number; char_start?: number; char_end?: number; metadata?: Record<string, unknown> }>;
  authorization?: { partial?: boolean };
  historical?: boolean;
  latest_ingestion_id?: string | null;
  latest_ingestion_status?: string | null;
};

export type KnowledgeProcessingNotice =
  | string
  | {
      code?: string | null;
      message?: string | null;
      source_id?: string | null;
      input_index?: number | null;
      retryable?: boolean;
      stage?: string | null;
      error_fingerprint?: string | null;
    };

export type KnowledgeIngestion = {
  id: string;
  project_id: string;
  app_type_id?: string | null;
  collection_id?: string | null;
  title?: string | null;
  status: KnowledgeProcessingStatus | string;
  stage?: KnowledgeProcessingStatus | string;
  progress?: number;
  processed_sources?: number;
  total_sources?: number;
  input_count?: number;
  processed_count?: number;
  failed_count?: number;
  document_count?: number;
  chunk_count?: number;
  embedding_count?: number;
  can_retry?: boolean;
  sources?: KnowledgeSource[];
  errors?: KnowledgeProcessingNotice[];
  warnings?: KnowledgeProcessingNotice[];
  config?: {
    title?: string;
    retry_count?: number;
    max_retries?: number;
    [key: string]: unknown;
  };
  created_at?: string;
  started_at?: string | null;
  updated_at?: string;
  completed_at?: string | null;
};

export type KnowledgeDocument = {
  id: string;
  project_id: string;
  source_id: string;
  title: string;
  version: number;
  token_count?: number;
  char_count?: number;
  checksum_sha256?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type KnowledgeIngestionResponse = {
  accepted?: boolean;
  idempotent_replay?: boolean;
  job: KnowledgeIngestion;
  sources: KnowledgeSource[];
  documents?: KnowledgeDocument[];
  chunk_count?: number;
  deduplicated_count?: number;
  warnings?: KnowledgeProcessingNotice[];
  status_url?: string;
};

export type KnowledgeCollection = {
  id: string;
  project_id: string;
  app_type_id?: string | null;
  name: string;
  description?: string | null;
  color?: string | null;
  source_ids?: string[];
  source_count?: number;
  document_count?: number;
  chunk_count?: number;
  status?: string;
  retrieval_config?: Record<string, unknown>;
  is_active?: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type KnowledgeSearchMode = "hybrid" | "semantic" | "keyword";

export type KnowledgeSearchFilters = {
  app_type_id?: string | null;
  collection_ids?: string[];
  source_kinds?: string[];
  source_ids?: string[];
  statuses?: string[];
  as_of?: string;
};

export type KnowledgeCitation = {
  index?: number;
  id: string;
  evidence_id?: string;
  canonical_id?: string;
  knowledge_id?: string;
  fragment_id?: string;
  freshness?: { current?: boolean; effective_from?: string; effective_to?: string | null; updated_at?: string; stale?: boolean };
  chunk_id?: string | null;
  document_id?: string | null;
  source_id?: string | null;
  source_kind?: KnowledgeSourceKind | string;
  title?: string;
  label?: string;
  source_ref_id?: string | null;
  excerpt?: string | null;
  uri?: string | null;
  source_uri?: string | null;
  score?: number | null;
  source_hash?: string | null;
  version_hash?: string | null;
  chunk_hash?: string | null;
  location?: {
    chunk_index?: number | null;
    heading?: string | null;
    heading_path?: string[];
    section_type?: string | null;
    char_start?: number | null;
    char_end?: number | null;
    page?: number | null;
    timestamp_start_ms?: number | null;
    timestamp_end_ms?: number | null;
  };
  metadata?: Record<string, unknown>;
};

export type KnowledgeSearchHit = KnowledgeCitation & {
  content?: string;
  collection_ids?: string[];
  source_ref_id?: string | null;
  citation?: KnowledgeCitation;
  keyword_score?: number | null;
  lexical_score?: number | null;
  semantic_score?: number | null;
  rank?: number;
};

export type KnowledgeAnswerStructure = {
  summary?: string;
  findings?: string[];
  recommendations?: string[];
  evidence_gaps?: string[];
  supported_claims?: Array<{
    statement: string;
    citation_ids: string[];
  }>;
};

export type KnowledgeRetrievalRequest = {
  contract_version: "RetrievalRequest.v1" | string;
  request_id: string;
  project_id: string;
  query: string;
  query_class: "LOOKUP" | "SEARCH" | "ANALYTICAL" | "INVESTIGATIVE" | "MULTIMODAL" | string;
  budgets?: Record<string, number>;
};

export type KnowledgeContextPacket = {
  contract_type?: "ContextPacket";
  contract_version: "ContextPacket.v1" | string;
  schema_id?: string;
  packet_id: string;
  context_packet_id?: string;
  evidence?: Array<KnowledgeCitation & { evidence_id: string; content?: string; visibility?: { state?: string }; locator?: KnowledgeCitation["location"] }>;
  retrieval?: { status?: string; rounds?: number; termination_reason?: string };
  authorization_coverage?: { fully_visible_objects?: number; partially_visible_objects?: number; unavailable_objects?: number };
  request_id?: string | null;
  coverage?: {
    evidence_count?: number;
    source_count?: number;
    source_kinds?: string[];
    context_tokens_estimated?: number;
    context_budget_exhausted?: boolean;
  };
  authorization?: {
    project_scope_enforced?: boolean;
    source_acl_enforced?: boolean;
  };
};

export type KnowledgeAnswerContract = {
  contract_type?: "AnswerContract";
  contract_version: "AnswerContract.v1" | string;
  schema_id?: string;
  status: string;
  presentation: string | { recommended_type: "TEXT" | "TABLE" | "TIMELINE" | "COMPARISON" | "RELATIONSHIP_GRAPH" | "METRIC" | "DOCUMENT_RESULTS" | "IMAGE_RESULTS"; structured_payload?: Record<string, unknown> };
  summary: string;
  answer?: { summary?: string };
  claims: Array<{ claim_id?: string; statement: string; text?: string; classification?: string; evidence_ids: string[] }>;
  citation_ids: string[];
  evidence_gaps: string[];
  limitations?: { retrieval_status?: string; authorization_partial?: boolean; budget_partial?: boolean; stale_sources?: Array<string | Record<string, unknown>>; unavailable_sources?: number };
  evidence_quality?: Record<string, unknown>;
  grounding?: {
    context_evidence_count?: number;
    supported_claim_count?: number;
    unsupported_claim_count?: number;
    claim_citation_coverage?: number;
    model_confidence_accepted?: boolean;
  };
  termination_reason?: string | null;
};

export type KnowledgeRetrievalSummary = {
  intent_planning_mode?: "llm" | "standard";
  intent_planning_model_used?: boolean;
  intent_plan_error_code?: string | null;
  context_transport?: string;
  mode?: KnowledgeSearchMode | string;
  query?: string;
  candidate_count?: number;
  matched_count?: number;
  returned_count?: number;
  result_count?: number;
  latency_ms?: number;
  collection_ids?: string[];
  source_kinds?: string[];
  confidence?: number | null;
  embedding_model?: string | null;
  vector_mode?: string | null;
  filters?: KnowledgeSearchFilters;
  live_context_count?: number;
  live_context_counts?: Record<string, number>;
  context_route?: {
    agent_id?: string | null;
    input_type?: string;
    query_category?: "tool_help" | "project_facts" | "project_analysis" | "project_knowledge" | "mixed" | "specialist_analysis" | string;
    answer_depth?: "concise" | "standard" | "detailed" | string;
    route_confidence?: "low" | "medium" | "high" | string;
    matched_intents?: string[];
    mode?: "chat" | "agent" | string;
    priority_scopes?: string[];
    effective_scopes?: string[];
    live_scopes?: string[];
    adaptive_live_scopes?: string[];
    indexed_source_kinds?: string[];
    information_needs?: string[];
    identifiers?: string[];
    requires_live_context?: boolean;
    requires_indexed_context?: boolean;
    retrieval_budget?: {
      max_queries?: number;
      max_rounds?: number;
      max_evidence_items?: number;
    };
    retrieval_focus?: string;
    outcome_sections?: string[];
    resolved_query?: string;
    conversation_reference_used?: boolean;
    decision_question?: string;
    deliverable_contract?: string;
  } | null;
  query_chain?: string[];
  planned_queries?: string[];
  embedding_batch_count?: number;
  model_context_plan?: {
    source_kinds?: string[];
    information_needs?: string[];
    stop_if_sufficient?: boolean;
  };
  answer_structure?: KnowledgeAnswerStructure;
  retrieval_round_count?: number;
  retrieval_rounds?: Array<{
    round: number;
    query_count: number;
    evidence_before: number;
    evidence_after: number;
    stop_reason: string;
  }>;
  evidence_sufficiency?: {
    score: number;
    status: "strong" | "usable" | "weak" | string;
    citation_ready_count: number;
    distinct_source_count: number;
    live_evidence_count: number;
    corroborated_result_count: number;
    route_aligned_result_count?: number;
    topically_matched_result_count?: number;
    strongest_retrieval_score: number;
    requires_more_context: boolean;
  };
  query_count?: number;
  grounded_result_count?: number;
  processing_trace?: Array<{
    phase?: string;
    label?: string;
    detail?: string;
    stage?: string;
    message?: string;
    error_code?: string;
    status: "pending" | "complete" | "failed" | string;
  }>;
  query_class?: KnowledgeRetrievalRequest["query_class"];
  provider_error_code?: string;
  provider_error_message?: string;
  retrieval_request?: KnowledgeRetrievalRequest;
  context_packet?: KnowledgeContextPacket;
  answer_contract?: KnowledgeAnswerContract;
  termination_reason?: string | null;
  budget?: {
    limits?: Record<string, number>;
    used?: Record<string, number>;
    remaining?: Record<string, number>;
    termination_reason?: string | null;
  };
};

export type KnowledgeSearchResponse = {
  project_id?: string;
  query: string;
  mode: KnowledgeSearchMode | string;
  total?: number;
  hits?: KnowledgeSearchHit[];
  results?: KnowledgeSearchHit[];
  retrieval?: KnowledgeRetrievalSummary;
  guardrails?: string[];
};

export type KnowledgeAssistantGroundingStatus =
  | "grounded"
  | "partially_grounded"
  | "insufficient_context"
  | "provider_unavailable"
  | "refused";

export type KnowledgeAssistantIntegration = {
  id: string;
  name: string;
  model: string | null;
  scope: "project" | "workspace";
  project_id?: string | null;
  is_default?: boolean;
};

export type KnowledgeAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "complete" | "failed" | "answered" | "insufficient_context" | "refused" | string;
  grounding_status?: KnowledgeAssistantGroundingStatus | string;
  citations: KnowledgeCitation[];
  retrieval?: KnowledgeRetrievalSummary;
  answer_contract?: KnowledgeAnswerContract | null;
  context_packet?: KnowledgeContextPacket | null;
  scope?: { project_id: string; app_type_id?: string | null; filters?: KnowledgeSearchFilters };
  guardrails?: string[];
  provenance?: {
    provider?: string | null;
    model?: string | null;
    generation_mode?: string;
    context_fingerprint?: string | null;
    context_item_count?: number;
    context_route?: KnowledgeRetrievalSummary["context_route"];
  };
  refusal_reason?: string | null;
  safety?: {
    status?: string;
    reason?: string | null;
    outside_scope?: boolean;
    pii_redacted?: boolean;
    extractive_grounded_fallback?: boolean;
  };
  provider?: string | null;
  model?: string | null;
  session_id?: string;
  created_at?: string;
};

export type KnowledgeAssistantSession = {
  id: string;
  project_id: string;
  app_type_id?: string | null;
  title?: string | null;
  status?: string;
  filters?: KnowledgeSearchFilters;
  messages?: KnowledgeAssistantMessage[];
  message_count?: number;
  last_message_at?: string | null;
  created_at?: string;
  updated_at?: string;
  client_turn_id?: string | null;
};

export type KnowledgeAssistantMessageResponse = {
  pending?: boolean;
  client_turn_id?: string | null;
  idempotent_replay?: boolean;
  retry_after_seconds?: number;
  session?: KnowledgeAssistantSession;
  user_message?: KnowledgeAssistantMessage;
  assistant_message?: KnowledgeAssistantMessage;
  message?: KnowledgeAssistantMessage;
  citations?: KnowledgeCitation[];
  retrieval?: KnowledgeRetrievalSummary;
  context_packet?: KnowledgeContextPacket | null;
  answer_contract?: KnowledgeAnswerContract | null;
  guardrails?: string[];
  provenance?: KnowledgeAssistantMessage["provenance"];
};

export type KnowledgeRetrievalEvent = {
  contract_type: "RetrievalEvent";
  contract_version: "1.0" | string;
  schema_id?: string;
  request_id?: string;
  sequence?: number;
  stage: string;
  status?: string;
  message?: string;
  error_code?: string;
  metrics?: Record<string, number>;
};

export type KnowledgeOverview = {
  project_id: string;
  counts?: {
    collections?: number;
    sources?: number;
    documents?: number;
    chunks?: number;
    ready_sources?: number;
    processing_sources?: number;
    failed_sources?: number;
  };
  totals?: {
    collections?: number;
    sources?: number;
    documents?: number;
    chunks?: number;
    ready?: number;
    processing?: number;
    failed?: number;
  };
  capabilities?: {
    embedding_provider?: string | null;
    embedding_model?: string | null;
    llm_ready?: boolean;
    ingestion_ready?: boolean;
    max_file_bytes?: number;
    max_files_per_ingestion?: number;
    supported_mime_types?: string[];
    supported_extensions?: string[];
    search_modes?: KnowledgeSearchMode[];
    hybrid_search?: boolean;
    vector_store?: string | null | {
      engine?: string | null;
      pgvector_available?: boolean;
      mode?: string | null;
      fallback?: string | null;
      provider?: string | null;
      configured?: boolean;
      circuit_open?: boolean;
      collection_strategy?: string;
      acl_prefilter?: boolean;
      canonical_store?: string;
    };
    embedding?: {
      provider?: string | null;
      model?: string | null;
      configured?: boolean;
    };
    context_processing?: {
      version?: string;
      hierarchy_strategy?: string;
      active_documents?: number;
      current_pipeline_documents?: number;
      review_required_documents?: number;
      average_score?: number | null;
      refresh_recommended?: boolean;
    };
    extraction?: {
      max_file_bytes?: number;
      max_extractable_bytes?: number;
      extraction_max_bytes?: number;
      max_extracted_text_chars?: number;
      native_text_mime_types?: string[];
      supported_mime_types?: string[];
      supported_extensions?: string[];
      tika_configured?: boolean;
      binary_requires_extracted_text?: boolean;
    };
    guardrails?: string[];
  };
  recent_jobs?: KnowledgeIngestion[];
  recent_ingestions?: KnowledgeIngestion[];
  recent_collections?: KnowledgeCollection[];
};

export type ExecutionCaseSnapshot = {
  test_data_options?: TestDataOptions;
  expected_iterations?: number;
  execution_id: string;
  test_case_id: string;
  test_case_title: string;
  test_case_description: string | null;
  external_references?: string[];
  requirement_ids?: string[];
  defect_ids?: string[];
  suite_id: string | null;
  suite_name: string | null;
  module_id?: string | null;
  module_name?: string | null;
  priority: number | null;
  status: string | null;
  parameter_values?: Record<string, string>;
  parameter_template_values?: Record<string, string>;
  suite_parameter_values?: Record<string, string>;
  suite_parameter_template_values?: Record<string, string>;
  test_data_set_id?: string | null;
  test_data_set_name?: string | null;
  test_data_set_snapshot?: ExecutionDataSetSnapshot | null;
  data_set_source?: "test_case" | "run" | string | null;
  sort_order: number;
  assigned_to?: string | null;
  assigned_to_ids?: string[];
  assignment_source?: "run" | "suite" | "module" | "case" | null;
  assigned_user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  } | null;
  assigned_users?: ExecutionScopeUser[];
};

export type ExecutionStepSnapshot = {
  shared_parameter_values?: Record<string, string>;
  shared_parameter_template_values?: Record<string, string>;
  shared_parameter_sensitive_names?: string[];
  execution_id: string;
  test_case_id: string;
  snapshot_step_id: string;
  step_order: number;
  action: string | null;
  expected_result: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
  group_id?: string | null;
  group_name?: string | null;
  group_kind?: "local" | "reusable" | null;
  reusable_group_id?: string | null;
};

export type ExecutionResult = {
  detail_complete?: boolean;
  id: string;
  execution_id: string;
  test_case_id: string;
  test_case_display_id?: string | null;
  test_case_title?: string | null;
  suite_id?: string | null;
  suite_name?: string | null;
  app_type_id: string;
  status: "pending" | "running" | "paused" | "passed" | "failed" | "blocked" | "aborted" | "skipped";
  duration_ms: number | null;
  elapsed_duration_ms?: number;
  started_at?: string | null;
  timer_started_at?: string | null;
  ended_at?: string | null;
  lifecycle_history?: Array<{ action: string; from_status: string; to_status: string; actor_id: string | null; actor_name?: string | null; actor_email?: string | null; at: string; duration_ms: number; previous_result_id?: string | null }>;
  error: string | null;
  logs: string | null;
  test_data_set_id?: string | null;
  test_data_set_name?: string | null;
  data_set_iteration_index?: number | null;
  data_set_iteration_key?: string | null;
  data_set_row_snapshot?: Record<string, string> | null;
  external_references?: string[];
  defects?: string[];
  case_defects?: string[];
  step_defects?: Record<string, string[]>;
  revision?: number;
  executed_by: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ReleaseReadinessExecutionEvidence = {
  candidate_runs?: number;
  evaluated_at?: string;
  executions: Execution[];
  results: ExecutionResult[];
  complete: boolean;
  reasons: string[];
  runs_scanned: number;
  results_scanned: number;
  candidate_results: number;
  limits: {
    runs: number;
    results: number;
    results_per_run: number;
  };
};

export type TraceabilityRunHistoryItem = {
  id: string;
  execution_id: string;
  execution_display_id?: string | null;
  execution_name: string;
  execution_status: ExecutionStatus | null;
  trigger: Execution["trigger"];
  suite_ids: string[];
  test_case_id: string;
  test_case_title: string;
  result_status: ExecutionResult["status"];
  defects: string[];
  result_created_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  release?: string | null;
  sprint?: string | null;
  build?: string | null;
};

export type SessionPayload = {
  token: string;
  user: User;
  project_id?: string | null;
  project_key?: string | null;
};

export type AuthSetupPayload = {
  google: {
    enabled: boolean;
    clientId: string | null;
  };
  emailVerification: {
    enabled: boolean;
    senderEmail: string | null;
    senderName: string | null;
  };
};

export type ApiError = {
  statusCode?: number;
  error?: string;
  message?: string;
  code?: string;
  current_revision?: number;
};

export type HelloTestEntityType = "project" | "requirement" | "test_case" | "test_suite" | "shared_step_group" | "execution" | "execution_result" | "issue";

export type HelloTestAttachment = {
  id: string;
  project_id?: string;
  entity_type?: HelloTestEntityType;
  entity_id?: string;
  filename: string;
  size: number;
  storedSize?: number;
  compression?: "gzip" | "none" | string;
  savedBytes?: number;
  mimeType: string;
  checksum?: string | null;
  created?: string | null;
  thumbnail?: string | null;
  author?: { displayName?: string; avatarUrls?: Record<string, string> } | null;
};

export type HelloTestComment = {
  id: string;
  body: string;
  created: string | null;
  updated: string | null;
  author: { id?: string | null; displayName?: string; avatarUrls?: Record<string, string> } | null;
};

export type OpsPlatformSnapshot = {
  checked_at: string;
  enabled: boolean;
  state: string;
  components: Array<{ id: string; purpose: string; state: string; memory_limit_mib: number; latency_ms?: number }>;
  policy: Record<string, string>;
};

export type OpsMonitoringSection = "dashboard" | "logs" | "alerts";
export type OpsMonitoringSnapshot = {
  section: OpsMonitoringSection;
  checked_at: string;
  state: "available" | "unavailable" | "not_configured";
  metrics?: Array<{ id: string; label: string; unit: string; value: number | null }>;
  services?: Array<{ name: string; available: boolean }>;
  logs?: Array<{ timestamp: string; time: string; container: string; message: string }>;
  alerts?: Array<{ id: string; name: string; severity: string; state: string; summary: string; description: string; starts_at: string }>;
  limit?: number;
  window?: string;
};
