export type EngineStepType = "web" | "api" | "android" | "ios";
export type EngineWebEngineProvider = "playwright" | "selenium";
export type EngineRunTrigger = "execution" | "test-run";
export type EngineSourceMode = "attached-script" | "manual-handover";
export type EngineTraceMode = "off" | "on" | "on-first-retry" | "retain-on-failure";
export type EngineVideoMode = "off" | "on" | "retain-on-failure";
export type EngineBrowser = "chromium" | "firefox" | "webkit";
export type HelloTestExecutionResultStatus = "passed" | "failed" | "blocked";
export type EngineStepOutcomeStatus = HelloTestExecutionResultStatus | "skipped";

export type EngineKeyValueEntry = {
  key: string;
  value: string;
  is_secret?: boolean;
};

export type EngineApiValidation = {
  kind: "status" | "header" | "body_contains" | "json_path";
  target?: string | null;
  expected?: string | null;
};

export type EngineApiCapture = {
  path?: string | null;
  parameter?: string | null;
};

export type EngineApiRequest = {
  timeout_ms?: number;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url?: string | null;
  headers?: Array<{ key: string; value: string }>;
  body_mode?: "none" | "json" | "text" | "xml" | "form";
  body?: string | null;
  validations?: EngineApiValidation[];
  captures?: EngineApiCapture[];
};

export type EngineRunStep = {
  source_case_parameters?: Record<string, string>;
  source_case_context?: Pick<EngineRunEnvelope, "case_parameters" | "suite_parameters" | "data_policy" | "data_set">;
  shared_parameter_values?: Record<string, string>;
  id: string;
  order: number;
  step_type: EngineStepType;
  engine_class?: EngineStepType | string | null;
  action: string | null;
  expected_result: string | null;
  automation_code?: string | null;
  api_request?: EngineApiRequest | null;
  group_name?: string | null;
  group_kind?: "local" | "reusable" | null;
};

export type EngineHookScope = "suite" | "test";
export type EngineHookPhase = "pre" | "post";
export type EngineHookFailBehavior = "fail-run" | "mark-blocked" | "continue";

export type EngineRunHook = {
  id: string;
  name: string;
  scope: EngineHookScope;
  phase: EngineHookPhase;
  fail_behavior?: EngineHookFailBehavior;
  target_kind?: "test" | "suite" | "inline";
  target_id?: string | null;
  steps: EngineRunStep[];
};

export type EngineObjectRepositoryEntry = {
  id: string;
  test_case_id?: string | null;
  page_url?: string | null;
  page_key: string;
  locator_intent: string;
  locator: string;
  locator_kind?: string | null;
  confidence?: number | null;
  source?: string | null;
  screen_name?: string | null;
  object_name?: string | null;
  object_role?: string | null;
  target_criteria?: string[];
  dom_structure?: string | null;
  screenshot_url?: string | null;
  fallback_strategy?: string | null;
  previous_locators?: string[];
  reference_aliases?: string[];
  fallback_locators?: Array<{
    locator?: string | null;
    strategy?: string | null;
    confidenceScore?: number | null;
    confidence_score?: number | null;
  }>;
  metadata?: Record<string, unknown>;
  updated_at?: string | null;
};

export type EngineMobileProvider = "local-appium" | "saucelabs" | "browserstack";

export type EngineManualSpec = {
  title: string;
  intent: string;
  preconditions: string[];
  steps: string[];
  detailed_steps?: Array<{
    id?: string | null;
    order?: number | null;
    action: string;
    expected_result?: string | null;
    automation_code?: string | null;
    api_request?: unknown;
  }>;
  assertions: string[];
  test_data: Record<string, string>;
  environment_notes?: string | null;
};

export type EngineAttachedScript = {
  language: "typescript";
  framework: "playwright";
  path: string;
  locator_map_path?: string | null;
  content_hash?: string | null;
};

