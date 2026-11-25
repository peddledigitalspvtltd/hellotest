import type { StepApiRequest, TestStep, TestStepType } from "@hellotest/platform/frontend/src/types";
import { automationNumericArgument, automationParameterArgument, automationStringArgument, getAutomationKeywordInputSpec, parseAutomationKeywordCall } from "./automationKeywordInputs";
import { markExpressionParameterBindings, usesExpressionParameterBindings } from "../../shared/automationParameterMode.mjs";

type AutomationBehaviorKeyword = "Given" | "When" | "Then" | "And";
export type AutomationStepDraft = {
  parameterExpressions?: boolean;
  parameterArgumentSources?: { objectRef?: { value: string; source: string }; value?: { value: string; source: string } };
  step_type: TestStepType;
  behaviorKeyword: AutomationBehaviorKeyword;
  name: string;
  keyword: string;
  objectRef: string;
  value: string;
  expected_result: string;
  apiMethod: NonNullable<StepApiRequest["method"]>;
  apiHeaders: string;
  apiBodyMode: NonNullable<StepApiRequest["body_mode"]>;
  apiExpectedStatus: string;
};


export const AUTOMATION_KEYWORDS_BY_TYPE: Record<TestStepType, string[]> = {
  web: [
    "web.goto", "web.openTab", "web.switchTab", "web.closeTab", "web.reload", "web.goBack", "web.goForward",
    "web.click", "web.hover", "web.dblclick", "web.rightClick", "web.fill", "web.clear", "web.select",
    "web.check", "web.uncheck", "web.uploadFile", "web.uploadLocalFile", "web.uploadRemoteFile", "web.press",
    "web.drag", "web.scroll", "web.wait", "web.waitForLoadState", "web.waitForSelector", "web.expectVisible", "web.expectHidden", "web.expectText",
    "web.expectValue", "web.expectEnabled", "web.expectUrl", "web.text", "web.value", "web.captureText", "web.screenshot"
  ],
  // API runs execute a request contract, including its assertions and captures.
  // Standalone api.* source remains readable for legacy sections, but is not a
  // runnable action in the current worker.
  api: ["api.request"],
  android: [
    "android.tap", "android.tapByText", "android.tapPoint", "android.doubleTap", "android.longPress", "android.type",
    "android.clear", "android.hideKeyboard", "android.swipe", "android.scrollIntoView", "android.waitForDisplayed",
    "android.waitForExist", "android.waitForEnabled", "android.expectText", "android.expectDisplayed",
    "android.expectNotDisplayed", "android.expectEnabled", "android.expectValue", "android.captureText", "android.screenshot", "android.pushFile",
    "android.pushRemoteFile", "android.pullFile", "android.installApp", "android.removeApp", "android.startActivity",
    "android.openDeepLink", "android.pressBack", "android.pressKeyCode", "android.backgroundApp", "android.activateApp",
    "android.terminateApp", "android.setOrientation", "android.pause"
  ],
  ios: [
    "ios.tap", "ios.tapByText", "ios.tapPoint", "ios.doubleTap", "ios.longPress", "ios.type", "ios.clear",
    "ios.swipe", "ios.scrollIntoView", "ios.hideKeyboard", "ios.waitForDisplayed", "ios.waitForExist", "ios.waitForEnabled",
    "ios.expectDisplayed", "ios.expectNotDisplayed", "ios.expectText", "ios.expectEnabled", "ios.expectValue",
    "ios.captureText", "ios.screenshot", "ios.pushFile", "ios.pushRemoteFile", "ios.pullFile", "ios.installApp", "ios.removeApp",
    "ios.backgroundApp", "ios.activateApp", "ios.terminateApp", "ios.setOrientation", "ios.pause"
  ]
};

export const emptyAutomationStepDraft = (stepType: TestStepType = "web"): AutomationStepDraft => ({
  step_type: stepType,
  behaviorKeyword: stepType === "api" ? "When" : "When",
  name: "",
  keyword: AUTOMATION_KEYWORDS_BY_TYPE[stepType][0],
  objectRef: "",
  value: "",
  expected_result: "",
  apiMethod: "GET",
  apiHeaders: "",
  apiBodyMode: "none",
  apiExpectedStatus: ""
});




export function formatKeywordDisplay(keyword: string) {
  const [namespace, action] = keyword.split(".");
  if (!namespace || !action) {
    return keyword;
  }
  return `${namespace.charAt(0).toUpperCase()}${namespace.slice(1)}.${action}`;
}

function formatObjectReferenceLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "No locator selected";
  }
  const parts = trimmed.split(".");
  return parts.length > 1 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : trimmed;
}

