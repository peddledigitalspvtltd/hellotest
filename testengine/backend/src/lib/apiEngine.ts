import type {
  EngineApiRequest,
  EngineApiValidation,
  EngineRunEnvelope,
  EngineRunStep,
  HelloTestExecutionApiAssertion,
  HelloTestExecutionStepApiDetail
} from "../contracts/hellotest.js";
import { compare, evaluateExtendedApiAssertion } from "./apiAssertions.js";
import { readJsonPathValue } from "./apiJsonPath.js";
import { apiRequestTimeoutMs } from "./apiRequestTimeout.js";
import {
  buildInitialContext,
  interpolateHeaders,
  interpolateText,
  normalizeText,
  stringifyValue
} from "./runtimeContext.js";

type ApiStepExecutionResult = {
  status: "passed" | "failed";
  duration_ms: number;
  note: string;
  detail: HelloTestExecutionStepApiDetail;
  captures: Record<string, string>;
  evidence: {
    dataUrl: string;
    fileName: string;
    mimeType: string;
  };
};

type ApiResponsePreview = {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  };
  response: {
    status: number;
    ok: boolean;
    status_text: string;
    headers: Record<string, string>;
    content_type: string | null;
    body_text: string;
    body_json: unknown;
    duration_ms: number;
  };
};

const API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const API_BODY_MODES = new Set(["none", "json", "text", "xml", "form"]);
const API_VALIDATION_KINDS = new Set(["status", "header", "header_present", "body_contains", "body_not_contains", "json_path", "json_schema", "response_time"]);

const ensureHttpUrl = (value: string | null | undefined) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error("A request URL is required");
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Request URL must be an absolute http or https URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }

  return parsed.toString();
};

const normalizeApiRequest = (request: EngineApiRequest | null | undefined): EngineApiRequest => {
  if (!request || typeof request !== "object") {
    throw new Error("A valid API request is required");
  }

  const method = String(request.method || "GET").trim().toUpperCase();
  const bodyMode = String(request.body_mode || "none").trim().toLowerCase();

  return {
    timeout_ms: apiRequestTimeoutMs(request.timeout_ms),
    query_params: Array.isArray(request.query_params) ? request.query_params : [],
    cookies: Array.isArray(request.cookies) ? request.cookies : [],
    auth: request.auth,
    follow_redirects: request.follow_redirects,
    method: API_METHODS.has(method) ? request.method : "GET",
    url: normalizeText(request.url) || "",
    headers: Array.isArray(request.headers)
      ? request.headers
          .map((header) => ({
            key: normalizeText(header?.key) || "",
            value: String(header?.value ?? "")
          }))
          .filter((header) => header.key || header.value)
      : [],
    body_mode: API_BODY_MODES.has(bodyMode) ? request.body_mode : "none",
    body: request.body ? String(request.body) : "",
    validations: Array.isArray(request.validations) ? request.validations : [],
    captures: Array.isArray(request.captures) ? request.captures : []
  };
};

const resolveApiRequest = (
  request: EngineApiRequest | null | undefined,
  envelope: EngineRunEnvelope,
  capturedValues: Record<string, string>,
  step?: EngineRunStep
) => {
  const context = buildInitialContext(envelope, capturedValues, step);
  const normalizedRequest = normalizeApiRequest(request);

  const resolved=normalizeApiRequest({
    ...normalizedRequest,
    url: interpolateText(normalizedRequest.url, context),
    body: interpolateText(normalizedRequest.body, context),
    headers: Object.entries(interpolateHeaders(normalizedRequest.headers, context)).map(([key, value]) => ({ key, value })),
    query_params: (normalizedRequest.query_params || []).map(row=>({key:interpolateText(row.key,context),value:interpolateText(row.value,context)})),
    cookies: (normalizedRequest.cookies || []).map(row=>({key:interpolateText(row.key,context),value:interpolateText(row.value,context)})),
    validations: (normalizedRequest.validations || []).map((validation) => ({
      ...validation,
      target: interpolateText(validation.target, context),
      expected: interpolateText(validation.expected, context)
    })),
    captures: (normalizedRequest.captures || []).map((capture) => ({
      ...capture,
      // Keep the destination reference literal when replacing a prior capture.
      path: interpolateText(capture.path, context)
    }))
  });
  const auth=resolved.auth;
  let credential: string | undefined;
  if(auth && auth.type!=='none'){
    const ref=String(auth.credential_reference||'');
    credential=interpolateText(ref.startsWith('@')?ref:`@${ref}`,context);
    if(!ref || !credential)throw new Error('Configure the API authentication credential_reference in authorized test data before execution.');
  }
  if(resolved.url?.startsWith('/') && envelope.environment?.base_url)resolved.url=new URL(resolved.url,envelope.environment.base_url).href;
  return {...resolved,resolved_credential:credential};
};

