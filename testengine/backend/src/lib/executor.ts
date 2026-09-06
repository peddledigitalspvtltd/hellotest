import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EngineApiRequest,
  EngineCallbackPayload,
  EngineCaseResultPayload,
  EngineRunEnvelope,
  EngineRunHook,
  EngineRunRecord,
  EngineRunState,
  EngineStepOutcome,
  EngineStepOutcomeStatus,
  HelloTestExecutionStepAutomationDetail,
  HelloTestExecutionStepWebDetail
} from "../contracts/hellotest.js";
import { saveRun, updateRun } from "./runStore.js";
import { createWebRunSession } from "./webEngine.js";
import { materializeTemplateValue } from "./runtimeContext.js";
import { decodeParameterColumnName, normalizeParameterReferenceKey, STEP_PARAMETER_PATTERN } from "./stepParameterReferences.js";

type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
};

type ExecutionContext = {
  values: Record<string, string>;
};

type ApiStepExecutionResult = {
  outcome: EngineStepOutcome;
  summary: {
    step_id: string;
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
    assertions: Array<{ kind: string; passed: boolean; target?: string | null; expected?: string | null; actual?: string | null }>;
  };
  automation_detail?: HelloTestExecutionStepAutomationDetail;
  captures: Record<string, string>;
  recovery_attempted: boolean;
  recovery_succeeded: boolean;
};

type ExecutedEngineStepResult = {
  outcome: EngineStepOutcome;
  summary?: ApiStepExecutionResult["summary"];
  web_detail?: HelloTestExecutionStepWebDetail;
  automation_detail?: HelloTestExecutionStepAutomationDetail;
  captures: Record<string, string>;
  recovery_attempted: boolean;
  recovery_succeeded: boolean;
};

type EngineCaseLogsPayload = {
  stepStatuses: Record<string, "passed" | "failed" | "blocked">;
  stepNotes: Record<string, string>;
  stepEvidence: Record<string, { dataUrl: string; fileName?: string; mimeType?: string }>;
  stepApiDetails: Record<string, ApiStepExecutionResult["summary"]>;
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail>;
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail>;
  stepCaptures: Record<string, Record<string, string>>;
};

const GENERATED_CONTEXT_ALIASES: Record<string, string> = {
  "t.random": "{{randomString:3}}",
  random: "{{randomString:3}}",
  "t.randomstring": "{{randomString:8}}",
  randomstring: "{{randomString:8}}",
  "t.randomnumber": "{{randomNumber:6}}",
  randomnumber: "{{randomNumber:6}}",
  "t.yopmail": "{{yopmail}}",
  yopmail: "{{yopmail}}",
  "t.today": "{{date:YYYY-MM-DD}}",
  today: "{{date:YYYY-MM-DD}}",
  "t.timestamp": "{{date:ISO}}",
  timestamp: "{{date:ISO}}"
};
const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT || "/artifacts";

const normalizeText = (value?: string | null) => {
  const normalized = String(value || "").trim();
  return normalized || "";
};

const normalizeOptionalText = (value?: string | null) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const nowIso = () => new Date().toISOString();

const truncateText = (value: string, maxLength = 420) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

const stringifyValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const stringifyError = (error: unknown, fallback = "Step execution failed.") => {
  if (error instanceof Error) {
    return [error.message || fallback, error.stack ? `Stack:\n${error.stack}` : ""].filter(Boolean).join("\n");
  }

  return String(error || fallback);
};

const parseExpectedLiteral = (value?: string | null) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  if (normalized === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  if (/^[\[{"]/.test(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return normalized;
    }
  }

  return normalized;
};

const normalizeKey = (value: string) => normalizeParameterReferenceKey(value);

const registerContextValue = (context: ExecutionContext, key: string, value: unknown) => {
  const normalizedKey = normalizeKey(key);

  if (!normalizedKey) {
    return;
  }

  const normalizedValue = stringifyValue(value);
  context.values[normalizedKey] = normalizedValue;

  if (!normalizedKey.includes(".")) {
    context.values[`t.${normalizedKey}`] = normalizedValue;
  }
};

const buildInitialContext = (envelope: EngineRunEnvelope): ExecutionContext => {
  const context: ExecutionContext = {
    values: Object.entries(GENERATED_CONTEXT_ALIASES).reduce<Record<string, string>>((values, [key, template]) => {
      values[key] = materializeTemplateValue(template);
      return values;
    }, {})
  };

  Object.entries(envelope.suite_parameters || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
      return;
    }
    context.values[`s.${normalizedKey.replace(/^s\./, "")}`] = materializeTemplateValue(value);
  });

  Object.entries(envelope.case_parameters || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
      return;
    }
    context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(value);
  });

  Object.entries(envelope.manual_spec?.test_data || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
      return;
    }
    context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(value);
  });

  (envelope.environment?.variables || []).forEach((entry) => {
    if (!entry?.key) {
      return;
    }
    context.values[`r.${normalizeKey(entry.key).replace(/^r\./, "")}`] = materializeTemplateValue(entry.value);
  });

  (envelope.configuration?.variables || []).forEach((entry) => {
    if (!entry?.key) {
      return;
    }
    context.values[`r.${normalizeKey(entry.key).replace(/^r\./, "")}`] = materializeTemplateValue(entry.value);
  });

  const dataSetRows = Array.isArray(envelope.data_set?.rows)
    ? envelope.data_set?.rows
    : envelope.data_set?.template_rows || [];

  if (envelope.data_set?.mode === "key_value") {
    dataSetRows.forEach((row) => {
      const normalizedKey = normalizeKey(row.key);
      if (!normalizedKey) {
        return;
      }
      context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(row.value);
    });
  } else if (Array.isArray(dataSetRows) && dataSetRows.length) {
    Object.entries(dataSetRows[0] || {}).forEach(([key, value]) => {
      context.values[`t.${normalizeKey(key).replace(/^t\./, "")}`] = materializeTemplateValue(value);
    });
  }

  if (envelope.data_set?.source === "test_case") {
    Object.entries(envelope.case_parameters || {}).forEach(([key, value]) => {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey) {
        return;
      }
      context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(value);
    });
  }

  return context;
};

