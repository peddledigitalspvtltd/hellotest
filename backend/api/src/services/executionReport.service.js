const executionService = require("./execution.service");
const executionResultService = require("./executionResult.service");
const emailService = require("./email.service");
const aiLlmSelectionService = require("./aiLlmSelection.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const { createLlmProviderError } = require("../utils/upstreamLlmError");
const { fetchLlmWithRetry } = require("../utils/llmHttpClient");
const { getCompletionContent } = require("../utils/llmResponse");

const configuredAiAnalysisTimeoutMs = Number(process.env.REPORT_AI_ANALYSIS_TIMEOUT_MS || process.env.LLM_REQUEST_TIMEOUT_MS || 90_000);
const AI_ANALYSIS_TIMEOUT_MS = Number.isFinite(configuredAiAnalysisTimeoutMs)
  ? Math.max(3_000, configuredAiAnalysisTimeoutMs)
  : 90_000;
const AI_ANALYSIS_FAILED_CASE_LIMIT = 20;

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeTextArray = (value, fallback = []) => {
  const entries = Array.isArray(value) ? value : fallback;
  return entries.map((item) => normalizeText(item)).filter(Boolean).slice(0, 8);
};

const reportCaseTitle = (testCase) => `${testCase.title}${testCase.data_set_iteration_index !== null && testCase.data_set_iteration_index !== undefined ? ` · Data row ${testCase.data_set_iteration_index + 1}` : testCase.data_set_iteration_key ? ` · ${testCase.data_set_iteration_key}` : ""}`;

const formatDate = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "Not recorded";
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? normalized : date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
};

const formatDuration = (value) => {
  const ms = Number(value || 0);

  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }

  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (!minutes) {
    return `${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${hours}h ${remainingMinutes}m`;
};

const { buildExecutionReportModel } = require("./executionReportModel");
const { renderDetailedExecutionHtml, REPORT_CSP } = require("./executionReportHtml");

const buildReportModel = async (executionId) => {
  const execution = await executionService.getExecution(executionId);
  const results = await executionResultService.getExecutionResults({ execution_id: executionId });
  return buildExecutionReportModel(execution, results);
};

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("LLM response was empty");
  }

  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonCandidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  return JSON.parse(jsonCandidate);
};

const createUnavailableAiAnalysis = (reason = "AI analysis was not available for this report.") => ({
  status: "unavailable",
  headline: "AI analysis unavailable",
  summary: reason,
  risk_level: "unknown",
  key_findings: [],
  recommended_actions: [],
  failed_cases: [],
  generated_at: new Date().toISOString()
});

const buildAiAnalysisPrompt = (report) => {
  const notExecuted = report.summary.running || 0;
  const failedSuites = report.suites
    .filter((suite) => suite.failed || suite.blocked || suite.running)
    .map((suite) => ({
      suite: suite.name,
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      blocked: suite.blocked,
      not_executed: suite.running,
      duration: formatDuration(suite.duration_ms)
    }));
  const failedCases = report.cases
    .filter((testCase) => ["failed", "blocked"].includes(testCase.status) || testCase.error)
    .slice(0, AI_ANALYSIS_FAILED_CASE_LIMIT)
    .map((testCase) => ({
      suite: testCase.suite_name || "Direct run",
      title: reportCaseTitle(testCase),
      status: testCase.status,
      priority: testCase.priority || null,
      duration: formatDuration(testCase.duration_ms),
      error: testCase.error || null,
      failed_steps: testCase.steps
        .filter((step) => ["failed", "blocked"].includes(step.status) || step.note)
        .slice(0, 4)
        .map((step) => ({
          order: step.order,
          status: step.status,
          action: step.action,
          note: step.note || null
        }))
    }));

  return [
    "Analyze this QA execution and return strict JSON only.",
    "",
    "Run summary:",
    JSON.stringify({
      name: report.execution.name || report.execution.id,
      status: report.execution.status || "queued",
      total_cases: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      blocked: report.summary.blocked,
      not_executed: notExecuted,
      remaining: notExecuted,
      pass_rate: report.summary.pass_rate,
      duration: formatDuration(report.summary.duration_ms)
    }, null, 2),
    "",
    "Suites needing attention:",
    JSON.stringify(failedSuites, null, 2),
    "",
    "Failed or blocked test case details:",
    JSON.stringify(failedCases, null, 2),
    "",
    "Return this exact JSON shape:",
    "{",
    '  "headline": "string",',
    '  "summary": "string",',
    '  "risk_level": "low | medium | high",',
    '  "key_findings": ["string"],',
    '  "recommended_actions": ["string"],',
    '  "failed_cases": [',
    '    { "suite": "string", "case": "string", "analysis": "string" }',
    "  ]",
    "}",
    "",
    "Guidance:",
    "- Mention pass/fail/not executed counts and the practical release risk.",
    "- Focus on failed suites, failed cases, blocked cases, recurring symptoms, and likely next triage actions.",
    "- Keep the response concise enough for a PDF/email report.",
    "- Do not include markdown or commentary outside the JSON."
  ].join("\n");
};