const mapResponseHeaders = (response: Response) =>
  Array.from(response.headers.entries()).reduce<Record<string, string>>((accumulator, [key, value]) => {
    accumulator[key.toLowerCase()] = value;
    return accumulator;
  }, {});

const parseResponseJson = (bodyText: string, contentType: string | null) => {
  const normalizedBody = bodyText.trim();
  const normalizedType = String(contentType || "").toLowerCase();

  if (!normalizedBody) {
    return null;
  }

  if (!normalizedType.includes("json") && !/^[\[{]/.test(normalizedBody)) {
    return null;
  }

  try {
    return JSON.parse(normalizedBody) as unknown;
  } catch {
    return null;
  }
};

const serializeApiBody = (request: EngineApiRequest, headers: Headers) => {
  const body = String(request.body || "");
  const mode = request.body_mode || "none";

  if (!body || mode === "none") {
    return undefined;
  }

  if (mode === "json") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return body;
  }

  if (mode === "form") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    }
    return body;
  }

  if (mode === "xml" && !headers.has("content-type")) {
    headers.set("content-type", "application/xml");
  }

  if (mode === "text" && !headers.has("content-type")) {
    headers.set("content-type", "text/plain;charset=UTF-8");
  }

  return body;
};

const parseAssertionExpectedValue = (value: string | null | undefined) => {
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
      return JSON.parse(normalized) as unknown;
    } catch {
      return normalized;
    }
  }

  return normalized;
};

const evaluateApiAssertions = (preview: ApiResponsePreview, validations: EngineApiValidation[] = []) => {
  const effectiveValidations: EngineApiValidation[] = validations.length ? validations : [{ kind: "status", expected: "200" }];

  return effectiveValidations.map((validation) => {
    const kind = normalizeText(validation.kind || "status") || "status";
    const target = normalizeText(validation.target);
    const expected = normalizeText(validation.expected);

    if (!API_VALIDATION_KINDS.has(kind)) {
      return {
        kind,
        passed: false,
        target,
        expected,
        actual: null,
        summary: `Unsupported API assertion kind: ${kind}.`
      };
    }

    const extended=evaluateExtendedApiAssertion(preview,{...validation,kind:validation.kind,target,expected});
    if(extended)return {kind,target,expected,...extended};

    if (kind === "status") {
      const validExpected = typeof expected === 'string' && /^\d{3}$/.test(expected) && Number(expected) >= 100 && Number(expected) <= 599;
      const expectedStatus = validExpected ? Number(expected) : null;
      const passed = validExpected && preview.response.status === expectedStatus;

      return {
        kind,
        passed,
        target: null,
        expected: expected || "[missing expected status]",
        actual: String(preview.response.status),
        summary: !validExpected ? 'The expected HTTP status is missing or invalid after resolving test parameters. Supply a status from 100 to 599.' : passed
          ? `Matched expected status ${expectedStatus}.`
          : `Expected status ${expectedStatus}, received ${preview.response.status}.`
      };
    }

    if (kind === "header") {
      const headerName = String(target || "content-type").toLowerCase();
      const actual = preview.response.headers[headerName] || "";
      const passed = compare(actual,expected || "",validation.operator);

      return {
        kind,
        passed,
        target: headerName,
        expected: expected || "",
        actual,
        summary: passed
          ? `Header matched ${headerName}.`
          : `Expected "${expected || ""}", received "${actual || "(empty)"}".`
      };
    }

    if (kind === "body_contains") {
      const bodyText = preview.response.body_text;
      const passed = bodyText.includes(expected || "");

      return {
        kind,
        passed,
        target: target || null,
        expected: expected || "",
        actual: bodyText,
        summary: passed
          ? "Expected text was found in the response body."
          : `Could not find "${expected || ""}" in the response body.`
      };
    }

    if (preview.response.body_json === null || preview.response.body_json === undefined) {
      return {
        kind,
        passed: false,
        target: target || "$",
        expected: expected || "",
        actual: null,
        summary: "Response body is not JSON, so this JPath assertion could not be evaluated."
      };
    }

    const resolved = readJsonPathValue(preview.response.body_json, target || "$");

    if (!resolved.found && validation.operator !== "exists") {
      return {
        kind,
        passed: false,
        target: target || "$",
        expected: expected || "",
        actual: null,
        summary: resolved.error || "JPath assertion did not match."
      };
    }

    const expectedValue = parseAssertionExpectedValue(expected);
    let passed: boolean;
    try { passed=compare(resolved.value, expectedValue, validation.operator); }
    catch(error) { return {kind,passed:false,target,expected,actual:null,summary:error instanceof Error?error.message:'Unsupported API assertion.'}; }

    return {
      kind,
      passed,
      target: target || "$",
      expected: stringifyValue(expectedValue),
      actual: stringifyValue(resolved.value),
      summary: passed
        ? `Matched ${target || "$"} = ${stringifyValue(resolved.value)}.`
        : `Expected ${stringifyValue(expectedValue)}, received ${stringifyValue(resolved.value)}.`
    };
  });
};

