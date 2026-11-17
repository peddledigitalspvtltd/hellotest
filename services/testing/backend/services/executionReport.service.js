const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const executionService = require("./execution.service");
const executionResultService = require("./executionResult.service");
const emailService = require("@hellotest/platform/backend/src/services/email.service");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");

const configuredAiAnalysisTimeoutMs = Number(process.env.REPORT_AI_ANALYSIS_TIMEOUT_MS || process.env.LLM_REQUEST_TIMEOUT_MS || 90_000);
const AI_ANALYSIS_TIMEOUT_MS = Number.isFinite(configuredAiAnalysisTimeoutMs)
  ? Math.max(3_000, configuredAiAnalysisTimeoutMs)
  : 90_000;
const AI_ANALYSIS_FAILED_CASE_LIMIT = 20;

const normalizeText = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
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

const { buildExecutionReportModel, scopeReportToCase } = require("./executionReportModel");
const { renderDetailedExecutionHtml, REPORT_CSP } = require("./executionReportHtml");

const buildReportModel = async (executionId, {user} = {}) => {
  const raw = await executionService.getExecution(executionId);
  const execution = user && executionService.projectExecutionForUser ? await executionService.projectExecutionForUser(raw,user) : raw;
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
    aiInstructionBlock("ai.execution.report_analysis", "executionReport.buildAiAnalysisPrompt.1"),
    "",
    aiInstructionBlock("ai.execution.report_analysis", "executionReport.buildAiAnalysisPrompt.29"),
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
    aiInstructionBlock("ai.execution.report_analysis", "executionReport.buildAiAnalysisPrompt.2"),
    JSON.stringify(failedSuites, null, 2),
    "",
    aiInstructionBlock("ai.execution.report_analysis", "executionReport.buildAiAnalysisPrompt.3"),
    JSON.stringify(failedCases, null, 2),
    "",
    aiInstructionBlock("ai.execution.report_analysis", "executionReport.buildAiAnalysisPrompt.4"),
    "{",
    aiInstructionBlock("ai.execution.report_analysis", "executionReport.buildAiAnalysisPrompt.5"),
    "}",
    "",
    aiInstructionBlock("ai.execution.report_analysis", "executionReport.buildAiAnalysisPrompt.32")
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

        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: aiInstructionBlock("ai.execution.report_analysis", "executionReport.response.15")
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
      throw createLlmProviderError({ status: response.status, headers: response.headers, detail: raw });
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
      usageKey: "ai.execution.report_analysis",
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

    return {...normalizeAiAnalysis(extractJsonPayload(content)),provenance:{source:"explicit_report_request",integration_id:integration.id,model:integration.model}};
  } catch (error) {
    return createUnavailableAiAnalysis(
      `AI analysis could not be generated. ${error instanceof Error ? error.message : "The report export continued without AI output."}`
    );
  }
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
  if (!analysis) return "";
  const resolved = analysis;
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

  if(report.ai_analysis) lines.push(...buildAiAnalysisLines(report.ai_analysis));

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

const { renderExecutionReportPdf } = require("./executionReportPdf");
const renderReportPdf = report => renderExecutionReportPdf(report, {
  formatDate, formatDuration, reportCaseTitle, getStatusMeta, buildAiAnalysisLines
});

const normalizeRecipients = (value) => {
  const entries = Array.isArray(value) ? value : String(value || "").split(/[,\n;]/);
  return [...new Set(entries.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))];
};

exports.buildReport = buildReportModel;

exports.renderReportHtml = async (executionId, { user, include_attachments = false } = {}) => {
  const report = await buildReportModel(executionId,{user});
  if (user && include_attachments) {
    await require("./executionReportEvidence").attachReportEvidence(report, { user });
  }
  return renderDetailedExecutionHtml(report);
};
exports.REPORT_CSP = REPORT_CSP;

exports.renderReportPdf = async (executionId, {user, user_id, include_ai = false} = {}) => {
  const report=await buildReportModel(executionId,{user});
  if(include_ai) report.ai_analysis=await generateAiAnalysis(report,{userId:user?.id||user_id});
  return renderReportPdf(report);
};


exports.renderCaseReportPdf = async (executionId, testCaseId, {user}={}) => renderReportPdf(scopeReportToCase(await buildReportModel(executionId,{user}), testCaseId));

exports.emailCaseReport = async ({ execution_id, test_case_id, recipients, requested_by, user } = {}) => {
  const normalizedRecipients = normalizeRecipients(recipients);
  if (!normalizedRecipients.length) throw new Error("At least one report recipient is required");
  const report = scopeReportToCase(await buildReportModel(execution_id,{user}), test_case_id);
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

exports.emailReport = async ({ execution_id, recipients, requested_by, user } = {}) => {
  const normalizedRecipients = normalizeRecipients(recipients);

  if (!normalizedRecipients.length) {
    throw new Error("At least one report recipient is required");
  }

  const report = await buildReportModel(execution_id, { user });
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
