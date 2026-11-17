import type { SetStateAction } from "react";
import type { RepositoryAgentPublishResult } from "./agentTypes";
type FindingGroup = "objects" | "test_cases" | "knowledge" | "components";
type PublicationFilter = "all" | "pending" | "published";
export type RepositoryReviewState = {
  sourceType: "zip" | "github";
  file: File | null;
  dragActive: boolean;
  repositoryUrl: string;
  ref: string;
  integrationId: string;
  message: string;
  messageTone: "success" | "error";
  messageArea: "source" | "review";
  historyOpen: boolean;
  historyPage: number;
  group: FindingGroup;
  search: string;
  publicationFilter: PublicationFilter;
  page: number;
  selected: Set<string>;
  moduleId: string;
  automationStartUrl: string;
  downloading: string;
  publishReceipt: RepositoryAgentPublishResult | null;
};
type FieldAction = { [K in keyof RepositoryReviewState]: { type: "field"; key: K; value: SetStateAction<RepositoryReviewState[K]> } }[keyof RepositoryReviewState];
export type RepositoryReviewAction = FieldAction | { type: "run.changed" } | { type: "scope.changed"; group: FindingGroup };
export function RepositoryReviewReducer(state: RepositoryReviewState, action: RepositoryReviewAction): RepositoryReviewState {
  if (action.type === "scope.changed") return RepositoryReviewInitial(action.group);
  if (action.type === "run.changed") return { ...state, selected: new Set(), search: "", publicationFilter: "all", page: 1, moduleId: "", automationStartUrl: "", publishReceipt: null };
  const value = typeof action.value === "function" ? (action.value as (current: unknown) => unknown)(state[action.key]) : action.value;
  const next = { ...state, [action.key]: value };
  if (["group", "publicationFilter"].includes(action.key)) { next.selected = new Set(); next.page = 1; }
  if (action.key === "search") next.page = 1;
  if (action.key === "sourceType") { next.message = ""; next.messageArea = "source"; }
  return next;
}
export function RepositoryReviewInitial(initialGroup: FindingGroup): RepositoryReviewState {
  return { sourceType: "zip",
    file: null,
    dragActive: false,
    repositoryUrl: "",
    ref: "",
    integrationId: "",
    message: "",
    messageTone: "error",
    messageArea: "source",
    historyOpen: false,
    historyPage: 1,
    group: initialGroup,
    search: "",
    publicationFilter: "all",
    page: 1,
    selected: new Set(),
    moduleId: "",
    automationStartUrl: "",
    downloading: "",
    publishReceipt: null };
}
