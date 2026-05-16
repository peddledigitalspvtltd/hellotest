import { randomUUID } from "node:crypto";
import type { EngineRunEnvelope, EngineRunRecord } from "../contracts/qaira.js";

const nowIso = () => new Date().toISOString();

export function buildAcceptedRun(envelope: EngineRunEnvelope): EngineRunRecord {
  const timestamp = nowIso();
  const artifactRoot = `artifacts/${envelope.engine_run_id}`;
  const isApiOnlyRun = envelope.steps.every((step) => step.step_type === "api");
  const activeWebEngine = envelope.web_engine?.active || "playwright";
  const generatedScriptPath =
    envelope.source_mode === "attached-script"
      ? envelope.attached_script?.path || null
      : `generated/${envelope.qaira_test_case_id}/${randomUUID()}.spec.ts`;
  const locatorMapPath =
    envelope.source_mode === "attached-script"
      ? envelope.attached_script?.locator_map_path || null
      : `generated/${envelope.qaira_test_case_id}/locator-map.json`;

  return {
    id: envelope.engine_run_id,
    qaira_run_id: envelope.qaira_run_id,
    qaira_execution_id: envelope.qaira_execution_id || envelope.qaira_run_id,
    qaira_test_case_id: envelope.qaira_test_case_id,
    test_case_title: envelope.qaira_test_case_title,
    state:
      isApiOnlyRun
        ? "running"
        : envelope.source_mode === "attached-script"
          ? "running"
          : "building-script",
    source_mode: envelope.source_mode,
    browser: envelope.browser,
    deterministic_attempted: true,
    healing_attempted: false,
    healing_succeeded: false,
    summary:
      isApiOnlyRun
        ? "Executing automated API steps deterministically in the Test Engine."
        : envelope.source_mode === "attached-script"
        ? `Using the attached automation script with the ${activeWebEngine} web engine.`
        : `Executing queued web steps with the ${activeWebEngine} web engine.`,
    generated_script_path: generatedScriptPath,
    locator_map_path: locatorMapPath,
    artifact_bundle: {
      trace_path: `${artifactRoot}/trace.zip`,
      video_path: envelope.artifact_policy.video_mode === "off" || isApiOnlyRun ? null : `${artifactRoot}/video.webm`,
      screenshot_paths: isApiOnlyRun ? [] : [`${artifactRoot}/screenshots/step-failure.png`],
      console_log_path: envelope.artifact_policy.capture_console ? `${artifactRoot}/console.log` : null,
      network_har_path: envelope.artifact_policy.capture_network ? `${artifactRoot}/network.har` : null,
      dom_snapshot_path: `${artifactRoot}/dom.html`,
      summary_path: `${artifactRoot}/engine-summary.json`,
      artifact_refs: [
        ...(envelope.artifact_policy.video_mode === "off" || isApiOnlyRun
          ? []
          : [
              {
                kind: "video" as const,
                label: "Compressed browser run video",
                path: `${artifactRoot}/video.webm`,
                file_name: "video.webm",
                content_type: "video/webm"
              }
            ]),
        {
          kind: "script",
          label: "Generated automation spec",
          path: generatedScriptPath
        },
        {
          kind: "locator-map",
          label: "Locator knowledge",
          path: locatorMapPath
        }
      ]
    },
    patch_proposals: envelope.max_repair_attempts
      ? [
          {
            kind: "locator-map",
            status: "review",
            summary: "When healing succeeds, locator patches should be proposed for review before promotion.",
            target_path: locatorMapPath || `generated/${envelope.qaira_test_case_id}/locator-map.json`
          }
        ]
      : [],
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function buildCapabilities() {
  const workerClass = String(process.env.TESTENGINE_WORKER_CLASS || "").trim().toLowerCase() || "hybrid";
  return {
    runner: workerClass,
    control_plane: "qaira",
    browsers: ["chromium", "firefox", "webkit"],
    execution_scope: "api+web+android",
    supported_step_types: ["api", "web", "android"],
    worker_class: workerClass,
    supported_web_engines: ["playwright", "selenium"],
    supported_mobile_engines: ["webdriverio", "appium"],
    android_keywords: ["tap", "type", "clear", "swipe", "waitForDisplayed", "expectText", "pressBack", "pause"],
    live_view_providers: ["playwright", "selenium"],
    qaira_result_log_compatibility: "execution_results.logs.v1",
    qaira_inline_step_evidence: true,
    healing_scope: ["locator", "wait", "popup", "navigation"],
    blocked_auto_changes: ["assertion", "business-rule", "test-data-mutation"]
  };
}
