const freezeOptions = (options) => Object.freeze(options.map((option) => Object.freeze({ ...option })));
const optionValues = (options) => Object.freeze(options.map((option) => option.value));

const APP_TYPE_OPTIONS = freezeOptions([
  { value: "web", label: "Web", description: "Browser-based application scope." },
  { value: "api", label: "API", description: "Service and endpoint coverage." },
  { value: "android", label: "Android", description: "Native or hybrid Android application scope." },
  { value: "ios", label: "iOS", description: "Native or hybrid iOS application scope." },
  { value: "unified", label: "Unified", description: "Shared cross-platform coverage scope." }
]);

const INTEGRATION_TYPE_OPTIONS = freezeOptions([
  {
    value: "llm",
    label: "LLM",
    description: "Large language model provider.",
    icon: "AI",
    defaults: {
      base_url: "https://api.openai.com/v1"
    }
  },
  {
    value: "jira",
    label: "Jira",
    description: "Issue tracker and release planning integration.",
    icon: "JI",
    defaults: {}
  },
  {
    value: "email",
    label: "Email Sender",
    description: "SMTP profile for transactional notifications and verification codes.",
    icon: "EM",
    defaults: {
      smtp_port: 587,
      sender_email: "support@qualipal.in",
      sender_name: "QAira Support"
    }
  },
  {
    value: "google_auth",
    label: "Google Sign-In",
    description: "OAuth identity provider for Google authentication.",
    icon: "GO",
    defaults: {}
  },
  {
    value: "google_drive",
    label: "Google Drive Backup",
    description: "Project artifact backup as a compressed archive in Google Drive.",
    icon: "GD",
    defaults: {
      schedule_mode: "manual",
      include_requirements_csv: true,
      include_test_cases_csv: true
    }
  },
  {
    value: "github",
    label: "GitHub Code Sync",
    description: "Push test-case-linked automation code and manifests into a GitHub repository.",
    icon: "GH",
    defaults: {
      branch: "main",
      schedule_mode: "manual"
    }
  },
  {
    value: "testengine",
    label: "Test Engine",
    description: "Provider-switchable remote execution backend for QAira with API automation, Playwright or Selenium web execution, and step-level evidence updates.",
    icon: "TE",
    defaults: {
      runner: "hybrid",
      active_web_engine: "playwright",
      browser: "chromium",
      headless: false,
      healing_enabled: true,
      max_repair_attempts: 2,
      trace_mode: "on-first-retry",
      video_mode: "retain-on-failure",
      capture_console: true,
      capture_network: true,
      artifact_retention_days: 14,
      run_timeout_seconds: 1800,
      navigation_timeout_ms: 30000,
      action_timeout_ms: 5000,
      assertion_timeout_ms: 10000,
      recovery_wait_ms: 750,
      max_video_attachment_mb: 25,
      queue_poll_interval_minutes: 5,
      max_api_workers: 10,
      max_web_workers: 5,
      max_android_workers: 2,
      qaira_api_base_url: "",
      promote_healed_patches: "review"
    }
  },
  {
    value: "local-desktop",
    label: "Local Desktop",
    description: "Local desktop execution bridge for headed browser, recorder, and device-adjacent automation.",
    icon: "LD",
    defaults: {
      runner: "local",
      active_web_engine: "playwright",
      browser: "chromium",
      headless: false,
      healing_enabled: true,
      max_repair_attempts: 1,
      trace_mode: "retain-on-failure",
      video_mode: "retain-on-failure",
      capture_console: true,
      capture_network: true,
      artifact_retention_days: 7,
      run_timeout_seconds: 1800,
      navigation_timeout_ms: 30000,
      action_timeout_ms: 5000,
      assertion_timeout_ms: 10000,
      recovery_wait_ms: 750,
      max_video_attachment_mb: 25,
      queue_poll_interval_minutes: 1,
      qaira_api_base_url: "",
      promote_healed_patches: "review"
    }
  },
  {
    value: "cloudrun",
    label: "Cloud Run",
    description: "Cloud browser and device execution providers for BrowserStack, LambdaTest, Sauce Labs, and CrossBrowser.",
    icon: "CR",
    defaults: {
      provider: "browserstack",
      browser: "Chrome",
      os: "Windows",
      remote_url: ""
    }
  },
  {
    value: "ops",
    label: "OPS Telemetry",
    description: "External operational telemetry sink for execution step, case, suite, and run updates.",
    icon: "OP",
    defaults: {
      events_path: "/api/v1/events",
      health_path: "/health",
      api_key_header: "Authorization",
      api_key_prefix: "Bearer",
      service_name: "qaira-testengine",
      environment: "production",
      timeout_ms: 4000,
      emit_step_events: true,
      emit_case_events: true,
      emit_suite_events: true,
      emit_run_events: true
    }
  }
]);

