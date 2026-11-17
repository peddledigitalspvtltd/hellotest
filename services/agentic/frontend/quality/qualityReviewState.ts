import type { SetStateAction } from "react";
import type { QualityAgentPlan, QualityAgentArtifact, QualityAgentFinding } from "../lib/qualityAgentContracts";
export type QualityReviewState = {
  plan: QualityAgentPlan | null;
  reviewed: boolean;
  showPolicy: boolean;
  showHistory: boolean;
  tab: 'overview' | 'model' | 'findings' | 'visual' | 'data';
  notice: string;
  formError: string;
  baselineArtifact: QualityAgentArtifact | null;
  draftFinding: QualityAgentFinding | null;
};
type FieldAction = { [K in keyof QualityReviewState]: { type: "field"; key: K; value: SetStateAction<QualityReviewState[K]> } }[keyof QualityReviewState];
export type QualityReviewAction = FieldAction | { type: "plan.cleared" } | { type: "run.started" } | { type: "scope.changed" };
export function QualityReviewReducer(state: QualityReviewState, action: QualityReviewAction): QualityReviewState {
  if (action.type === "plan.cleared") return { ...state, plan: null, reviewed: false, formError: "" };
  if (action.type === "run.started") return QualityReviewInitial();
  if (action.type === "scope.changed") return QualityReviewInitial();
  const value = typeof action.value === "function" ? (action.value as (current: unknown) => unknown)(state[action.key]) : action.value;
  const next = { ...state, [action.key]: value };
  if (action.key === "plan") next.reviewed = false;
  return next;
}
export function QualityReviewInitial(): QualityReviewState {
  return { plan: null,
    reviewed: false,
    showPolicy: false,
    showHistory: false,
    tab: 'overview',
    notice: '',
    formError: '',
    baselineArtifact: null,
    draftFinding: null };
}