function formatAutomationKeywordReadable(draft: AutomationStepDraft, variables: string[] = []) {
  const keyword = formatKeywordDisplay(draft.keyword);
  const target = formatObjectReferenceLabel(draft.objectRef);
  const dataReference = draft.value.trim() || variables.find((variable) => variable.startsWith("t.") || variable.startsWith("s.") || variable.startsWith("r."));
  return `${keyword} ${target}${dataReference ? ` using @${dataReference.replace(/^@/, "")}` : ""}`;
}


export function parseAutomationStepDraft(step: TestStep): AutomationStepDraft {
  const code = step.automation_code || "";
  const call = parseAutomationKeywordCall(code);
  // The stored runtime owns execution. Only an unimplemented legacy Web row
  // with a canonical API request is eligible for inference, as on the backend.
  const savedType = step.step_type || "web";
  const stepType = savedType === "web" && !code.trim() && step.api_request?.url?.trim() ? "api" : savedType;
  const parsedKeyword = stepType === "ios" ? call?.keyword.replace(/^(?:mobile|android)\./, "ios.") : call?.keyword;
  const keyword = parsedKeyword && (AUTOMATION_KEYWORDS_BY_TYPE[stepType].includes(parsedKeyword)
    || stepType === "api" && ["api.expectStatus", "api.expectJson", "api.capture"].includes(parsedKeyword))
    ? parsedKeyword
    : AUTOMATION_KEYWORDS_BY_TYPE[stepType][0];
  const args = call?.args || [];
  const argumentSources = call?.argumentSources || [];
  const parameterExpressions = usesExpressionParameterBindings(code);
  const actionText = (step.action || "").trim();
  const behaviorMatch = actionText.match(/^(Given|When|Then|And)\s+(.+)$/i);
  const inferredBehavior: AutomationBehaviorKeyword = /(?:expect|assert|verify|capture|screenshot)/i.test(keyword)
    ? "Then"
    : /(?:goto|open|wait|background|activate)/i.test(keyword) ? "Given" : "When";
  const apiRequest = stepType === "api" ? step.api_request || null : null;
  const parsedApiTarget = args[0]?.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  let objectRef = apiRequest?.url || parsedApiTarget?.[2] || args[0] || "";
  let value = apiRequest?.body || args[1] || "";
  let objectSource: string | undefined = argumentSources[0], valueSource: string | undefined = argumentSources[1];
  if (["web.wait", "web.waitForLoadState", "web.expectUrl"].includes(keyword) || (keyword === "web.expectText" && args.length === 1)) {
    objectRef = "";
    value = args[0] || "";
    objectSource = undefined; valueSource = argumentSources[0];
  } else if (keyword === "web.scroll") {
    const x = Number(args[0] || 0);
    const y = Number(args[1] || 0);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      objectRef = x ? x < 0 ? "left" : "right" : y < 0 ? "up" : "down";
      value = String(Math.abs(x || y));
    } else if (/^-?@/.test(args[0] || "") || /^-?@/.test(args[1] || "")) {
      const horizontal = /^-?@/.test(args[0] || "");
      const distance = args[horizontal ? 0 : 1];
      objectRef = horizontal ? distance.startsWith("-") ? "left" : "right" : distance.startsWith("-") ? "up" : "down";
      value = distance.replace(/^-/, "");
    }
  } else if (/^(?:android|ios|mobile)\.swipe$/.test(keyword)) {
    objectRef = args.slice(0, 2).join(",");
    value = args.slice(2, 5).join(",");
  }

  return {
    ...(parameterExpressions ? { parameterExpressions: true, parameterArgumentSources: {
      ...(objectSource ? { objectRef: {value: objectRef, source: objectSource} } : {}),
      ...(valueSource ? { value: {value, source: valueSource} } : {})
    } } : {}),
    step_type: stepType,
    behaviorKeyword: behaviorMatch ? `${behaviorMatch[1][0].toUpperCase()}${behaviorMatch[1].slice(1).toLowerCase()}` as AutomationBehaviorKeyword : inferredBehavior,
    name: behaviorMatch?.[2] || actionText,
    keyword,
    objectRef,
    value,
    expected_result: step.expected_result || "",
    apiMethod: apiRequest?.method || (parsedApiTarget?.[1]?.toUpperCase() as NonNullable<StepApiRequest["method"]> | undefined) || "GET",
    apiHeaders: (apiRequest?.headers || []).map((header) => `${header.key}: ${header.value}`).join("\n"),
    apiBodyMode: apiRequest?.body_mode || (apiRequest?.body ? "json" : "none"),
    apiExpectedStatus: String(apiRequest?.validations?.find((validation) => validation.kind === "status")?.expected || "")
  };
}

export function buildAutomationStepAction(draft: AutomationStepDraft) {
  const description = (draft.name.trim() || formatAutomationKeywordReadable(draft)).replace(/^(Given|When|Then|And)\s+/i, "");
  return description;
}

