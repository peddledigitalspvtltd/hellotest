import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";
import type { AutomationAuthoringState as ServerAuthoringState } from "../api.client";
import type { RecorderStartOptions } from "../components/RecorderStartControls";

export type AuthoringBuildStatus = "submitting" | "queued" | "running" | "completed" | "failed" | "paused" | "cancelled";
export type AuthoringBuild = { operationId: string; activityId?: string; caseIds: string[]; status: AuthoringBuildStatus; scheduledAt: string | null; startedAt: number };
export type RecordingOrigin = { caseId: string; projectId: string; appTypeId: string; targetStepId: string; environmentId: string; configurationId: string; dataSetId: string; suiteId: string };
export type RecordingParameterDraft = { caseValues: Record<string, string>; suiteValues: Record<string, string>; privateNames: string[]; overrideNames: string[] };
export type AuthoringRecording = { operationId: string; origin: RecordingOrigin; options: RecorderStartOptions; session: RecorderSessionResponse | null; parameterBindings: Record<number, string>; excludedActionIndices?: number[]; privateValues: string[]; parameterDraft?: RecordingParameterDraft };
export type AuthoringCaseState =
  | { phase: "idle"; lastBuild?: AuthoringBuild }
  | { phase: "building"; build: AuthoringBuild }
  | { phase: "record_starting" | "recording" | "record_saving"; recording: AuthoringRecording | null; server?: ServerAuthoringState }
  | { phase: "conflict"; message: string; server?: ServerAuthoringState; local?: { kind: "build"; build: AuthoringBuild } | { kind: "recording"; recording: AuthoringRecording } };
export type AutomationAuthoringScope = { projectId: string; appTypeId: string; actorId: string };
export type AutomationAuthoringSnapshot = { scope: AutomationAuthoringScope; cases: Record<string, AuthoringCaseState> };
export type AutomationAuthoringAction =
  | { type: "build.requested"; build: AuthoringBuild }
  | { type: "build.accepted"; operationId: string; activityId: string; status: "queued" | "running" }
  | { type: "build.updated"; activityId: string; status: AuthoringBuildStatus }
  | { type: "build.rejected"; operationId: string; definite: boolean; message: string }
  | { type: "record.requested"; recording: AuthoringRecording }
  | { type: "record.started"; operationId: string; session: RecorderSessionResponse }
  | { type: "record.start_rejected"; operationId: string; definite: boolean; message: string }
  | { type: "record.session_updated"; caseId: string; session: RecorderSessionResponse }
  | { type: "record.parameters_changed"; caseId: string; operationId: string; parameterBindings: Record<number, string>; privateValues?: string[] }
  | { type: "record.parameter_draft_changed"; caseId: string; operationId: string; draft: RecordingParameterDraft }
  | { type: "record.action_inclusion_changed"; caseId: string; operationId: string; index: number; included: boolean }
  | { type: "record.save_requested"; caseId: string; sessionId: string }
  | { type: "record.save_rejected"; caseId: string; sessionId: string }
  | { type: "record.saved"; caseId: string; sessionId: string }
  | { type: "server.synced"; caseId: string; server: ServerAuthoringState; observedAt?: number };

const idle: AuthoringCaseState = Object.freeze({ phase: "idle" });
const activeBuild = (status: AuthoringBuildStatus) => ["submitting", "queued", "running"].includes(status);
export const caseAuthoringState = (state: AutomationAuthoringSnapshot, caseId: string) => state.cases[caseId] || idle;
export function activeAuthoringRecording(state: AutomationAuthoringSnapshot) {
  for (const [caseId, value] of Object.entries(state.cases)) {
    if (["record_starting", "recording", "record_saving"].includes(value.phase)) return { caseId, phase: value.phase, recording: "recording" in value ? value.recording : null };
    if (value.phase === "conflict" && value.local?.kind === "recording") return { caseId, phase: value.phase, recording: value.local.recording };
    if (value.phase === "conflict" && value.server?.recording) return { caseId, phase: value.phase, recording: null };
  }
  return null;
}
export function authoringBusy(caseId: string, value: AuthoringCaseState) {
  return Object.assign(new Error(value.phase === "conflict" ? value.message : `Finish or reconcile the ${value.phase.replace(/_/g, " ")} operation before starting another.`), { code: "AUTOMATION_AUTHORING_BUSY", caseId, phase: value.phase });
}
export const automationAuthoringInitial = (scope: AutomationAuthoringScope): AutomationAuthoringSnapshot => ({ scope, cases: {} });