export type EngineRunArtifactPolicy = {
  trace_mode: EngineTraceMode;
  video_mode: EngineVideoMode;
  screenshot_on_failure: boolean;
  screenshot_on_success?: boolean;
  capture_console: boolean;
  capture_network: boolean;
  artifact_retention_days: number;
  max_video_attachment_mb?: number;
};

export type EngineRunTimeoutPolicy = {
  navigation_timeout_ms?: number;
  action_timeout_ms?: number;
  assertion_timeout_ms?: number;
  recovery_wait_ms?: number;
};

export type EngineSessionPolicy = {
  web?: {
    mode?: "new" | "reuse" | "attach";
    reuse_key?: string | null;
    connect_over_cdp_endpoint?: string | null;
    close_on_finish?: boolean;
  } | null;
  mobile?: {
    mode?: "new" | "reuse" | "attach";
    reuse_key?: string | null;
    existing_session_id?: string | null;
    close_on_finish?: boolean;
  } | null;
} | null;

export type EngineInlineEvidenceImage = {
  data_url?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  artifact_path?: string | null;
};

export type HelloTestExecutionStepEvidence = {
  dataUrl?: string;
  attachmentId?: string;
  size?: number;
  checksum?: string;
  fileName?: string;
  mimeType?: string;
};

export type HelloTestExecutionApiAssertion = {
  kind: string;
  passed: boolean;
  target?: string | null;
  expected?: string | null;
  actual?: string | null;
};

export type HelloTestExecutionStepApiDetail = {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  };
  response: {
    status: number;
    status_text: string;
    headers: Record<string, string>;
    body: string;
    json: unknown;
  };
  captures: Record<string, string>;
  assertions: HelloTestExecutionApiAssertion[];
};

export type HelloTestExecutionStepWebDetail = {
  provider: EngineWebEngineProvider;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  url: string;
  console: Array<{
    type: string;
    text: string;
    timestamp: string;
    location?: string | null;
  }>;
  network: Array<{
    method: string;
    url: string;
    status?: number | null;
    resource_type?: string | null;
    error?: string | null;
    timestamp: string;
  }>;
  captures: Record<string, string>;
};

export type HelloTestExecutionStepAutomationDetail = {
  line_results?: Array<{ line: number; status: "passed" | "failed"; duration_ms: number; attempt: number; error?: string }>;
  engine: EngineStepType | "ios" | string;
  provider?: string | null;
  status: HelloTestExecutionResultStatus | "queued" | "running" | "skipped";
  code: string;
  language?: "javascript" | "json" | "text" | string;
  active_line?: number | null;
  error_line?: number | null;
  error_message?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
};

export type HelloTestExecutionLogsPayload = {
  stepStatuses?: Record<string, EngineStepOutcomeStatus>;
  stepNotes?: Record<string, string>;
  stepEvidence?: Record<string, HelloTestExecutionStepEvidence>;
  stepApiDetails?: Record<string, HelloTestExecutionStepApiDetail>;
  stepWebDetails?: Record<string, HelloTestExecutionStepWebDetail>;
  stepAutomationDetails?: Record<string, HelloTestExecutionStepAutomationDetail>;
  stepCaptures?: Record<string, Record<string, string>>;
};

export type EngineArtifactKind =
  | "trace"
  | "video"
  | "screenshot"
  | "console"
  | "network"
  | "dom"
  | "summary"
  | "script"
  | "locator-map";

export type EngineArtifactRef = {
  kind: EngineArtifactKind;
  label: string;
  path?: string | null;
  url?: string | null;
  content_type?: string | null;
  file_name?: string | null;
  content_base64?: string | null;
  size_bytes?: number | null;
  attachment_id?: string;
  attachment_status?: "uploaded" | "inline" | "unavailable";
  attachment_error?: string;
  checksum_sha256?: string;
  compression?: string;
  capture_outcome?: EngineStepOutcomeStatus;
  transcoded?: boolean;
  original_size_bytes?: number;
};

