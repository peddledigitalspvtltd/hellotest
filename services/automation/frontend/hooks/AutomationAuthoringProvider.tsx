import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { readRequestSession } from "@hellotest/platform/frontend/src/lib/httpClient";
import { automationApi } from "../api.client";
import { activeAuthoringRecording, automationAuthoringInitial, caseAuthoringState, createAutomationAuthoringStore, type AuthoringBuildStatus, type AuthoringRecording, type RecordingOrigin, type RecordingParameterDraft } from "../lib/automationAuthoringState";
import { createAutomationSelectionStore, type AutomationCatalogFilters } from "../lib/automationSelectionState";
import type { RecorderStartOptions } from "../components/RecorderStartControls";
import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";

/** This provider sits above Cases/Detail/Repository lazy routes. Sensitive
 * recording context lives in memory and is discarded on actor/session/scope change. */
function createController(projectId: string, appTypeId: string, actorId: string, revision: number) {
  const store = createAutomationAuthoringStore({ projectId, appTypeId, actorId });
  const selection = createAutomationSelectionStore(`${projectId}:${appTypeId}:${actorId}:${revision}`);
  const reads = new Map<string, AbortController>();
  const hiddenSnapshot = automationAuthoringInitial({ projectId, appTypeId, actorId });
  const visibleSnapshot = () => readRequestSession().token && readRequestSession().revision === revision ? store.snapshot() : hiddenSnapshot;
  const currentSession = () => { if (!actorId || !readRequestSession().token || readRequestSession().revision !== revision) throw new DOMException("The session changed.", "AbortError"); };
  const requestId = () => crypto.randomUUID();
  const failureMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
  const definiteRejection = (error: unknown) => { const status = Number((error as { status?: number; statusCode?: number })?.status || (error as { statusCode?: number })?.statusCode); return status >= 400 && status < 500 && status !== 409; };
  const commands = {
    beginBuild(caseIds: string[], scheduledAt: string | null = null) {
      currentSession();
      const operationId = requestId();
      store.dispatch({ type: "build.requested", build: { operationId, caseIds, status: "submitting", scheduledAt, startedAt: Date.now() } });
      return operationId;
    },
    buildAccepted(operationId: string, activityId: string, status: "queued" | "running" = "queued") { currentSession(); store.dispatch({ type: "build.accepted", operationId, activityId, status }); },
    buildUpdated(activityId: string, status: AuthoringBuildStatus) { currentSession(); store.dispatch({ type: "build.updated", activityId, status }); },
    buildRejected(operationId: string, error: unknown) { currentSession(); store.dispatch({ type: "build.rejected", operationId, definite: definiteRejection(error), message: failureMessage(error, "The build admission outcome is unknown. Refresh its saved activity before trying again.") }); },
    beginRecording(origin: RecordingOrigin, options: RecorderStartOptions, privateValues: string[] = []) {
      currentSession(); const operationId = requestId();
      store.dispatch({ type: "record.requested", recording: { operationId, origin, options, session: null, parameterBindings: {}, privateValues } }); return operationId;
    },
    recordingStarted(operationId: string, session: RecorderSessionResponse) { currentSession(); store.dispatch({ type: "record.started", operationId, session }); },
    recordingStartRejected(operationId: string, error: unknown) { currentSession(); store.dispatch({ type: "record.start_rejected", operationId, definite: definiteRejection(error), message: failureMessage(error, "Recorder start is uncertain. Review its saved activity before opening another browser.") }); },
    recorderSessionUpdated(caseId: string, session: RecorderSessionResponse) { currentSession(); store.dispatch({ type: "record.session_updated", caseId, session }); },
    recordingParametersChanged(caseId: string, operationId: string, parameterBindings: Record<number, string>, privateValues?: string[]) { currentSession(); store.dispatch({ type: "record.parameters_changed", caseId, operationId, parameterBindings, privateValues }); },
    recordingDraftChanged(caseId: string, operationId: string, draft: RecordingParameterDraft) { currentSession(); store.dispatch({ type: "record.parameter_draft_changed", caseId, operationId, draft }); },
    recordingActionInclusionChanged(caseId: string, operationId: string, index: number, included: boolean) { currentSession(); store.dispatch({ type: "record.action_inclusion_changed", caseId, operationId, index, included }); },
    beginRecordingSave(caseId: string) {
      currentSession(); const value = caseAuthoringState(store.snapshot(), caseId);
      if (!(value.phase === "recording" && value.recording?.session)) throw new Error("Return to the original recording before saving it.");
      const sessionId = value.recording.session.id;
      store.dispatch({ type: "record.save_requested", caseId, sessionId }); return sessionId;
    },
    recordingSaveRejected(caseId: string, sessionId: string) { currentSession(); store.dispatch({ type: "record.save_rejected", caseId, sessionId }); },
    recordingSaved(caseId: string, sessionId: string) { currentSession(); store.dispatch({ type: "record.saved", caseId, sessionId }); },
    async syncAuthoringState(caseId: string, signal?: AbortSignal) {
      currentSession(); reads.get(caseId)?.abort();
      const controller = new AbortController(); reads.set(caseId, controller);
      const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const before = caseAuthoringState(store.snapshot(), caseId);
      try {
        const server = await automationApi.authoringState(caseId, controller.signal); currentSession(); controller.signal.throwIfAborted();
        if (!server || server.case_id !== caseId || !["idle", "building", "recording", "conflict"].includes(server.state)) throw new Error("The authoring state response is invalid. Refresh before starting another operation.");
        // A late idle response must never release a newer local request.
        if (caseAuthoringState(store.snapshot(), caseId) === before) store.dispatch({ type: "server.synced", caseId, server, observedAt: Date.now() });
        return server;
      } finally { signal?.removeEventListener("abort", abort); if (reads.get(caseId) === controller) reads.delete(caseId); }
    },
    openCase(caseId: string, routeCaseId = caseId) { selection.dispatch({ type: "case.changed", caseId, routeCaseId }); },
    filterCatalog(filters: Partial<AutomationCatalogFilters>) { selection.dispatch({ type: "catalog.filtered", filters }); },
    selectCases(ids: string[]) { selection.dispatch({ type: "cases.selected", ids }); },
    toggleCase(id: string, selected: boolean) { selection.dispatch({ type: "case.toggled", id, selected }); },
    selectSteps(ids: string[]) { selection.dispatch({ type: "steps.selected", ids }); },
    toggleStep(id: string, selected: boolean) { selection.dispatch({ type: "step.toggled", id, selected }); },
    expandSteps(ids: string[]) { selection.dispatch({ type: "steps.expanded", ids }); },
    toggleExpandedStep(id: string) { selection.dispatch({ type: "step.expansion_toggled", id }); },
    showInstructions(ids: string[]) { selection.dispatch({ type: "instructions.shown", ids }); },
    showInstruction(id: string) { selection.dispatch({ type: "instruction.shown", id }); },
    toggleInstructions(id: string) { selection.dispatch({ type: "instruction.toggled", id }); },
    reconcileSteps(availableIds: string[]) { selection.dispatch({ type: "steps.reconciled", availableIds }); },
    activeRecording: () => activeAuthoringRecording(visibleSnapshot()),
    caseState: (caseId: string) => caseAuthoringState(visibleSnapshot(), caseId)
  };
  return { store: { ...store, snapshot: visibleSnapshot }, selection, commands, dispose() { reads.forEach(controller => controller.abort()); reads.clear(); } };
}