const resolveContextValue = (context: ExecutionContext, scopedKey: string, fallbackScope = "t") => {
  const normalizedKey = normalizeKey(scopedKey);

  if (!normalizedKey) {
    return "";
  }

  if (context.values[normalizedKey] !== undefined && !(GENERATED_CONTEXT_ALIASES[normalizedKey] && context.values[normalizedKey] === "")) {
    return context.values[normalizedKey];
  }

  if (!normalizedKey.includes(".")) {
    const direct = context.values[`${fallbackScope}.${normalizedKey}`];
    if (direct !== undefined) {
      return direct;
    }

    const suite = context.values[`s.${normalizedKey}`];
    if (suite !== undefined) {
      return suite;
    }

    const run = context.values[`r.${normalizedKey}`];
    if (run !== undefined) {
      return run;
    }
  }

  if (GENERATED_CONTEXT_ALIASES[normalizedKey]) {
    return materializeTemplateValue(GENERATED_CONTEXT_ALIASES[normalizedKey]);
  }

  return "";
};

const interpolateText = (value: string | null | undefined, context: ExecutionContext) =>
  String(value || "").replace(STEP_PARAMETER_PATTERN, (token, scope, referenceName, offset, source) => {
    if (!scope && /^[tsr]$/i.test(referenceName) && source[offset + token.length] === ".") return token;
    const rawName = referenceName.startsWith("[") ? decodeParameterColumnName(referenceName.slice(1, -1)) : referenceName;
    const normalizedKey = scope ? `${String(scope).toLowerCase()}.${String(rawName).toLowerCase()}` : String(rawName).toLowerCase();
    return resolveContextValue(context, normalizedKey, scope ? String(scope).toLowerCase() : "t");
  });

const interpolateHeaders = (
  headers: EngineApiRequest["headers"],
  context: ExecutionContext
) =>
  (headers || []).reduce<Record<string, string>>((accumulator, header) => {
    const key = interpolateText(header?.key || "", context).trim();

    if (!key) {
      return accumulator;
    }

    accumulator[key] = interpolateText(header?.value || "", context);
    return accumulator;
  }, {});

const mapHeaders = (headers: Headers) => {
  const values: Record<string, string> = {};
  headers.forEach((value, key) => {
    values[key] = value;
  });
  return values;
};

const parseResponseJson = (bodyText: string, contentType?: string | null) => {
  const normalizedBody = bodyText.trim();

  if (!normalizedBody) {
    return null;
  }

  const looksLikeJson = String(contentType || "").toLowerCase().includes("json")
    || normalizedBody.startsWith("{")
    || normalizedBody.startsWith("[");

  if (!looksLikeJson) {
    return null;
  }

  try {
    return JSON.parse(normalizedBody);
  } catch {
    return null;
  }
};

const buildResponsePreview = (bodyText: string, json: unknown) => {
  if (json !== null && json !== undefined) {
    return truncateText(stringifyValue(json));
  }

  return truncateText(bodyText);
};

const readJsonPath = (source: unknown, rawPath?: string | null) => {
  if (source === null || source === undefined) {
    return undefined;
  }

  const normalizedPath = normalizeText(rawPath || "$");

  if (!normalizedPath || normalizedPath === "$") {
    return source;
  }

  const pathWithoutRoot = normalizedPath.replace(/^\$\.?/, "");

  if (!pathWithoutRoot) {
    return source;
  }

  const segments = pathWithoutRoot
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let cursor: unknown = source;

  for (const segment of segments) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }

    if (Array.isArray(cursor)) {
      const index = Number(segment);
      cursor = Number.isInteger(index) ? cursor[index] : undefined;
      continue;
    }

    if (typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[segment];
      continue;
    }

    return undefined;
  }

  return cursor;
};