const requestAiAnalysisCompletion = async ({ integration, prompt }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_ANALYSIS_TIMEOUT_MS);

  try {
    const response = await fetchLlmWithRetry(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${integration.api_key}`
      },
      body: JSON.stringify({
        model: integration.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a senior QA release analyst. Return strict JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    }, { integration, timeoutMs: AI_ANALYSIS_TIMEOUT_MS, operation: "execution-report.generate" });

    if (!response.ok) {
      const raw = await response.text();
      throw createLlmProviderError({ status: response.status, detail: raw });
    }

    const payload = await response.json();
    const messageContent = getCompletionContent(payload);

    if (!messageContent) {
      throw new Error("LLM response did not include analysis content");
    }

    return messageContent;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("AI analysis timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeAiAnalysis = (payload) => {
  const headline = normalizeText(payload?.headline) || "AI execution analysis";
  const summary = normalizeText(payload?.summary) || "The AI analysis completed, but did not include a narrative summary.";
  const riskLevel = normalizeText(payload?.risk_level || payload?.riskLevel) || "unknown";
  const failedCases = Array.isArray(payload?.failed_cases || payload?.failedCases)
    ? (payload.failed_cases || payload.failedCases)
        .map((item) => ({
          suite: normalizeText(item?.suite) || "Unscoped",
          case: normalizeText(item?.case || item?.title) || "Untitled case",
          analysis: normalizeText(item?.analysis || item?.summary) || "Needs review."
        }))
        .slice(0, 8)
    : [];

  return {
    status: "generated",
    headline,
    summary,
    risk_level: riskLevel,
    key_findings: normalizeTextArray(payload?.key_findings || payload?.keyFindings),
    recommended_actions: normalizeTextArray(payload?.recommended_actions || payload?.recommendedActions),
    failed_cases: failedCases,
    generated_at: new Date().toISOString()
  };
};

const generateAiAnalysis = async (report, { userId } = {}) => {
  try {
    const integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
      userId,
      usageKey: "ai.execution.analysis",
      projectId: report.execution?.project_id,
      fallback: "project-then-global",
      allowMissing: true
    });

    if (!integration) {
      return createUnavailableAiAnalysis("No active LLM integration is configured, so this report was generated without AI analysis.");
    }

    if (!integration.is_active) {
      return createUnavailableAiAnalysis("The configured LLM integration is inactive, so this report was generated without AI analysis.");
    }

    const content = await requestAiAnalysisCompletion({
      integration,
      prompt: buildAiAnalysisPrompt(report)
    });

    return normalizeAiAnalysis(extractJsonPayload(content));
  } catch (error) {
    return createUnavailableAiAnalysis(
      `AI analysis could not be generated. ${error instanceof Error ? error.message : "The report export continued without AI output."}`
    );
  }
};

const buildReportWithAiAnalysis = async (executionId, { userId } = {}) => {
  const report = await buildReportModel(executionId);
  return {
    ...report,
    ai_analysis: await generateAiAnalysis(report, { userId })
  };
};

const STATUS_META = {
  passed: { label: "Passed", bg: "#e4f7ed", fg: "#126c48", border: "#28a66d" },
  completed: { label: "Completed", bg: "#e4f7ed", fg: "#126c48", border: "#28a66d" },
  failed: { label: "Failed", bg: "#ffe7ed", fg: "#a32647", border: "#d94b6a" },
  blocked: { label: "Blocked", bg: "#fff3d7", fg: "#85530a", border: "#d9901f" },
  running: { label: "Running", bg: "#e9efff", fg: "#284da8", border: "#5271d8" },
  paused: { label: "Paused", bg: "#fff3d7", fg: "#85530a", border: "#d9901f" },
  pending: { label: "Unexecuted", bg: "#eef2f7", fg: "#475569", border: "#94a3b8" },
  skipped: { label: "N/A", bg: "#eef2f7", fg: "#475569", border: "#94a3b8" },
  aborted: { label: "Aborted", bg: "#eef2f7", fg: "#475569", border: "#94a3b8" },
  queued: { label: "Queued", bg: "#eef2f7", fg: "#475569", border: "#94a3b8" }
};

const getStatusMeta = (status) => STATUS_META[normalizeText(status).toLowerCase()] || STATUS_META.queued;

const renderStatusPill = (status) => {
  const meta = getStatusMeta(status);

  return `<span style="display:inline-block;border-radius:999px;padding:4px 9px;background:${meta.bg};color:${meta.fg};font-size:11px;font-weight:800;line-height:1;border:1px solid ${meta.border};">${escapeHtml(meta.label)}</span>`;
};

const shouldShowCompactSteps = (report, suite) =>
  report.summary.total <= 8
  && suite.total <= 3
  && suite.step_count > 0
  && suite.step_count <= 12;

const renderOutcomeRows = (report) => {
  const rows = [
    {
      scope: "Run",
      suite: report.execution.name || report.execution.id,
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      blocked: report.summary.blocked,
      running: report.summary.running,
      duration_ms: report.summary.duration_ms
    },
    ...report.suites.map((suite) => ({
      scope: "Suite",
      suite: suite.name,
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      blocked: suite.blocked,
      running: suite.running,
      duration_ms: suite.duration_ms
    }))
  ];

  return rows.map((row, index) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;color:#647084;font-size:12px;font-weight:700;">${escapeHtml(row.scope)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;color:#111827;font-size:13px;font-weight:${index === 0 ? "800" : "700"};">${escapeHtml(row.suite)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;text-align:right;color:#111827;font-size:13px;">${escapeHtml(row.total)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;text-align:right;color:#126c48;font-size:13px;font-weight:800;">${escapeHtml(row.passed)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;text-align:right;color:#a32647;font-size:13px;font-weight:800;">${escapeHtml(row.failed)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;text-align:right;color:#85530a;font-size:13px;">${escapeHtml(row.blocked)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;text-align:right;color:#284da8;font-size:13px;">${escapeHtml(row.running)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7edf5;text-align:right;color:#111827;font-size:13px;">${escapeHtml(formatDuration(row.duration_ms))}</td>
    </tr>
  `).join("");
};