const extractCaptures = (request: EngineApiRequest, preview: ApiResponsePreview) => {
  const captures: Record<string, string> = {};

  for (const capture of request.captures || []) {
    const parameter = normalizeText(capture.parameter);

    if (!parameter) {
      continue;
    }

    const source = preview.response.body_json !== null && preview.response.body_json !== undefined
      ? preview.response.body_json
      : preview.response.body_text;
    const resolved = readJsonPathValue(source, capture.path || "$");
    captures[parameter] = resolved.found ? stringifyValue(resolved.value) : "";
  }

  return captures;
};

const escapeXml = (value: unknown) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildApiEvidenceDataUrl = ({
  status,
  title,
  url,
  method,
  responseStatus,
  captureLines
}: {
  status: "passed" | "failed";
  title: string;
  url: string;
  method: string;
  responseStatus: string;
  captureLines: string[];
}) => {
  const bg = status === "passed" ? "#dff7ec" : "#ffe6ea";
  const accent = status === "passed" ? "#0f9d6c" : "#cd3658";
  const lines = [
    `${method} ${url}`,
    title,
    responseStatus ? `Response ${responseStatus}` : null,
    ...captureLines.slice(0, 2)
  ].filter(Boolean);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220">`,
    `<rect width="900" height="220" rx="22" fill="${bg}"/>`,
    `<rect x="28" y="28" width="844" height="164" rx="18" fill="#ffffff" stroke="${accent}" stroke-width="4"/>`,
    `<text x="52" y="72" font-size="28" font-family="Arial, sans-serif" fill="${accent}" font-weight="700">${escapeXml(status.toUpperCase())}</text>`,
    ...lines.map((line, index) =>
      `<text x="52" y="${112 + index * 28}" font-size="${index === 0 ? 22 : 18}" font-family="Arial, sans-serif" fill="#16324f">${escapeXml(line)}</text>`
    ),
    `</svg>`
  ].join("");

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
};

