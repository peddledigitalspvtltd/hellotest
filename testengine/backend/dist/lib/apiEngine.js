import { buildInitialContext, interpolateHeaders, interpolateText, normalizeText, stringifyValue } from "./runtimeContext.js";
const API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const API_BODY_MODES = new Set(["none", "json", "text", "xml", "form"]);
const API_VALIDATION_KINDS = new Set(["status", "header", "body_contains", "json_path"]);
const ensureHttpUrl = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        throw new Error("A request URL is required");
    }
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        throw new Error("Request URL must be an absolute http or https URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http and https URLs are supported");
    }
    return parsed.toString();
};
const normalizeApiRequest = (request) => {
    if (!request || typeof request !== "object") {
        throw new Error("A valid API request is required");
    }
    const method = String(request.method || "GET").trim().toUpperCase();
    const bodyMode = String(request.body_mode || "none").trim().toLowerCase();
    return {
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
const resolveApiRequest = (request, envelope, capturedValues, step) => {
    const context = buildInitialContext(envelope, capturedValues, step);
    const normalizedRequest = normalizeApiRequest(request);
    return normalizeApiRequest({
        ...normalizedRequest,
        url: interpolateText(normalizedRequest.url, context),
        body: interpolateText(normalizedRequest.body, context),
        headers: Object.entries(interpolateHeaders(normalizedRequest.headers, context)).map(([key, value]) => ({ key, value })),
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
};
const mapResponseHeaders = (response) => Array.from(response.headers.entries()).reduce((accumulator, [key, value]) => {
    accumulator[key.toLowerCase()] = value;
    return accumulator;
}, {});
const parseResponseJson = (bodyText, contentType) => {
    const normalizedBody = bodyText.trim();
    const normalizedType = String(contentType || "").toLowerCase();
    if (!normalizedBody) {
        return null;
    }
    if (!normalizedType.includes("json") && !/^[\[{]/.test(normalizedBody)) {
        return null;
    }
    try {
        return JSON.parse(normalizedBody);
    }
    catch {
        return null;
    }
};
const serializeApiBody = (request, headers) => {
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
const parseJsonPath = (path) => {
    const normalized = normalizeText(path);
    if (!normalized || normalized === "$") {
        return [];
    }
    if (!normalized.startsWith("$")) {
        throw new Error("JPath must start with $");
    }
    const tokens = [];
    let index = 1;
    while (index < normalized.length) {
        const current = normalized[index];
        if (current === ".") {
            index += 1;
            const nextIndex = index;
            while (index < normalized.length && normalized[index] !== "." && normalized[index] !== "[") {
                index += 1;
            }
            const token = normalized.slice(nextIndex, index).trim();
            if (!token) {
                throw new Error("JPath contains an empty property segment");
            }
            tokens.push(token);
            continue;
        }
        if (current === "[") {
            index += 1;
            const quote = normalized[index];
            if (quote === "\"" || quote === "'") {
                index += 1;
                const nextIndex = index;
                while (index < normalized.length && normalized[index] !== quote) {
                    index += 1;
                }
                if (index >= normalized.length) {
                    throw new Error("JPath has an unterminated quoted property");
                }
                const token = normalized.slice(nextIndex, index);
                index += 1;
                if (normalized[index] !== "]") {
                    throw new Error("JPath has an invalid quoted property segment");
                }
                index += 1;
                tokens.push(token);
                continue;
            }
            const nextIndex = index;
            while (index < normalized.length && normalized[index] !== "]") {
                index += 1;
            }
            if (index >= normalized.length) {
                throw new Error("JPath is missing a closing bracket");
            }
            const rawToken = normalized.slice(nextIndex, index).trim();
            index += 1;
            if (!/^\d+$/.test(rawToken)) {
                throw new Error("Only numeric array indexes are supported in bracket notation");
            }
            tokens.push(Number(rawToken));
            continue;
        }
        throw new Error(`Unexpected token "${current}" in JPath`);
    }
    return tokens;
};
const readJsonPathValue = (source, path) => {
    try {
        const tokens = parseJsonPath(path);
        let current = source;
        for (const token of tokens) {
            if (typeof token === "number") {
                if (!Array.isArray(current)) {
                    return { found: false, error: `Path ${path} does not point to an array before [${token}]` };
                }
                if (token < 0 || token >= current.length) {
                    return { found: false, error: `Path ${path} is missing array index [${token}]` };
                }
                current = current[token];
                continue;
            }
            if (!current || typeof current !== "object" || !(token in current)) {
                return { found: false, error: `Path ${path} is missing property "${token}"` };
            }
            current = current[token];
        }
        return { found: true, value: current };
    }
    catch (error) {
        return {
            found: false,
            error: error instanceof Error ? error.message : "Invalid JPath"
        };
    }
};
const parseAssertionExpectedValue = (value) => {
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
        }
        catch {
            return normalized;
        }
    }
    return normalized;
};
const areAssertionValuesEqual = (left, right) => {
    if (left === right) {
        return true;
    }
    if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        }
        catch {
            return false;
        }
    }
    return false;
};
const evaluateApiAssertions = (preview, validations = []) => {
    const effectiveValidations = validations.length ? validations : [{ kind: "status", expected: "200" }];
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
        if (kind === "status") {
            const expectedStatus = Number(expected || "200") || 200;
            const passed = preview.response.status === expectedStatus;
            return {
                kind,
                passed,
                target: null,
                expected: String(expectedStatus),
                actual: String(preview.response.status),
                summary: passed
                    ? `Matched expected status ${expectedStatus}.`
                    : `Expected status ${expectedStatus}, received ${preview.response.status}.`
            };
        }
        if (kind === "header") {
            const headerName = String(target || "content-type").toLowerCase();
            const actual = preview.response.headers[headerName] || "";
            const passed = actual === (expected || "");
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
        if (!resolved.found) {
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
        const passed = areAssertionValuesEqual(resolved.value, expectedValue);
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
const extractCaptures = (request, preview) => {
    const captures = {};
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
const escapeXml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const buildApiEvidenceDataUrl = ({ status, title, url, method, responseStatus, captureLines }) => {
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
        ...lines.map((line, index) => `<text x="52" y="${112 + index * 28}" font-size="${index === 0 ? 22 : 18}" font-family="Arial, sans-serif" fill="#16324f">${escapeXml(line)}</text>`),
        `</svg>`
    ].join("");
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
};
const runResolvedApiRequest = async (request) => {
    const url = ensureHttpUrl(request.url);
    const method = String(request.method || "GET").toUpperCase();
    const headers = new Headers();
    for (const header of request.headers || []) {
        const key = normalizeText(header.key);
        if (!key) {
            continue;
        }
        headers.set(key, header.value || "");
    }
    const startedAt = Date.now();
    let response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: method === "GET" || method === "HEAD" ? undefined : serializeApiBody(request, headers),
            signal: AbortSignal.timeout(20_000)
        });
    }
    catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("API request timed out after 20 seconds");
        }
        throw new Error(error instanceof Error ? error.message : "Unable to run API request");
    }
    const bodyText = await response.text();
    const contentType = response.headers.get("content-type");
    return {
        request: {
            method,
            url,
            headers: Object.fromEntries(headers.entries()),
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
export async function executeApiStepInEngine(envelope, step, capturedValues = {}) {
    const request = resolveApiRequest(step.api_request, envelope, capturedValues, step);
    const preview = await runResolvedApiRequest(request);
    const assertions = evaluateApiAssertions(preview, request.validations || []);
    const captures = extractCaptures(request, preview);
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
            assertions: assertions.map((assertion) => ({
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
