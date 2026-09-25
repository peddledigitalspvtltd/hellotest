import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "../../../src/styles.css";
import "../../../src/dark-theme.css";
import "../../../src/catalog-list.css";
import "../../../src/modal-system.css";
import { AnalyticsMissionControl } from "./analytics/AnalyticsMissionControl";
import "./analyticsMissionPreview.css";

const previewParams = new URLSearchParams(window.location.search);
const requestedPreviewWidth = Number(previewParams.get("width") || 1020);
const previewWidth = Math.max(320, Math.min(1440, Number.isFinite(requestedPreviewWidth) ? requestedPreviewWidth : 1020));
document.documentElement.style.setProperty("--analytics-preview-width", `${previewWidth}px`);
if (previewParams.get("theme") === "dark") {
  document.documentElement.dataset.theme = "dark";
}
document.body.dataset.qaRuntimeErrors = "0";
window.addEventListener("error", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});
window.addEventListener("unhandledrejection", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});

const defaultSectionState = {
  decision: { order: 0, visible: true },
  signals: { order: 1, visible: true },
  delivery: { order: 2, visible: true },
  flow: { order: 3, visible: true },
  automation: { order: 4, visible: true },
  risk: { order: 5, visible: true }
};

function markInteraction(name: string, value = "true") {
  document.body.dataset[name] = value;
}