const buildApiEvidenceDataUrl = ({
  status,
  title,
  url,
  method,
  captureLines
}: {
  status: EngineStepOutcomeStatus;
  title: string;
  url: string;
  method: string;
  captureLines: string[];
}) => {
  const bg = status === "passed" ? "#dff7ec" : status === "failed" ? "#ffe6ea" : "#eef2ff";
  const accent = status === "passed" ? "#0f9d6c" : status === "failed" ? "#cd3658" : "#5b6fd8";
  const lines = [
    `${method} ${url}`,
    title,
    ...captureLines.slice(0, 3)
  ];

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220">`,
    `<rect width="900" height="220" rx="22" fill="${bg}"/>`,
    `<rect x="28" y="28" width="844" height="164" rx="18" fill="#ffffff" stroke="${accent}" stroke-width="4"/>`,
    `<text x="52" y="72" font-size="28" font-family="Arial, sans-serif" fill="${accent}" font-weight="700">${status.toUpperCase()}</text>`,
    ...lines.map((line, index) =>
      `<text x="52" y="${112 + index * 28}" font-size="${index === 0 ? 22 : 18}" font-family="Arial, sans-serif" fill="#16324f">${escapeXml(line)}</text>`
    ),
    `</svg>`
  ].join("");

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildCallbackSignature = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