const renderInlineList = (items = []) =>
  items.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;color:#334155;font-size:13px;line-height:1.55;">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p style="margin:8px 0 0;color:#647084;font-size:13px;">No specific items were returned.</p>`;

const renderAiAnalysisHtml = (analysis) => {
  const resolved = analysis || createUnavailableAiAnalysis();
  const isUnavailable = resolved.status !== "generated";

  return `
    <div style="background:#ffffff;border:1px solid #dfe7f1;border-radius:8px;margin-top:14px;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid #e7edf5;background:${isUnavailable ? "#fbfdff" : "#f6fbff"};">
        <strong style="font-size:15px;color:#111827;">AI execution analysis</strong>
        <div style="margin-top:4px;font-size:12px;color:#647084;">${escapeHtml(isUnavailable ? "Report export continued without AI output." : `Risk level: ${resolved.risk_level || "unknown"}`)}</div>
      </div>
      <div style="padding:14px 16px;">
        <div style="font-size:14px;font-weight:800;color:#111827;">${escapeHtml(resolved.headline)}</div>
        <p style="margin:7px 0 0;color:#334155;font-size:13px;line-height:1.55;">${escapeHtml(resolved.summary)}</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">
          <div>
            <div style="font-size:12px;font-weight:800;color:#647084;text-transform:uppercase;letter-spacing:.05em;">Key findings</div>
            ${renderInlineList(resolved.key_findings)}
          </div>
          <div>
            <div style="font-size:12px;font-weight:800;color:#647084;text-transform:uppercase;letter-spacing:.05em;">Recommended actions</div>
            ${renderInlineList(resolved.recommended_actions)}
          </div>
        </div>
        ${resolved.failed_cases?.length ? `
          <div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:800;color:#647084;text-transform:uppercase;letter-spacing:.05em;">Failed case notes</div>
            ${resolved.failed_cases.map((item) => `
              <div style="margin-top:8px;padding:9px 10px;border:1px solid #e7edf5;border-radius:7px;background:#fbfdff;">
                <div style="font-size:13px;font-weight:800;color:#111827;">${escapeHtml(item.case)}</div>
                <div style="margin-top:2px;color:#647084;font-size:12px;">${escapeHtml(item.suite)}</div>
                <div style="margin-top:5px;color:#334155;font-size:13px;line-height:1.5;">${escapeHtml(item.analysis)}</div>
              </div>
            `).join("")}
          </div>
        ` : ""}
      </div>
    </div>
  `;
};

const renderStepRows = (testCase) => `
  <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;background:#fbfdff;border:1px solid #e7edf5;border-radius:6px;overflow:hidden;">
    <thead>
      <tr style="background:#f2f6fb;color:#58667a;text-align:left;">
        <th style="padding:8px 9px;border-bottom:1px solid #e7edf5;width:42px;">#</th>
        <th style="padding:8px 9px;border-bottom:1px solid #e7edf5;">Step</th>
        <th style="padding:8px 9px;border-bottom:1px solid #e7edf5;width:84px;">Status</th>
        <th style="padding:8px 9px;border-bottom:1px solid #e7edf5;width:105px;">Signals</th>
      </tr>
    </thead>
    <tbody>
      ${testCase.steps.map((step) => `
        <tr>
          <td style="padding:8px 9px;border-bottom:1px solid #e7edf5;color:#647084;">${escapeHtml(step.order)}</td>
          <td style="padding:8px 9px;border-bottom:1px solid #e7edf5;color:#111827;">
            <div style="font-weight:700;">${escapeHtml(step.action || "No action recorded")}</div>
            ${step.expected_result ? `<div style="margin-top:3px;color:#647084;">Expected: ${escapeHtml(step.expected_result)}</div>` : ""}
            ${step.note ? `<div style="margin-top:3px;color:#475569;">${escapeHtml(step.note.replace(/\n+/g, " "))}</div>` : ""}
            ${step.page_url ? `<div style="margin-top:3px;color:#647084;">URL: ${escapeHtml(step.page_url)}</div>` : ""}
          </td>
          <td style="padding:8px 9px;border-bottom:1px solid #e7edf5;">${renderStatusPill(step.status)}</td>
          <td style="padding:8px 9px;border-bottom:1px solid #e7edf5;color:#647084;">${[
            step.has_evidence ? "image" : null,
            step.console_count ? `${step.console_count} console` : null,
            step.network_count ? `${step.network_count} network` : null
          ].filter(Boolean).join(" · ") || "none"}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
