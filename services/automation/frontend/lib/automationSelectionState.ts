import type { AutomationCaseType } from "@hellotest/platform/frontend/src/types";

export type AutomationCatalogFilters = {
  search: string;
  plan: "" | "ready" | "incomplete";
  platform: "" | AutomationCaseType;
  outcome: "" | "passed" | "failed" | "blocked" | "not_verified";
};

export const EMPTY_AUTOMATION_CATALOG_FILTERS: AutomationCatalogFilters = { search: "", plan: "", platform: "", outcome: "" };

export type AutomationSelectionState = {
  scope: string;
  caseId: string;
  routeCaseId: string;
  caseIds: string[];
  catalogFilters: AutomationCatalogFilters;
  stepIds: string[];
  expandedStepIds: string[];
  visibleInstructionIds: string[];
};
export type AutomationSelectionAction =
  | { type: "scope.changed"; scope: string }
  | { type: "catalog.filtered"; filters: Partial<AutomationCatalogFilters> }
  | { type: "case.changed"; caseId: string; routeCaseId?: string }
  | { type: "cases.selected"; ids: string[] }
  | { type: "case.toggled"; id: string; selected: boolean }
  | { type: "steps.selected"; ids: string[] }
  | { type: "step.toggled"; id: string; selected: boolean }
  | { type: "steps.expanded"; ids: string[] }
  | { type: "step.expansion_toggled"; id: string }
  | { type: "instructions.shown"; ids: string[] }
  | { type: "instruction.shown"; id: string }
  | { type: "instruction.toggled"; id: string }
  | { type: "steps.reconciled"; availableIds: string[] };
export const automationSelectionInitial = (scope: string): AutomationSelectionState => ({
  scope, caseId: "", routeCaseId: "", caseIds: [], catalogFilters: EMPTY_AUTOMATION_CATALOG_FILTERS,
  stepIds: [], expandedStepIds: [], visibleInstructionIds: []
});
const unique = (ids: string[]) => [...new Set(ids.filter(Boolean))];
export function automationSelectionReducer(state: AutomationSelectionState, action: AutomationSelectionAction): AutomationSelectionState {
  if (action.type === "scope.changed") return action.scope === state.scope ? state : automationSelectionInitial(action.scope);
  if (action.type === "catalog.filtered") {
    return { ...state, catalogFilters: { ...state.catalogFilters, ...action.filters }, caseIds: [] };
  }
  if (action.type === "case.changed") {
    const routeCaseId = action.routeCaseId ?? action.caseId;
    if (action.caseId === state.caseId) return routeCaseId === state.routeCaseId ? state : { ...state, routeCaseId };
    return { ...state, caseId: action.caseId, routeCaseId, stepIds: [], expandedStepIds: [], visibleInstructionIds: [] };
  }
  if (action.type === "cases.selected") return { ...state, caseIds: unique(action.ids) };
  if (action.type === "case.toggled") return { ...state, caseIds: action.selected ? unique([...state.caseIds, action.id]) : state.caseIds.filter(id => id !== action.id) };
  if (action.type === "steps.selected") return { ...state, stepIds: unique(action.ids) };
  if (action.type === "step.toggled") return { ...state, stepIds: action.selected ? unique([...state.stepIds, action.id]) : state.stepIds.filter(id => id !== action.id) };
  if (action.type === "steps.expanded") return { ...state, expandedStepIds: unique(action.ids) };
  if (action.type === "step.expansion_toggled") return { ...state, expandedStepIds: state.expandedStepIds.includes(action.id) ? [] : [action.id] };
  if (action.type === "instructions.shown") return { ...state, visibleInstructionIds: unique(action.ids) };
  if (action.type === "instruction.shown") return { ...state, visibleInstructionIds: unique([...state.visibleInstructionIds, action.id]) };
  if (action.type === "instruction.toggled") return { ...state, visibleInstructionIds: state.visibleInstructionIds.includes(action.id) ? state.visibleInstructionIds.filter(id => id !== action.id) : unique([...state.visibleInstructionIds, action.id]) };
  const available = new Set(action.availableIds);
  return { ...state, stepIds: state.stepIds.filter(id => available.has(id)), expandedStepIds: state.expandedStepIds.filter(id => available.has(id)), visibleInstructionIds: state.visibleInstructionIds.filter(id => available.has(id)) };
}

/** A display-ID URL and its resolved UUID describe the same selected case.
 * Keep the pair scoped to the current URL so a previous selection cannot hide
 * another case's capture while the next detail route is loading. */
export function selectionMatchesCaseRoute(state: AutomationSelectionState, caseId: string, routeCaseId: string) {
  return Boolean(routeCaseId && (caseId === routeCaseId || state.caseId === caseId && state.routeCaseId === routeCaseId));
}

export function createAutomationSelectionStore(scope: string) {
  let state = automationSelectionInitial(scope);
  const listeners = new Set<() => void>();
  return { snapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, dispatch(action: AutomationSelectionAction) { const next = automationSelectionReducer(state, action); if (next !== state) { state = next; listeners.forEach(listener => listener()); } return state; } };
}