const Context = createContext<ReturnType<typeof createController> | null>(null);
export function AutomationAuthoringProvider({ projectId, appTypeId, children }: { projectId: string; appTypeId: string; children: ReactNode }) {
  const { session } = useAuth(), actorId = session?.user.id || "", revision = readRequestSession().revision;
  const controller = useMemo(() => createController(projectId, appTypeId, actorId, revision), [projectId, appTypeId, actorId, revision]);
  useEffect(() => () => controller.dispose(), [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
function useController() { const value = useContext(Context); if (!value) throw new Error("Automation authoring requires its route provider."); return value; }
export function useAutomationAuthoring() {
  const value = useController(), state = useSyncExternalStore(value.store.subscribe, value.store.snapshot, value.store.snapshot);
  return { state, ...value.commands };
}
export function useAutomationCaseAuthoring(caseId: string) {
  const value = useController(), read = () => caseAuthoringState(value.store.snapshot(), caseId);
  const state = useSyncExternalStore(value.store.subscribe, read, read);
  return { state, ...value.commands };
}
export function useAutomationSelection() {
  const value = useController(), state = useSyncExternalStore(value.selection.subscribe, value.selection.snapshot, value.selection.snapshot);
  return { state, openCase: value.commands.openCase, filterCatalog: value.commands.filterCatalog, selectCases: value.commands.selectCases, toggleCase: value.commands.toggleCase, selectSteps: value.commands.selectSteps, toggleStep: value.commands.toggleStep, expandSteps: value.commands.expandSteps, toggleExpandedStep: value.commands.toggleExpandedStep, showInstructions: value.commands.showInstructions, showInstruction: value.commands.showInstruction, toggleInstructions: value.commands.toggleInstructions, reconcileSteps: value.commands.reconcileSteps };
}
export type { AuthoringRecording };