export type EngineStepOutcome = {
  step_id: string;
  status: EngineStepOutcomeStatus;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  note?: string | null;
  evidence_image?: EngineInlineEvidenceImage | null;
  artifacts?: EngineArtifactRef[];
};

export type EngineCaseResultPayload = {
  hellotest_execution_result_id?: string | null;
  status: HelloTestExecutionResultStatus;
  duration_ms?: number | null;
  error?: string | null;
  logs: HelloTestExecutionLogsPayload;
};

export type EngineConfigurationTarget = {
  id?: string | null;
  os?: "Windows" | "macOS" | "Linux" | "";
  browser?: string;
  mobile_os?: "Android" | "iOS" | "";
  version?: string;
};

export type ParameterDataPolicy = {
  version: number;
  case?: ParameterOverrideOptions; suite?: ParameterOverrideOptions; run?: ParameterOverrideOptions;
};
export type ParameterOverrideOptions = { parameter_overrides?: string[]; private_parameter_names?: string[]; override_shared_steps?: boolean; override_test_case_data?: boolean; override_suite_data?: boolean };

export type EngineRunEnvelope = {
  engine_run_id: string;
  hellotest_run_id: string;
  hellotest_execution_id?: string | null;
  hellotest_test_case_id: string;
  hellotest_test_case_title: string;
  external_references?: string[];
  project: {
    id: string;
    name: string;
  };
  app_type: {
    id: string;
    name: string;
    kind: string;
  };
  trigger: EngineRunTrigger;
  source_mode: EngineSourceMode;
  automated: boolean;
  orchestration_class?: "api" | "web" | "android" | string | null;
  step_engine_classes?: Array<"api" | "web" | "android" | string>;
  engine_worker_caps?: {
    api?: number;
    web?: number;
    android?: number;
  } | null;
  execution_policy?: {
    parallel_enabled?: boolean;
    parallel_count?: number;
    suite_parallel_override?: boolean;
    suite_id?: string | null;
    execution_order?: number;
  } | null;
  browser: EngineBrowser;
  headless: boolean;
  max_repair_attempts: number;
  run_timeout_seconds: number;
  timeouts?: EngineRunTimeoutPolicy | null;
  session_policy?: EngineSessionPolicy;
  web_engine?: {
    active: EngineWebEngineProvider;
  } | null;
  mobile_engine?: {
    platform_name?: "android" | "ios" | null;
    udid?: string | null;
    bundle_id?: string | null;
    app_package?: string | null;
    app_activity?: string | null;
    provider_options?: Record<string, unknown>;
    active: EngineMobileProvider;
    recorder_mode?: "local" | "remote";
    appium_server_url?: string | null;
    cloud_provider?: string | null;
    device_name?: string | null;
    platform_version?: string | null;
    app?: string | null;
  } | null;
  manual_spec: EngineManualSpec;
  auto_repair_brief?: {
    goal?: string;
    screen_selection?: string;
    correction_policy?: string[];
  } | null;
  attached_script?: EngineAttachedScript | null;
  hooks?: EngineRunHook[];
  object_repository?: EngineObjectRepositoryEntry[];
  steps: EngineRunStep[];
  suite_parameters: Record<string, string>;
  case_parameters: Record<string, string>;
  run_parameters?: Record<string, string>;
  parameters_frozen?: boolean;
  data_policy?: ParameterDataPolicy;
  environment?: {
    name: string;
    base_url?: string | null;
    browser?: string | null;
    variables: EngineKeyValueEntry[];
  } | null;
  configuration?: {
    name: string;
    os?: string | null;
    browser?: string | null;
    mobile_os?: string | null;
    platform_version?: string | null;
    targets?: EngineConfigurationTarget[];
    variables: EngineKeyValueEntry[];
  } | null;
  data_set?: {
    shared_rows?: Array<Record<string, unknown>>;
    data_scope_policy?: ParameterDataPolicy;
    parameter_data_layers?: Partial<Record<"case" | "suite" | "run", { rows: Array<Record<string,string>> } | null>>;
    id?: string | null;
    name: string;
    source?: "run" | "suite" | "test_case";
    mode: "key_value" | "table";
    columns: string[];
    rows: Array<Record<string, string>>;
    template_rows?: Array<Record<string, string>>;
    iteration?: { index: number; number: number; key: string; total: number } | null;
  } | null;
  artifact_policy: EngineRunArtifactPolicy;
  callback?: {
    url: string;
    signing_secret: string;
  } | null;
};