const TEST_CASE_STATUS_OPTIONS = freezeOptions([
  { value: "active", label: "Active", description: "Available for reuse in current design and execution flows." },
  { value: "draft", label: "Draft", description: "Work in progress and not yet considered stable coverage." },
  { value: "ready", label: "Ready", description: "Prepared for steady reuse and release coverage." },
  { value: "retired", label: "Retired", description: "Preserved for history but not intended for active reuse." }
]);

const TEST_CASE_AUTOMATED_OPTIONS = freezeOptions([
  { value: "no", label: "No", description: "Case is not marked for automation coverage yet." },
  { value: "yes", label: "Yes", description: "Case is marked as automated and counts toward automation coverage." }
]);

const REQUIREMENT_STATUS_OPTIONS = freezeOptions([
  { value: "open", label: "Open", description: "Captured but not yet ready for delivery." },
  { value: "in_progress", label: "In Progress", description: "Being refined or implemented." },
  { value: "ready", label: "Ready", description: "Ready for testing and release coverage." },
  { value: "blocked", label: "Blocked", description: "Waiting on a decision, dependency, or missing detail." },
  { value: "done", label: "Done", description: "Completed and accepted." }
]);

const TEST_STEP_GROUP_KIND_OPTIONS = freezeOptions([
  { value: "local", label: "Local", description: "Scoped only to the current test case." },
  { value: "reusable", label: "Reusable", description: "Linked shared group reused across test cases." }
]);

const TEST_STEP_TYPE_OPTIONS = freezeOptions([
  { value: "web", label: "Web", description: "Browser-driven UI automation step." },
  { value: "api", label: "API", description: "HTTP request and response validation step." },
  { value: "android", label: "Android", description: "Android app automation step." },
  { value: "ios", label: "iOS", description: "iOS app automation step." }
]);

const TEST_DATA_SET_MODE_OPTIONS = freezeOptions([
  { value: "table", label: "Spreadsheet table", description: "Column-based row data set." },
  { value: "key_value", label: "Key / value", description: "Simple variable-style pairs." }
]);

const TEST_ENVIRONMENT_BROWSER_OPTIONS = freezeOptions([
  { value: "Chrome", label: "Chrome" },
  { value: "Firefox", label: "Firefox" },
  { value: "Safari", label: "Safari" },
  { value: "Edge", label: "Edge" },
  { value: "Mobile Chrome", label: "Mobile Chrome" },
  { value: "Mobile Safari", label: "Mobile Safari" }
]);

const TEST_ENVIRONMENT_MOBILE_OS_OPTIONS = freezeOptions([
  { value: "Android", label: "Android" },
  { value: "iOS", label: "iOS" }
]);

const EXECUTION_STATUS_OPTIONS = freezeOptions([
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "aborted", label: "Aborted" }
]);

const EXECUTION_FINAL_STATUS_OPTIONS = freezeOptions([
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "aborted", label: "Aborted" }
]);

const EXECUTION_RESULT_STATUS_OPTIONS = freezeOptions([
  { value: "running", label: "Running" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "blocked", label: "Blocked" }
]);

const EXECUTION_IMPACT_LEVEL_OPTIONS = freezeOptions([
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
]);

const FEEDBACK_STATUS_OPTIONS = freezeOptions([
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Reviewed" },
  { value: "planned", label: "Planned" },
  { value: "closed", label: "Closed" }
]);
const ISSUE_STATUS_OPTIONS = FEEDBACK_STATUS_OPTIONS;

const PRIORITY_SCALE = Object.freeze([1, 2, 3, 4, 5]);

