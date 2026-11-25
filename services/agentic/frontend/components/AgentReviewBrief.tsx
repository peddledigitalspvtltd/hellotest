import type { AgenticAssistantSavedSessionResponse, AgenticAssistantSessionResponse } from "@hellotest/platform/frontend/src/types";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { AgenticOutcomePanel } from "./AgenticExperience";
import { AgentRunFailure } from "./AgentRunFailure";

export function AgentReviewBrief({ sessionId, session, saved, loading, error, expectedResult, canViewDiagnostics }: {
  sessionId?: string;
  session?: AgenticAssistantSessionResponse | null;
  saved?: AgenticAssistantSavedSessionResponse;
  loading?: boolean;
  error?: unknown;
  expectedResult: string;
  canViewDiagnostics: boolean;
}) {
  const selected = session || saved;
  const transaction = selected?.transaction;
  if (selected?.result && transaction) {
    const elapsed = Date.parse(transaction.completed_at || "") - Date.parse(transaction.started_at || transaction.created_at || "");
    return <AgenticOutcomePanel key={transaction.id} citations={selected.citations} guardrails={selected.guardrails}
      guardrailRules={selected.guardrail_rules} provenance={selected.provenance} result={selected.result} sessionId={transaction.id}
      durationMs={elapsed >= 0 ? elapsed : undefined} />;
  }
  if (saved?.session_state === "failed") return <AgentRunFailure session={saved} canViewDiagnostics={canViewDiagnostics} />;
  const message = error instanceof Error ? error.message : saved?.message || "Only reviews belonging to this project, application and specialist can be opened here.";
  return <div className="agent-specialist-ready">
    <span className="agent-eyebrow">{sessionId ? "Saved review" : "What you will get"}</span>
    {sessionId && loading ? <LoadingState label="Loading saved review" />
      : <h3>{sessionId ? saved?.session_state === "running" ? "This review is still in progress" : "This saved review is unavailable" : expectedResult}</h3>}
    <p>{sessionId ? message : "A decision summary, cited findings, proposed next actions and evidence gaps."}</p>
  </div>;
}