`;

const renderSuiteCard = (report, suite, mode) => {
  const includeSteps = mode === "detailed" || shouldShowCompactSteps(report, suite);

  return `
    <div style="display:inline-block;vertical-align:top;width:100%;max-width:440px;margin:0 10px 12px 0;background:#ffffff;border:1px solid #dfe7f1;border-radius:8px;overflow:hidden;">
      <div style="padding:14px 16px;border-top:4px solid ${suite.failed ? "#d94b6a" : suite.blocked ? "#d9901f" : "#28a66d"};border-bottom:1px solid #edf2f7;background:#fbfdff;">
        <div style="font-size:15px;font-weight:800;color:#111827;">${escapeHtml(suite.name)}</div>
        <div style="margin-top:4px;font-size:12px;color:#647084;">${escapeHtml(formatDuration(suite.duration_ms))} · ${escapeHtml(suite.total)} case${suite.total === 1 ? "" : "s"} · ${escapeHtml(suite.step_count)} step${suite.step_count === 1 ? "" : "s"}</div>
      </div>
      <div style="padding:10px 14px;">
        ${suite.cases.map((testCase) => `
          <div style="padding:8px 0;border-bottom:1px solid #edf2f7;">
            <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;">
              <div style="font-size:13px;color:#111827;font-weight:700;line-height:1.35;">${escapeHtml(reportCaseTitle(testCase))}</div>
              ${renderStatusPill(testCase.status)}
            </div>
            <div style="margin-top:3px;font-size:12px;color:#647084;">${escapeHtml(formatDuration(testCase.duration_ms))}${testCase.error ? ` · ${escapeHtml(testCase.error)}` : ""}</div>
            ${includeSteps ? renderStepRows(testCase) : ""}
          </div>
        `).join("")}
        ${!includeSteps && suite.step_count ? `<div style="padding:8px 0 2px;color:#647084;font-size:12px;">Step detail is kept out of this compact email because the suite has ${escapeHtml(suite.step_count)} steps. The PDF export includes the full step trace.</div>` : ""}
      </div>
    </div>
  `;
};

const renderReportHtml = (report, { mode = "email" } = {}) => {
  const execution = report.execution;
  const summary = report.summary;
  const title = execution.name || "Execution run report";
  const isDetailed = mode === "detailed";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#eef3f8;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:1040px;margin:0 auto;padding:28px;">
      <div style="background:#122033;border-radius:8px;padding:24px;border:1px solid #122033;">
        <p style="margin:0 0 8px;color:#9fb5cf;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">HelloTest Run Report</p>
        <h1 style="margin:0 0 8px;font-size:28px;line-height:1.15;color:#ffffff;">${escapeHtml(title)}</h1>
        <p style="margin:0;color:#d7e2ef;font-size:13px;">Generated ${escapeHtml(formatDate(report.generated_at))} · Started ${escapeHtml(formatDate(execution.started_at))} · Ended ${escapeHtml(formatDate(execution.ended_at))}</p>
      </div>

      <div style="background:#ffffff;border:1px solid #dfe7f1;border-radius:8px;padding:14px;margin-top:14px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${[
            ["Pass rate", `${summary.pass_rate}%`, "#28a66d"],
            ["Total cases", summary.total, "#5271d8"],
            ["Passed", summary.passed, "#28a66d"],
            ["Failed", summary.failed, "#d94b6a"],
            ["Duration", formatDuration(summary.duration_ms), "#5b6472"]
          ].map(([label, value, color]) => `
            <div style="flex:1 1 140px;min-width:130px;border:1px solid #e4ebf3;border-left:4px solid ${color};border-radius:7px;padding:11px 12px;background:#fbfdff;">
              <div style="font-size:20px;font-weight:800;color:#111827;line-height:1.1;">${escapeHtml(value)}</div>
              <div style="margin-top:4px;font-size:12px;color:#647084;">${escapeHtml(label)}</div>
            </div>
          `).join("")}
        </div>
      </div>

      ${renderAiAnalysisHtml(report.ai_analysis)}

      <div style="background:#ffffff;border:1px solid #dfe7f1;border-radius:8px;margin-top:14px;overflow:hidden;">
        <div style="padding:14px 16px;border-bottom:1px solid #e7edf5;">
          <strong style="font-size:15px;color:#111827;">Run and suite outcomes</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f6f9fc;color:#647084;text-align:left;">
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;">Scope</th>
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;">Name</th>
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;text-align:right;">Cases</th>
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;text-align:right;">Passed</th>
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;text-align:right;">Failed</th>
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;text-align:right;">Blocked</th>
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;text-align:right;">Running</th>
              <th style="padding:9px 12px;border-bottom:1px solid #e7edf5;text-align:right;">Duration</th>
            </tr>
          </thead>
          <tbody>${renderOutcomeRows(report)}</tbody>
        </table>
      </div>

      <div style="margin-top:14px;">
        ${report.suites.map((suite) => renderSuiteCard(report, suite, isDetailed ? "detailed" : "email")).join("")}
      </div>
    </div>
  </body>
</html>`;
};