function parseApiHeaderDraft(value: string) {
  return value
    .split("\n")
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 1) return null;
      const key = line.slice(0, separatorIndex).trim();
      const headerValue = line.slice(separatorIndex + 1).trim();
      return key ? { key, value: headerValue } : null;
    })
    .filter((header): header is { key: string; value: string } => Boolean(header));
}

export function buildAutomationApiRequest(draft: AutomationStepDraft, existing?: StepApiRequest | null): StepApiRequest | null {
  if (draft.step_type !== "api" || draft.keyword !== "api.request") return null;
  // Keep exact scoped bindings and invalid authored strings intact: the
  // request validator can explain an invalid value instead of silently
  // truncating it to a different assertion or removing the check.
  const expectedStatus = draft.apiExpectedStatus.trim();
  const existingStatus = existing?.validations?.find((item) => item.kind === "status");
  const statusUnchanged = Boolean(existing) && String(existingStatus?.expected ?? "") === draft.apiExpectedStatus.trim();
  return {
    ...existing,
    method: draft.apiMethod,
    url: draft.objectRef.trim(),
    headers: parseApiHeaderDraft(draft.apiHeaders),
    body_mode: draft.apiBodyMode,
    body: draft.apiBodyMode === "none" ? null : draft.value,
    timeout_ms: existing?.timeout_ms ?? 30_000,
    follow_redirects: existing?.follow_redirects ?? true,
    validations: statusUnchanged ? existing?.validations || [] : [...(existing?.validations || []).filter((item) => item.kind !== "status"), ...(expectedStatus
      ? [{ kind: "status" as const, expected: expectedStatus }]
      : [])]
  };
}