/** One phase per case. Requests reserve synchronously before network work;
 * callbacks carry an operation identity so late results cannot replace a newer operation. */
export function automationAuthoringReducer(state: AutomationAuthoringSnapshot, action: AutomationAuthoringAction): AutomationAuthoringSnapshot {
  const cases = { ...state.cases };
  if (action.type === "build.requested") {
    const caseIds = [...new Set(action.build.caseIds.filter(Boolean))];
    if (!caseIds.length) throw new Error("Select at least one automation case.");
    for (const id of caseIds) if (caseAuthoringState(state, id).phase !== "idle") throw authoringBusy(id, caseAuthoringState(state, id));
    const build = { ...action.build, caseIds, status: "submitting" as const };
    caseIds.forEach(id => { cases[id] = { phase: "building", build }; });
  } else if (action.type === "record.requested") {
    const recording = action.recording, id = recording.origin.caseId;
    if (recording.origin.projectId !== state.scope.projectId || recording.origin.appTypeId !== state.scope.appTypeId) throw new Error("The recording belongs to another project or application.");
    const existing = activeAuthoringRecording(state);
    if (existing) throw authoringBusy(existing.caseId, caseAuthoringState(state, existing.caseId));
    if (caseAuthoringState(state, id).phase !== "idle") throw authoringBusy(id, caseAuthoringState(state, id));
    cases[id] = { phase: "record_starting", recording: { ...recording, origin: { ...recording.origin }, options: { ...recording.options }, parameterBindings: { ...recording.parameterBindings }, privateValues: [...recording.privateValues], session: null } };
  } else if (action.type === "build.accepted" || action.type === "build.updated" || action.type === "build.rejected") {
    for (const [id, value] of Object.entries(cases)) {
      if (value.phase !== "building") continue;
      if (action.type === "build.accepted" && value.build.operationId === action.operationId) cases[id] = { phase: "building", build: { ...value.build, activityId: action.activityId, status: action.status } };
      if (action.type === "build.updated" && value.build.activityId === action.activityId) {
        const build = { ...value.build, status: action.status };
        cases[id] = activeBuild(action.status) ? { phase: "building", build } : { phase: "idle", lastBuild: build };
      }
      if (action.type === "build.rejected" && value.build.operationId === action.operationId) cases[id] = action.definite ? idle : { phase: "conflict", message: action.message, local: { kind: "build", build: value.build } };
    }
  } else if (action.type === "record.started" || action.type === "record.start_rejected") {
    for (const [id, value] of Object.entries(cases)) {
      if (value.phase !== "record_starting" || value.recording?.operationId !== action.operationId) continue;
      cases[id] = action.type === "record.started" ? { phase: "recording", recording: { ...value.recording, session: action.session } } : action.definite ? idle : { phase: "conflict", message: action.message, local: { kind: "recording", recording: value.recording } };
    }
  } else if (action.type === "server.synced") {
    if (action.server.case_id !== action.caseId) throw new Error("Authoring state belongs to another case.");
    const before = caseAuthoringState(state, action.caseId), remote = action.server;
    const local = before.phase === "conflict" ? before.local : before.phase === "building" ? { kind: "build" as const, build: before.build }
      : "recording" in before && before.recording ? { kind: "recording" as const, recording: before.recording } : undefined;
    if (remote.state === "idle") {
      // A read taken before an admitted POST cannot release that in-flight request.
      if (before.phase === "record_starting" || before.phase === "record_saving" || before.phase === "building" && before.build.status === "submitting") return state;
      cases[action.caseId] = idle;
    } else if (remote.state === "building" && remote.build) {
      if (before.phase === "building" && (!before.build.activityId || before.build.activityId === remote.build.activity_id)) cases[action.caseId] = { phase: "building", build: { ...before.build, activityId: remote.build.activity_id, status: remote.build.status === "queued" ? "queued" : "running" } };
      else if (local?.kind === "build" && (!local.build.activityId || local.build.activityId === remote.build.activity_id)) cases[action.caseId] = { phase: "building", build: { ...local.build, activityId: remote.build.activity_id, status: remote.build.status === "queued" ? "queued" : "running" } };
      else if (before.phase === "idle") cases[action.caseId] = { phase: "building", build: { operationId: `remote:${remote.build.activity_id}`, activityId: remote.build.activity_id, caseIds: [action.caseId], status: remote.build.status === "queued" ? "queued" : "running", scheduledAt: null, startedAt: action.observedAt || 0 } };
      else cases[action.caseId] = { phase: "conflict", server: remote, local, message: "A build is already claimed for this case. Refresh its saved activity before continuing." };
    } else if (remote.state === "recording") {
      if (before.phase === "recording" || before.phase === "record_starting" || before.phase === "record_saving") cases[action.caseId] = { ...before, server: remote };
      else if (local?.kind === "recording") cases[action.caseId] = { phase: "recording", recording: local.recording, server: remote };
      else if (before.phase === "idle") cases[action.caseId] = { phase: "recording", recording: null, server: remote };
      else cases[action.caseId] = { phase: "conflict", server: remote, local, message: "A recorder is already reserved for this case. Return to its recording activity before continuing." };
    } else cases[action.caseId] = { phase: "conflict", server: remote, local, message: "Conflicting authoring activity needs reconciliation. Review the build and recording receipts." };
  } else {
    const before = caseAuthoringState(state, action.caseId);
    if (!(before.phase === "recording" || before.phase === "record_saving" || before.phase === "record_starting" && (action.type === "record.parameters_changed" || action.type === "record.parameter_draft_changed")) || !("recording" in before) || !before.recording) {
      if (action.type === "record.save_requested") throw new Error("Reconnect to the original recording before saving it.");
      return state;
    }
    const recording = before.recording;
    if ((action.type === "record.save_requested" || action.type === "record.save_rejected" || action.type === "record.saved") && recording.session?.id !== action.sessionId) return state;
    if ((action.type === "record.parameters_changed" || action.type === "record.parameter_draft_changed") && recording.operationId !== action.operationId) return state;
    if (action.type === "record.session_updated") {
      if (recording.session?.id !== action.session.id) return state;
      cases[action.caseId] = { ...before, recording: { ...recording, session: action.session } };
    } else if (action.type === "record.parameters_changed") cases[action.caseId] = { ...before, recording: { ...recording, parameterBindings: { ...action.parameterBindings }, privateValues: action.privateValues ? [...action.privateValues] : recording.privateValues } };
    else if (action.type === "record.action_inclusion_changed") {
      if (before.phase !== "recording" || recording.operationId !== action.operationId || !recording.session?.actions?.some(row => row.index === action.index)) return state;
      const excluded = new Set(recording.excludedActionIndices || []);
      if (action.included) excluded.delete(action.index);
      else excluded.add(action.index);
      cases[action.caseId] = { ...before, recording: { ...recording, excludedActionIndices: [...excluded] } };
    }
    else if (action.type === "record.parameter_draft_changed") {
      // Keep only parameter state, with a finite bound; never silently truncate a value.
      if (Object.keys(action.draft.caseValues).length + Object.keys(action.draft.suiteValues).length > 2000 || JSON.stringify(action.draft).length > 4 * 1024 * 1024) throw new Error("Recording parameter context is too large. Save the data set before continuing.");
      cases[action.caseId] = { ...before, recording: { ...recording, parameterDraft: { caseValues: { ...action.draft.caseValues }, suiteValues: { ...action.draft.suiteValues }, privateNames: [...action.draft.privateNames], overrideNames: [...action.draft.overrideNames] } } };
    }
    else if (action.type === "record.save_requested") {
      if (before.phase !== "recording") throw authoringBusy(action.caseId, before);
      cases[action.caseId] = { phase: "record_saving", recording };
    } else if (action.type === "record.save_rejected") cases[action.caseId] = { phase: "recording", recording };
    else if (action.type === "record.saved" && recording.session?.id === action.sessionId) cases[action.caseId] = idle;
  }
  return { ...state, cases };
}

export function createAutomationAuthoringStore(scope: AutomationAuthoringScope) {
  let snapshot = automationAuthoringInitial(scope);
  const listeners = new Set<() => void>();
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispatch(action: AutomationAuthoringAction) { const next = automationAuthoringReducer(snapshot, action); if (next !== snapshot) { snapshot = next; listeners.forEach(listener => listener()); } return snapshot; }
  };
}
