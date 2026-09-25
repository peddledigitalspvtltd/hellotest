import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconRocket, IconX } from "@tabler/icons-react";
import { api, HelloTestApiError } from "@hellotest/platform/frontend/src/lib/api";
import { changedRunFields, retainRunSelections, runEditDraft, runEditLocks, type RunEditDraft } from "../lib/runEdit";
import { isRunFinished } from "../lib/runCatalog";
import type { Execution, TestCase, TestSuite } from "@hellotest/platform/frontend/src/types";
import type { AssigneeOption } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { buildDeliveryScopeOptions } from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { RunPlanningFields } from "./RunPlanningFields";
import { ExecutionContextSelector } from "./ExecutionContextSelector";
import { RunDataSetup } from "./RunDataSetup";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { SuiteCasePicker, SuiteScopePicker } from "./SuiteCasePicker";
import "./suite-authoring-reference.css";
import "@hellotest/platform/frontend/src/execution-run-builder.css";
import "./RunEditDialog.css";

type Props = { executionId: string; assigneeOptions: AssigneeOption[]; canRunLocalAutomation: boolean; canRunRemoteAutomation: boolean; canConfigureParallelAutomation: boolean; onClose: () => void; onSaved: () => void };

export function RunEditDialog(props: Props) {
  const query = useQuery({ queryKey: ["execution-edit", props.executionId], queryFn: () => api.executions.get(props.executionId), gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (query.data) return <RunEditForm {...props} execution={query.data} key={`${query.data.id}:${query.data.revision}`} />;
  return <RunEditLoading onClose={props.onClose} isError={query.isError} onRetry={() => void query.refetch()} />;
}

function RunEditLoading({ onClose, isError, onRetry }: { onClose: () => void; isError: boolean; onRetry: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  return <div className="modal-backdrop" role="presentation"><div role="dialog" aria-modal="true" aria-label="Edit run" className="modal-card run-edit-dialog" ref={dialogRef} tabIndex={-1}>
    <div className="run-edit-loading"><h2>Edit run</h2>{isError ? <p role="alert">The run could not be loaded. Try again.</p> : <LoadingState label="Loading the current run" />}
    {isError ? <button type="button" className="ghost-button" onClick={onRetry}>Retry</button> : null}
    <button className="ghost-button" onClick={onClose} type="button">Close</button></div>
  </div></div>;
}

function RunEditForm({ execution, assigneeOptions, canRunLocalAutomation, canRunRemoteAutomation, canConfigureParallelAutomation, onClose, onSaved }: Props & { execution: Execution }) {
  const initial = useMemo(() => runEditDraft(execution), [execution]);
  const [draft, setDraft] = useState<RunEditDraft>(initial);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(isRunFinished(execution));
  const [checkingLatest, setCheckingLatest] = useState(false);
  const [latestRun, setLatestRun] = useState<Execution | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const { session } = useAuth();
  const featureFlags = useFeatureFlags(Boolean(session));
  const scrollRef = useRef<HTMLFieldSetElement>(null);
  const queryClient = useQueryClient();
  const update = useMutation({ mutationFn: (changes: Parameters<typeof api.executions.update>[1]) => api.executions.update(execution.id, changes) });
  const busy = update.isPending || checkingLatest;
  const fieldsDisabled = finished || busy || needsReload;
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose, closeDisabled: busy });
  const scope = { project_id: execution.project_id, app_type_id: execution.app_type_id || undefined };
  const canViewSuites = hasPermission(session, "suite.view", execution.project_id);
  const canViewCases = hasPermission(session, "testcase.view", execution.project_id);
  const canViewDeliveryScopes = hasPermission(session, "requirement_iteration.view", execution.project_id)
    && areFeatureFlagsEnabled(featureFlags.data, ["hellotest.manual.requirements"]);
  const releases = useQuery({ queryKey: ["requirement-releases", execution.project_id], queryFn: () => api.requirementReleases.list({ project_id: execution.project_id }), enabled: canViewDeliveryScopes, staleTime: 30_000 });
  const iterations = useQuery({ queryKey: ["requirement-iterations", execution.project_id], queryFn: () => api.requirementIterations.list({ project_id: execution.project_id }), enabled: canViewDeliveryScopes, staleTime: 30_000 });
  const deliveryMetadata = useQuery({ queryKey: ["domain-metadata", "execution-builder", execution.project_id], queryFn: api.metadata.domain, enabled: canViewDeliveryScopes, staleTime: 10 * 60 * 1000 });
  const suites = useQuery({ queryKey: ["test-suites", "run-edit", scope], queryFn: () => api.testSuites.list(scope), enabled: canViewSuites && !finished });
  const cases = useQuery({ queryKey: ["test-cases", "run-edit", scope], queryFn: () => api.testCases.list(scope), enabled: canViewCases && !finished });
  const { runtimeLocked, scopeLocked } = runEditLocks(latestRun || execution);
  const set = <K extends keyof RunEditDraft>(key: K, value: RunEditDraft[K]) => {
    if (fieldsDisabled) return;
    if (runtimeLocked && ["test_data_options", "test_environment_id", "test_configuration_id", "test_data_set_id", "execution_mode", "parallel_enabled", "parallel_count"].includes(key)) return;
    if (scopeLocked && ["suite_ids", "test_case_ids"].includes(key)) return;
    if ((key === "suite_ids" && !canViewSuites) || (key === "test_case_ids" && !canViewCases)) return;
    if (["parallel_enabled", "parallel_count"].includes(key) && !canConfigureParallelAutomation) return;
    if (key === "execution_mode" && ((value === "local" && !canRunLocalAutomation) || (value === "remote" && !canRunRemoteAutomation))) return;
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const suiteOptions = retainRunSelections<TestSuite>(canViewSuites ? suites.data || [] : [], initial.suite_ids, (id) => ({
    id, app_type_id: execution.app_type_id || "", parent_id: null,
    name: `${execution.suite_snapshots?.find((item) => item.id === id)?.name || id} (saved selection)`,
    test_case_ids: execution.case_snapshots?.filter((item) => item.suite_id === id).map((item) => item.test_case_id) || []
  }));
  const caseOptions = retainRunSelections<TestCase>(canViewCases ? cases.data || [] : [], initial.test_case_ids, (id) => {
    const snapshot = execution.case_snapshots?.find((item) => item.test_case_id === id);
    return { id, suite_id: snapshot?.suite_id || null, requirement_id: null, title: `${snapshot?.test_case_title || id} (saved selection)`, description: snapshot?.test_case_description || null, automated: null, status: snapshot?.status || null, priority: snapshot?.priority || null };
  });
  const retainedAssignees = retainRunSelections(assigneeOptions, initial.assigned_to_ids, (id) => {
    const user = execution.assigned_users?.find((item) => item.id === id) || (execution.assigned_user?.id === id ? execution.assigned_user : null);
    return { id, name: user?.name || null, email: user?.email || "", label: user?.name || user?.email || id, caption: "Current assignee" };
  });
  const releaseRows = canViewDeliveryScopes ? asArray(releases.data) : [];
  const sprintRows = canViewDeliveryScopes ? asArray(iterations.data) : [];
  const mappedRelease = releaseRows.find(item => item.id === draft.release_id);
  const mappedSprint = sprintRows.find(item => item.id === draft.iteration_id);
  // IDs keep a saved selection attached through a rename. Loading its current
  // label must not silently rewrite the saved plan or mark the form as edited.
  const selectedRelease = mappedRelease?.fix_version || mappedRelease?.name || draft.release || draft.release_id;
  const selectedSprint = mappedSprint?.jira_sprint_name || mappedSprint?.name || draft.sprint || draft.iteration_id;
  const { releaseOptions, sprintOptions } = buildDeliveryScopeOptions({
    releases: releaseRows, iterations: sprintRows,
    jiraVersions: canViewDeliveryScopes ? deliveryMetadata.data?.jira?.versions : [],
    jiraSprints: canViewDeliveryScopes ? deliveryMetadata.data?.jira?.sprints : [],
    currentRelease: selectedRelease, currentSprint: selectedSprint
  });
  for (const [options, saved] of [[releaseOptions, initial.release || initial.release_id], [sprintOptions, initial.sprint || initial.iteration_id]] as const) {
    if (saved && !options.some(option => option.value === saved)) options.push({ value: saved, label: saved, source: "current", sourceId: null, state: null });
  }
  const setDelivery = (kind: "release" | "sprint", value: string) => {
    if (fieldsDisabled || !canViewDeliveryScopes) return;
    const option = (kind === "release" ? releaseOptions : sprintOptions).find(item => item.value === value);
    const relation = kind === "release" ? "release_id" : "iteration_id";
    const restoreSaved = option?.source === "current" && value === (initial[kind] || initial[relation]);
    setDraft(current => ({ ...current, [kind]: restoreSaved ? initial[kind] : value,
      [relation]: restoreSaved ? initial[relation] : option?.source === "hellotest" ? option.sourceId || "" : "" }));
  };
  const changes = changedRunFields(initial, draft);
  const dateError = draft.start_date && draft.end_date && draft.end_date < draft.start_date ? "End date must be on or after start date." : "";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (fieldsDisabled || dateError || !draft.name.trim() || !Object.keys(changes).length || (!draft.suite_ids.length && !draft.test_case_ids.length)) return;
    setError("");
    try {
      await update.mutateAsync({ ...changes, expected_revision: execution.revision });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["execution", execution.id] }),
        queryClient.invalidateQueries({ queryKey: ["execution-results"] })
      ]);
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The run could not be updated.");
      if (cause instanceof HelloTestApiError && cause.code === "RUN_FINISHED") setFinished(true);
      setCheckingLatest(true);
      const latest = await api.executions.get(execution.id).catch(() => null);
      if (latest) {
        setLatestRun(latest);
        if (isRunFinished(latest)) setFinished(true);
        else if (latest.revision !== execution.revision || latest.status !== execution.status || latest.started_at !== execution.started_at) setNeedsReload(true);
      } else if (cause instanceof HelloTestApiError && cause.status === 409) setNeedsReload(true);
      setCheckingLatest(false);
    }
  };
  const reloadLatest = async () => {
    setCheckingLatest(true);
    try {
      const latest = latestRun || await api.executions.get(execution.id);
      queryClient.setQueryData(["execution-edit", execution.id], latest);
      if (latest.revision === execution.revision) {
        setDraft(runEditDraft(latest));
        setFinished(isRunFinished(latest));
        setNeedsReload(false);
        setError("");
      }
    } catch { setError("The current run could not be loaded. Your edits are still here; retry when the connection is available."); }
    finally { setCheckingLatest(false); }
  };
  return <div className="modal-backdrop modal-backdrop--scroll" role="presentation" onClick={() => !busy && onClose()}>
    <div aria-labelledby="run-edit-title" aria-modal="true" role="dialog" className="modal-card execution-create-modal execution-run-builder-modal run-edit-dialog" ref={dialogRef} onClick={(event) => event.stopPropagation()} onWheel={(event) => {
      // The header/footer share the form's scroll surface. Within the body,
      // native wheel and touch scrolling handles inputs and open pickers.
      if (!scrollRef.current?.contains(event.target as Node)) scrollRef.current?.scrollBy({ top: event.deltaY, left: event.deltaX });
    }} tabIndex={-1}>
      <form className="execution-create-form" onSubmit={submit}>
        <header className="execution-create-header execution-run-builder-header run-edit-heading"><div className="execution-run-builder-title"><span className="execution-run-builder-title-icon" aria-hidden="true"><IconRocket size={17} /></span><div className="execution-run-builder-title-copy"><h2 className="dialog-title" id="run-edit-title">Edit run</h2><p>Update the plan and scope for {execution.name || "this run"}.</p></div></div><button aria-label="Close edit run" className="ghost-button dialog-close-button" disabled={busy} onClick={onClose} type="button"><IconX size={20} /></button></header>
        {finished ? <p role="status" className="inline-message">This run has finished. Its plan and captured results are locked.</p> : null}
        {error ? <p role="alert" className="inline-message error-message">{error}</p> : null}
        {needsReload && !finished ? <p className="inline-message" role="status">This run changed while you were editing. Reload its current values before saving; reloading replaces your unsaved edits. <button type="button" className="ghost-button" disabled={busy} onClick={() => void reloadLatest()}>Reload current run</button></p> : null}
        <fieldset className="run-edit-fields" disabled={fieldsDisabled} ref={scrollRef}>
          <div className="execution-create-body execution-run-builder-body run-edit-grid">
            <section className="execution-run-config-rail run-edit-settings" aria-label="Run configuration">
              <div className="execution-run-config-heading"><span>Run Configuration</span></div>
              <FormField label="Run Name" required><input value={draft.name} onChange={(event) => set("name", event.target.value)} maxLength={255} required /></FormField>
              <RunPlanningFields mode={draft.execution_mode} currentMode={initial.execution_mode} onModeChange={(value) => set("execution_mode", value)} startDate={draft.start_date} endDate={draft.end_date} onStartDateChange={(value) => set("start_date", value)} onEndDateChange={(value) => set("end_date", value)} canRunLocalAutomation={canRunLocalAutomation} canRunRemoteAutomation={canRunRemoteAutomation} modeDisabled={runtimeLocked} disabled={fieldsDisabled} modeHint={runtimeLocked ? "Run mode is fixed after execution starts." : "Changing the mode updates this run's plan. Saving does not start execution."} />
              <FormField label="Assignees" composite><MultiAssigneePicker options={retainedAssignees} selectedIds={draft.assigned_to_ids} onChange={(value) => set("assigned_to_ids", value)} disabled={fieldsDisabled} /></FormField>
              <div className="run-edit-delivery">
                <FormField label="Release"><select disabled={!canViewDeliveryScopes} value={selectedRelease} onChange={event => setDelivery("release", event.target.value)}>
                  <option value="">No release</option>
                  {releaseOptions.map(option => <option key={option.value} value={option.value}>{option.source === "current" && option.value === initial.release_id && !initial.release ? "Saved release (unavailable)" : option.label}</option>)}
                </select></FormField>
                <FormField label="Sprint"><select disabled={!canViewDeliveryScopes} value={selectedSprint} onChange={event => setDelivery("sprint", event.target.value)}>
                  <option value="">No Sprint</option>
                  {sprintOptions.map(option => <option key={option.value} value={option.value}>{option.source === "current" && option.value === initial.iteration_id && !initial.sprint ? "Saved Sprint (unavailable)" : option.label}</option>)}
                </select></FormField>
              </div>
              {canViewDeliveryScopes && (releases.isLoading || iterations.isLoading || deliveryMetadata.isLoading) ? <LoadingState label="Loading releases and Sprints" /> : null}
              {canViewDeliveryScopes && (releases.isError || iterations.isError || deliveryMetadata.isError) ? <p className="inline-message" role="alert">Some delivery options could not load. Saved selections are retained. <button className="text-button" type="button" onClick={() => { void releases.refetch(); void iterations.refetch(); void deliveryMetadata.refetch(); }}>Retry delivery options</button></p> : null}
              <FormField label="Build"><input value={draft.build} onChange={event => set("build", event.target.value)} /></FormField>
              <fieldset className="run-edit-runtime" disabled={runtimeLocked}>
                <legend>Run configuration</legend>
                {runtimeLocked ? <p>Environment, test data and execution settings are fixed after this run starts.</p> : null}
                <ExecutionContextSelector hideDataSet projectId={execution.project_id} appTypeId={execution.app_type_id || ""} selectedEnvironmentId={draft.test_environment_id} selectedConfigurationId={draft.test_configuration_id} selectedDataSetId={draft.test_data_set_id} onEnvironmentChange={(value) => set("test_environment_id", value)} onConfigurationChange={(value) => set("test_configuration_id", value)} onDataSetChange={(value) => set("test_data_set_id", value)} preserveMissingSelection />
                <RunDataSetup dataOptions={draft.test_data_options} onDataOptionsChange={value => set("test_data_options", value)} executionId={execution.id} appTypeId={execution.app_type_id || ""} onDataSetChange={value => set("test_data_set_id", value)} projectId={execution.project_id} cases={caseOptions.filter((item) => draft.test_case_ids.includes(item.id))} suites={suiteOptions.filter((suite) => draft.suite_ids.includes(suite.id))} environmentId={draft.test_environment_id} configurationId={draft.test_configuration_id} dataSetId={draft.test_data_set_id} disabled={fieldsDisabled || runtimeLocked} />
                <label className="checkbox-field"><input type="checkbox" checked={draft.parallel_enabled} disabled={!canConfigureParallelAutomation} onChange={(event) => set("parallel_enabled", event.target.checked)} />Run automation in parallel</label>
                {draft.parallel_enabled ? <FormField label="Parallel workers"><input type="number" min={1} max={100} disabled={!canConfigureParallelAutomation} value={draft.parallel_count} onChange={(event) => set("parallel_count", Math.max(1, Number(event.target.value) || 1))} /></FormField> : null}
              </fieldset>
            </section>
            <section className="execution-run-selection-workspace run-edit-scope">
              <h3>Run scope</h3><p>{scopeLocked ? "Automated run scope is fixed after execution starts." : "Choose suites and any additional individual cases. Cases with recorded results must stay in the run."}</p>
              {suites.isError || cases.isError ? <p role="alert">Some scope options could not load. Existing selections are retained. <button className="ghost-button" type="button" onClick={() => { void suites.refetch(); void cases.refetch(); }}>Retry</button></p> : null}
              {suites.isLoading || cases.isLoading ? <LoadingState label="Loading suites and test cases" /> : <>
                <fieldset className="run-edit-scope-options" disabled={scopeLocked || !canViewSuites}><SuiteScopePicker suites={suiteOptions} testCases={caseOptions} selectedSuiteIds={draft.suite_ids} onChange={(value) => set("suite_ids", value)} heading="Run suites" emptyMessage="No suites are available in this scope." /></fieldset>
                <fieldset className="run-edit-scope-options" disabled={scopeLocked || !canViewCases}><SuiteCasePicker cases={caseOptions} selectedCaseIds={draft.test_case_ids} onChange={(value) => set("test_case_ids", value)} disabled={scopeLocked || !canViewCases || fieldsDisabled} heading="Additional test cases" description="Cases selected here are retained independently of suite membership." emptyMessage="No individual cases are available in this scope." /></fieldset>
              </>}
            </section>
          </div>
        </fieldset>
        <footer className="execution-run-builder-footer run-edit-footer"><button className="ghost-button" disabled={busy} onClick={onClose} type="button">Cancel</button><button className="primary-button" disabled={fieldsDisabled || Boolean(dateError) || !draft.name.trim() || !Object.keys(changes).length || (!draft.suite_ids.length && !draft.test_case_ids.length)} type="submit">{update.isPending ? "Saving…" : checkingLatest ? "Checking current run…" : "Save changes"}</button></footer>
      </form>
    </div>
  </div>;
}