export function buildAutomationCodeFromDraft(draft: AutomationStepDraft) {
  const parameterExpressions = draft.parameterExpressions === true;
  const q = (value: string, field?: "objectRef" | "value") => {
    const original = field && draft.parameterArgumentSources?.[field];
    if (parameterExpressions && original && original.value === value) return original.source;
    if(field === "value" && /(?:captureText|captureValue|^api\.capture)$/.test(draft.keyword))return JSON.stringify(value);
    return automationStringArgument(value, parameterExpressions);
  };
  const build = () => {
  const objectRef = draft.objectRef.trim();
  const targetRef = objectRef;
  const value = parameterExpressions ? draft.value : draft.value.trim();
  if (draft.keyword.startsWith("api.")) {
    if (draft.keyword === "api.expectStatus") {
      return `await api.expectStatus(${automationNumericArgument(objectRef, 200)});`;
    }
    if (draft.keyword === "api.expectJson") {
      return `await api.expectJson(${q(targetRef, "objectRef")}, ${q(value, "value")});`;
    }
    if (draft.keyword === "api.capture") {
      return `await api.capture(${q(targetRef, "objectRef")}, ${JSON.stringify(value)});`;
    }
    return `await api.request(${q(`${draft.apiMethod} ${objectRef || "/"}`)}${value ? `, ${q(value, "value")}` : ""});`;
  }
  if (/^(?:android|ios|mobile)\./.test(draft.keyword)) {
    const nativePrefix = draft.step_type === "ios" ? "ios" : "android";
    const keyword = draft.keyword.replace(/^(?:mobile|ios)\./, "android.");
    if (["android.hideKeyboard", "android.pressBack", "android.screenshot"].includes(keyword)) return `await ${keyword.replace(/^android/, nativePrefix)}();`;
    if (keyword === "android.aiStep") return `await ${nativePrefix}.aiStep(${q(value, "value")}, ${objectRef ? `{ selector: ${q(objectRef, "objectRef")} }` : "{}"});`;
    if (["android.type", "android.select", "android.press", "android.expectText", "android.expectValue", "android.captureText", "android.captureValue", "android.pushFile", "android.pushRemoteFile", "android.startActivity", "android.openDeepLink", "android.deepLink"].includes(keyword)) {
      return `await ${keyword.replace(/^android/, nativePrefix)}(${q(targetRef, "objectRef")}, ${q(value, "value")});`;
    }
    if (keyword === "android.drag") {
      return `await ${nativePrefix}.drag(${q(targetRef, "objectRef")}, ${q(value, "value")});`;
    }
    if (["android.longPress", "android.waitForDisplayed", "android.waitForExist", "android.waitForEnabled", "android.expectNotDisplayed"].includes(keyword)) {
      return `await ${keyword.replace(/^android/, nativePrefix)}(${q(targetRef, "objectRef")}, ${automationNumericArgument(value, keyword === "android.longPress" ? 800 : 10000)});`;
    }
    if (keyword === "android.swipe") {
      const points = `${objectRef},${value}`.split(",");
      return `await ${nativePrefix}.swipe(${[0, 1, 2, 3, 4].map((index) => automationNumericArgument(points[index] || "", index === 4 ? 300 : 0)).join(", ")});`;
    }
    if (keyword === "android.scrollIntoView") return `await ${nativePrefix}.scrollIntoView(${q(targetRef, "objectRef")}, { direction: ${q(value || "down")} });`;
    if (keyword === "android.pause" || keyword === "android.pressKeyCode" || keyword === "android.backgroundApp") {
      return `await ${keyword.replace(/^android/, nativePrefix)}(${automationNumericArgument(objectRef, keyword === "android.pressKeyCode" ? 66 : keyword === "android.backgroundApp" ? 3 : 1000)});`;
    }
    return `await ${keyword.replace(/^android/, nativePrefix)}(${q(targetRef, "objectRef")});`;
  }
  if (draft.keyword === "web.aiStep") return `await web.aiStep(${q(value, "value")}, ${objectRef ? `{ target: ${q(objectRef, "objectRef")} }` : "{}"});`;
  if (draft.keyword === "web.goto") return `await web.goto(${q(objectRef, "objectRef")});`;
  if (draft.keyword === "web.expectUrl") return `await web.expectUrl(${q(value, "value")});`;
  if (draft.keyword === "web.openTab") return objectRef ? `await web.openTab(${q(objectRef, "objectRef")});` : "await web.openTab();";
  if (draft.keyword === "web.wait" || draft.keyword === "web.waitForTimeout") {
    return `await web.wait(${automationNumericArgument(value, 1000)});`;
  }
  if (draft.keyword === "web.waitForLoadState") {
    return `await web.waitForLoadState(${automationParameterArgument(value) || q(value || "domcontentloaded")});`;
  }
  if (draft.keyword === "web.waitForSelector") {
    return `await web.waitForSelector(${q(targetRef, "objectRef")}, ${automationParameterArgument(value) || q(/^(attached|detached|visible|hidden)$/i.test(value) ? value.toLowerCase() : "visible", "value")});`;
  }
  if (draft.keyword === "web.scroll") {
    const parameterDirection = automationParameterArgument(objectRef);
    if (parameterDirection) return `{ const direction = String(${parameterDirection}).toLowerCase(); const amount = ${automationNumericArgument(value, 600)}; await web.scroll(direction === "left" ? -amount : direction === "right" ? amount : 0, direction === "up" ? -amount : direction === "down" ? amount : 0); }`;
    const direction = /^(up|down|left|right)$/i.test(objectRef) ? objectRef.toLowerCase() : "down";
    const amount = automationNumericArgument(value, 600);
    const signedAmount = direction === "up" || direction === "left" ? `-(${amount})` : amount;
    return `await web.scroll(${direction === "left" || direction === "right" ? `${signedAmount}, 0` : `0, ${signedAmount}`});`;
  }
  if (draft.keyword === "web.drag") {
    return `await web.drag(${q(targetRef, "objectRef")}, ${q(value, "value")});`;
  }
  if (draft.keyword === "web.press") {
    return objectRef
      ? `await web.press(${q(objectRef, "objectRef")}, ${q(value, "value")});`
      : `await web.press(null, ${q(value, "value")});`;
  }
  if (["web.uploadFile", "web.uploadLocalFile"].includes(draft.keyword)) {
    return `await ${draft.keyword}(${q(targetRef, "objectRef")}, ${q(value, "value")}, { waitFor: "attached" });`;
  }
  if (draft.keyword === "web.uploadRemoteFile") {
    return `await web.uploadRemoteFile(${q(targetRef, "objectRef")}, ${q(value, "value")}, { waitFor: "attached" });`;
  }
  if (draft.keyword === "web.expectText" && !objectRef) return `await web.expectText(${q(value, "value")});`;
  if (["web.fill", "web.select", "web.expectText", "web.expectValue", "web.captureText"].includes(draft.keyword)) {
    return `await ${draft.keyword}(${q(targetRef, "objectRef")}, ${q(value, "value")});`;
  }
  if (draft.keyword === "web.screenshot") {
    return 'await web.screenshot("automation-step");';
  }
  if (["web.switchTab", "web.closeTab"].includes(draft.keyword)) {
    return objectRef ? `await ${draft.keyword}(${q(objectRef, "objectRef")});` : `await ${draft.keyword}();`;
  }
  if (getAutomationKeywordInputSpec(draft.keyword).target === "none" && !getAutomationKeywordInputSpec(draft.keyword).showValue) return `await ${draft.keyword}();`;
  return `await ${draft.keyword}(${q(targetRef, "objectRef")});`;
  };
  const source = build();
  return parameterExpressions ? markExpressionParameterBindings(source) : source;
}