export type EngineArtifactBundle = {
  capture_warnings?: string[];
  trace_path?: string | null;
  video_path?: string | null;
  screenshot_paths: string[];
  console_log_path?: string | null;
  network_har_path?: string | null;
  dom_snapshot_path?: string | null;
  summary_path?: string | null;
  artifact_refs?: EngineArtifactRef[];
};

export type EnginePatchProposal = {
  kind: "locator-map" | "script";
  status: "review" | "applied";
  summary: string;
  target_path: string;
};

export type EngineRunState =
  | "queued"
  | "building-script"
  | "running"
  | "healing"
  | "completed"
  | "failed"
  | "incident";

export type EngineRunRecord = {
  id: string;
  hellotest_run_id: string;
  hellotest_execution_id?: string | null;
  hellotest_test_case_id: string;
  data_set_iteration?: { index: number; number: number; key: string; total: number } | null;
  test_case_title: string;
  state: EngineRunState;
  source_mode: EngineSourceMode;
  browser: EngineBrowser;
  deterministic_attempted: boolean;
  healing_attempted: boolean;
  healing_succeeded: boolean;
  summary: string;
  generated_script_path?: string | null;
  locator_map_path?: string | null;
  artifact_bundle: EngineArtifactBundle;
  patch_proposals: EnginePatchProposal[];
  created_at: string;
  updated_at: string;
  callback_delivery?: { status: "pending" | "delivered" | "failed"; attempts: number; event: string; error_code?: string; http_status?: number; updated_at: string };
};

export type EngineCallbackEventType =
  | "run.accepted"
  | "run.progress"
  | "run.step.completed"
  | "run.completed"
  | "run.failed"
  | "run.incident"
  | "run.patch.proposed";

export type EngineCallbackPayload = {
  event: EngineCallbackEventType;
  engine_run_id: string;
  hellotest_run_id: string;
  hellotest_execution_id?: string | null;
  hellotest_test_case_id: string;
  data_set_iteration?: { index: number; number: number; key: string; total: number } | null;
  state: EngineRunState;
  summary: string;
  deterministic_attempted: boolean;
  healing_attempted: boolean;
  healing_succeeded: boolean;
  step_outcomes?: EngineStepOutcome[];
  case_result?: EngineCaseResultPayload | null;
  artifact_bundle: EngineArtifactBundle;
  patch_proposals: EnginePatchProposal[];
  emitted_at: string;
};

export type EngineQueueRuntimeState = {
  captured_values?: Record<string, string>;
  logs?: HelloTestExecutionLogsPayload;
  deterministic_attempted?: boolean;
  healing_attempted?: boolean;
  healing_succeeded?: boolean;
  final_summary?: string | null;
  artifact_bundle?: EngineArtifactBundle;
  patch_proposals?: EnginePatchProposal[];
};

export type EngineQueuedJob = {
  id: string;
  engine_run_id: string;
  execution_id: string;
  test_case_id: string;
  test_case_title: string;
  engine_class?: "api" | "web" | "android" | string | null;
  engine_host?: string | null;
  status: "queued" | "leased" | "running" | "completed" | "failed" | "aborted" | string;
  payload: EngineRunEnvelope;
  runtime_state?: EngineQueueRuntimeState;
  lease_expires_at?: string | null;
};
