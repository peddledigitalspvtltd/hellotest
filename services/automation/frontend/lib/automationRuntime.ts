import type { AutomationCaseType, TestStepType } from "@hellotest/platform/frontend/src/types";

export const AUTOMATION_RUNTIMES: Record<TestStepType, { label: string; engine: string; authoring: string; target: string; evidence: string; agent: string }> = {
  web: { label: "Web", engine: "Playwright", authoring: "Keywords, JavaScript or browser recording", target: "Environment URL and browser configuration", evidence: "Awaited operations, screenshots, trace and video per run policy", agent: "The automation agent can inspect the browser through MCP, then build code from your steps and stories." },
  api: { label: "API", engine: "HTTP request runner", authoring: "Requests, assertions and response captures", target: "Base URL, headers and scoped test data", evidence: "Request, response, duration and each assertion", agent: "The automation agent generates structured requests and assertions from your steps and supplied API context." },
  android: { label: "Android", engine: "Appium · UiAutomator2", authoring: "Native keywords, driver code or device recording", target: "Appium connection, Android device and app", evidence: "Step outcomes, captures and failure screenshots per run policy", agent: "The automation agent uses your native locators and recordings to generate driver code. Browser MCP cannot inspect a native app." },
  ios: { label: "iOS", engine: "Appium · XCUITest", authoring: "Native keywords, driver code or device recording", target: "XCUITest host or device cloud, iOS device and app", evidence: "Step outcomes, captures and failure screenshots per run policy", agent: "The automation agent uses your native locators and recordings to generate driver code. Browser MCP cannot inspect a native app." }
};

export function getAutomationRuntimeTypes(steps: Array<{ step_type?: string | null }>, fallback = "web"): TestStepType[] {
  const types = [...new Set(steps.map((step) => step.step_type).filter((type): type is TestStepType => Boolean(type && Object.prototype.hasOwnProperty.call(AUTOMATION_RUNTIMES, type))))];
  return types.length ? types : [Object.prototype.hasOwnProperty.call(AUTOMATION_RUNTIMES, fallback) ? fallback as TestStepType : "web"];
}

/** Build-time inference leaves saved executable sources and recorder behavior intact. */
export function inferAutomationBuildRuntime(step: {step_type?:string|null;action?:string|null;automation_code?:string|null;api_request?:{url?:string|null}|null}, appTypeKind = "web"): TestStepType {
  const saved = Object.prototype.hasOwnProperty.call(AUTOMATION_RUNTIMES, step.step_type || "") ? step.step_type as TestStepType : "web";
  if (saved !== "web" || step.automation_code?.trim()) return saved;
  if (step.api_request?.url || appTypeKind === "api") return "api";
  const action = String(step.action || "").replace(/<[^>]+>/g," ").trim().replace(/^(?:Given|When|Then|And|But)\s+/i, "").replace(/^(?:I|we|the client)\s+/i, "");
  if (/^(?:click|tap|type|fill|enter|select|navigate|browse|open|visit|hover|scroll)\b/i.test(action)) return saved;
  return /^(?:(?:send|call|execute|perform|issue|make|invoke)\s+(?:(?:an?|the)\s+)?(?:(?:HTTP|API)\s+)?(?:request\s+)?(?:to\s+)?)?(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?:(?:HTTP|API)\s+)?(?:request\s+)?(?:to\s+)?(?:https?:\/\/|\/|@[a-z][\w.\[\]-]*|\{\{)/i.test(action)
    || /^(?:send|call|execute|perform|issue|make|invoke)\b.*\b(?:API|HTTP)\s+(?:request|endpoint|call)\b/i.test(action) ? "api" : saved;
}

export function getAutomationBuildRuntimeTypes(steps: Parameters<typeof inferAutomationBuildRuntime>[0][], fallback = "web"): TestStepType[] {
  return steps.length ? [...new Set(steps.map(step=>inferAutomationBuildRuntime(step,fallback)))] : getAutomationRuntimeTypes([],fallback);
}

export function getDefaultAutomationStepType(steps: Array<{ step_type?: string | null }>, fallback = "web"): TestStepType {
  if (Object.prototype.hasOwnProperty.call(AUTOMATION_RUNTIMES, fallback)) return fallback as TestStepType;
  const types = getAutomationRuntimeTypes(steps, fallback);
  return types.find((type) => type !== "api") || types[0];
}

export function getRecorderPlatform(steps: Array<{ id: string; step_type?: string | null }>, targetStepId: string, fallback = "web") {
  const selected = targetStepId ? steps.filter((step) => step.id === targetStepId) : steps;
  const types = getAutomationRuntimeTypes(selected, fallback);
  // API setup does not turn a native case into a browser recording session.
  const recordableTypes = types.filter((type) => type !== "api");
  return recordableTypes.length === 0 ? "api" : recordableTypes.length === 1 ? recordableTypes[0] : "unified" as const;
}

/** Platform is a saved authoring constraint; functional Test Case category is separate. */
export const AUTOMATION_CASE_TYPES: Array<{value: AutomationCaseType; label: string; description: string}> = [
  {value: "web", label: "Web", description: "Web browser steps and API requests."},
  {value: "api", label: "API", description: "API requests, assertions and response captures."},
  {value: "android", label: "Android", description: "Android device steps and API requests."},
  {value: "ios", label: "iOS", description: "iOS device steps and API requests."},
  {value: "unified", label: "Unified", description: "A flow spanning browsers, devices and API requests."}
];

export function getAllowedAutomationStepTypes(caseType: AutomationCaseType | "", mobileEnabled = true): TestStepType[] {
  const types: TestStepType[] = caseType === "unified" ? ["web", "api", "android", "ios"]
    : caseType === "web" ? ["web", "api"] : caseType === "android" ? ["android", "api"]
    : caseType === "ios" ? ["ios", "api"] : caseType === "api" ? ["api"] : [];
  return mobileEnabled ? types : types.filter(type => type !== "android" && type !== "ios");
}

/** Legacy records acquire a displayed platform from the plan, without rewriting it. */
export function resolveAutomationCaseType(testCase: { automation_case_type?: string | null; test_data_options?: { automation_case_type?: string | null } } | null | undefined, steps: Parameters<typeof getAutomationBuildRuntimeTypes>[0], fallback = "web"): AutomationCaseType {
  const saved = testCase?.automation_case_type || testCase?.test_data_options?.automation_case_type;
  if (AUTOMATION_CASE_TYPES.some(type => type.value === saved)) return saved as AutomationCaseType;
  if (!steps.length && AUTOMATION_CASE_TYPES.some(type => type.value === fallback)) return fallback as AutomationCaseType;
  const runtimes = getAutomationBuildRuntimeTypes(steps, fallback);
  const targets = runtimes.filter(type => type !== "api");
  if (targets.length > 1) return "unified";
  if (targets.length === 1) return targets[0];
  return runtimes[0] || "web";
}

export function incompatibleAutomationRuntimes(caseType: AutomationCaseType | "", steps: Parameters<typeof getAutomationBuildRuntimeTypes>[0]): TestStepType[] {
  if (!caseType || !steps.length) return [];
  const allowed = getAllowedAutomationStepTypes(caseType);
  return getAutomationBuildRuntimeTypes(steps).filter(type => !allowed.includes(type));
}