const writeArtifactFile = async (relativePath: string | null | undefined, content: string) => {
  if (!relativePath) {
    return null;
  }

  const fullPath = path.join(ARTIFACT_ROOT, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
  return fullPath;
};

const emitCallback = async (envelope: EngineRunEnvelope, payload: EngineCallbackPayload) => {
  if (!envelope.callback?.url || !envelope.callback?.signing_secret) {
    throw new Error("This run does not include a HelloTest callback target.");
  }

  const serialized = JSON.stringify(payload);
  const signature = buildCallbackSignature(envelope.callback.signing_secret, serialized);

  const response = await fetch(envelope.callback.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-testengine-signature": signature
    },
    body: serialized
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HelloTest callback failed with status ${response.status}`);
  }
};

const persistRunSummary = async (
  run: EngineRunRecord,
  summary: {
    execution: {
      started_at: string;
      ended_at: string;
      status: EngineStepOutcomeStatus;
      summary: string;
    };
    steps: ApiStepExecutionResult["summary"][];
    captured_values: Record<string, string>;
  }
) => {
  await writeArtifactFile(run.artifact_bundle.summary_path, JSON.stringify(summary, null, 2));
};

const buildStepApiDetailMap = (stepSummaries: ApiStepExecutionResult["summary"][] = []) =>
  stepSummaries.reduce<Record<string, ApiStepExecutionResult["summary"]>>((accumulator, summary) => {
    if (!summary?.step_id) {
      return accumulator;
    }

    accumulator[summary.step_id] = summary;
    return accumulator;
  }, {});

const buildLogsPayload = (
  stepOutcomes: EngineStepOutcome[],
  stepSummaries: ApiStepExecutionResult["summary"][] = [],
  stepCaptures: Record<string, Record<string, string>> = {},
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail> = {},
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail> = {}
) =>
  stepOutcomes.reduce<EngineCaseLogsPayload>(
    (accumulator, outcome) => {
      if (outcome.status === "passed" || outcome.status === "failed" || outcome.status === "blocked") {
        accumulator.stepStatuses[outcome.step_id] = outcome.status;
      }

      if (outcome.note) {
        accumulator.stepNotes[outcome.step_id] = outcome.note;
      }

      if (outcome.evidence_image?.data_url) {
        accumulator.stepEvidence[outcome.step_id] = {
          dataUrl: outcome.evidence_image.data_url,
          fileName: outcome.evidence_image.file_name || undefined,
          mimeType: outcome.evidence_image.mime_type || undefined
        };
      }

      return accumulator;
    },
    {
      stepStatuses: {},
      stepNotes: {},
      stepEvidence: {},
      stepApiDetails: buildStepApiDetailMap(stepSummaries),
      stepWebDetails: { ...stepWebDetails },
      stepAutomationDetails: { ...stepAutomationDetails },
      stepCaptures: Object.entries(stepCaptures).reduce<Record<string, Record<string, string>>>((accumulator, [stepId, captures]) => {
        accumulator[stepId] = { ...captures };
        return accumulator;
      }, {})
    }
  );

const mergeArtifactBundle = (
  base: EngineRunRecord["artifact_bundle"],
  patch: Partial<EngineRunRecord["artifact_bundle"]> | undefined
) => {
  if (!patch || !Object.keys(patch).length) {
    return base;
  }
  const mergedRefs = [
    ...(base.artifact_refs || []),
    ...(patch.artifact_refs || [])
  ].reduce<NonNullable<EngineRunRecord["artifact_bundle"]["artifact_refs"]>>((items, ref) => {
    const key = `${ref.kind || ""}:${ref.path || ""}:${ref.file_name || ""}`;
    const existingIndex = items.findIndex((item) => `${item.kind || ""}:${item.path || ""}:${item.file_name || ""}` === key);

    if (existingIndex >= 0) {
      items[existingIndex] = ref;
      return items;
    }

    items.push(ref);
    return items;
  }, []);

  return {
    ...base,
    ...patch,
    artifact_refs: mergedRefs
  };
};

const syncCapturedValues = (context: ExecutionContext | { values: Record<string, string> }, captures: Record<string, string>) => {
  Object.entries(captures || {}).forEach(([key, value]) => {
    registerContextValue(context, key, value);
  });
};

const summarizeAssertionProgress = (
  assertions: Array<{ passed: boolean }>
) => `${assertions.filter((assertion) => assertion.passed).length}/${assertions.length} assertions passed`;

const buildStepAutomationDetail = ({
  step,
  status,
  provider,
  startedAt,
  endedAt,
  errorMessage
}: {
  step: EngineRunEnvelope["steps"][number];
  status: HelloTestExecutionStepAutomationDetail["status"];
  provider?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  errorMessage?: string | null;
}): HelloTestExecutionStepAutomationDetail => {
  const code =
    normalizeText(step.automation_code)
    || (step.step_type === "api" ? JSON.stringify(step.api_request || {}, null, 2) : "")
    || step.action
    || "";
  const reportedLine = errorMessage?.match(/Code line:\s*(\d+)/i)?.[1];
  const errorLine = reportedLine
    ? Number.parseInt(reportedLine, 10)
    : errorMessage
    ? code.split(/\r?\n/).findIndex((line) => errorMessage.includes(line.trim()) && line.trim().length > 8) + 1 || null
    : null;

  return {
    engine: step.step_type,
    provider: provider || null,
    status,
    code,
    language: step.step_type === "api" ? "json" : "javascript",
    active_line: status === "running" ? 1 : errorLine,
    error_line: errorLine,
    error_message: errorMessage || null,
    started_at: startedAt || null,
    ended_at: endedAt || null
  };
};

const normalizeHooks = (envelope: EngineRunEnvelope, phase: EngineRunHook["phase"]) =>
  (envelope.hooks || [])
    .filter((hook) => hook?.phase === phase && Array.isArray(hook.steps) && hook.steps.length)
    .flatMap((hook) =>
      hook.steps
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((step, index) => ({
          hook,
          step: {
            ...step,
            id: step.id || `${hook.id}:${phase}:${index + 1}`,
            order: step.order || index + 1
          }
        }))
    );

const decorateHookOutcome = (
  hook: EngineRunHook,
  step: EngineRunEnvelope["steps"][number],
  outcome: EngineStepOutcome
): EngineStepOutcome => ({
  ...outcome,
  step_id: `${hook.scope}:${hook.phase}:${hook.id}:${outcome.step_id}`,
  note: [
    `[${hook.phase === "pre" ? "Pre" : "Post"} ${hook.scope} hook] ${hook.name}`,
    outcome.note || `${step.action || `Step ${step.order}`} completed.`
  ].filter(Boolean).join("\n")
});

const buildApiAssertionResult = (
  validation: NonNullable<EngineApiRequest["validations"]>[number],
  response: { status: number; headers: Record<string, string>; body: string; json: unknown }
) => {
  const kind = validation.kind || "status";

  if (kind === "header") {
    const target = normalizeText(validation.target || "content-type").toLowerCase();
    const expected = normalizeText(validation.expected);
    const actual = response.headers[target] || "";
    return {
      kind,
      passed: expected !== null ? actual === expected : Boolean(actual),
      target,
      expected,
      actual
    };
  }

  if (kind === "body_contains") {
    const expected = normalizeText(validation.expected);
    return {
      kind,
      passed: expected ? response.body.includes(expected) : false,
      target: null,
      expected,
      actual: expected ? String(response.body.includes(expected)) : null
    };
  }

  if (kind === "json_path") {
    const target = normalizeText(validation.target || "$");
    const expected = parseExpectedLiteral(validation.expected);
    const actualValue = readJsonPath(response.json, target);
    return {
      kind,
      passed: actualValue === expected,
      target,
      expected: stringifyValue(expected),
      actual: stringifyValue(actualValue)
    };
  }

  const expectedStatus = Number.parseInt(normalizeText(validation.expected || "200"), 10) || 200;
  return {
    kind: "status",
    passed: response.status === expectedStatus,
    target: null,
    expected: String(expectedStatus),
    actual: String(response.status)
  };
};

const executeApiStep = async ({
  envelope,
  run,
  step,
  context
}: {
  envelope: EngineRunEnvelope;
  run: EngineRunRecord;
  step: EngineRunEnvelope["steps"][number];
  context: ExecutionContext;
}): Promise<ApiStepExecutionResult> => {
  const startedAt = Date.now();
  const request = step.api_request;

  if (!request?.url) {
    throw new Error(`Step ${step.order} is missing an API request URL.`);
  }

  const interpolatedUrl = interpolateText(request.url, context);
  const interpolatedBody = normalizeOptionalText(interpolateText(request.body || "", context));
  const headers = interpolateHeaders(request.headers, context);

  const response = await fetch(interpolatedUrl, {
    method: request.method || "GET",
    headers,
    body: request.body_mode && request.body_mode !== "none" ? interpolatedBody || undefined : undefined
  });

  const responseBody = await response.text();
  const responseHeaders = mapHeaders(response.headers);
  const responseJson = parseResponseJson(responseBody, response.headers.get("content-type"));
  const assertions = (request.validations || [{ kind: "status", expected: "200" }]).map((validation) =>
    buildApiAssertionResult(validation, {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
      json: responseJson
    })
  );

  const captures: Record<string, string> = {};

  for (const capture of request.captures || []) {
    const target = readJsonPath(responseJson ?? responseBody, capture.path || "$");
    const parameter = normalizeText(capture.parameter);

    if (!parameter) {
      continue;
    }

    const stringValue = stringifyValue(target);
    captures[parameter] = stringValue;
    registerContextValue(context, parameter, stringValue);
  }

  const captureLines = Object.entries(captures).map(([key, value]) => `Captured ${key} = ${value}`);
  const assertionLines = assertions.map((assertion) =>
    `${assertion.kind}${assertion.target ? `(${assertion.target})` : ""}: ${assertion.passed ? "passed" : `failed, expected ${assertion.expected || ""}, got ${assertion.actual || ""}`}`
  );
  const passed = assertions.every((assertion) => assertion.passed);
  const responsePreview = buildResponsePreview(responseBody, responseJson);
  const note = [
    `${request.method || "GET"} ${interpolatedUrl} -> ${response.status} ${response.statusText}`.trim(),
    summarizeAssertionProgress(assertions),
    ...assertionLines,
    ...captureLines,
    responsePreview ? `Response preview: ${responsePreview}` : ""
  ].filter(Boolean).join("\n");
  const evidenceDataUrl = buildApiEvidenceDataUrl({
    status: passed ? "passed" : "failed",
    title: step.action || `Step ${step.order}`,
    url: interpolatedUrl,
    method: request.method || "GET",
    captureLines
  });
  const stepArtifactPath = path.posix.join(`artifacts/${run.id}`, "steps", `${String(step.order).padStart(2, "0")}.json`);

  await writeArtifactFile(
    stepArtifactPath,
    JSON.stringify(
      {
        step_id: step.id,
        title: step.action || `Step ${step.order}`,
        expected_result: step.expected_result,
        request: {
          method: request.method || "GET",
          url: interpolatedUrl,
          headers,
          body: interpolatedBody
        },
        response: {
          status: response.status,
          status_text: response.statusText,
          headers: responseHeaders,
          body: responseBody,
          json: responseJson
        },
        assertions,
        captures
      },
      null,
      2
    )
  );

  return {
    outcome: {
      step_id: step.id,
      status: passed ? "passed" : "failed",
      started_at: new Date(startedAt).toISOString(),
      ended_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      note,
      evidence_image: {
        data_url: evidenceDataUrl,
        file_name: `step-${step.order}.svg`,
        mime_type: "image/svg+xml",
        artifact_path: stepArtifactPath
      },
      artifacts: [
        {
          kind: "summary",
          label: `API step ${step.order} summary`,
          path: stepArtifactPath,
          content_type: "application/json"
        }
      ]
    },
    summary: {
      step_id: step.id,
      request: {
        method: request.method || "GET",
        url: interpolatedUrl,
        headers,
        body: interpolatedBody
      },
      response: {
        status: response.status,
        status_text: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        json: responseJson
      },
      captures,
      assertions
    },
    captures,
    automation_detail: buildStepAutomationDetail({
      step,
      status: passed ? "passed" : "failed",
      provider: "api",
      startedAt: new Date(startedAt).toISOString(),
      endedAt: nowIso(),
      errorMessage: passed ? null : note
    }),
    recovery_attempted: false,
    recovery_succeeded: false
  };
};

const executeWebStep = async ({
  step,
  webRunSession
}: {
  step: EngineRunEnvelope["steps"][number];
  webRunSession: ReturnType<typeof createWebRunSession>;
}): Promise<ExecutedEngineStepResult> => {
  const result = await webRunSession.runStep(step);

  return {
    outcome: {
      step_id: step.id,
      status: result.status,
      started_at: null,
      ended_at: nowIso(),
      duration_ms: null,
      note: result.note,
      evidence_image: result.evidence
        ? {
            data_url: result.evidence.dataUrl,
            file_name: result.evidence.fileName || undefined,
            mime_type: result.evidence.mimeType || undefined
          }
        : null
    },
    captures: result.captures,
    web_detail: result.web_detail,
    automation_detail: buildStepAutomationDetail({
      step,
      status: result.status,
      provider: result.web_detail?.provider || webRunSession.provider,
      startedAt: result.web_detail?.started_at || null,
      endedAt: result.web_detail?.ended_at || null,
      errorMessage: result.status === "failed" ? result.note : null
    }),
    recovery_attempted: result.recovery_attempted,
    recovery_succeeded: result.recovery_succeeded
  };
};

const markRunState = (
  runId: string,
  nextState: EngineRunState,
  summary: string,
  extra?: Partial<EngineRunRecord>
) =>
  updateRun(runId, (current) => ({
    ...current,
    ...extra,
    state: nextState,
    summary,
    updated_at: nowIso()
  }));

const buildFinalCallback = ({
  envelope,
  run,
  stepOutcomes,
  stepSummaries,
  stepCaptures,
  stepWebDetails,
  stepAutomationDetails,
  status,
  durationMs,
  errorMessage,
  healingAttempted,
  healingSucceeded
}: {
  envelope: EngineRunEnvelope;
  run: EngineRunRecord;
  stepOutcomes: EngineStepOutcome[];
  stepSummaries: ApiStepExecutionResult["summary"][];
  stepCaptures: Record<string, Record<string, string>>;
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail>;
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail>;
  status: "passed" | "failed" | "blocked";
  durationMs: number;
  errorMessage?: string | null;
  healingAttempted?: boolean;
  healingSucceeded?: boolean;
}): EngineCallbackPayload => ({
  event: status === "passed" ? "run.completed" : status === "failed" ? "run.failed" : "run.incident",
  engine_run_id: run.id,
  hellotest_run_id: envelope.hellotest_run_id,
  hellotest_execution_id: envelope.hellotest_execution_id || envelope.hellotest_run_id,
  hellotest_test_case_id: envelope.hellotest_test_case_id,
  data_set_iteration: envelope.data_set?.iteration || null,
  state: status === "passed" ? "completed" : status === "failed" ? "failed" : "incident",
  summary:
    status === "passed"
      ? `${envelope.hellotest_test_case_title} completed successfully.`
      : errorMessage || `${envelope.hellotest_test_case_title} failed during automated execution.`,
  deterministic_attempted: true,
  healing_attempted: Boolean(healingAttempted),
  healing_succeeded: Boolean(healingSucceeded),
  step_outcomes: stepOutcomes,
  case_result: {
    status,
    duration_ms: durationMs,
    error: errorMessage || null,
    logs: buildLogsPayload(stepOutcomes, stepSummaries, stepCaptures, stepWebDetails, stepAutomationDetails)
  },
  artifact_bundle: run.artifact_bundle,
  patch_proposals: run.patch_proposals,
  emitted_at: nowIso()
});

const buildProgressCallback = ({
  envelope,
  run,
  stepOutcomes,
  stepSummaries,
  stepCaptures,
  stepWebDetails,
  stepAutomationDetails,
  latestOutcome,
  durationMs,
  totalSteps,
  healingAttempted,
  healingSucceeded
}: {
  envelope: EngineRunEnvelope;
  run: EngineRunRecord;
  stepOutcomes: EngineStepOutcome[];
  stepSummaries: ApiStepExecutionResult["summary"][];
  stepCaptures: Record<string, Record<string, string>>;
  stepWebDetails: Record<string, HelloTestExecutionStepWebDetail>;
  stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail>;
  latestOutcome: EngineStepOutcome;
  durationMs: number;
  totalSteps: number;
  healingAttempted?: boolean;
  healingSucceeded?: boolean;
}): EngineCallbackPayload => ({
  event: "run.step.completed",
  engine_run_id: run.id,
  hellotest_run_id: envelope.hellotest_run_id,
  hellotest_execution_id: envelope.hellotest_execution_id || envelope.hellotest_run_id,
  hellotest_test_case_id: envelope.hellotest_test_case_id,
  data_set_iteration: envelope.data_set?.iteration || null,
  state: "running",
  summary: `${envelope.hellotest_test_case_title}: completed step ${stepOutcomes.length} of ${totalSteps}.`,
  deterministic_attempted: true,
  healing_attempted: Boolean(healingAttempted),
  healing_succeeded: Boolean(healingSucceeded),
  step_outcomes: [latestOutcome],
  case_result: {
    status: stepOutcomes.length === totalSteps && stepOutcomes.every((outcome) => outcome.status === "passed") ? "passed" : "blocked",
    duration_ms: durationMs,
    error: null,
    logs: buildLogsPayload(stepOutcomes, stepSummaries, stepCaptures, stepWebDetails, stepAutomationDetails)
  },
  artifact_bundle: run.artifact_bundle,
  patch_proposals: run.patch_proposals,
  emitted_at: nowIso()
});

const executeUnsupportedRun = async ({
  envelope,
  run,
  logger,
  reason
}: {
  envelope: EngineRunEnvelope;
  run: EngineRunRecord;
  logger: Logger;
  reason: string;
}) => {
  const next = markRunState(run.id, "incident", reason);

  if (!next) {
    return;
  }

  const payload = buildFinalCallback({
    envelope,
    run: next,
    stepOutcomes: [],
    stepSummaries: [],
    stepCaptures: {},
    stepWebDetails: {},
    stepAutomationDetails: {},
    status: "failed",
    durationMs: 0,
    errorMessage: reason
  });

  try {
    await emitCallback(envelope, payload);
  } catch (error) {
    logger.error({ error, engineRunId: run.id }, "Unable to emit HelloTest callback for unsupported run");
  }
};

async function executeRun(envelope: EngineRunEnvelope, run: EngineRunRecord, logger: Logger) {
  const hasUnsupportedStep = envelope.steps.some((step) => step.step_type !== "api" && step.step_type !== "web");

  if (hasUnsupportedStep) {
    await executeUnsupportedRun({
      envelope,
      run,
      logger,
      reason: "Local Test Engine received an unsupported step type."
    });
    return;
  }

  const hasWebSteps = envelope.steps.some((step) => step.step_type === "web");
  const running = markRunState(
    run.id,
    "running",
    hasWebSteps
      ? "Executing automated API and web steps in order."
      : "Executing automated API steps in order."
  );

  if (!running) {
    return;
  }

  const startedAt = Date.now();
  const context = buildInitialContext(envelope);
  const stepOutcomes: EngineStepOutcome[] = [];
  const stepSummaries: ApiStepExecutionResult["summary"][] = [];
  const stepCaptures: Record<string, Record<string, string>> = {};
  const stepWebDetails: Record<string, HelloTestExecutionStepWebDetail> = {};
  const stepAutomationDetails: Record<string, HelloTestExecutionStepAutomationDetail> = {};
  const orderedSteps = envelope.steps.slice().sort((left, right) => left.order - right.order);
  const preHookSteps = normalizeHooks(envelope, "pre");
  const postHookSteps = normalizeHooks(envelope, "post");
  const webRunSession = hasWebSteps ? createWebRunSession(envelope, context.values) : null;
  let healingAttempted = false;
  let healingSucceeded = false;
  let webRunSessionStopped = false;
  let currentStep: EngineRunEnvelope["steps"][number] | null = null;
  const stopWebRunSession = async (status?: "passed" | "failed" | "blocked") => {
    if (!webRunSession || webRunSessionStopped) {
      return {};
    }

    webRunSessionStopped = true;
    try {
      return await webRunSession.stop(status);
    } catch (error) {
      logger.error({ error, engineRunId: run.id }, "Unable to finalize web automation artifacts");
      return {};
    }
  };
  const executeEngineStep = async (step: EngineRunEnvelope["steps"][number]) => {
    const result =
      step.step_type === "api"
        ? await executeApiStep({
            envelope,
            run: running,
            step,
            context
          })
        : webRunSession
          ? await executeWebStep({
              step,
              webRunSession
            })
          : null;

    if (!result) {
      throw new Error(`Unable to execute step ${step.order}.`);
    }

    syncCapturedValues(context, result.captures);

    if (webRunSession && step.step_type === "api") {
      syncCapturedValues(webRunSession.context, result.captures);
    }

    return result;
  };
  const recordStepResult = (result: ExecutedEngineStepResult) => {
    stepOutcomes.push(result.outcome);
    if (Object.keys(result.captures || {}).length) {
      stepCaptures[result.outcome.step_id] = {
        ...(stepCaptures[result.outcome.step_id] || {}),
        ...result.captures
      };
    }
    if (result.summary) {
      stepSummaries.push(result.summary);
    }
    if (result.web_detail) {
      stepWebDetails[result.outcome.step_id] = result.web_detail;
    }
    if (result.automation_detail) {
      stepAutomationDetails[result.outcome.step_id] = result.automation_detail;
    }
    healingAttempted = healingAttempted || result.recovery_attempted;
    healingSucceeded = healingSucceeded || result.recovery_succeeded;
  };
  const runHookSteps = async (phase: EngineRunHook["phase"], entries: ReturnType<typeof normalizeHooks>) => {
    for (const entry of entries) {
      currentStep = entry.step;
      const result = await executeEngineStep(entry.step);
      result.outcome = decorateHookOutcome(entry.hook, entry.step, result.outcome);
      recordStepResult(result);
      currentStep = null;

      if (result.outcome.status === "failed" && entry.hook.fail_behavior !== "continue") {
        const behavior = entry.hook.fail_behavior || "fail-run";
        if (behavior === "mark-blocked") {
          result.outcome.status = "blocked";
          return;
        }
        throw new Error(`${entry.hook.name} ${phase} hook failed: ${result.outcome.note || "hook step failed"}`);
      }
    }
  };

  try {
    if (webRunSession) {
      await webRunSession.start();
    }

    await runHookSteps("pre", preHookSteps);

    for (const step of orderedSteps) {
      currentStep = step;
      const result = await executeEngineStep(step);
      recordStepResult(result);
      currentStep = null;

      const progressSummary = `${envelope.hellotest_test_case_title}: completed step ${stepOutcomes.length} of ${orderedSteps.length}.`;
      const progressRun = markRunState(run.id, "running", progressSummary);

      if (progressRun) {
        await persistRunSummary(progressRun, {
          execution: {
            started_at: new Date(startedAt).toISOString(),
            ended_at: nowIso(),
            status: result.outcome.status === "failed" ? "failed" : "blocked",
            summary: progressSummary
          },
          steps: stepSummaries,
          captured_values: context.values
        });

        if (result.outcome.status === "passed" && stepOutcomes.length < orderedSteps.length) {
          try {
            await emitCallback(
              envelope,
              buildProgressCallback({
                envelope,
                run: progressRun,
                stepOutcomes,
                stepSummaries,
                stepCaptures,
                stepWebDetails,
                stepAutomationDetails,
                latestOutcome: result.outcome,
                durationMs: Date.now() - startedAt,
                totalSteps: orderedSteps.length,
                healingAttempted,
                healingSucceeded
              })
            );
          } catch (error) {
            logger.error({ error, engineRunId: run.id, stepId: result.outcome.step_id }, "Unable to emit engine step progress callback");
          }
        }
      }

      if (result.outcome.status === "failed") {
        const artifactBundle = mergeArtifactBundle(running.artifact_bundle, await stopWebRunSession("failed"));
        const failedRun = markRunState(
          run.id,
          "failed",
          `${envelope.hellotest_test_case_title} failed on step ${step.order}.`,
          { artifact_bundle: artifactBundle }
        );

        if (!failedRun) {
          return;
        }

        await persistRunSummary(failedRun, {
          execution: {
            started_at: new Date(startedAt).toISOString(),
            ended_at: nowIso(),
            status: "failed",
            summary: failedRun.summary
          },
          steps: stepSummaries,
          captured_values: context.values
        });

        await emitCallback(
          envelope,
          buildFinalCallback({
            envelope,
            run: failedRun,
            stepOutcomes,
            stepSummaries,
            stepCaptures,
            stepWebDetails,
            stepAutomationDetails,
            status: "failed",
            durationMs: Date.now() - startedAt,
            errorMessage: result.outcome.note || `${envelope.hellotest_test_case_title} failed on step ${step.order}.`,
            healingAttempted,
            healingSucceeded
          })
        );

        return;
      }
    }

    await runHookSteps("post", postHookSteps);

    const finalStatus: "passed" | "blocked" = stepOutcomes.some((outcome) => outcome.status === "blocked") ? "blocked" : "passed";
    const artifactBundle = mergeArtifactBundle(running.artifact_bundle, await stopWebRunSession(finalStatus));
    const completedRun = markRunState(
      run.id,
      finalStatus === "passed" ? "completed" : "incident",
      finalStatus === "passed"
        ? `${envelope.hellotest_test_case_title} completed successfully.`
        : `${envelope.hellotest_test_case_title} completed with blocked hook or step outcomes.`,
      { artifact_bundle: artifactBundle }
    );

    if (!completedRun) {
      return;
    }

    await persistRunSummary(completedRun, {
      execution: {
        started_at: new Date(startedAt).toISOString(),
        ended_at: nowIso(),
        status: finalStatus,
        summary: completedRun.summary
      },
      steps: stepSummaries,
      captured_values: context.values
    });

    await emitCallback(
      envelope,
      buildFinalCallback({
        envelope,
        run: completedRun,
        stepOutcomes,
        stepSummaries,
        stepCaptures,
        stepWebDetails,
        stepAutomationDetails,
        status: finalStatus,
        durationMs: Date.now() - startedAt,
        healingAttempted,
        healingSucceeded
      })
    );
  } catch (error) {
    const failureMessage = stringifyError(error, `${envelope.hellotest_test_case_title} failed during execution.`);

    if (currentStep && !stepOutcomes.some((outcome) => outcome.step_id === currentStep?.id)) {
      const failedOutcome: EngineStepOutcome = {
        step_id: currentStep.id,
        status: "failed",
        started_at: null,
        ended_at: nowIso(),
        duration_ms: null,
        note: [
          `${envelope.hellotest_test_case_title} failed on step ${currentStep.order}.`,
          failureMessage
        ].join("\n")
      };
      stepOutcomes.push(failedOutcome);
      stepAutomationDetails[currentStep.id] = buildStepAutomationDetail({
        step: currentStep,
        status: "failed",
        provider: currentStep.step_type,
        endedAt: nowIso(),
        errorMessage: failureMessage
      });
    }

    const artifactBundle = mergeArtifactBundle(running.artifact_bundle, await stopWebRunSession("failed"));
    const failedRun = markRunState(
      run.id,
      "failed",
      failureMessage,
      { artifact_bundle: artifactBundle }
    );

    if (!failedRun) {
      return;
    }

    await persistRunSummary(failedRun, {
      execution: {
        started_at: new Date(startedAt).toISOString(),
        ended_at: nowIso(),
        status: "failed",
        summary: failedRun.summary
      },
      steps: stepSummaries,
      captured_values: context.values
    });

    try {
      await emitCallback(
        envelope,
        buildFinalCallback({
          envelope,
          run: failedRun,
          stepOutcomes,
          stepSummaries,
          stepCaptures,
          stepWebDetails,
          stepAutomationDetails,
          status: "failed",
          durationMs: Date.now() - startedAt,
          errorMessage: failedRun.summary,
          healingAttempted,
          healingSucceeded
        })
      );
    } catch (callbackError) {
      logger.error({ error: callbackError, engineRunId: run.id }, "Unable to emit HelloTest callback after execution failure");
    }
  } finally {
    if (webRunSession && !webRunSessionStopped) {
      try {
        await stopWebRunSession();
      } catch (stopError) {
        logger.error({ error: stopError, engineRunId: run.id }, "Unable to stop web automation session cleanly");
      }
    }
  }
}

export function queueRunExecution(envelope: EngineRunEnvelope, run: EngineRunRecord, logger: Logger) {
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      void executeRun(envelope, run, logger)
        .catch((error) => {
          logger.error({ error, engineRunId: run.id }, "Uncaught Test Engine execution failure");
        })
        .finally(resolve);
    });
  });
}

export function saveAcceptedRun(envelope: EngineRunEnvelope, run: EngineRunRecord) {
  return saveRun(run, envelope);
}