function Preview() {
  const [sectionState, setSectionState] = React.useState(defaultSectionState);

  return (
    <main className="analytics-preview-workspace workspace-main" data-route="/">
      <div className="page-content page-content--overview overview-layout quality-mission-control">
        <AnalyticsMissionControl
          actions={[
            { id: "coverage", title: "Close coverage gaps", detail: "Map missing stories to reusable cases.", meta: "10 uncovered stories", to: "#", tone: "error" },
            { id: "design", title: "Shape suite flows", detail: "Curate release-ready suite structure.", meta: "2 suites live", to: "#", tone: "info" },
            { id: "test-design", title: "Complete test design", detail: "Add steps and expected results.", meta: "6 cases missing steps", to: "#", tone: "info" }
          ]}
          activeChecks={0}
          activity={[
            { key: "mar", label: "Mar", total: 0, height: 14 },
            { key: "apr", label: "Apr", total: 0, height: 14 },
            { key: "may", label: "May", total: 1, height: 50 },
            { key: "jun", label: "Jun", total: 2, height: 100 },
            { key: "jul", label: "Jul", total: 0, height: 14 },
            { key: "aug", label: "Aug", total: 2, height: 100 }
          ]}
          automatedCases={4}
          automatedPassRate={100}
          automatedResults={2}
          automatedRuns={2}
          automationAvailable
          automationCandidates={10}
          automationCoverage={29}
          canCreateTestCases
          canExplainSignals
          designCompleteness={57}
          evidenceQueue={[
            { id: "execution-1", title: "Verify test step validation... endpoints Run", detail: "HelloTest release check ended failed and needs triage in the execution hub.", label: "Investigate run", tone: "error", to: "#" },
            { id: "requirement-1", title: "API Recorder Sessions", detail: "Priority P3 story still has no reusable test coverage attached.", label: "Design coverage", tone: "info", to: "#" },
            { id: "case-1", title: "[Web] Dashboard account menu...", detail: "Reusable case exists, but it still needs steps and expected results.", label: "Add steps", tone: "info", to: "#" }
          ]}
          executableCases={8}
          funnelMetrics={[
            { id: "stories", label: "Stories", value: 16, detail: "Product scope tracked in HelloTest", chipLabel: "Scope", tone: "neutral" },
            { id: "covered", label: "Covered", value: 6, detail: "38% linked to reusable cases", chipLabel: "Growing", tone: "info" },
            { id: "suites", label: "Suites", value: 2, detail: "Reusable test flow groups", chipLabel: "Reusable", tone: "info" },
            { id: "cases", label: "Cases", value: 33, detail: "Reusable quality assets available", chipLabel: "Ready", tone: "info" },
            { id: "executable", label: "Executable", value: 8, detail: "57% have executable steps", chipLabel: "Build out", tone: "info" },
            { id: "evidence", label: "Evidence", value: 2, detail: "Captured run signals", chipLabel: "Observed", tone: "success" }
          ]}
          hotspots={[
            { id: "hot-1", title: "Validate dashboard account menu", detail: "Assertion failed in the latest run.", count: 2, status: "failed", executionId: "1" }
          ]}
          isExplainingSignals={false}
          lanes={[
            { id: "web", name: "Web", projectName: "HELLOTEST", type: "web", cases: 14, suites: 2, executableCases: 8, failedSignals: 1, releaseScore: 53, label: "At risk", tone: "error", destination: "#" },
            { id: "api", name: "API", projectName: "HELLOTEST", type: "api", cases: 0, suites: 0, executableCases: 0, failedSignals: 0, releaseScore: 0, label: "No design yet", tone: "neutral", destination: "#" },
            { id: "mobile", name: "Mobile", projectName: "HELLOTEST", type: "android", cases: 0, suites: 0, executableCases: 0, failedSignals: 0, releaseScore: 0, label: "No design yet", tone: "neutral", destination: "#" }
          ]}
          latestFailedSignals={0}
          latestPassRate={100}
          mappedStories={6}
          onExplainSignals={() => markInteraction("qaExplained")}
          onNavigate={(to) => markInteraction("qaNavigation", to)}
          onOpenEvidence={(id) => markInteraction("qaEvidence", id)}
          onOpenLayout={() => {
            markInteraction("qaPersonalized");
            setSectionState((current) => ({
              ...current,
              decision: { ...current.decision, order: 1 },
              signals: { ...current.signals, order: 0 }
            }));
          }}
          openRiskCount={18}
          passedSignals={2}
          projectName="HelloTest"
          provisional
          recentExecutions={[
            { id: "1", name: "Release confidence run", projectName: "HELLOTEST", appTypeName: "Web", trigger: "manual", status: "failed", summary: { running: 0, passed: 1, failed: 1, blocked: 0, total: 2, percent: 50 } },
            { id: "2", name: "Smoke check", projectName: "HELLOTEST", appTypeName: "Web", trigger: "ci", status: "completed", summary: { running: 0, passed: 2, failed: 0, blocked: 0, total: 2, percent: 100 } }
          ]}
          releaseBlockerCount={2}
          releaseHeadline="Production readiness needs hardening"
          releaseNarrative="The release picture is taking shape, but a few design and run gaps still stand between status reporting and confidence."
          releaseScore={66}
          runConfidence={50}
          sectionState={sectionState}
          storyCoverage={38}
          topRecommendation="10 stories still need reusable coverage before this dashboard becomes release-grade."
          totalStories={16}
          unstableSignals={0}
          verifiedAutomationCases={14}
          verifiedCases={14}
        />
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Preview /></React.StrictMode>
);

if (previewParams.has("exercise")) {
  window.setTimeout(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((button) => button.textContent?.trim() === "Summary")?.click();
    document.querySelector<HTMLButtonElement>(".qa-personalize")?.click();
    document.querySelector<HTMLButtonElement>(".qa-mission-create")?.click();
    document.querySelector<HTMLButtonElement>(".qa-release-card")?.click();
    document.querySelector<HTMLButtonElement>(".qa-top-recommendation button")?.click();

    const input = document.querySelector<HTMLInputElement>(".qa-mission-search input");
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (input && valueSetter) {
      valueSetter.call(input, "api");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    window.setTimeout(() => {
      const summarySelected = buttons.find((button) => button.textContent?.trim() === "Summary")?.getAttribute("aria-current") === "page";
      const visibleLanes = [...document.querySelectorAll<HTMLButtonElement>(".qa-lane-list > button")];
      const searchFiltered = visibleLanes.length === 1 && visibleLanes[0].textContent?.includes("API");
      const firstSection = document.querySelector<HTMLElement>(".qa-mission-sections > section");
      const personalizedDomOrder = firstSection?.getAttribute("aria-labelledby") === "qa-confidence-heading";
      const callbacksFired = document.body.dataset.qaPersonalized === "true"
        && document.body.dataset.qaNavigation === "/test-cases?create=1"
        && document.body.dataset.qaEvidence === "readiness"
        && document.body.dataset.qaExplained === "true";
      document.body.dataset.qaInteractionStatus = summarySelected && searchFiltered && personalizedDomOrder && callbacksFired ? "passed" : "failed";
    }, 250);
  }, 500);
}
