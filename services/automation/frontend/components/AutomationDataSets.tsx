import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AuthoringDataSetPanel } from "@hellotest/platform/frontend/src/platform/components/AuthoringDataSetPanel";
import { useDomainMetadata } from "@hellotest/platform/frontend/src/platform/hooks/useDomainMetadata";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import type { TestDataSet } from "@hellotest/platform/frontend/src/types";
import type { StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { isPrivateParameterName } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { TestDataSetPickerDialog } from "@hellotest/testing/frontend/components/TestDataSetPickerDialog";
import { downloadParameterCsvTemplate } from "@hellotest/testing/frontend/lib/executionParameterContext";
import { buildDataSetPayload, buildEmptyDataSetDraft, dataSetToDraft, DataSetForm, ResourceModalShell } from "@hellotest/testing/frontend/pages/TestEnvironmentPage";

/** Reuse manual authoring's picker, validation, CSV import and data utilities. */
export function AutomationDataSets({ expanded = false, valuesOnly = false, inheritedLink = false, projectId, appTypeId, dataSets, linkedId, isLoading, error, onRetry,
  canView, canLink, canManage, overrideSharedSteps, onOverrideSharedStepsChange, onLink, parameters, parameterValues = {}, canEditParameters = canLink, onManageParameters
}: {
  expanded?: boolean; valuesOnly?: boolean; inheritedLink?: boolean; projectId: string; appTypeId: string; dataSets: TestDataSet[]; linkedId: string;
  isLoading: boolean; error?: string; onRetry: () => void;
  canView: boolean; canLink: boolean; canManage: boolean;
  overrideSharedSteps: boolean; onOverrideSharedStepsChange: (value: boolean) => void;
  onLink: (id: string) => void; parameters: StepParameterDefinition[]; parameterValues?: Record<string, string>;
  canEditParameters?: boolean; onManageParameters: () => void;
}) {
  const client = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const metadata = useDomainMetadata();
  const linkedSnapshot = useRef<TestDataSet>();
  const currentLinked = canView ? dataSets.find(item => item.id === linkedId) : undefined;
  if (currentLinked) linkedSnapshot.current = currentLinked;
  const linked = currentLinked || (canView && linkedSnapshot.current?.id === linkedId ? linkedSnapshot.current : undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [draft, setDraft] = useState(buildEmptyDataSetDraft);
  const [saveError, setSaveError] = useState("");
  useEffect(() => { if (linked && editor !== "edit") setDraft(dataSetToDraft(linked)); }, [linked, editor]);
  const save = useMutation({
    mutationFn: async () => {
      if (!canLink || !canManage || !projectId) throw new Error("Data management and case update access are required.");
      const { payload } = buildDataSetPayload(projectId, editor === "edit" ? linked?.app_type_id || undefined : appTypeId || undefined, draft);
      if (!payload.name) throw new Error("Provide a data set name.");
      if (editor === "edit" && !linked) throw new Error("The linked data set is unavailable. Reload it before saving.");
      const mode = editor;
      const existing = mode === "edit" ? linked : undefined;
      const result = existing ? await api.testDataSets.update(existing.id, payload) : await api.testDataSets.create(payload);
      return { mode, result, saved: existing ? { ...existing, ...payload, id: existing.id } : undefined };
    },
    onSuccess: async ({ mode, result, saved }) => {
      if (mounted.current && mode === "create") onLink(result.id);
      if (saved) {
        if (mounted.current) linkedSnapshot.current = saved;
        client.setQueriesData<TestDataSet[]>({ queryKey: ["test-data-sets"] }, items =>
          Array.isArray(items) ? items.map(item => item.id === saved.id ? saved : item) : items);
        if (mounted.current) setDraft(dataSetToDraft(saved));
      }
      await client.invalidateQueries({ queryKey: ["test-data-sets"] });
      if (mounted.current) setEditor(null);
    },
    onError: error => setSaveError(error instanceof Error ? error.message : "Unable to save data set.")
  });
  const create = () => {
    setDraft(buildEmptyDataSetDraft((metadata.data?.test_data_sets?.default_mode || "table") as TestDataSet["mode"]));
    setSaveError(""); setPickerOpen(false); setEditor("create");
  };
  const parameterContent = <>
    <p className="muted">Values apply to this case. Edit an override to replace an inherited value; an empty value stays empty.</p>
    {parameters.length ? <dl className="automation-case-parameter-values">{parameters.map(parameter => <div key={parameter.name}>
      <dt><code>{parameter.token}</code><small>{parameter.sourceLabel || parameter.scopeLabel}</small></dt>
      <dd>{parameter.sensitive || isPrivateParameterName(parameter.name) ? "Hidden value" : Object.prototype.hasOwnProperty.call(parameterValues, parameter.name) ? parameterValues[parameter.name] || "(empty)" : "Not set"}</dd>
    </div>)}</dl> : <p className="muted">No Test Params yet. Add @t.name, @s.name or @r.name to this case's steps to define one.</p>}
    <button className="link-button" type="button" onClick={onManageParameters}>{canEditParameters ? "Edit Test Params" : "View Test Params"}</button>
  </>;
  return <>
    {valuesOnly && !linkedId ? <section className="automation-case-test-params" aria-label="Test Params"><details>
      <summary><strong>Test Params</strong><span>{parameters.length} parameter{parameters.length === 1 ? "" : "s"}</span></summary>
      {parameterContent}
    </details></section> : null}
    <section className="automation-data-sets" aria-label="Data Sets">
    <h3>Data Sets</h3>
    {inheritedLink ? <p className="muted">Inherited from the linked manual case. Case parameter overrides can replace values without changing its data set link.</p> : null}
    {!valuesOnly ? <AuthoringDataSetPanel sharedGroupKind="sections" dataSet={linked} linkedDataSetId={linkedId} isLoading={isLoading} error={error} onRetry={onRetry}
      canView={canView} canLink={canLink} canUnlink={!inheritedLink} canCreate={canLink && canManage}
      overrideSharedSteps={overrideSharedSteps} onOverrideSharedStepsChange={onOverrideSharedStepsChange}
      hasParameters={parameters.length > 0} onManageParameters={onManageParameters}
      onDownloadTemplate={() => downloadParameterCsvTemplate(parameters, "automation-parameter-template.csv")}
      onCreate={create} onLink={() => { setSelectedId(linkedId); setSearch(""); setPickerOpen(true); }} onUnlink={() => onLink("")} /> : null}
    {valuesOnly && linked ? <header className="automation-linked-data-heading"><div><strong>{linked.name}</strong><span>{linked.mode === "table" ? `${linked.rows.length} data rows` : `${linked.rows.length} values`}</span></div>
      {canLink && canManage ? <button className="link-button" disabled={save.isPending || editor === "edit"} type="button" onClick={() => {
        setDraft(dataSetToDraft(linked)); setSaveError(""); setEditor("edit");
      }}>Edit linked data set</button> : null}
    </header> : null}
    {expanded && linked ? <div className="automation-linked-data-editor">
      {saveError ? <p role="alert">{saveError}</p> : null}
      <DataSetForm draft={draft} onChange={setDraft} savedDataSets={dataSets} isSubmitting={save.isPending} readOnly={editor !== "edit" || !canManage || !canLink}
        dataSetModeOptions={metadata.data?.test_data_sets?.modes?.length ? metadata.data.test_data_sets.modes : [{value:"table",label:"Table"},{value:"key_value",label:"Key/value"}]}
        onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (editor === "edit") { setSaveError(""); save.mutate(); } }} submitLabel={save.isPending ? "Saving…" : "Save data set"} />
      {editor === "edit" ? <button className="ghost-button compact" disabled={save.isPending} type="button" onClick={() => { setEditor(null); setSaveError(""); }}>Cancel data changes</button> : null}
    </div> : null}
    {valuesOnly && linkedId ? <details className="automation-linked-parameter-values"><summary>Parameter values and case overrides ({parameters.length})</summary>{parameterContent}</details> : null}
    {valuesOnly && !linked ? <div className="empty-state compact">{isLoading ? "Loading linked data set…" : error || "No data set linked. Link a data set from the Plan tab."}{error ? <button type="button" className="link-button" onClick={onRetry}>Retry</button> : null}</div> : null}
    {pickerOpen && canLink ? createPortal(<TestDataSetPickerDialog dataSets={dataSets} canCreateDataSet={canManage}
      isLoading={isLoading} error={error} onRetry={onRetry} search={search} selectedId={selectedId}
      onSearchChange={setSearch} onSelect={setSelectedId} onCreateNew={create} onClose={() => setPickerOpen(false)}
      onConfirm={() => { if (dataSets.some(item => item.id === selectedId)) { onLink(selectedId); setPickerOpen(false); } }} />, document.body) : null}
    {editor && !(expanded && editor === "edit") && canLink && canManage ? createPortal(<ResourceModalShell title={editor === "edit" ? "Edit Test Data Set" : "Create Test Data Set"}
      className="resource-modal-card--test-data" closeDisabled={save.isPending} onClose={() => { if (!save.isPending) setEditor(null); }}>
      {saveError ? <p role="alert">{saveError}</p> : null}
      <DataSetForm draft={draft} onChange={setDraft} savedDataSets={dataSets} isSubmitting={save.isPending}
        dataSetModeOptions={metadata.data?.test_data_sets?.modes?.length ? metadata.data.test_data_sets.modes : [{value:"table",label:"Table"},{value:"key_value",label:"Key/value"}]}
        onSubmit={event => { event.preventDefault(); setSaveError(""); save.mutate(); }}
        submitLabel={save.isPending ? "Saving…" : editor === "edit" ? "Save data set" : "Create and Select"} />
    </ResourceModalShell>, document.body) : null}
  </section></>;
}
