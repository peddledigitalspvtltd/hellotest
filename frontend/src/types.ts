export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_data_url?: string | null;
  role?: "admin" | "member";
  permissions?: string[];
  auth_provider?: "local" | "google";
  email_verified?: boolean;
  created_at?: string;
};

export type Role = {
  id: string;
  name: string;
};

export type Permission = {
  id: string;
  code: string;
  description: string | null;
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
  permissions?: string[];
  routes?: string[];
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
  groups: FeatureFlagGroup[];
  flags: Record<string, boolean>;
  local_flags: Record<string, boolean>;
  provider: {
    type: "local";
    configured: boolean;
    connected: boolean;
  };
};

export type AppNotification = {
  id: string;
  user_id: string;
  session_id?: string | null;
  project_id?: string | null;
  run_id?: string | null;
  target_url?: string | null;
  type: string;
  title: string;
  message: string;
  status: "unread" | "read" | string;
  created_at?: string;
};

export type Project = {
  id: string;
  display_id?: string | null;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at?: string;
};

export type ProjectMember = {
  id: string;
  project_id: string;
  user_id: string;
  role_id: string;
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
  id: string;
  display_id?: string | null;
  project_id: string;
  iteration_id?: string | null;
  title: string;
  description: string | null;
  external_references?: string[];
  labels?: string[];
  sprint?: string | null;
  fix_version?: string | null;
  release?: string | null;
  priority: number | null;
  status: string | null;
  test_case_ids?: string[];
  defect_ids?: string[];
  defects?: RequirementDefectLink[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RequirementIteration = {
  id: string;
  display_id?: string | null;
  project_id: string;
  name: string;
  description?: string | null;
  requirement_count?: number;
  requirement_ids?: string[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RequirementDefectLink = {
  id: string;
  title: string;
  status: string | null;
  link_source?: "manual" | "automatic" | string;
  created_at?: string;
};

export type TestCaseDefectLink = {
  id: string;
  title: string;
  status: string | null;
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
  user_id: string;
  user_name?: string | null;
  user_email?: string | null;
  title: string;
  message: string;
  steps_to_reproduce?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  severity?: string | null;
  priority?: string | null;
  environment?: string | null;
  build?: string | null;
  jira_bug_key?: string | null;
  linked_test_run_id?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
  root_cause?: string | null;
  status: string | null;
  created_at?: string;
};

export type IntegrationType =
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
  value: string;
  label: string;
  description?: string;
  icon?: string;
  defaults?: Record<string, unknown>;
};

export type DomainMetadata = {
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
    priority_scale: number[];
  };
  test_cases: {
    default_status: string;
    default_automated: string;
    statuses: DomainOption[];
    automated_options: DomainOption[];
    priority_scale: number[];
  };
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
  executions: {
    statuses: DomainOption[];
    final_statuses: DomainOption[];
    result_statuses: DomainOption[];
    impact_levels: DomainOption[];
  };
  issues: {
    default_status: string;
    statuses: DomainOption[];
  };
  feedback?: {
    default_status: string;
    statuses: DomainOption[];
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
};

export type AiDesignImageInput = {
  name?: string | null;
  url: string;
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
  applicable_domain?: string | null;
  requirement_ids: string[];
  requirement_titles: string[];
  steps: Array<{
    step_order: number;
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
  };
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
  status: "queued" | "running" | "completed" | "failed" | string;
  total_requirements: number;
  processed_requirements: number;
  generated_cases_count: number;
  error?: string | null;
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
  requirement_titles: string[];
  step_count: number;
  reason: string;
  impact_level: "critical" | "high" | "medium" | "low";
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
  source_case_count: number;
  matched_case_count: number;
  execution_name: string;
  summary: string;
  cases: SmartExecutionImpactCase[];
};

export type TestSuite = {
  id: string;
  display_id?: string | null;
  app_type_id: string;
  name: string;
  parent_id: string | null;
  labels?: string[];
  parameter_values?: Record<string, string>;
  parallel_enabled?: boolean | null;
  parallel_count?: number | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TestCase = {
  id: string;
  display_id?: string | null;
  app_type_id?: string | null;
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
  priority: number | null;
  status: string | null;
  requirement_id: string | null;
  reviewer_id?: string | null;
  review_status?: TestCaseReviewStatus | null;
  review_history?: TestCaseReviewEvent[];
  ai_quality_score?: number | null;
  ai_generation_source?: "scheduler" | null;
  ai_generation_review_status?: "pending" | "accepted" | null;
  ai_generation_job_id?: string | null;
  ai_generated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TestCaseModule = {
  id: string;
  display_id?: string | null;
  app_type_id: string;
  name: string;
  description?: string | null;
  test_case_count?: number;
  test_case_ids?: string[];
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

export type StepApiValidationKind = "status" | "header" | "body_contains" | "json_path";

export type StepApiValidation = {
  kind: StepApiValidationKind;
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
  step_order: number;
  action: string | null;
  expected_result: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
};

export type SharedStepGroup = {
  id: string;
  display_id?: string;
  app_type_id: string;
  name: string;
  description: string | null;
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

export type TestConfiguration = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  browser: string | null;
  mobile_os: string | null;
  platform_version: string | null;
  variables: KeyValueEntry[];
  created_at?: string;
};

export type TestDataSetMode = "key_value" | "table";

export type TestDataSetRow = Record<string, string>;

export type TestDataSet = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  mode: TestDataSetMode;
  columns: string[];
  rows: TestDataSetRow[];
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
  variables: KeyValueEntry[];
};

export type ExecutionDataSetSnapshot = {
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

export type ExecutionStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export type Execution = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  suite_ids: string[];
  suite_snapshots?: Array<{ id: string; name: string; parameter_values?: Record<string, string> }>;
  case_snapshots?: ExecutionCaseSnapshot[];
  step_snapshots?: ExecutionStepSnapshot[];
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
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
  started_at: string | null;
  ended_at: string | null;
};

export type ExecutionSchedule = {
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
  workflow_id: string | null;
  project_id: string;
  app_type_id: string | null;
  workflow_name: string;
  status: ExecutionStatus;
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

export type ExecutionCaseSnapshot = {
  execution_id: string;
  test_case_id: string;
  test_case_title: string;
  test_case_description: string | null;
  external_references?: string[];
  suite_id: string | null;
  suite_name: string | null;
  priority: number | null;
  status: string | null;
  parameter_values?: Record<string, string>;
  parameter_template_values?: Record<string, string>;
  suite_parameter_values?: Record<string, string>;
  suite_parameter_template_values?: Record<string, string>;
  sort_order: number;
  assigned_to?: string | null;
  assigned_user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  } | null;
};

export type ExecutionStepSnapshot = {
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
  id: string;
  execution_id: string;
  test_case_id: string;
  test_case_title?: string | null;
  suite_id?: string | null;
  suite_name?: string | null;
  app_type_id: string;
  status: "running" | "passed" | "failed" | "blocked";
  duration_ms: number | null;
  error: string | null;
  logs: string | null;
  external_references?: string[];
  defects?: string[];
  executed_by: string | null;
  created_at?: string;
};

export type SessionPayload = {
  token: string;
  user: User;
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
};
