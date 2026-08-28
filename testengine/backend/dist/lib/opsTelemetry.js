import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, open as openFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
const DEFAULT_EVENTS_PATH = "/api/v1/events";
const DEFAULT_BOARD_PATH = "/ops-telemetry";
const DEFAULT_SERVICES_PATH = "/api/v1/ops-telemetry/services";
const REDACTED_VALUE = "[REDACTED]";
const TRUNCATED_VALUE = "[TRUNCATED]";
const LOCAL_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);
const SENSITIVE_KEY_NAMES = new Set([
    "authorization",
    "proxy_authorization",
    "cookie",
    "set_cookie",
    "x_api_key",
    "api_key",
    "apikey",
    "password",
    "passwd",
    "secret",
    "client_secret",
    "private_key",
    "credential",
    "credentials",
    "access_token",
    "refresh_token",
    "id_token",
    "token",
    "captures",
    "request_body",
    "response_body",
    "body",
    "body_text",
    "body_json",
    "data_url"
]);
const normalizeText = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
};
const normalizePath = (value, fallback) => {
    const normalized = normalizeText(value) || fallback;
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
};
const normalizeInteger = (value, fallback) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};
const normalizeBoolean = (value, fallback) => {
    const normalized = normalizeText(value)?.toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
        return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
        return false;
    }
    return fallback;
};
const clampInteger = (value, fallback, minimum, maximum) => Math.min(maximum, Math.max(minimum, normalizeInteger(value, fallback)));
const isPlainObject = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};
const normalizeKeyName = (value) => value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const isSensitiveKey = (value) => {
    const normalized = normalizeKeyName(value);
    if (SENSITIVE_KEY_NAMES.has(normalized)) {
        return true;
    }
    return /(^|_)(auth|authorization|cookie|password|passwd|secret|credential|api_key|token|jwt|session|private_key)(_|$)/.test(normalized);
};
const redactSensitiveText = (value) => value
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, "$1 [REDACTED]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@");
const truncateText = (value, maximum) => {
    const redacted = redactSensitiveText(value);
    if (redacted.length <= maximum) {
        return redacted;
    }
    const available = Math.max(0, maximum - TRUNCATED_VALUE.length);
    return `${redacted.slice(0, available)}${TRUNCATED_VALUE}`;
};
const sanitizeValue = (value, config, depth = 0, seen = new WeakSet()) => {
    if (value === null || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return truncateText(value, config.maxStringCharacters);
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "bigint") {
        return truncateText(value.toString(), config.maxStringCharacters);
    }
    if (typeof value !== "object") {
        return null;
    }
    if (depth >= config.maxDepth || seen.has(value)) {
        return TRUNCATED_VALUE;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        const itemLimit = Math.max(1, config.maxArrayItems);
        const wasTruncated = value.length > itemLimit;
        const values = value
            .slice(0, wasTruncated ? Math.max(0, itemLimit - 1) : itemLimit)
            .map((item) => sanitizeValue(item, config, depth + 1, seen));
        if (wasTruncated) {
            values.push(TRUNCATED_VALUE);
        }
        seen.delete(value);
        return values;
    }
    const entries = Object.entries(value);
    const output = {};
    const keyLimit = Math.max(1, config.maxObjectKeys);
    const selectedEntries = entries.slice(0, keyLimit);
    for (const [key, nestedValue] of selectedEntries) {
        output[truncateText(key, 256)] = isSensitiveKey(key)
            ? REDACTED_VALUE
            : sanitizeValue(nestedValue, config, depth + 1, seen);
    }
    if (entries.length > keyLimit) {
        output.__truncated__ = TRUNCATED_VALUE;
    }
    seen.delete(value);
    return output;
};
const sanitizeObject = (value, config) => {
    const sanitized = sanitizeValue(value, config);
    return isPlainObject(sanitized) ? sanitized : {};
};
const jsonByteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const boundPayload = (payload, config) => {
    const sanitized = sanitizeObject(payload, config);
    if (jsonByteLength(sanitized) <= config.maxPayloadBytes) {
        return sanitized;
    }
    const bounded = {};
    const retainedKeys = [
        "source",
        "service_name",
        "environment",
        "event_type",
        "status",
        "summary",
        "project_id",
        "integration_id"
    ];
    for (const key of retainedKeys) {
        const value = sanitized[key];
        if (typeof value === "string") {
            bounded[key] = truncateText(value, 256);
        }
        else if (typeof value === "number" || typeof value === "boolean" || value === null) {
            bounded[key] = value;
        }
    }
    bounded.__truncated__ = "[TRUNCATED: payload exceeded configured byte limit]";
    return bounded;
};
const redactRemoteAddress = (value) => value ? REDACTED_VALUE : null;
const secureEqual = (actual, expected) => {
    const actualDigest = createHash("sha256").update(actual).digest();
    const expectedDigest = createHash("sha256").update(expected).digest();
    return timingSafeEqual(actualDigest, expectedDigest);
};
const normalizeUrl = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }
    try {
        return new URL(normalized).toString().replace(/\/+$/, "");
    }
    catch {
        return null;
    }
};
const buildPublicUrl = (baseUrl, routePath) => {
    if (!baseUrl) {
        return null;
    }
    try {
        return new URL(routePath, `${baseUrl}/`).toString();
    }
    catch {
        return null;
    }
};
const escapeHtml = (value) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const buildConfig = () => {
    const artifactRoot = normalizeText(process.env.ARTIFACT_ROOT) || "/artifacts";
    const publicBaseUrl = normalizeUrl(process.env.ENGINE_PUBLIC_URL);
    const environment = normalizeText(process.env.OPS_TELEMETRY_ENVIRONMENT)
        || normalizeText(process.env.OPS_ENVIRONMENT)
        || normalizeText(process.env.NODE_ENV)
        || "production";
    const apiKey = normalizeText(process.env.OPS_TELEMETRY_API_KEY);
    const isLocalEnvironment = LOCAL_ENVIRONMENTS.has(environment.toLowerCase());
    const allowUnauthenticatedLocal = isLocalEnvironment
        && normalizeBoolean(process.env.OPS_TELEMETRY_ALLOW_UNAUTHENTICATED_LOCAL, true);
    const authenticationRequired = Boolean(apiKey) || !allowUnauthenticatedLocal;
    const maxPayloadBytes = clampInteger(process.env.OPS_TELEMETRY_MAX_PAYLOAD_BYTES, 64 * 1024, 4 * 1024, 1024 * 1024);
    const requestedStoreBytes = clampInteger(process.env.OPS_TELEMETRY_MAX_STORE_BYTES, 16 * 1024 * 1024, 16 * 1024, 256 * 1024 * 1024);
    const apiKeyPrefix = Object.prototype.hasOwnProperty.call(process.env, "OPS_TELEMETRY_API_KEY_PREFIX")
        ? String(process.env.OPS_TELEMETRY_API_KEY_PREFIX ?? "")
        : "Bearer";
    return {
        enabled: process.env.OPS_TELEMETRY_ENABLED !== "false",
        serviceName: normalizeText(process.env.OPS_TELEMETRY_SERVICE_NAME)
            || normalizeText(process.env.OTEL_SERVICE_NAME)
            || "hellotest-testengine",
        environment,
        eventsPath: normalizePath(process.env.OPS_TELEMETRY_EVENTS_PATH, DEFAULT_EVENTS_PATH),
        boardPath: normalizePath(process.env.OPS_TELEMETRY_BOARD_PATH, DEFAULT_BOARD_PATH),
        servicesPath: DEFAULT_SERVICES_PATH,
        storePath: normalizeText(process.env.OPS_TELEMETRY_STORE_PATH)
            || path.join(artifactRoot, "ops-telemetry-events.ndjson"),
        maxEvents: clampInteger(process.env.OPS_TELEMETRY_MAX_EVENTS, 2000, 1, 10_000),
        publicBaseUrl,
        apiKey,
        apiKeyHeader: normalizeText(process.env.OPS_TELEMETRY_API_KEY_HEADER) || "Authorization",
        apiKeyPrefix: apiKeyPrefix.length ? apiKeyPrefix : null,
        authenticationRequired,
        authenticationMisconfigured: authenticationRequired && !apiKey,
        allowUnauthenticatedLocal,
        maxPayloadBytes,
        maxStringCharacters: clampInteger(process.env.OPS_TELEMETRY_MAX_STRING_CHARACTERS, 4096, 128, 16_384),
        maxDepth: clampInteger(process.env.OPS_TELEMETRY_MAX_DEPTH, 8, 2, 16),
        maxArrayItems: clampInteger(process.env.OPS_TELEMETRY_MAX_ARRAY_ITEMS, 100, 1, 500),
        maxObjectKeys: clampInteger(process.env.OPS_TELEMETRY_MAX_OBJECT_KEYS, 100, 1, 500),
        maxStoreBytes: Math.max(requestedStoreBytes, maxPayloadBytes * 4),
        retentionMs: clampInteger(process.env.OPS_TELEMETRY_RETENTION_HOURS, 24 * 7, 1, 24 * 365) * 60 * 60 * 1000
    };
};
const createStoredEvent = (rawPayload, remoteAddress, requestSource, config) => {
    const payload = boundPayload(rawPayload, config);
    return {
        id: randomUUID(),
        received_at: new Date().toISOString(),
        remote_address: redactRemoteAddress(remoteAddress),
        request_source: requestSource ? truncateText(requestSource, config.maxStringCharacters) : null,
        source: normalizeText(payload.source),
        service_name: normalizeText(payload.service_name),
        environment: normalizeText(payload.environment),
        event_type: normalizeText(payload.event_type),
        status: normalizeText(payload.status),
        summary: normalizeText(payload.summary),
        project_id: normalizeText(payload.project_id),
        integration_id: normalizeText(payload.integration_id),
        execution: isPlainObject(payload.execution) ? payload.execution : null,
        test_case: isPlainObject(payload.test_case) ? payload.test_case : null,
        suite: isPlainObject(payload.suite) ? payload.suite : null,
        step: isPlainObject(payload.step) ? payload.step : null,
        payload
    };
};
const normalizeStoredEvent = (value, config) => {
    if (!isPlainObject(value) || !normalizeText(value.id) || !normalizeText(value.received_at) || !isPlainObject(value.payload)) {
        return null;
    }
    const sanitized = sanitizeObject(value, config);
    const payload = isPlainObject(sanitized.payload) ? boundPayload(sanitized.payload, config) : null;
    if (!payload) {
        return null;
    }
    return {
        id: String(sanitized.id),
        received_at: String(sanitized.received_at),
        remote_address: (() => {
            const remoteAddress = normalizeText(sanitized.remote_address);
            return redactRemoteAddress(remoteAddress);
        })(),
        request_source: normalizeText(sanitized.request_source),
        source: normalizeText(sanitized.source) || normalizeText(payload.source),
        service_name: normalizeText(sanitized.service_name) || normalizeText(payload.service_name),
        environment: normalizeText(sanitized.environment) || normalizeText(payload.environment),
        event_type: normalizeText(sanitized.event_type) || normalizeText(payload.event_type),
        status: normalizeText(sanitized.status) || normalizeText(payload.status),
        summary: normalizeText(sanitized.summary) || normalizeText(payload.summary),
        project_id: normalizeText(sanitized.project_id) || normalizeText(payload.project_id),
        integration_id: normalizeText(sanitized.integration_id) || normalizeText(payload.integration_id),
        execution: isPlainObject(sanitized.execution) ? sanitized.execution : (isPlainObject(payload.execution) ? payload.execution : null),
        test_case: isPlainObject(sanitized.test_case) ? sanitized.test_case : (isPlainObject(payload.test_case) ? payload.test_case : null),
        suite: isPlainObject(sanitized.suite) ? sanitized.suite : (isPlainObject(payload.suite) ? payload.suite : null),
        step: isPlainObject(sanitized.step) ? sanitized.step : (isPlainObject(payload.step) ? payload.step : null),
        payload
    };
};
const serializeEventStore = (events) => events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : "";
const pruneEvents = (events, config, now = Date.now()) => {
    const cutoff = now - config.retentionMs;
    let retained = events.filter((event) => {
        const receivedAt = Date.parse(event.received_at);
        return Number.isFinite(receivedAt) && receivedAt >= cutoff && receivedAt <= now + 5 * 60 * 1000;
    });
    if (retained.length > config.maxEvents) {
        retained = retained.slice(-config.maxEvents);
    }
    let serialized = serializeEventStore(retained);
    while (retained.length && Buffer.byteLength(serialized, "utf8") > config.maxStoreBytes) {
        retained.shift();
        serialized = serializeEventStore(retained);
    }
    const changed = retained.length !== events.length || retained.some((event, index) => event.id !== events[index]?.id);
    events.splice(0, events.length, ...retained);
    return { changed, serialized };
};
const readStoreTail = async (storePath, maximumBytes) => {
    const handle = await openFile(storePath, "r");
    try {
        const fileStats = await handle.stat();
        const start = Math.max(0, fileStats.size - maximumBytes);
        const length = fileStats.size - start;
        const buffer = Buffer.alloc(length);
        if (length) {
            await handle.read(buffer, 0, length, start);
        }
        let raw = buffer.toString("utf8");
        if (start > 0) {
            const firstLineEnd = raw.indexOf("\n");
            raw = firstLineEnd >= 0 ? raw.slice(firstLineEnd + 1) : "";
        }
        return { raw, originalBytes: fileStats.size, truncated: start > 0 };
    }
    finally {
        await handle.close();
    }
};
const loadStoredEvents = async (config) => {
    const { raw, originalBytes, truncated } = await readStoreTail(config.storePath, config.maxStoreBytes);
    const loaded = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
        try {
            return normalizeStoredEvent(JSON.parse(line), config);
        }
        catch {
            return null;
        }
    })
        .filter((item) => Boolean(item));
    const beforePrune = loaded.length;
    const { changed, serialized } = pruneEvents(loaded, config);
    const canonicalRaw = raw.length && !raw.endsWith("\n") ? `${raw}\n` : raw;
    return {
        events: loaded,
        serialized,
        needsRewrite: truncated
            || originalBytes > config.maxStoreBytes
            || changed
            || beforePrune !== raw.split(/\r?\n/).filter(Boolean).length
            || serialized !== canonicalRaw
    };
};
const atomicWriteStore = async (storePath, serialized) => {
    const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, storePath);
    }
    catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
    }
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const withStoreLock = async (storePath, operation) => {
    const lockPath = `${storePath}.lock`;
    let lockHandle = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            lockHandle = await openFile(lockPath, "wx", 0o600);
            await lockHandle.writeFile(`${process.pid}\n${Date.now()}\n`, "utf8");
            break;
        }
        catch (error) {
            if (error?.code !== "EEXIST") {
                throw error;
            }
            if (attempt % 25 === 24) {
                try {
                    const lockStats = await stat(lockPath);
                    if (Date.now() - lockStats.mtimeMs > 30_000) {
                        await unlink(lockPath);
                        continue;
                    }
                }
                catch (lockError) {
                    if (lockError?.code !== "ENOENT") {
                        throw lockError;
                    }
                }
            }
            await wait(10);
        }
    }
    if (!lockHandle) {
        throw new Error("Timed out acquiring OPS telemetry event-store lock");
    }
    try {
        return await operation();
    }
    finally {
        await lockHandle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
    }
};
const buildSearchHaystack = (event) => [
    event.service_name,
    event.environment,
    event.event_type,
    event.status,
    event.summary,
    normalizeText(event.execution?.id),
    normalizeText(event.execution?.name),
    normalizeText(event.test_case?.id),
    normalizeText(event.test_case?.title),
    normalizeText(event.suite?.id),
    normalizeText(event.suite?.name),
    normalizeText(event.step?.id)
]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
const matchesFilter = (event, filters) => {
    if (filters.service_name && event.service_name !== filters.service_name) {
        return false;
    }
    if (filters.event_type && event.event_type !== filters.event_type) {
        return false;
    }
    if (filters.status && event.status !== filters.status) {
        return false;
    }
    if (filters.execution_id && normalizeText(event.execution?.id) !== filters.execution_id) {
        return false;
    }
    if (filters.test_case_id && normalizeText(event.test_case?.id) !== filters.test_case_id) {
        return false;
    }
    if (filters.suite_id && normalizeText(event.suite?.id) !== filters.suite_id) {
        return false;
    }
    if (filters.search && !buildSearchHaystack(event).includes(filters.search.toLowerCase())) {
        return false;
    }
    return true;
};
const renderBoardHtml = (config) => {
    const title = `${config.serviceName} OPS Telemetry`;
    const titleText = escapeHtml(title);
    const subtitleText = escapeHtml(`Execution hierarchy events stored on this Test Engine host. Filter by service, event type, status, or execution identifiers.`);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${titleText}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --panel: #ffffff;
        --panel-strong: #ffffff;
        --line: #dbe3ee;
        --text: #172033;
        --muted: #667085;
        --accent: #1767c2;
        --accent-soft: rgba(23, 103, 194, 0.10);
        --warn: #9a5b00;
        --danger: #b42318;
        --danger-soft: rgba(180, 35, 24, 0.10);
        --shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, "Segoe UI", system-ui, sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .shell {
        width: min(1320px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 40px;
      }
      .hero {
        display: grid;
        gap: 10px;
        padding: 24px 24px 18px;
        border-radius: 8px;
        background: var(--panel);
        border: 1px solid var(--line);
        box-shadow: var(--shadow);
      }
      .eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 6px 10px;
        border-radius: 6px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1.04;
      }
      .subtitle {
        margin: 0;
        max-width: 72ch;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.55;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 4px;
      }
      .pill {
        padding: 8px 12px;
        border-radius: 6px;
        background: #ffffff;
        border: 1px solid var(--line);
        font-size: 13px;
      }
      .grid {
        display: grid;
        gap: 16px;
        margin-top: 18px;
      }
      .controls,
      .summary,
      .events {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }
      .controls {
        padding: 18px;
      }
      .controls-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
      label {
        display: grid;
        gap: 7px;
        font-size: 13px;
        font-weight: 600;
        color: var(--muted);
      }
      input,
      select,
      button {
        font: inherit;
      }
      input,
      select {
        width: 100%;
        min-height: 42px;
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid var(--line);
        background: #ffffff;
        color: var(--text);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-top: 14px;
      }
      button {
        min-height: 42px;
        padding: 10px 16px;
        border: 0;
        border-radius: 6px;
        background: #1767c2;
        color: white;
        font-weight: 700;
        cursor: pointer;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.58;
      }
      .button-danger {
        background: var(--danger);
      }
      .button-secondary {
        background: #edf2f7;
        color: var(--text);
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(15, 23, 42, 0.46);
      }
      .modal-backdrop.is-open {
        display: flex;
      }
      .modal-card {
        width: min(420px, 100%);
        padding: 20px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
      }
      .modal-card h2 {
        margin: 0 0 8px;
        color: var(--danger);
        font-size: 20px;
      }
      .modal-card p {
        margin: 0;
        color: var(--muted);
      }
      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 18px;
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--muted);
      }
      .toggle input {
        width: auto;
        min-height: auto;
      }
      .summary {
        padding: 18px;
      }
      .summary-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
      .summary-card {
        padding: 14px 15px;
        border-radius: 8px;
        background: var(--panel-strong);
        border: 1px solid var(--line);
      }
      .summary-card span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 8px;
      }
      .summary-card strong {
        display: block;
        font-size: 18px;
      }
      .events {
        padding: 16px;
      }
      .events-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        padding: 6px 6px 14px;
      }
      .events-head strong {
        font-size: 18px;
      }
      .events-meta {
        font-size: 13px;
        color: var(--muted);
      }
      .event-list {
        display: grid;
        gap: 12px;
      }
      .event-card {
        padding: 16px;
        border-radius: 8px;
        background: var(--panel-strong);
        border: 1px solid var(--line);
      }
      .event-top,
      .event-bottom {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: space-between;
      }
      .event-top strong {
        font-size: 16px;
      }
      .event-top small,
      .event-bottom small {
        color: var(--muted);
      }
      .event-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0;
      }
      .tag {
        padding: 6px 10px;
        border-radius: 6px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
      }
      .tag.status-failed {
        background: rgba(166, 90, 0, 0.12);
        color: var(--warn);
      }
      .summary-line {
        margin: 0 0 12px;
        color: var(--text);
        line-height: 1.55;
      }
      details {
        margin-top: 10px;
      }
      details summary {
        cursor: pointer;
        color: var(--accent);
        font-weight: 700;
      }
      pre {
        margin: 12px 0 0;
        padding: 14px;
        overflow: auto;
        border-radius: 8px;
        background: #111827;
        color: #e5e7eb;
        font-size: 12px;
        line-height: 1.5;
      }
      .empty {
        padding: 26px 18px;
        border-radius: 8px;
        border: 1px dashed var(--line);
        color: var(--muted);
        text-align: center;
      }
      .error {
        margin-top: 12px;
        padding: 12px 14px;
        border-radius: 8px;
        background: rgba(166, 90, 0, 0.12);
        color: var(--warn);
        display: none;
      }
      .notice {
        margin-top: 12px;
        padding: 12px 14px;
        border-radius: 8px;
        background: var(--accent-soft);
        color: var(--accent);
        display: none;
      }
      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 1320px);
          padding-top: 20px;
        }
        .hero,
        .controls,
        .summary,
        .events {
          border-radius: 8px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <span class="eyebrow">OPS Telemetry</span>
        <h1>${titleText}</h1>
        <p class="subtitle">${subtitleText}</p>
        <div class="meta">
          <span class="pill">Service label: ${escapeHtml(config.serviceName)}</span>
          <span class="pill">Environment: ${escapeHtml(config.environment)}</span>
          <span class="pill">Events route: ${escapeHtml(config.eventsPath)}</span>
          <span class="pill">Board route: ${escapeHtml(config.boardPath)}</span>
        </div>
      </section>

      <div class="grid">
        <section class="controls">
          <div class="controls-grid">
            <label>
              Service
              <select id="serviceFilter">
                <option value="">All services</option>
              </select>
            </label>
            <label>
              Event Type
              <input id="eventTypeFilter" placeholder="execution.step.updated" />
            </label>
            <label>
              Status
              <input id="statusFilter" placeholder="passed, failed, running" />
            </label>
            <label>
              Execution ID
              <input id="executionFilter" placeholder="Execution id" />
            </label>
            <label>
              Search
              <input id="searchFilter" placeholder="Case title, suite, summary" />
            </label>
            <label>
              Limit
              <select id="limitFilter">
                <option value="25">25</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </label>
          </div>
          <div class="actions">
            <button id="refreshButton" type="button">Refresh Board</button>
            <button class="button-danger" id="clearButton" type="button">Delete Telemetry Logs</button>
            <label class="toggle">
              <input id="autoRefreshToggle" checked type="checkbox" />
              Auto refresh every 5 seconds
            </label>
          </div>
          <div class="notice" id="noticeBox"></div>
          <div class="error" id="errorBox"></div>
        </section>

        <section class="summary">
          <div class="summary-grid" id="summaryGrid"></div>
        </section>

        <section class="events">
          <div class="events-head">
            <strong>Captured events</strong>
            <span class="events-meta" id="eventsMeta">Waiting for data...</span>
          </div>
          <div class="event-list" id="eventList"></div>
        </section>
      </div>
    </main>

    <div class="modal-backdrop" id="deleteModal" role="presentation">
      <div aria-labelledby="deleteModalTitle" aria-modal="true" class="modal-card" role="dialog">
        <h2 id="deleteModalTitle">Delete telemetry logs?</h2>
        <p>Delete all captured OPS telemetry logs from this Test Engine host? This cannot be undone.</p>
        <div class="modal-actions">
          <button class="button-secondary" id="cancelDeleteButton" type="button">Cancel</button>
          <button class="button-danger" id="confirmDeleteButton" type="button">Delete logs</button>
        </div>
      </div>
    </div>

    <script>
      const EVENTS_PATH = ${JSON.stringify(config.eventsPath)};
      const SERVICES_PATH = ${JSON.stringify(config.servicesPath)};
      const SEARCH = new URLSearchParams(window.location.search);

      const serviceFilter = document.getElementById("serviceFilter");
      const eventTypeFilter = document.getElementById("eventTypeFilter");
      const statusFilter = document.getElementById("statusFilter");
      const executionFilter = document.getElementById("executionFilter");
      const searchFilter = document.getElementById("searchFilter");
      const limitFilter = document.getElementById("limitFilter");
      const refreshButton = document.getElementById("refreshButton");
      const clearButton = document.getElementById("clearButton");
      const autoRefreshToggle = document.getElementById("autoRefreshToggle");
      const summaryGrid = document.getElementById("summaryGrid");
      const eventList = document.getElementById("eventList");
      const eventsMeta = document.getElementById("eventsMeta");
      const noticeBox = document.getElementById("noticeBox");
      const errorBox = document.getElementById("errorBox");
      const deleteModal = document.getElementById("deleteModal");
      const cancelDeleteButton = document.getElementById("cancelDeleteButton");
      const confirmDeleteButton = document.getElementById("confirmDeleteButton");

      const initialService = SEARCH.get("service_name") || "";
      if (initialService) {
        serviceFilter.value = initialService;
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function buildQuery() {
        const params = new URLSearchParams();

        if (serviceFilter.value) params.set("service_name", serviceFilter.value);
        if (eventTypeFilter.value.trim()) params.set("event_type", eventTypeFilter.value.trim());
        if (statusFilter.value.trim()) params.set("status", statusFilter.value.trim());
        if (executionFilter.value.trim()) params.set("execution_id", executionFilter.value.trim());
        if (searchFilter.value.trim()) params.set("search", searchFilter.value.trim());
        params.set("limit", limitFilter.value || "50");
        return params;
      }

      async function fetchJson(url) {
        const response = await fetch(url, {
          headers: { accept: "application/json" }
        });

        if (!response.ok) {
          throw new Error("Request failed with status " + response.status);
        }

        return response.json();
      }

      function setError(message) {
        if (!message) {
          errorBox.style.display = "none";
          errorBox.textContent = "";
          return;
        }

        errorBox.style.display = "block";
        errorBox.textContent = message;
      }

      function setNotice(message) {
        if (!message) {
          noticeBox.style.display = "none";
          noticeBox.textContent = "";
          return;
        }

        noticeBox.style.display = "block";
        noticeBox.textContent = message;
      }

      function renderSummary(eventsPayload, servicesPayload) {
        const items = Array.isArray(eventsPayload.items) ? eventsPayload.items : [];
        const services = Array.isArray(servicesPayload.items) ? servicesPayload.items : [];
        const latest = items[0];
        const cards = [
          { label: "Visible events", value: String(items.length) },
          { label: "Matching total", value: String(eventsPayload.total || 0) },
          { label: "Services", value: String(services.length) },
          { label: "Latest event", value: latest ? (latest.event_type || "unknown") : "None yet" },
          { label: "Latest service", value: latest ? (latest.service_name || "unlabeled") : "None yet" },
          { label: "Last received", value: latest ? new Date(latest.received_at).toLocaleString() : "No events yet" }
        ];

        summaryGrid.innerHTML = cards.map((card) => \`
          <article class="summary-card">
            <span>\${escapeHtml(card.label)}</span>
            <strong>\${escapeHtml(card.value)}</strong>
          </article>
        \`).join("");
      }

      function renderServiceOptions(servicesPayload) {
        const items = Array.isArray(servicesPayload.items) ? servicesPayload.items : [];
        const currentValue = serviceFilter.value;
        const options = ['<option value="">All services</option>']
          .concat(items.map((item) => \`<option value="\${escapeHtml(item.service_name || "")}">\${escapeHtml(item.service_name || "unlabeled")} (\${item.count})</option>\`));
        serviceFilter.innerHTML = options.join("");
        serviceFilter.value = currentValue;
      }

      function renderEvents(eventsPayload) {
        const items = Array.isArray(eventsPayload.items) ? eventsPayload.items : [];
        eventsMeta.textContent = items.length
          ? \`Showing \${items.length} of \${eventsPayload.total || items.length} matching events\`
          : "No matching events yet";

        if (!items.length) {
          eventList.innerHTML = '<div class="empty">No captured OPS telemetry matched the current filters.</div>';
          return;
        }

        eventList.innerHTML = items.map((item) => {
          const execution = item.execution || {};
          const testCase = item.test_case || {};
          const suite = item.suite || {};
          const step = item.step || {};
          const statusClass = item.status === "failed" ? "tag status-failed" : "tag";
          return \`
            <article class="event-card">
              <div class="event-top">
                <div>
                  <strong>\${escapeHtml(item.event_type || "unknown.event")}</strong>
                  <br />
                  <small>\${escapeHtml(new Date(item.received_at).toLocaleString())}</small>
                </div>
                <div>
                  <small>\${escapeHtml(item.service_name || "unlabeled service")}</small>
                </div>
              </div>
              <div class="event-tags">
                <span class="tag">\${escapeHtml(item.environment || "environment: n/a")}</span>
                <span class="\${statusClass}">\${escapeHtml(item.status || "status: n/a")}</span>
                \${execution.id ? \`<span class="tag">execution: \${escapeHtml(execution.id)}</span>\` : ""}
                \${testCase.id ? \`<span class="tag">case: \${escapeHtml(testCase.id)}</span>\` : ""}
                \${suite.id ? \`<span class="tag">suite: \${escapeHtml(suite.id)}</span>\` : ""}
                \${step.id ? \`<span class="tag">step: \${escapeHtml(step.id)}</span>\` : ""}
              </div>
              <p class="summary-line">\${escapeHtml(item.summary || "No summary provided for this event.")}</p>
              <div class="event-bottom">
                <small>\${escapeHtml(execution.name || testCase.title || suite.name || "")}</small>
                <small>\${escapeHtml(item.request_source || item.source || "")}</small>
              </div>
              <details>
                <summary>Show raw payload</summary>
                <pre>\${escapeHtml(JSON.stringify(item.payload || {}, null, 2))}</pre>
              </details>
            </article>
          \`;
        }).join("");
      }

      async function loadBoard() {
        setError("");
        const query = buildQuery();

        try {
          const [eventsPayload, servicesPayload] = await Promise.all([
            fetchJson(EVENTS_PATH + "?" + query.toString()),
            fetchJson(SERVICES_PATH)
          ]);

          renderServiceOptions(servicesPayload);
          renderSummary(eventsPayload, servicesPayload);
          renderEvents(eventsPayload);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Unable to load telemetry events.");
        }
      }

      async function clearTelemetryLogs() {
        setError("");
        setNotice("");
        clearButton.disabled = true;
        confirmDeleteButton.disabled = true;
        clearButton.textContent = "Deleting...";
        confirmDeleteButton.textContent = "Deleting...";

        try {
          const response = await fetch(EVENTS_PATH, {
            method: "DELETE",
            headers: { accept: "application/json" }
          });
          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            throw new Error((payload && payload.message) || "Delete failed with status " + response.status);
          }

          const deleted = Number((payload && payload.deleted) || 0);
          setNotice("Deleted " + deleted + " telemetry log" + (deleted === 1 ? "" : "s") + ".");
          await loadBoard();
        } catch (error) {
          setError(error instanceof Error ? error.message : "Unable to delete telemetry logs.");
        } finally {
          clearButton.disabled = false;
          confirmDeleteButton.disabled = false;
          clearButton.textContent = "Delete Telemetry Logs";
          confirmDeleteButton.textContent = "Delete logs";
          closeDeleteModal();
        }
      }

      function openDeleteModal() {
        deleteModal.classList.add("is-open");
        confirmDeleteButton.focus();
      }

      function closeDeleteModal() {
        deleteModal.classList.remove("is-open");
      }

      refreshButton.addEventListener("click", () => { void loadBoard(); });
      clearButton.addEventListener("click", () => { openDeleteModal(); });
      cancelDeleteButton.addEventListener("click", () => { closeDeleteModal(); });
      confirmDeleteButton.addEventListener("click", () => { void clearTelemetryLogs(); });
      deleteModal.addEventListener("click", (event) => {
        if (event.target === deleteModal) {
          closeDeleteModal();
        }
      });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && deleteModal.classList.contains("is-open")) {
          closeDeleteModal();
        }
      });

      [serviceFilter, eventTypeFilter, statusFilter, executionFilter, searchFilter, limitFilter].forEach((element) => {
        element.addEventListener("change", () => { void loadBoard(); });
        element.addEventListener("keyup", (event) => {
          if (event.key === "Enter") {
            void loadBoard();
          }
        });
      });

      window.setInterval(() => {
        if (autoRefreshToggle.checked) {
          void loadBoard();
        }
      }, 5000);

      void loadBoard();
    </script>
  </body>
</html>`;
};
export const createOpsTelemetry = async (logger) => {
    const config = buildConfig();
    const events = [];
    let writeQueue = Promise.resolve();
    await mkdir(path.dirname(config.storePath), { recursive: true });
    try {
        const loaded = await withStoreLock(config.storePath, async () => {
            try {
                const snapshot = await loadStoredEvents(config);
                if (snapshot.needsRewrite) {
                    await atomicWriteStore(config.storePath, snapshot.serialized);
                }
                return snapshot.events;
            }
            catch (error) {
                if (error?.code === "ENOENT") {
                    await atomicWriteStore(config.storePath, "");
                    return [];
                }
                throw error;
            }
        });
        events.push(...loaded);
    }
    catch (error) {
        logger.warn({ error }, "Unable to preload OPS telemetry events");
    }
    if (config.authenticationMisconfigured && config.enabled) {
        logger.error({
            ops_telemetry: true,
            environment: config.environment,
            api_key_header: config.apiKeyHeader
        }, "OPS telemetry HTTP routes are locked because authentication is not configured for this environment");
    }
    const compactStoreWithEvent = async (event) => {
        let durableEvents = [];
        try {
            durableEvents = (await loadStoredEvents(config)).events;
        }
        catch (error) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
        }
        if (!durableEvents.some((item) => item.id === event.id)) {
            durableEvents.push(event);
        }
        durableEvents.sort((left, right) => Date.parse(left.received_at) - Date.parse(right.received_at));
        const { serialized } = pruneEvents(durableEvents, config);
        await atomicWriteStore(config.storePath, serialized);
    };
    const persistEvent = (event, forceCompaction) => {
        writeQueue = writeQueue
            .then(() => withStoreLock(config.storePath, async () => {
            const serialized = `${JSON.stringify(event)}\n`;
            const eventBytes = Buffer.byteLength(serialized, "utf8");
            let currentBytes = 0;
            try {
                currentBytes = (await stat(config.storePath)).size;
            }
            catch (error) {
                if (error?.code !== "ENOENT") {
                    throw error;
                }
            }
            if (forceCompaction || currentBytes + eventBytes > config.maxStoreBytes) {
                await compactStoreWithEvent(event);
                return;
            }
            await appendFile(config.storePath, serialized, { encoding: "utf8", mode: 0o600 });
        }))
            .catch((error) => {
            logger.error({ error, storePath: config.storePath }, "Unable to persist OPS telemetry event");
        });
    };
    const storeEvent = (payload, remoteAddress, requestSource) => {
        if (!config.enabled) {
            return null;
        }
        const storedEvent = createStoredEvent(payload, remoteAddress, requestSource, config);
        events.push(storedEvent);
        const { changed } = pruneEvents(events, config);
        persistEvent(storedEvent, changed);
        logger.info({
            ops_telemetry: true,
            event_id: storedEvent.id,
            event_type: storedEvent.event_type,
            service_name: storedEvent.service_name,
            status: storedEvent.status,
            execution_id: normalizeText(storedEvent.execution?.id),
            test_case_id: normalizeText(storedEvent.test_case?.id),
            suite_id: normalizeText(storedEvent.suite?.id),
            step_id: normalizeText(storedEvent.step?.id)
        }, "OPS telemetry event captured");
        return storedEvent;
    };
    const listEvents = (query) => {
        const filters = {
            service_name: normalizeText(query.service_name),
            event_type: normalizeText(query.event_type),
            status: normalizeText(query.status),
            execution_id: normalizeText(query.execution_id),
            test_case_id: normalizeText(query.test_case_id),
            suite_id: normalizeText(query.suite_id),
            search: normalizeText(query.search)
        };
        const limit = Math.min(500, Math.max(1, normalizeInteger(query.limit, 50)));
        const filtered = [...events]
            .reverse()
            .filter((event) => matchesFilter(event, filters));
        return {
            ok: true,
            total: filtered.length,
            limit,
            items: filtered.slice(0, limit)
        };
    };
    const listServices = () => {
        const summary = new Map();
        [...events].reverse().forEach((event) => {
            const serviceName = event.service_name || "unlabeled";
            const current = summary.get(serviceName);
            if (!current) {
                summary.set(serviceName, {
                    service_name: serviceName,
                    count: 1,
                    last_received_at: event.received_at
                });
                return;
            }
            current.count += 1;
        });
        return {
            ok: true,
            items: [...summary.values()].sort((left, right) => right.count - left.count || left.service_name.localeCompare(right.service_name))
        };
    };
    const clearEvents = async () => {
        const deleted = events.length;
        events.splice(0, events.length);
        writeQueue = writeQueue
            .then(() => withStoreLock(config.storePath, () => atomicWriteStore(config.storePath, "")))
            .catch((error) => {
            logger.error({ error, storePath: config.storePath }, "Unable to clear OPS telemetry event store");
        });
        await writeQueue;
        logger.warn({
            ops_telemetry: true,
            deleted
        }, "OPS telemetry events cleared");
        return {
            ok: true,
            deleted
        };
    };
    const getHealthSnapshot = () => ({
        enabled: config.enabled,
        service_name: config.serviceName,
        environment: config.environment,
        stored_events: events.length,
        last_received_at: events.length ? events[events.length - 1]?.received_at || null : null,
        events_path: config.eventsPath,
        events_url: buildPublicUrl(config.publicBaseUrl, config.eventsPath),
        board_path: config.boardPath,
        board_url: buildPublicUrl(config.publicBaseUrl, config.boardPath),
        services_path: config.servicesPath,
        services_url: buildPublicUrl(config.publicBaseUrl, config.servicesPath),
        authentication_required: config.authenticationRequired,
        authentication_configured: Boolean(config.apiKey),
        authentication_ready: !config.authenticationMisconfigured,
        unauthenticated_local_access: config.allowUnauthenticatedLocal,
        max_events: config.maxEvents,
        max_payload_bytes: config.maxPayloadBytes,
        max_store_bytes: config.maxStoreBytes,
        retention_hours: Math.round(config.retentionMs / (60 * 60 * 1000))
    });
    const authorizeRequest = (headers) => {
        if (!config.authenticationRequired) {
            return true;
        }
        if (!config.apiKey) {
            return false;
        }
        const headerLookup = config.apiKeyHeader.toLowerCase();
        const actualHeader = Object.entries(headers).find(([name]) => name.toLowerCase() === headerLookup)?.[1];
        const actualValue = Array.isArray(actualHeader) ? actualHeader[0] : actualHeader;
        if (typeof actualValue !== "string") {
            return false;
        }
        const expectedValue = config.apiKeyPrefix ? `${config.apiKeyPrefix} ${config.apiKey}` : config.apiKey;
        return secureEqual(actualValue.trim(), expectedValue);
    };
    const authorizeRoute = (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!config.enabled) {
            reply.code(503).send({ message: "OPS telemetry is disabled" });
            return false;
        }
        if (config.authenticationMisconfigured) {
            reply.code(503).send({ message: "OPS telemetry authentication is not configured for this environment" });
            return false;
        }
        if (!authorizeRequest(request.headers)) {
            if (config.apiKeyHeader.toLowerCase() === "authorization") {
                reply.header("WWW-Authenticate", `${config.apiKeyPrefix || "Bearer"} realm="ops-telemetry"`);
            }
            reply.code(401).send({ message: "Unauthorized OPS telemetry request" });
            return false;
        }
        return true;
    };
    const receiveEvent = async (app, routePath) => {
        app.post(routePath, { bodyLimit: config.maxPayloadBytes }, async (request, reply) => {
            if (!authorizeRoute(request, reply)) {
                return reply;
            }
            if (!isPlainObject(request.body)) {
                reply.code(400);
                return {
                    message: "OPS telemetry expects a JSON object payload"
                };
            }
            const storedEvent = storeEvent(request.body, normalizeText(request.ip), normalizeText(request.headers["x-hellotest-source"]));
            reply.code(202);
            return {
                accepted: true,
                id: storedEvent.id,
                received_at: storedEvent.received_at
            };
        });
        app.get(routePath, async (request, reply) => {
            if (!authorizeRoute(request, reply)) {
                return reply;
            }
            return listEvents(request.query);
        });
        app.delete(routePath, async (request, reply) => {
            if (!authorizeRoute(request, reply)) {
                return reply;
            }
            return clearEvents();
        });
    };
    return {
        async register(app) {
            const routePaths = new Set([DEFAULT_EVENTS_PATH, config.eventsPath]);
            for (const routePath of routePaths) {
                await receiveEvent(app, routePath);
            }
            app.get(config.servicesPath, async (request, reply) => {
                if (!authorizeRoute(request, reply)) {
                    return reply;
                }
                return listServices();
            });
            app.get(config.boardPath, async (request, reply) => {
                if (!authorizeRoute(request, reply)) {
                    return reply;
                }
                reply.header("X-Content-Type-Options", "nosniff");
                reply.header("Referrer-Policy", "no-referrer");
                reply.type("text/html; charset=utf-8");
                return renderBoardHtml(config);
            });
            app.addHook("onClose", async () => {
                await writeQueue;
            });
        },
        captureLocalEvent(payload) {
            const normalizedPayload = {
                service_name: config.serviceName,
                environment: config.environment,
                source: "testengine",
                ...payload
            };
            return storeEvent(normalizedPayload, null, "testengine-local");
        },
        getHealthSnapshot
    };
};
