import { useState } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "./styles.css";
import "./assurancePreview.css";
import { ArtifactAssuranceWorkspace } from "./components/ArtifactAssuranceWorkspace";
import { buildStoryAssuranceAnalysis, buildTestCaseAssuranceAnalysis } from "./lib/artifactAssurance";

const previewParameters = new URLSearchParams(window.location.search);
const mode = previewParameters.get("mode") === "test-case" ? "test-case" : "story";
if (previewParameters.get("theme") === "dark") document.documentElement.dataset.theme = "dark";
const storyAssessment = buildStoryAssuranceAnalysis({
  title: "Customers can securely recover a forgotten password",
  description: "A customer needs a secure recovery path with a time-bound, single-use token, neutral responses, accessible feedback, and explicit session invalidation after the password changes.",
  gherkinScenarios: ["Given an existing customer requests recovery, when a valid single-use token is submitted, then the password changes and prior sessions are invalidated."],
  linkedCaseCount: 3,
  externalReferences: ["Identity recovery product specification"],
  labels: ["identity", "security", "accessibility"],
  hasDeliveryContext: true
});
const testCaseAssessment = buildTestCaseAssuranceAnalysis({
  title: "Complete password recovery with a valid single-use token",
  description: "Validate the recovery path, neutral confirmation, session invalidation, and expired-token boundary.",
  steps: [
    { id: "1", action: "Open the password recovery page", expected_result: "The email field and submit control are displayed" },
    { id: "2", action: "Submit a registered email address", expected_result: "A neutral confirmation message is displayed and a 15-minute token is sent" },
    { id: "3", action: "Open the single-use link and set a valid password", expected_result: "The password is updated and existing sessions are invalidated" },
    { id: "4", action: "Reuse the consumed token", expected_result: "An expired-token error is displayed without changing the password" },
    { id: "5", action: "Inspect the audit event", expected_result: "" }
  ],
  requirementCount: 1,
  labels: ["identity", "regression"],
  parameterValues: { account: "registered-customer", token_state: "valid" },
  reviewStatus: "pending",
  finalizedRunCount: 4,
  passRate: 75,
  suiteCount: 2,
  externalReferenceCount: 1
});

function Preview() {
  const isStory = mode === "story";
  const assessment = isStory ? storyAssessment : testCaseAssessment;
  const href = isStory ? "?mode=test-case" : "?mode=story";
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSource, setAnalysisSource] = useState<"local" | "ai">("ai");
  const [impactOpen, setImpactOpen] = useState(false);

  const refreshAnalysis = () => {
    setIsAnalyzing(true);
    window.setTimeout(() => {
      setAnalysisSource("ai");
      setIsAnalyzing(false);
    }, 650);
  };

  return (
    <main className="assurance-preview-shell">
      <header className="assurance-preview-head">
        <div className="assurance-preview-identity">
          <span>{isStory ? "QAIRA-142 · Story" : "TC-018 · Test Case"}</span>
          <h1>{isStory ? "Customers can securely recover a forgotten password" : "Complete password recovery with a valid token"}</h1>
          <p>{isStory ? "Identity Sprint 18 · August release" : "Web Project · Identity regression"}</p>
        </div>
        <nav className="assurance-preview-mode" aria-label="Preview mode">
          <a className={isStory ? "is-active" : ""} href="?mode=story">Story</a>
          <a className={!isStory ? "is-active" : ""} href="?mode=test-case">Test Case</a>
        </nav>
      </header>
      <nav className="assurance-preview-tabs" aria-label={`${isStory ? "Story" : "Test Case"} details`}>
        <span>Details</span>
        <span className="is-active">AI Assurance</span>
        <span>{isStory ? "Test Cases" : "Linked Suites"}</span>
        <span>History</span>
        <span>Linked Bugs</span>
        <span>Attachments</span>
      </nav>
      <section className="assurance-preview-body">
        <ArtifactAssuranceWorkspace
          analysis={assessment}
          analysisSource={analysisSource}
          generatedAt="2026-08-02T13:48:00.000Z"
          isAnalyzing={isAnalyzing}
          onAnalyze={refreshAnalysis}
          onInspectImpact={() => setImpactOpen(true)}
          reviewState={isStory ? "review-required" : "pending-review"}
          title={isStory ? "Story quality & design analysis" : "Test design & evidence analysis"}
        />
        <a href={href} hidden>Switch</a>
      </section>
      {impactOpen ? (
        <div className="assurance-preview-dialog-backdrop" role="presentation">
          <section aria-labelledby="assurance-impact-title" aria-modal="true" className="assurance-preview-dialog" role="dialog">
            <span>AI Assurance · Jira evidence</span>
            <h2 id="assurance-impact-title">{isStory ? "Story change impact" : "Test case downstream impact"}</h2>
            <p>{isStory ? "3 test cases, 2 suites, and 1 active run may require review." : "1 Story, 2 suites, and 4 recorded runs are in the current impact graph."}</p>
            <div><b>Preview only</b><span>No Jira record has been changed.</span></div>
            <button onClick={() => setImpactOpen(false)} type="button">Close impact</button>
          </section>
        </div>
      ) : null}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
