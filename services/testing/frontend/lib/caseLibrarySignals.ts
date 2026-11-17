import type { ExecutionResult } from "@hellotest/platform/frontend/src/types";

export type CaseChannelEvidence = { manual?: ExecutionResult | null; automation?: ExecutionResult | null };

export function caseEvidenceLineage(history: ExecutionResult[], channels?: CaseChannelEvidence) {
  const ordered = [...history].sort((a, b) => String(b.effective_at || b.created_at || "").localeCompare(String(a.effective_at || a.created_at || "")));
  const manual = channels ? channels.manual || undefined : ordered.find(item => item.result_origin !== "linked_automation" && !item.derived);
  const automation = channels ? channels.automation || undefined : ordered.find(item => item.result_origin === "linked_automation" || item.derived);
  const latest = [manual, automation].filter((item): item is ExecutionResult => Boolean(item)).sort((a,b) => String(b.effective_at || b.created_at || "").localeCompare(String(a.effective_at || a.created_at || "")))[0];
  return { manual, automation, latest };
}

export function caseExecutionGuidance({ hasRuns, failed, unlinked, automationCandidate }: { hasRuns: boolean; failed: boolean; unlinked: boolean; automationCandidate: boolean }) {
  if (!hasRuns) return { tone: "neutral" as const, text: "No execution evidence yet. Run this case to establish its first observed outcome." };
  if (failed) return { tone: "danger" as const, text: "Recent failed or blocked evidence needs review. Open the attempt and its recorded comments." };
  if (unlinked) return { tone: "warning" as const, text: "Link this case to a Story to make delivery scope traceable." };
  if (automationCandidate) return { tone: "info" as const, text: "Automation candidate based on authored steps. Review its suitability independently of execution history." };
  return { tone: "success" as const, text: "Recent passing evidence is available. Review its scope and recency before using it in a release gate." };
}

/** Keep existing explicit order; module additions are ordered and deduplicated. */
export function mergeModuleCaseOrder(explicit: string[], moduleCases: string[][]) {
  return [...new Set([...explicit, ...moduleCases.flat()])];
}