const DOMAIN_METADATA = Object.freeze({
  app_types: {
    default_type: "web",
    types: APP_TYPE_OPTIONS
  },
  integrations: {
    default_type: "llm",
    types: INTEGRATION_TYPE_OPTIONS
  },
  requirements: {
    default_status: "open",
    statuses: REQUIREMENT_STATUS_OPTIONS,
    priority_scale: PRIORITY_SCALE
  },
  test_cases: {
    default_status: "active",
    default_automated: "no",
    statuses: TEST_CASE_STATUS_OPTIONS,
    automated_options: TEST_CASE_AUTOMATED_OPTIONS,
    priority_scale: PRIORITY_SCALE
  },
  test_steps: {
    group_kinds: TEST_STEP_GROUP_KIND_OPTIONS,
    types: TEST_STEP_TYPE_OPTIONS
  },
  test_data_sets: {
    default_mode: "table",
    modes: TEST_DATA_SET_MODE_OPTIONS
  },
  test_environments: {
    browsers: TEST_ENVIRONMENT_BROWSER_OPTIONS,
    mobile_os: TEST_ENVIRONMENT_MOBILE_OS_OPTIONS
  },
  executions: {
    statuses: EXECUTION_STATUS_OPTIONS,
    final_statuses: EXECUTION_FINAL_STATUS_OPTIONS,
    result_statuses: EXECUTION_RESULT_STATUS_OPTIONS,
    impact_levels: EXECUTION_IMPACT_LEVEL_OPTIONS
  },
  issues: {
    default_status: "open",
    statuses: ISSUE_STATUS_OPTIONS
  },
  feedback: {
    default_status: "open",
    statuses: ISSUE_STATUS_OPTIONS
  }
});

const cloneDomainMetadata = () => JSON.parse(JSON.stringify(DOMAIN_METADATA));

module.exports = {
  DOMAIN_METADATA,
  cloneDomainMetadata,
  APP_TYPE_OPTIONS,
  APP_TYPE_VALUES: optionValues(APP_TYPE_OPTIONS),
  INTEGRATION_TYPE_OPTIONS,
  INTEGRATION_TYPE_VALUES: optionValues(INTEGRATION_TYPE_OPTIONS),
  REQUIREMENT_STATUS_OPTIONS,
  REQUIREMENT_STATUS_VALUES: optionValues(REQUIREMENT_STATUS_OPTIONS),
  TEST_CASE_STATUS_OPTIONS,
  TEST_CASE_STATUS_VALUES: optionValues(TEST_CASE_STATUS_OPTIONS),
  TEST_CASE_AUTOMATED_OPTIONS,
  TEST_CASE_AUTOMATED_VALUES: optionValues(TEST_CASE_AUTOMATED_OPTIONS),
  TEST_STEP_GROUP_KIND_OPTIONS,
  TEST_STEP_GROUP_KIND_VALUES: optionValues(TEST_STEP_GROUP_KIND_OPTIONS),
  TEST_STEP_TYPE_OPTIONS,
  TEST_STEP_TYPE_VALUES: optionValues(TEST_STEP_TYPE_OPTIONS),
  TEST_DATA_SET_MODE_OPTIONS,
  TEST_DATA_SET_MODE_VALUES: optionValues(TEST_DATA_SET_MODE_OPTIONS),
  EXECUTION_STATUS_OPTIONS,
  EXECUTION_STATUS_VALUES: optionValues(EXECUTION_STATUS_OPTIONS),
  EXECUTION_FINAL_STATUS_OPTIONS,
  EXECUTION_FINAL_STATUS_VALUES: optionValues(EXECUTION_FINAL_STATUS_OPTIONS),
  EXECUTION_RESULT_STATUS_OPTIONS,
  EXECUTION_RESULT_STATUS_VALUES: optionValues(EXECUTION_RESULT_STATUS_OPTIONS),
  ISSUE_STATUS_OPTIONS,
  ISSUE_STATUS_VALUES: optionValues(ISSUE_STATUS_OPTIONS),
  FEEDBACK_STATUS_OPTIONS,
  FEEDBACK_STATUS_VALUES: optionValues(FEEDBACK_STATUS_OPTIONS),
  PRIORITY_SCALE
};
