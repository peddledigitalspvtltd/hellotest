import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";

type JsonObject = Record<string, unknown>;

type StoredTelemetryEvent = {
  id: string;
  received_at: string;
  remote_address: string | null;
  request_source: string | null;
  source: string | null;
  service_name: string | null;
  environment: string | null;
  event_type: string | null;
  status: string | null;
  summary: string | null;
  project_id: string | null;
  integration_id: string | null;
  execution: JsonObject | null;
  test_case: JsonObject | null;
  suite: JsonObject | null;
  step: JsonObject | null;
  payload: JsonObject;
};

type TelemetryConfig = {
  enabled: boolean;
  serviceName: string;
  environment: string;
  eventsPath: string;
  boardPath: string;
  servicesPath: string;
  storePath: string;
  maxEvents: number;
  publicBaseUrl: string | null;
  apiKey: string | null;
  apiKeyHeader: string;
  apiKeyPrefix: string | null;
};

const DEFAULT_EVENTS_PATH = "/api/v1/events";
const DEFAULT_BOARD_PATH = "/ops-telemetry";
const DEFAULT_SERVICES_PATH = "/api/v1/ops-telemetry/services";

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizePath = (value: unknown, fallback: string): string => {
  const normalized = normalizeText(value) || fallback;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const normalizeInteger = (value: unknown, fallback: number): number => {
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

const isPlainObject = (value: unknown): value is JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeUrl = (value: unknown): string | null => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
};

const buildPublicUrl = (baseUrl: string | null, routePath: string): string | null => {
  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(routePath, `${baseUrl}/`).toString();
  } catch {
    return null;
  }
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildConfig = (): TelemetryConfig => {
  const artifactRoot = normalizeText(process.env.ARTIFACT_ROOT) || "/artifacts";
  const publicBaseUrl = normalizeUrl(process.env.ENGINE_PUBLIC_URL);
  const apiKeyPrefix = Object.prototype.hasOwnProperty.call(process.env, "OPS_TELEMETRY_API_KEY_PREFIX")
    ? String(process.env.OPS_TELEMETRY_API_KEY_PREFIX ?? "")
    : "Bearer";

  return {
    enabled: process.env.OPS_TELEMETRY_ENABLED !== "false",
    serviceName:
      normalizeText(process.env.OPS_TELEMETRY_SERVICE_NAME)
      || normalizeText(process.env.OTEL_SERVICE_NAME)
      || "hellotest-testengine",
    environment:
      normalizeText(process.env.OPS_TELEMETRY_ENVIRONMENT)
      || normalizeText(process.env.OPS_ENVIRONMENT)
      || process.env.NODE_ENV
      || "production",
    eventsPath: normalizePath(process.env.OPS_TELEMETRY_EVENTS_PATH, DEFAULT_EVENTS_PATH),
    boardPath: normalizePath(process.env.OPS_TELEMETRY_BOARD_PATH, DEFAULT_BOARD_PATH),
    servicesPath: DEFAULT_SERVICES_PATH,
    storePath:
      normalizeText(process.env.OPS_TELEMETRY_STORE_PATH)
      || path.join(artifactRoot, "ops-telemetry-events.ndjson"),
    maxEvents: Math.max(100, normalizeInteger(process.env.OPS_TELEMETRY_MAX_EVENTS, 2000)),
    publicBaseUrl,
    apiKey: normalizeText(process.env.OPS_TELEMETRY_API_KEY),
    apiKeyHeader: normalizeText(process.env.OPS_TELEMETRY_API_KEY_HEADER) || "Authorization",
    apiKeyPrefix: apiKeyPrefix.length ? apiKeyPrefix : null
  };
};

const createStoredEvent = (payload: JsonObject, remoteAddress: string | null, requestSource: string | null): StoredTelemetryEvent => ({
  id: randomUUID(),
  received_at: new Date().toISOString(),
  remote_address: remoteAddress,
  request_source: requestSource,
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
});

const normalizeStoredEvent = (value: unknown): StoredTelemetryEvent | null => {
  if (!isPlainObject(value) || !normalizeText(value.id) || !normalizeText(value.received_at) || !isPlainObject(value.payload)) {
    return null;
  }

  return {
    id: String(value.id),
    received_at: String(value.received_at),
    remote_address: normalizeText(value.remote_address),
    request_source: normalizeText(value.request_source),
    source: normalizeText(value.source),
    service_name: normalizeText(value.service_name),
    environment: normalizeText(value.environment),
    event_type: normalizeText(value.event_type),
    status: normalizeText(value.status),
    summary: normalizeText(value.summary),
    project_id: normalizeText(value.project_id),
    integration_id: normalizeText(value.integration_id),
    execution: isPlainObject(value.execution) ? value.execution : null,
    test_case: isPlainObject(value.test_case) ? value.test_case : null,
    suite: isPlainObject(value.suite) ? value.suite : null,
    step: isPlainObject(value.step) ? value.step : null,
    payload: value.payload
  };
};

const buildSearchHaystack = (event: StoredTelemetryEvent) =>
  [
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

const matchesFilter = (event: StoredTelemetryEvent, filters: Record<string, string | null>) => {
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

const renderBoardHtml = (config: TelemetryConfig) => {
  const title = `${config.serviceName} OPS Telemetry`;
  const titleText = escapeHtml(title);
  const subtitleText = escapeHtml(
    `Execution hierarchy events stored on this Test Engine host. Filter by service, event type, status, or execution identifiers.`
  );

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

export const createOpsTelemetry = async (logger: FastifyBaseLogger) => {
  const config = buildConfig();
  const events: StoredTelemetryEvent[] = [];
  let writeQueue = Promise.resolve();

  await mkdir(path.dirname(config.storePath), { recursive: true });

  try {
    const raw = await readFile(config.storePath, "utf8");
    const loaded = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return normalizeStoredEvent(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((item): item is StoredTelemetryEvent => Boolean(item));

    if (loaded.length > config.maxEvents) {
      loaded.splice(0, loaded.length - config.maxEvents);
    }

    events.push(...loaded);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logger.warn({ error }, "Unable to preload OPS telemetry events");
    }
  }

  const persistEvent = (event: StoredTelemetryEvent) => {
    writeQueue = writeQueue
      .then(() => appendFile(config.storePath, `${JSON.stringify(event)}\n`, "utf8"))
      .catch((error) => {
        logger.error({ error, storePath: config.storePath }, "Unable to persist OPS telemetry event");
      });
  };

  const storeEvent = (
    payload: JsonObject,
    remoteAddress: string | null,
    requestSource: string | null
  ): StoredTelemetryEvent | null => {
    if (!config.enabled) {
      return null;
    }

    const storedEvent = createStoredEvent(payload, remoteAddress, requestSource);

    events.push(storedEvent);
    if (events.length > config.maxEvents) {
      events.splice(0, events.length - config.maxEvents);
    }

    persistEvent(storedEvent);

    logger.info(
      {
        ops_telemetry: true,
        event_id: storedEvent.id,
        event_type: storedEvent.event_type,
        service_name: storedEvent.service_name,
        status: storedEvent.status,
        execution_id: normalizeText(storedEvent.execution?.id),
        test_case_id: normalizeText(storedEvent.test_case?.id),
        suite_id: normalizeText(storedEvent.suite?.id),
        step_id: normalizeText(storedEvent.step?.id)
      },
      "OPS telemetry event captured"
    );

    return storedEvent;
  };

  const listEvents = (query: Record<string, unknown>) => {
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
    const summary = new Map<string, { service_name: string; count: number; last_received_at: string }>();

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
      .then(() => writeFile(config.storePath, "", "utf8"))
      .catch((error) => {
        logger.error({ error, storePath: config.storePath }, "Unable to clear OPS telemetry event store");
      });
    await writeQueue;

    logger.warn(
      {
        ops_telemetry: true,
        deleted
      },
      "OPS telemetry events cleared"
    );

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
    services_url: buildPublicUrl(config.publicBaseUrl, config.servicesPath)
  });

  const authorizeRequest = (headers: Record<string, unknown>) => {
    if (!config.apiKey) {
      return true;
    }

    const headerLookup = config.apiKeyHeader.toLowerCase();
    const actualHeader = Object.entries(headers).find(([name]) => name.toLowerCase() === headerLookup)?.[1];

    if (typeof actualHeader !== "string") {
      return false;
    }

    const expectedValue = config.apiKeyPrefix ? `${config.apiKeyPrefix} ${config.apiKey}` : config.apiKey;
    return actualHeader.trim() === expectedValue;
  };

  const receiveEvent = async (app: FastifyInstance, routePath: string) => {
    app.post(routePath, async (request, reply) => {
      if (!config.enabled) {
        reply.code(503);
        return {
          message: "OPS telemetry is disabled"
        };
      }

      if (!authorizeRequest(request.headers as Record<string, unknown>)) {
        reply.code(401);
        return {
          message: "Unauthorized OPS telemetry request"
        };
      }

      if (!isPlainObject(request.body)) {
        reply.code(400);
        return {
          message: "OPS telemetry expects a JSON object payload"
        };
      }

      const storedEvent = storeEvent(
        request.body,
        normalizeText(request.ip),
        normalizeText(request.headers["x-hellotest-source"])
      )!;

      reply.code(202);
      return {
        accepted: true,
        id: storedEvent.id,
        received_at: storedEvent.received_at
      };
    });

    app.get(routePath, async (request) => listEvents(request.query as Record<string, unknown>));
    app.delete(routePath, async (request, reply) => {
      if (!config.enabled) {
        reply.code(503);
        return {
          message: "OPS telemetry is disabled"
        };
      }

      if (!authorizeRequest(request.headers as Record<string, unknown>)) {
        reply.code(401);
        return {
          message: "Unauthorized OPS telemetry request"
        };
      }

      return clearEvents();
    });
  };

  return {
    async register(app: FastifyInstance) {
      const routePaths = new Set([DEFAULT_EVENTS_PATH, config.eventsPath]);

      for (const routePath of routePaths) {
        await receiveEvent(app, routePath);
      }

      app.get(config.servicesPath, async () => listServices());
      app.get(config.boardPath, async (_request, reply) => {
        reply.type("text/html; charset=utf-8");
        return renderBoardHtml(config);
      });
    },
    captureLocalEvent(payload: JsonObject) {
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
