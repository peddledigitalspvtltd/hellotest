import { useId, type ReactNode } from "react";
import { ChevronDownIcon, SparkIcon } from "./AppIcons";
import { InfoTooltip } from "./InfoTooltip";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { AI_METRIC_CRITERIA_REGISTRY } from "../lib/aiPromptRegistry";
import type { AiArtifactAssuranceAnalysis, AiAssuranceDimensionStatus } from "../types";
import "./ArtifactAssuranceWorkspace.css";

type AssuranceReviewState = "review-required" | "pending-review" | "human-reviewed";

const REVIEW_LABEL: Record<AssuranceReviewState, string> = {
  "review-required": "Human review required",
  "pending-review": "Review pending",
  "human-reviewed": "Human reviewed"
};

const STATUS_LABEL: Record<AiAssuranceDimensionStatus, string> = {
  strong: "Strong",
  developing: "Developing",
  "needs-attention": "Needs attention"
};

const scoreTone = (score: number) => score >= 82 ? "strong" : score >= 60 ? "developing" : "needs-attention";

export function ArtifactAssuranceWorkspace({
  analysis,
  title,
  reviewState,
  analysisSource,
  generatedAt,
  isAnalyzing = false,
  analysisDisabled = false,
  isDraftChanged = false,
  analysisError,
  analysisNotice,
  providerControl,
  onAnalyze,
  onInspectImpact,
  criteriaKey
}: {
  analysis: AiArtifactAssuranceAnalysis;
  title: string;
  reviewState: AssuranceReviewState;
  analysisSource: "local" | "ai" | "fallback";
  generatedAt?: string | null;
  isAnalyzing?: boolean;
  analysisDisabled?: boolean;
  isDraftChanged?: boolean;
  analysisError?: string | null;
  analysisNotice?: string | null;
  providerControl?: ReactNode;
  onAnalyze?: () => void;
  onInspectImpact?: () => void;
  criteriaKey?: "metric.assurance.story" | "metric.assurance.test_case";
}) {
  const instanceId = useId();
  const titleId = `artifact-assurance-title-${instanceId}`;
  const insightsTitleId = `artifact-assurance-insights-title-${instanceId}`;
  const normalizedScore = Math.max(0, Math.min(100, Math.round(analysis.overall_score)));
  const { getMetricCriteria } = useAiPromptRegistry();
  const governedMetric = AI_METRIC_CRITERIA_REGISTRY.find((item) => item.key === criteriaKey) || null;
  const organizationCriteria = criteriaKey ? getMetricCriteria(criteriaKey) : "";
  const overallTone = scoreTone(normalizedScore);
  const sourceLabel = analysisSource === "ai"
    ? "AI-refined · deterministic scores"
    : analysisSource === "fallback"
      ? "Deterministic fallback"
      : "Live draft baseline";
  const timestamp = generatedAt ? new Date(generatedAt) : null;
  const timestampLabel = timestamp && !Number.isNaN(timestamp.getTime())
    ? timestamp.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <section aria-busy={isAnalyzing} aria-labelledby={titleId} className="artifact-assurance-workspace">
      <span aria-atomic="true" aria-live="polite" className="artifact-assurance-live" role="status">
        {isAnalyzing
          ? "AI assurance analysis is in progress."
          : isDraftChanged
            ? "The draft changed after the last AI analysis. Live baseline scores are shown until you refresh."
            : analysisSource === "ai" || analysisSource === "fallback"
              ? `AI assurance analysis is ready with a score of ${normalizedScore} out of 100.`
              : "Live draft assurance baseline is ready."}
      </span>
      <header className="artifact-assurance-overview">
        <div
          aria-label={`${analysis.score_label}: ${normalizedScore} out of 100`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={normalizedScore}
          aria-valuetext={`${analysis.score_label}: ${normalizedScore} out of 100`}
          className={`artifact-assurance-overall-score ${overallTone}`}
          role="meter"
        >
          <strong>{normalizedScore}</strong>
          <span>/100</span>
          <small>{analysis.score_label}</small>
        </div>

        <div className="artifact-assurance-overview-copy">
          <span className="artifact-assurance-eyebrow">
            <SparkIcon /> AI Assurance · Evidence-led analysis
            <InfoTooltip
              className="artifact-assurance-methodology-info"
              content={(
                <span className="metric-methodology-copy">
                  <span>{governedMetric?.formula || analysis.benchmark.disclosure}</span>
                  {organizationCriteria ? <span><b>Organization criteria:</b> {organizationCriteria}</span> : null}
                  <span>Scores and evidence remain deterministic anchors; AI may refine only explanations and recommendations.</span>
                </span>
              )}
              label={`How ${analysis.score_label} is calculated`}
              title={governedMetric?.label || analysis.score_label}
            />
          </span>
          <h2 id={titleId}>{title}</h2>
          <strong className="artifact-assurance-verdict">{analysis.verdict}</strong>
          <p>{analysis.summary}</p>
        </div>

        <div className="artifact-assurance-overview-actions">
          <span className={`artifact-assurance-review-badge ${reviewState}`}>{REVIEW_LABEL[reviewState]}</span>
          {providerControl}
          {onAnalyze ? (
            <button className="artifact-assurance-analyze-button" disabled={analysisDisabled || isAnalyzing} onClick={onAnalyze} type="button">
              <SparkIcon />
              <span>{isAnalyzing ? "Analyzing…" : analysisSource === "local" ? "Analyze with AI" : "Refresh analysis"}</span>
            </button>
          ) : null}
          {onInspectImpact ? (
            <button className="artifact-assurance-impact-button" disabled={analysisDisabled || isAnalyzing} onClick={onInspectImpact} type="button">
              Inspect impact
            </button>
          ) : null}
        </div>
      </header>

      {analysisNotice ? <p className="artifact-assurance-baseline-note" role="status">AI refinement is unavailable. {analysisNotice} Live draft scores remain available.</p> : null}
      {analysisError ? <p className="artifact-assurance-error" role="alert">Analysis could not be refreshed. {analysisError}</p> : null}
      {isDraftChanged ? (
        <p className="artifact-assurance-stale" role="status">
          <strong>Draft changed.</strong> Scores now reflect the live draft baseline; refresh AI analysis to update its explanations.
        </p>
      ) : null}

      <div aria-label="Assurance dimensions" className="artifact-assurance-dimensions">
        {analysis.dimensions.map((item) => {
          const normalizedDimensionScore = Math.max(0, Math.min(100, Math.round(item.score)));
          return (
            <details className={`artifact-assurance-dimension ${item.status}`} key={item.id}>
              <InfoTooltip
                className="artifact-assurance-dimension-info"
                content={(
                  <span className="metric-methodology-copy">
                    <span>{item.explanation}</span>
                    <span><b>Evidence:</b> {item.evidence.length ? item.evidence.join(" · ") : "No supporting signal is currently available."}</span>
                    {organizationCriteria ? <span><b>Organization criteria:</b> {organizationCriteria}</span> : null}
                  </span>
                )}
                label={`How ${item.label} is scored`}
                title={`${item.label} methodology`}
              />
              <summary>
                <span className="artifact-assurance-dimension-topline">
                  <span className="artifact-assurance-dimension-score">
                    <strong>{normalizedDimensionScore}</strong><span>/100</span>
                  </span>
                  <span className="artifact-assurance-dimension-status">{STATUS_LABEL[item.status]}</span>
                </span>
                <span aria-level={3} className="artifact-assurance-dimension-title" role="heading">{item.label}</span>
                <span aria-label={`${item.label}: ${normalizedDimensionScore} out of 100`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={normalizedDimensionScore} className="artifact-assurance-meter" role="meter">
                  <span style={{ width: `${normalizedDimensionScore}%` }} />
                </span>
                <span className="artifact-assurance-dimension-explanation">{item.explanation}</span>
                <span className="artifact-assurance-disclosure-label">Evidence & action <ChevronDownIcon /></span>
              </summary>
              <div className="artifact-assurance-dimension-detail">
                {item.frameworks?.length ? (
                  <div className="artifact-assurance-frameworks" aria-label="Relevant quality lenses">
                    {item.frameworks.map((framework) => <span key={framework}>{framework}</span>)}
                  </div>
                ) : null}
                <ul>
                  {item.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}
                </ul>
                <p><b>Next:</b> {item.recommendation}</p>
              </div>
            </details>
          );
        })}
      </div>

      <section aria-labelledby={insightsTitleId} className="artifact-assurance-insights">
        <header>
          <div>
            <span>Prioritized by evidence gap</span>
            <h3 id={insightsTitleId}>Priority insights</h3>
          </div>
          <span>{analysis.insights.length} {analysis.insights.length === 1 ? "action" : "actions"}</span>
        </header>
        {analysis.insights.length ? (
          <ol>
            {analysis.insights.map((item, index) => (
              <li key={item.id}>
                <span className="artifact-assurance-insight-index">{index + 1}</span>
                <div>
                  <div className="artifact-assurance-insight-title">
                    <strong>{item.title}</strong>
                    <span className={item.priority}>{item.priority}</span>
                  </div>
                  <p>{item.explanation}</p>
                  <span className="artifact-assurance-insight-evidence">Evidence: {item.evidence.join(" · ")}</span>
                  <p className="artifact-assurance-insight-action"><b>Action:</b> {item.recommendation}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="artifact-assurance-no-insights">No material design gaps were detected. Human review still owns the decision.</p>
        )}
      </section>

      <details className="artifact-assurance-methodology">
        <summary>
          <span>Evidence & methodology</span>
          <small>{analysis.evidence_count} signals · {sourceLabel}{timestampLabel ? ` · ${timestampLabel}` : ""}</small>
          <ChevronDownIcon />
        </summary>
        <div>
          <p><b>{analysis.benchmark.label}:</b> {analysis.benchmark.disclosure}</p>
          <ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          <p>Numeric scores and evidence are rules-based anchors. AI can refine concise explanations and recommendations, but cannot approve the artifact or change connected work items.</p>
        </div>
      </details>
    </section>
  );
}