const pdfEscape = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const wrapLine = (line, max = 92) => {
  const words = String(line || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
};

const buildAiAnalysisLines = (analysis) => {
  const resolved = analysis || createUnavailableAiAnalysis();
  const lines = [
    "AI execution analysis:",
    `${resolved.headline} (${resolved.status === "generated" ? `risk: ${resolved.risk_level || "unknown"}` : "unavailable"})`,
    resolved.summary
  ];

  if (resolved.key_findings?.length) {
    lines.push("Key findings:");
    resolved.key_findings.forEach((item) => lines.push(`- ${item}`));
  }

  if (resolved.recommended_actions?.length) {
    lines.push("Recommended actions:");
    resolved.recommended_actions.forEach((item) => lines.push(`- ${item}`));
  }

  if (resolved.failed_cases?.length) {
    lines.push("Failed case notes:");
    resolved.failed_cases.forEach((item) => {
      lines.push(`- ${item.suite} / ${item.case}: ${item.analysis}`);
    });
  }

  lines.push("");
  return lines;
};

const buildReportLines = (report, { detailed = false } = {}) => {
  const lines = [
    `HelloTest Run Report: ${report.execution.name || report.execution.id}`,
    `Generated: ${formatDate(report.generated_at)}`,
    `Status: ${report.execution.status || "queued"}`,
    `Cases: ${report.summary.total} total, ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.blocked} blocked`,
    `Pass rate: ${report.summary.pass_rate}%`,
    `Duration: ${formatDuration(report.summary.duration_ms)}`,
    ""
  ];

  lines.push(...buildAiAnalysisLines(report.ai_analysis));

  lines.push("Suite outcomes:");
  report.suites.forEach((suite) => {
    lines.push(
      `- ${suite.name}: ${suite.total} cases, ${suite.passed} passed, ${suite.failed} failed, ${suite.blocked} blocked, ${formatDuration(suite.duration_ms)}`
    );
  });
  lines.push("");

  report.suites.forEach((suite) => {
    const includeSteps = detailed || shouldShowCompactSteps(report, suite);
    lines.push(`${suite.name} (${formatDuration(suite.duration_ms)})`);
    suite.cases.forEach((testCase, index) => {
      lines.push(`${index + 1}. ${reportCaseTitle(testCase)} [${testCase.status}]`);
      if (testCase.error) {
        lines.push(`   Error: ${testCase.error}`);
      }
      if (includeSteps) {
        testCase.steps.forEach((step) => {
          lines.push(`   Step ${step.order} ${String(step.type || "").toUpperCase()} [${step.status}]: ${step.action || "No action recorded"}`);
          if (step.note) {
            lines.push(`     ${step.note.replace(/\n+/g, " ")}`);
          }
        });
      }
    });
    if (!includeSteps && suite.step_count) {
      lines.push(`   Step detail omitted from compact email text. PDF export includes ${suite.step_count} steps.`);
    }
    lines.push("");
  });

  return lines.flatMap((line) => wrapLine(line));
};

const pdfNumber = (value) => {
  const normalized = Number(value || 0);
  return Number.isFinite(normalized) ? normalized.toFixed(2).replace(/\.?0+$/, "") : "0";
};

const hexToRgb = (hex) => {
  const normalized = String(hex || "#000000").replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((entry) => `${entry}${entry}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255
  ].map(pdfNumber);
};

const pdfColor = (hex, operator = "rg") => `${hexToRgb(hex).join(" ")} ${operator}`;

const wrapPdfText = (value, width, fontSize) => {
  const maxChars = Math.max(10, Math.floor(width / Math.max(fontSize * 0.5, 1)));
  return String(value || "").split(/\n+/).flatMap((line) => wrapLine(line, maxChars));
};

const parseJpegEvidence = (evidence) => {
  const dataUrl = normalizeText(evidence?.dataUrl || evidence?.data_url);

  if (!dataUrl) {
    return null;
  }

  const match = dataUrl.match(/^data:image\/(?:jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i);

  if (!match) {
    return null;
  }

  const data = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  const size = readJpegSize(data);

  if (!size) {
    return null;
  }

  return {
    data,
    width: size.width,
    height: size.height,
    fileName: normalizeText(evidence?.fileName || evidence?.file_name) || "evidence.jpg"
  };
};

const readJpegSize = (data) => {
  if (!Buffer.isBuffer(data) || data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = data[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > data.length) {
      break;
    }

    const length = data.readUInt16BE(offset);

    if (length < 2 || offset + length > data.length) {
      break;
    }

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame && offset + 7 < data.length) {
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5)
      };
    }

    offset += length;
  }

  return null;
};

const renderReportPdf = (report) => {
  const pageWidth = 612;
  const pageHeight = 842;
  const margin = 36;
  const usableWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - margin;
  const pages = [];
  const images = [];
  let ops = [];
  let cursorY = margin;

  const toPdfY = (topY, height = 0) => pageHeight - topY - height;
  const addPage = (continued = false) => {
    ops = [];
    pages.push(ops);
    cursorY = margin;

    if (continued) {
      ops.push(`${pdfColor("#edf3f8")} 0 ${pdfNumber(pageHeight - 28)} ${pageWidth} 28 re f`);
      ops.push(`BT ${pdfColor("#5b6472")} /F2 9 Tf ${margin} ${pdfNumber(pageHeight - 18)} Td (${pdfEscape(report.execution.name || "HelloTest Run Report")}) Tj ET`);
      cursorY = 52;
    }
  };
  const ensure = (height) => {
    if (cursorY + height > bottomLimit) {
      addPage(true);
    }
  };
  const rect = (x, y, width, height, fill, stroke) => {
    const commands = ["q"];
    if (fill) {
      commands.push(pdfColor(fill));
    }
    if (stroke) {
      commands.push(pdfColor(stroke, "RG"));
    }
    commands.push(`${pdfNumber(x)} ${pdfNumber(toPdfY(y, height))} ${pdfNumber(width)} ${pdfNumber(height)} re`);
    commands.push(fill && stroke ? "B" : fill ? "f" : "S");
    commands.push("Q");
    ops.push(commands.join("\n"));
  };
  const text = (value, x, y, size = 10, options = {}) => {
    const font = options.bold ? "F2" : "F1";
    const color = options.color || "#111827";
    ops.push(`BT ${pdfColor(color)} /${font} ${pdfNumber(size)} Tf ${pdfNumber(x)} ${pdfNumber(pageHeight - y)} Td (${pdfEscape(value)}) Tj ET`);
  };
  const wrappedText = (value, x, y, width, size = 10, options = {}) => {
    const lineHeight = options.lineHeight || size + 4;
    const lines = wrapPdfText(value, width, size);

    lines.forEach((line, index) => {
      text(line, x, y + index * lineHeight, size, options);
    });

    return lines.length * lineHeight;
  };
  const statusPill = (status, x, y) => {
    const meta = getStatusMeta(status);
    const label = meta.label.toUpperCase();
    const width = Math.max(48, label.length * 5.5 + 16);
    rect(x, y - 10, width, 17, meta.bg, meta.border);
    text(label, x + 8, y + 2, 7, { bold: true, color: meta.fg });
    return width;
  };
  const addImageResource = (evidence) => {
    const parsed = parseJpegEvidence(evidence);

    if (!parsed) {
      return null;
    }

    const existing = images.find((image) => image.fileName === parsed.fileName && image.data.equals(parsed.data));

    if (existing) {
      return existing;
    }

    const image = {
      ...parsed,
      name: `Im${images.length + 1}`
    };

    images.push(image);
    return image;
  };
  const drawImage = (image, x, y, width, height) => {
    ops.push(`q ${pdfNumber(width)} 0 0 ${pdfNumber(height)} ${pdfNumber(x)} ${pdfNumber(toPdfY(y, height))} cm /${image.name} Do Q`);
  };
  const sectionTitle = (label) => {
    ensure(30);
    text(label, margin, cursorY, 14, { bold: true, color: "#122033" });
    cursorY += 22;
  };
  const signalLabel = (step) => [
    step.has_evidence ? "image" : null,
    step.console_count ? `${step.console_count} console` : null,
    step.network_count ? `${step.network_count} network` : null
  ].filter(Boolean).join(" | ") || "no artifacts";

  addPage(false);

  rect(margin, cursorY, usableWidth, 92, "#122033", "#122033");
  text("HelloTest Run Report", margin + 18, cursorY + 25, 11, { bold: true, color: "#9fb5cf" });
  wrappedText(report.execution.name || "Execution run report", margin + 18, cursorY + 48, usableWidth - 36, 20, {
    bold: true,
    color: "#ffffff",
    lineHeight: 23
  });
  text(`Generated ${formatDate(report.generated_at)} | Started ${formatDate(report.execution.started_at)} | Ended ${formatDate(report.execution.ended_at)}`, margin + 18, cursorY + 78, 8, {
    color: "#d7e2ef"
  });
  cursorY += 112;

  const cardGap = 8;
  const cardWidth = (usableWidth - cardGap * 4) / 5;
  [
    ["Pass rate", `${report.summary.pass_rate}%`, "#28a66d"],
    ["Total cases", report.summary.total, "#5271d8"],
    ["Passed", report.summary.passed, "#28a66d"],
    ["Failed", report.summary.failed, "#d94b6a"],
    ["Duration", formatDuration(report.summary.duration_ms), "#5b6472"]
  ].forEach(([label, value, color], index) => {
    const x = margin + index * (cardWidth + cardGap);
    rect(x, cursorY, cardWidth, 54, "#ffffff", "#dfe7f1");
    rect(x, cursorY, 4, 54, color, color);
    text(String(value), x + 12, cursorY + 23, 17, { bold: true, color: "#111827" });
    text(label, x + 12, cursorY + 41, 8, { color: "#647084" });
  });
  cursorY += 78;

  sectionTitle("AI execution analysis");
  buildAiAnalysisLines(report.ai_analysis)
    .filter(Boolean)
    .slice(1)
    .forEach((line, index) => {
      const isHeading = line.endsWith(":");
      const size = index === 0 ? 10 : 8;
      const height = wrapPdfText(line, usableWidth, size).length * (size + 4);

      ensure(height + 4);
      wrappedText(line, margin, cursorY, usableWidth, size, {
        bold: index === 0 || isHeading,
        color: isHeading ? "#122033" : "#334155",
        lineHeight: size + 4
      });
      cursorY += height + 3;
    });
  cursorY += 14;

  sectionTitle("Run and suite outcomes");
  const tableColumns = [
    ["Scope", 52],
    ["Name", 188],
    ["Cases", 46],
    ["Passed", 52],
    ["Failed", 48],
    ["Blocked", 54],
    ["Running", 54],
    ["Duration", 58]
  ];
  const tableRows = [
    {
      scope: "Run",
      name: report.execution.name || report.execution.id,
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      blocked: report.summary.blocked,
      running: report.summary.running,
      duration: formatDuration(report.summary.duration_ms)
    },
    ...report.suites.map((suite) => ({
      scope: "Suite",
      name: suite.name,
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      blocked: suite.blocked,
      running: suite.running,
      duration: formatDuration(suite.duration_ms)
    }))
  ];

  ensure(24 + tableRows.length * 22);
  rect(margin, cursorY - 4, usableWidth, 24, "#f6f9fc", "#dfe7f1");
  let x = margin + 8;
  tableColumns.forEach(([label, width]) => {
    text(label, x, cursorY + 11, 8, { bold: true, color: "#647084" });
    x += width;
  });
  cursorY += 25;
  tableRows.forEach((row, rowIndex) => {
    ensure(24);
    rect(margin, cursorY - 4, usableWidth, 24, rowIndex % 2 ? "#ffffff" : "#fbfdff", "#edf2f7");
    x = margin + 8;
    [
      row.scope,
      row.name,
      row.total,
      row.passed,
      row.failed,
      row.blocked,
      row.running,
      row.duration
    ].forEach((value, index) => {
      const color = index === 3 ? "#126c48" : index === 4 ? "#a32647" : "#111827";
      text(String(value), x, cursorY + 11, 8, { bold: rowIndex === 0 || index === 1, color });
      x += tableColumns[index][1];
    });
    cursorY += 24;
  });
  cursorY += 22;

  report.suites.forEach((suite) => {
    sectionTitle(`${suite.name} | ${formatDuration(suite.duration_ms)} | ${suite.total} case${suite.total === 1 ? "" : "s"}`);

    suite.cases.forEach((testCase) => {
      const titleLines = wrapPdfText(reportCaseTitle(testCase), usableWidth - 120, 11);
      const caseHeaderHeight = Math.max(38, titleLines.length * 15 + 18);
      ensure(caseHeaderHeight);
      rect(margin, cursorY - 4, usableWidth, caseHeaderHeight, "#ffffff", "#dfe7f1");
      wrappedText(reportCaseTitle(testCase), margin + 12, cursorY + 14, usableWidth - 130, 11, {
        bold: true,
        color: "#111827",
        lineHeight: 14
      });
      statusPill(testCase.status, pageWidth - margin - 76, cursorY + 15);
      text(formatDuration(testCase.duration_ms), margin + 12, cursorY + caseHeaderHeight - 9, 8, { color: "#647084" });
      cursorY += caseHeaderHeight + 8;

      if (testCase.error) {
        const errorLines = wrapPdfText(`Error: ${testCase.error}`, usableWidth - 36, 8);
        const errorHeight = errorLines.length * 11 + 12;
        rect(margin + 8, cursorY - 4, usableWidth - 16, errorHeight, "#fff5f7", "#ffd4de");
        wrappedText(`Error: ${testCase.error}`, margin + 18, cursorY + 10, usableWidth - 36, 8, {
          color: "#a32647",
          lineHeight: 11
        });
        cursorY += errorHeight + 6;
      }

      testCase.steps.forEach((step) => {
        const action = step.action || "No action recorded";
        const actionHeight = wrapPdfText(action, usableWidth - 120, 9).length * 12;
        const expectedHeight = step.expected_result ? wrapPdfText(`Expected: ${step.expected_result}`, usableWidth - 120, 8).length * 10 : 0;
        const noteHeight = step.note ? wrapPdfText(step.note.replace(/\n+/g, " "), usableWidth - 120, 8).length * 10 : 0;
        const urlHeight = step.page_url ? wrapPdfText(`URL: ${step.page_url}`, usableWidth - 120, 7).length * 9 : 0;
        const evidenceImage = addImageResource(step.evidence);
        const imageWidth = evidenceImage ? Math.min(220, usableWidth - 140, evidenceImage.width) : 0;
        const imageHeight = evidenceImage ? Math.max(44, Math.min(140, (imageWidth / evidenceImage.width) * evidenceImage.height)) : 0;
        const imageBlockHeight = evidenceImage ? imageHeight + 24 : 0;
        const rowHeight = Math.max(42, actionHeight + expectedHeight + noteHeight + urlHeight + imageBlockHeight + 18);

        ensure(rowHeight + 8);
        rect(margin + 8, cursorY - 3, usableWidth - 16, rowHeight, "#fbfdff", "#e7edf5");
        text(`Step ${step.order}`, margin + 18, cursorY + 15, 8, { bold: true, color: "#647084" });
        statusPill(step.status, margin + 18, cursorY + 33);
        let detailY = cursorY + 14;
        detailY += wrappedText(action, margin + 92, detailY, usableWidth - 120, 9, {
          bold: true,
          color: "#111827",
          lineHeight: 12
        });
        if (step.expected_result) {
          detailY += wrappedText(`Expected: ${step.expected_result}`, margin + 92, detailY, usableWidth - 120, 8, {
            color: "#647084",
            lineHeight: 10
          });
        }
        if (step.note) {
          detailY += wrappedText(step.note.replace(/\n+/g, " "), margin + 92, detailY, usableWidth - 120, 8, {
            color: "#475569",
            lineHeight: 10
          });
        }
        if (step.page_url) {
          detailY += wrappedText(`URL: ${step.page_url}`, margin + 92, detailY, usableWidth - 120, 7, {
            color: "#647084",
            lineHeight: 9
          });
        }
        if (evidenceImage) {
          text("Evidence image", margin + 92, detailY + 10, 7, { bold: true, color: "#647084" });
          drawImage(evidenceImage, margin + 92, detailY + 16, imageWidth, imageHeight);
        }
        text(signalLabel(step), pageWidth - margin - 118, cursorY + rowHeight - 9, 7, { color: "#647084" });
        cursorY += rowHeight + 8;
      });

      cursorY += 6;
    });
  });

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };
  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const imageObjectRefs = images.map((image) => {
    const header = Buffer.from(
      [
        `<< /Type /XObject`,
        `/Subtype /Image`,
        `/Width ${image.width}`,
        `/Height ${image.height}`,
        `/ColorSpace /DeviceRGB`,
        `/BitsPerComponent 8`,
        `/Filter /DCTDecode`,
        `/Length ${image.data.length}`,
        `>>`,
        `stream\n`
      ].join(" "),
      "binary"
    );
    const footer = Buffer.from("\nendstream", "binary");

    return {
      name: image.name,
      id: addObject(Buffer.concat([header, image.data, footer]))
    };
  });
  const xObjectResources = imageObjectRefs.length
    ? `/XObject << ${imageObjectRefs.map((image) => `/${image.name} ${image.id} 0 R`).join(" ")} >>`
    : "";
  const pageIds = [];

  pages.forEach((pageOps) => {
    const stream = pageOps.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> ${xObjectResources} >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = [Buffer.from("%PDF-1.4\n", "binary")];
  const offsets = [0];
  const lengthSoFar = () => chunks.reduce((total, chunk) => total + chunk.length, 0);
  const pushChunk = (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "binary"));
  };

  objects.forEach((object, index) => {
    offsets.push(lengthSoFar());
    pushChunk(`${index + 1} 0 obj\n`);
    pushChunk(object);
    pushChunk("\nendobj\n");
  });

  const xrefOffset = lengthSoFar();
  pushChunk(`xref\n0 ${objects.length + 1}\n`);
  pushChunk("0000000000 65535 f \n");
  offsets.slice(1).forEach((offset) => {
    pushChunk(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  pushChunk(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
};

const normalizeRecipients = (value) => {
  const entries = Array.isArray(value) ? value : String(value || "").split(/[,\n;]/);
  return [...new Set(entries.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))];
};

exports.buildReport = buildReportModel;

exports.renderReportHtml = async (executionId, { user, include_attachments = false } = {}) => {
  const report = await buildReportModel(executionId);
  if (user && include_attachments) {
    await require("./executionReportEvidence").attachReportEvidence(report, { user });
  }
  return renderDetailedExecutionHtml(report);
};
exports.REPORT_CSP = REPORT_CSP;

exports.renderReportPdf = async (executionId, { user_id } = {}) => renderReportPdf(await buildReportWithAiAnalysis(executionId, { userId: user_id }));

const scopeReportToCase = (report, testCaseId) => {
  const cases = report.cases.filter((item) => String(item.id) === String(testCaseId));
  if (!cases.length) throw Object.assign(new Error("The selected test case is not part of this run snapshot"), { statusCode: 404 });
  const scoped = buildExecutionReportModel(
    { ...report.execution, case_snapshots: (report.execution.case_snapshots || []).filter(item => String(item.test_case_id) === String(testCaseId)) },
    report.results.filter(item => String(item.test_case_id) === String(testCaseId)),
    new Date(report.generated_at).getTime()
  );
  return {
    ...scoped,
    execution: { ...report.execution, name: `${report.execution.name || "HelloTest run"} · ${cases[0].title}` },
    ai_analysis: createUnavailableAiAnalysis("AI summary is omitted from a single-case evidence export; review the recorded case and step evidence directly.")
  };
};

exports.renderCaseReportPdf = async (executionId, testCaseId) => renderReportPdf(scopeReportToCase(await buildReportModel(executionId), testCaseId));

exports.emailCaseReport = async ({ execution_id, test_case_id, recipients, requested_by } = {}) => {
  const normalizedRecipients = normalizeRecipients(recipients);
  if (!normalizedRecipients.length) throw new Error("At least one report recipient is required");
  const report = scopeReportToCase(await buildReportModel(execution_id), test_case_id);
  const testCase = report.cases[0];
  await emailService.sendMail({
    to: normalizedRecipients,
    subject: `HelloTest case report: ${testCase.title}`,
    text: buildReportLines(report).join("\n"),
    html: renderReportHtml(report)
  });
  try {
    const transaction = await workspaceTransactionService.createTransaction({ project_id: report.execution.project_id, app_type_id: report.execution.app_type_id || null, category: "reporting", action: "case_report_share", status: "completed", title: `Shared case report for ${testCase.title}`, description: `Sent case report to ${normalizedRecipients.length} recipient${normalizedRecipients.length === 1 ? "" : "s"}.`, metadata: { channel: "email", recipient_count: normalizedRecipients.length, execution_id, test_case_id }, related_kind: "execution", related_id: execution_id, created_by: requested_by || null, started_at: new Date().toISOString(), completed_at: new Date().toISOString() });
    await workspaceTransactionService.appendTransactionEvent(transaction.id, { level: "success", phase: "report.email.sent", message: "Case report email sent.", details: { execution_id, test_case_id, recipient_count: normalizedRecipients.length } });
  } catch {
    // Audit failure must not reverse a successfully delivered email.
  }
  return { sent: true, recipients: normalizedRecipients.length };
};

exports.emailReport = async ({ execution_id, recipients, requested_by } = {}) => {
  const normalizedRecipients = normalizeRecipients(recipients);

  if (!normalizedRecipients.length) {
    throw new Error("At least one report recipient is required");
  }

  const report = await buildReportWithAiAnalysis(execution_id, { userId: requested_by });
  const title = report.execution.name || "HelloTest execution run";
  const html = renderReportHtml(report);
  const text = buildReportLines(report).join("\n");

  await emailService.sendMail({
    to: normalizedRecipients,
    subject: `HelloTest run report: ${title}`,
    text,
    html
  });

  try {
    const transaction = await workspaceTransactionService.createTransaction({
      project_id: report.execution.project_id,
      app_type_id: report.execution.app_type_id || null,
      category: "reporting",
      action: "run_report_export",
      status: "completed",
      title: `Shared run report for ${title}`,
      description: `Sent HTML report to ${normalizedRecipients.length} recipient${normalizedRecipients.length === 1 ? "" : "s"}.`,
      metadata: {
        exported: 1,
        channel: "email",
        recipient_count: normalizedRecipients.length,
        execution_id
      },
      related_kind: "execution",
      related_id: execution_id,
      created_by: requested_by || null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });

    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "success",
      phase: "report.email.sent",
      message: `Run report emailed to ${normalizedRecipients.length} recipient${normalizedRecipients.length === 1 ? "" : "s"}.`,
      details: {
        execution_id,
        recipient_count: normalizedRecipients.length
      }
    });
  } catch {
    // Reporting audit events must not block email delivery.
  }

  return {
    sent: true,
    recipients: normalizedRecipients.length
  };
};