const runResolvedApiRequest = async (request: EngineApiRequest & {resolved_credential?:string}): Promise<ApiResponsePreview> => {
  const target = new URL(ensureHttpUrl(request.url));
  for(const row of request.query_params || [])target.searchParams.append(row.key,row.value);
  const method = String(request.method || "GET").toUpperCase();
  const headers = new Headers();

  for (const header of request.headers || []) {
    const key = normalizeText(header.key);

    if (!key) {
      continue;
    }

    headers.set(key, header.value || "");
  }

  if(request.cookies?.length)headers.set('cookie',request.cookies.map(row=>`${row.key}=${row.value}`).join('; '));
  const auth=request.auth;
  if(auth && auth.type!=='none'){
    const credential=request.resolved_credential;
    if(!credential)throw new Error('Configure the API authentication credential_reference in authorized test data before execution.');
    if(auth.type==='api_key'){
      if(auth.location==='query')target.searchParams.append(auth.key_name||'api_key',credential);
      else headers.set(auth.key_name||'Authorization',credential);
    }else headers.set('Authorization',`${auth.type==='basic'?'Basic':'Bearer'} ${credential}`);
  }
  const url=target.toString();
  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : serializeApiBody(request, headers),
      redirect: request.follow_redirects===false?"manual":"follow",
      signal: AbortSignal.timeout(apiRequestTimeoutMs(request.timeout_ms))
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error(`API request timed out after ${apiRequestTimeoutMs(request.timeout_ms)} ms`);
    }

    throw new Error(error instanceof Error ? error.message : "Unable to run API request");
  }

  const bodyText = await response.text();
  const contentType = response.headers.get("content-type");

  const reportedUrl=new URL(url);
  const reportedHeaders=Object.fromEntries(headers.entries());
  if(auth && auth.type !== 'none'){
    if(auth.type==='api_key' && auth.location==='query')reportedUrl.searchParams.set(auth.key_name||'api_key','[credential reference]');
    else reportedHeaders[auth.type==='api_key'?(auth.key_name||'authorization').toLowerCase():'authorization']='[credential reference]';
  }
  return {
    request: {
      method,
      url:reportedUrl.toString(),
      headers: reportedHeaders,
      body: request.body || null
    },
    response: {
      status: response.status,
      ok: response.ok,
      status_text: response.statusText,
      headers: mapResponseHeaders(response),
      content_type: contentType,
      body_text: bodyText,
      body_json: parseResponseJson(bodyText, contentType),
      duration_ms: Date.now() - startedAt
    }
  };
};

export async function executeApiStepInEngine(
  envelope: EngineRunEnvelope,
  step: EngineRunStep,
  capturedValues: Record<string, string> = {}
): Promise<ApiStepExecutionResult> {
  const request = resolveApiRequest(step.api_request, envelope, capturedValues, step);
  const preview = await runResolvedApiRequest(request);
  const assertions = evaluateApiAssertions(preview, request.validations || []);
  const captures = extractCaptures(request, preview);
  const captureSource=preview.response.body_json ?? preview.response.body_text;
  for(const capture of request.captures || [])if(!readJsonPathValue(captureSource,capture.path||'$').found)assertions.push({kind:'json_path',passed:false,target:capture.path||'$',expected:`Capture ${capture.parameter}`,actual:null,summary:`Required response capture ${capture.parameter} was not found at ${capture.path}.`});
  const firstFailure = assertions.find((assertion) => !assertion.passed);
  const passed = assertions.every((assertion) => assertion.passed);
  const captureLines = Object.entries(captures).map(([key, value]) => `Captured ${key} = ${stringifyValue(value)}`);

  return {
    status: passed ? "passed" : "failed",
    duration_ms: preview.response.duration_ms,
    note: passed
      ? `${preview.request.method} ${preview.request.url} passed with ${preview.response.status}.`
      : firstFailure?.summary || `${preview.request.method} ${preview.request.url} failed with ${preview.response.status}.`,
    detail: {
      request: {
        method: preview.request.method,
        url: preview.request.url,
        headers: preview.request.headers,
        body: preview.request.body
      },
      response: {
        status: preview.response.status,
        status_text: preview.response.status_text,
        headers: preview.response.headers,
        body: preview.response.body_text,
        json: preview.response.body_json
      },
      captures,
      assertions: assertions.map<HelloTestExecutionApiAssertion>((assertion) => ({
        kind: assertion.kind,
        passed: assertion.passed,
        target: assertion.target,
        expected: assertion.expected,
        actual: assertion.actual
      }))
    },
    captures,
    evidence: {
      dataUrl: buildApiEvidenceDataUrl({
        status: passed ? "passed" : "failed",
        title: request.url || "API step",
        url: preview.request.url,
        method: preview.request.method,
        responseStatus: `${preview.response.status} ${preview.response.status_text}`.trim(),
        captureLines
      }),
      fileName: `api-step-${passed ? "passed" : "failed"}.svg`,
      mimeType: "image/svg+xml"
    }
  };
}
