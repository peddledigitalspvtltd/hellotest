import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconFileImport, IconDatabase, IconCheck, IconChevronDown, IconSearch, IconLink, IconPlus } from "@tabler/icons-react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { testingApi } from "../api.client";
import { dataOverrideEnabled, missingDataSetParameters } from "../lib/dataSetValidation";
import { parseRunDataCsv } from "../lib/runDataTemplate";
import { RunParameterTemplateButton } from "./RunParameterTemplateButton";
import type { TestCase, TestSuite } from "@hellotest/platform/frontend/src/types";
import "./RunDataSetup.css";

export function RunDataSetup({ parameterValues, onValidityChange, dataOptions = {}, onDataOptionsChange, suiteContextId, projectId, appTypeId, executionId, cases, suites = [], dataSetId, onDataSetChange, environmentId, configurationId, disabled = false, suiteMode = false }: {
  parameterValues?: Record<string, string>;
  onValidityChange?: (valid: boolean) => void;
  suiteContextId?: string;
  dataOptions?: TestDataOptions; onDataOptionsChange?: (options: TestDataOptions) => void;
  projectId: string; appTypeId: string; executionId?: string; cases: TestCase[]; suites?: TestSuite[]; dataSetId: string;
  onDataSetChange: (id: string) => void; environmentId?: string; configurationId?: string; disabled?: boolean; suiteMode?: boolean;
}) {
  const { session } = useAuth();
  const flags = useFeatureFlags(Boolean(session));
  const enabled = areFeatureFlagsEnabled(flags.data, ["hellotest.manual.test_data"]);
  const { can } = useCapabilityAccess(projectId);
  const canView = enabled && can("data.view");
  const canCreate = canView && can("data.manage");
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const scopeVersion = useRef(0);
  const fileVersion = useRef(0);
  const activeSave = useRef<symbol | null>(null);
  const scope = JSON.stringify([projectId, appTypeId, executionId]);
  const [dataPage, setDataPage] = useState(0);
  const [expanded, setExpanded] = useState(Boolean(dataSetId));
  const contentId = useId();
  const [linkOpen, setLinkOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [checkingId, setCheckingId] = useState("");
  const validationVersion = useRef(0);
  const [draft, setDraft] = useState<ReturnType<typeof parseRunDataCsv> | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const selection = JSON.stringify([cases.map(item => [item.id, item.revision, item.title, item.parameter_values, item.gherkin_document]), suites.map(item => [item.id, item.revision, item.updated_at, item.parameter_values, item.test_data_set_id, item.test_data_options])]);
  useLayoutEffect(() => {
    scopeVersion.current += 1;
    fileVersion.current += 1;
    activeSave.current = null;
    setDataPage(0); setDraft(null); setFeedback(""); setName(""); setBusy(false); setFailed(false); setLinkOpen(false); setSearch("");
    return () => {
      scopeVersion.current += 1;
      fileVersion.current += 1;
      activeSave.current = null;
    };
  }, [scope]);
  const dataQuery = optionalQueryView(useQuery({ queryKey: ["test-data-sets", projectId, appTypeId], queryFn: () => testingApi.testDataSets.list({ project_id: projectId, app_type_id: appTypeId }), enabled: Boolean(projectId && appTypeId && canView) }), canView);
  const canInspectPlan = Boolean(enabled && projectId && appTypeId && (cases.length || suites.length || executionId || suiteContextId)
    && (executionId ? can("run.view") : can("testcase.view") && (!suites.length || can("suite.view")))
    && (!dataSetId || canView || Boolean(executionId)));
  const planInput = (id: string) => ({ parameter_values: parameterValues, suite_context_id: suiteContextId, test_data_options: dataOptions, data_scope: suiteMode ? "suite" as const : "run" as const,
    project_id: projectId, app_type_id: appTypeId, execution_id: executionId,
    test_environment_id: can("environment.view") ? environmentId || (executionId ? "" : undefined) : undefined,
    test_configuration_id: can("configuration.view") ? configurationId || (executionId ? "" : undefined) : undefined,
    suite_ids: suites.map(item => item.id), test_case_ids: cases.map(item => item.id),
    test_data_set_id: canView ? id || (executionId || suiteContextId ? "" : undefined) : undefined });
  const scopePlan = useQuery({ queryKey: ["run-parameter-plan", projectId, appTypeId, executionId, selection, dataSetId, environmentId, configurationId, dataOptions, parameterValues, suiteMode, suiteContextId, dataQuery.dataUpdatedAt, canView, can("environment.view"), can("configuration.view")],
    queryFn: () => testingApi.executions.parameterPlan(planInput(dataSetId)),
    enabled: canInspectPlan, staleTime: 30_000, retry: false });
  const validationScope = JSON.stringify([scope, selection, dataOptions, parameterValues, suiteMode, suiteContextId, environmentId, configurationId, canView, disabled]);
  useLayoutEffect(() => {
    validationVersion.current += 1; setCheckingId(""); setFeedback(""); setFailed(false);
    return () => { validationVersion.current += 1; };
  }, [validationScope]);
  const visibleData = canView ? dataQuery.data || [] : [];
  const selectedData = visibleData.find(item => item.id === dataSetId);
  const groupKinds = scopePlan.data?.shared_group_kinds || (suites.length || executionId ? ["steps", "sections"] : [...new Set(cases.map(item => item.automated === "yes" ? "sections" : "steps"))]);
  const scopeVerified = canInspectPlan && scopePlan.isSuccess && !scopePlan.isFetching;
  const caseCount = scopeVerified ? scopePlan.data.case_count : null;
  const rows = selectedData ? selectedData.mode === "key_value" ? 1 : selectedData.rows.length : null;
  const required = scopePlan.data?.parameters || [];
  const selectedMissing = scopePlan.data?.data_set_validation?.missing_parameters
    || (selectedData ? missingDataSetParameters(selectedData, required) : []);
  const draftMissing = draft ? missingDataSetParameters({ ...draft, mode: "table" }, required) : [];
  const selectedValid = !dataSetId || !canView || (scopeVerified && scopePlan.data?.data_set_validation?.valid !== false && !selectedMissing.length);
  useEffect(() => { onValidityChange?.(selectedValid && !checkingId); }, [onValidityChange, selectedValid, checkingId]);
  const selectDataSet = async (id: string) => {
    if (!canView || !canInspectPlan || disabled || busy) return;
    const version = ++validationVersion.current;
    setCheckingId(id); setFeedback(""); setFailed(false);
    try {
      const plan = await testingApi.executions.parameterPlan(planInput(id));
      if (validationVersion.current !== version) return;
      const item = visibleData.find(data => data.id === id);
      const missing = plan.data_set_validation?.missing_parameters || (item ? missingDataSetParameters(item, plan.parameters) : []);
      if (plan.data_set_validation?.valid === false || missing.length) {
        setFailed(true); setFeedback(missing.length ? `This data set is missing required parameters: ${missing.join(", ")}. Download the current template or choose another data set.` : "This data set has no usable data rows. Add a row or choose another data set.");
        return;
      }
      onDataSetChange(id); setLinkOpen(false); setFeedback("Data set validated and linked.");
    } catch (error) {
      if (validationVersion.current === version) { setFailed(true); setFeedback(error instanceof Error ? error.message : "Unable to validate this data set."); }
    } finally { if (validationVersion.current === version) setCheckingId(""); }
  };
  const readFile = async (file?: File) => {
    if (!file || busy || disabled || !canCreate) return;
    const requestScope = scopeVersion.current;
    const requestFile = ++fileVersion.current;
    const isCurrent = () => scopeVersion.current === requestScope && fileVersion.current === requestFile;
    setExpanded(true); setLinkOpen(false); setDraft(null); setName(""); setFeedback(""); setFailed(false);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Use a CSV file smaller than 5 MB.");
      const parsed = parseRunDataCsv(await file.text(), suiteMode ? "s" : "r");
      if (!isCurrent()) return;
      setDataPage(0); setDraft(parsed); setName(file.name.replace(/\.csv$/i, "").replace(/[-_]+/g, " "));
    } catch (error) { if (isCurrent()) { setFailed(true); setFeedback(error instanceof Error ? error.message : "Unable to read this CSV."); } }
    if (isCurrent() && fileInput.current) fileInput.current.value = "";
  };
  const save = async () => {
    if (!draft || !name.trim() || busy || disabled || !canCreate || activeSave.current || !scopeVerified || draftMissing.length) return;
    const request = Symbol("save-data-set");
    const requestScope = scopeVersion.current;
    const requestSelection = validationVersion.current;
    activeSave.current = request;
    const isCurrent = () => scopeVersion.current === requestScope && activeSave.current === request;
    setBusy(true); setFailed(false); setFeedback("");
    try {
      if (draft.columns.length > 500 || draft.rows.length > 5000) throw new Error("Use at most 500 parameter columns and 5,000 rows in one data set.");
      if (new TextEncoder().encode(JSON.stringify({ columns: draft.columns, rows: draft.rows })).byteLength > 3 * 1024 * 1024) throw new Error("This data table exceeds 3 MB. Split it into smaller data sets before saving.");
      const response = await testingApi.testDataSets.create({ project_id: projectId, app_type_id: appTypeId, name: name.trim(), mode: "table", columns: draft.columns, rows: draft.rows });
      await client.invalidateQueries({ queryKey: ["test-data-sets", projectId] });
      if (!isCurrent()) return;
      if (requestSelection !== validationVersion.current) { setFeedback("Data set saved. The selected scope changed; link it again to validate the new selection."); setDraft(null); return; }
      onDataSetChange(response.id); setDraft(null); setFeedback("Test data saved and selected.");
    } catch (error) { if (isCurrent()) { setFailed(true); setFeedback(error instanceof Error ? error.message : "Unable to save test data. Your imported rows are retained for retry."); } }
    finally { if (isCurrent()) { activeSave.current = null; setBusy(false); } }
  };
  if (!enabled) return null;
  return <section className="run-data-setup" aria-label={suiteMode ? "Suite test data" : "Run test data setup"}>
    <button className="run-data-toggle" aria-expanded={expanded} aria-controls={contentId} type="button" onClick={() => setExpanded(value => !value)}>
      <IconDatabase size={18} aria-hidden="true" /><span><strong>Data Sets</strong><small>{dataSetId ? selectedData?.name || "Data set linked" : "Inherit data or link a reusable set"}</small></span>
      <IconChevronDown size={16} aria-hidden="true" className={expanded ? "is-expanded" : ""} />
    </button>
    <div id={contentId} className="run-data-content" hidden={!expanded}>
      <div className="run-data-template-row">
        {canInspectPlan ? (<RunParameterTemplateButton parameterValues={parameterValues} suiteContextId={suiteContextId} dataOptions={dataOptions} suiteMode={suiteMode} executionId={executionId} appTypeId={appTypeId} projectId={projectId} cases={cases} suites={suites} environmentId={can("environment.view") ? environmentId : undefined} configurationId={can("configuration.view") ? configurationId : undefined} dataSetId={canView ? dataSetId : undefined} disabled={disabled || busy || !canInspectPlan} fileName={suiteMode ? "suite-parameter-template.csv" : "run-parameter-template.csv"} />) : null}
      </div>
      {onDataOptionsChange ? <fieldset className="run-data-options"><legend>Allow This {suiteMode ? "Suite" : "Run"} To Override</legend>
        <label><input type="checkbox" checked={dataOverrideEnabled(dataOptions, "case")} disabled={disabled || busy} onChange={event => onDataOptionsChange({ ...dataOptions, override_test_case_data: event.target.checked })} />Test Case Params Data</label>
        {!suiteMode ? <label><input type="checkbox" checked={dataOverrideEnabled(dataOptions, "suite")} disabled={disabled || busy} onChange={event => onDataOptionsChange({ ...dataOptions, override_suite_data: event.target.checked })} />Suite Params Data</label> : null}
        {groupKinds.includes("steps") ? <label><input type="checkbox" checked={dataOverrideEnabled(dataOptions, "shared")} disabled={disabled || busy} onChange={event => onDataOptionsChange({ ...dataOptions, override_shared_steps: event.target.checked, override_shared_sections: dataOptions.override_shared_sections ?? dataOverrideEnabled(dataOptions, "shared") })} />Override Shared Groups Test Data</label> : null}
        {groupKinds.includes("sections") ? <label><input type="checkbox" checked={dataOptions.override_shared_sections ?? dataOverrideEnabled(dataOptions, "shared")} disabled={disabled || busy} onChange={event => onDataOptionsChange({ ...dataOptions, override_shared_sections: event.target.checked })} />Override Shared Sections Test Data</label> : null}
        <p>Unchecked layers retain their saved data. Templates include parameters allowed by these options.</p>
      </fieldset> : null}
      <div className="run-data-actions run-data-primary-actions">
        {canView ? (<button className="ghost-button" type="button" disabled={disabled || busy || !canView} onClick={() => { setLinkOpen(value => !value); setDraft(null); setFeedback(""); }}><IconLink size={15} aria-hidden="true" />Link Data Set</button>) : null}
        {canCreate ? <><button className="ghost-button" type="button" disabled={disabled || busy} onClick={() => fileInput.current?.click()}><IconFileImport size={15} aria-hidden="true" />Import Data Set</button><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={event => void readFile(event.target.files?.[0])} /></> : null}
        {canCreate ? <button className="ghost-button" type="button" disabled={disabled || busy || !scopeVerified || !required.length} title={!required.length ? "Declare parameters in the selected scope to create a data table." : undefined} onClick={() => { const columns = required.map(item => item.name); setDataPage(0); setName(""); setDraft({ columns, rows: [Object.fromEntries(columns.map(column => [column, ""]))] }); setLinkOpen(false); setFeedback(""); }}><IconPlus size={15} aria-hidden="true" />Create Data Set</button> : null}
      </div>
      {dataSetId ? <div className="run-data-linked"><IconDatabase size={16} aria-hidden="true" /><span><strong>{selectedData?.name || "Current Data Set"}</strong><small>{rows === null ? "Saved execution data" : `${rows} ${rows === 1 ? "row" : "rows"}`}</small></span>{canView ? (<button className="link-button" type="button" disabled={disabled || busy || !canView} onClick={() => { onDataSetChange(""); setFeedback(""); }}>Unlink</button>) : null}</div> : null}
      {linkOpen ? <div className="run-data-picker">
        <label className="run-data-search"><IconSearch size={15} aria-hidden="true" /><input aria-label="Search data sets" placeholder="Search data sets" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="run-data-picker-list" role="listbox" aria-label="Available data sets">
          {visibleData.filter(item => !search.trim() || `${item.name} ${item.description || ""}`.toLowerCase().includes(search.trim().toLowerCase())).map(item => (canInspectPlan ? (<button key={item.id} className="run-data-picker-option" role="option" aria-selected={item.id === dataSetId} disabled={disabled || busy || Boolean(checkingId) || !canInspectPlan} type="button" onClick={() => void selectDataSet(item.id)}><span><strong>{item.name}</strong><small>{item.mode === "key_value" ? "Key/value · 1 row" : `Table · ${item.rows.length} rows`}</small></span>{checkingId === item.id ? <small>Checking…</small> : item.id === dataSetId ? <IconCheck size={16} /> : null}</button>) : null))}
          {!visibleData.length ? <p>{dataQuery.isLoading ? "Loading data sets…" : "No data sets are available in this application."}</p> : null}
        </div>
        {!canInspectPlan ? <p>Select test cases or suites to validate a data set.</p> : null}
      </div> : null}
    {draft ? <div className="run-data-import-preview"><label>Data set name<input value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><p><strong>{draft.rows.length} rows</strong> · {draft.columns.length} parameter columns. Each row creates one iteration per case.</p>
      <div className="run-data-table"><table><thead><tr><th>Row</th>{draft.columns.map(column => <th key={column}><code>{column}</code></th>)}</tr></thead><tbody>{draft.rows.slice(dataPage * 20, dataPage * 20 + 20).map((row, offset) => { const index = dataPage * 20 + offset; return <tr key={index}><th>{index + 1}</th>{draft.columns.map(column => <td key={column}><textarea rows={1} aria-label={`Row ${index + 1} ${column}`} disabled={busy} value={row[column] ?? ""} onChange={event => { const value = event.target.value; setDraft(current => current ? { ...current, rows: current.rows.map((item, offset) => offset === index ? { ...item, [column]: value } : item) } : null); }} /></td>)}</tr>; })}</tbody></table></div>
      <div className="run-data-actions">
        {draft.rows.length > 20 ? <><button className="ghost-button" type="button" disabled={busy || dataPage === 0} onClick={() => setDataPage(page => page - 1)}>Previous Rows</button><span>Rows {dataPage * 20 + 1}–{Math.min(draft.rows.length, dataPage * 20 + 20)} of {draft.rows.length}</span><button className="ghost-button" type="button" disabled={busy || (dataPage + 1) * 20 >= draft.rows.length} onClick={() => setDataPage(page => page + 1)}>Next Rows</button></> : null}
        <button className="ghost-button" type="button" disabled={busy || draft.rows.length >= 5000} onClick={() => { setDataPage(Math.floor(draft.rows.length / 20)); setDraft(current => current ? { ...current, rows: [...current.rows, Object.fromEntries(current.columns.map(column => [column, ""]))] } : null); }}>Add Row</button>
      </div>
      {draftMissing.length ? <p role="alert">Missing required parameters: {draftMissing.join(", ")}. Use the current template for this selection.</p> : null}
      <div className="run-data-actions"><button className="primary-button" type="button" disabled={busy || disabled || !name.trim() || !scopeVerified || Boolean(draftMissing.length)} onClick={() => void save()}>{busy ? "Saving…" : "Save and select data"}</button><button className="ghost-button" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel import</button></div></div> : null}
    {dataSetId ? <p className="run-data-instance-summary">{caseCount !== null ? <IconCheck size={16} aria-hidden="true" /> : null}<span>{caseCount !== null ? <><strong>{executionId || rows === null || scopePlan.data?.expected_instance_count !== caseCount * rows ? `${scopePlan.data?.expected_instance_count} execution instances across ${caseCount} cases` : `${caseCount} cases × ${rows} ${rows === 1 ? "row" : "rows"} = ${scopePlan.data?.expected_instance_count} execution instances`}</strong> · Includes child suites</> : scopePlan.isError ? "Execution instance count is unavailable. Retry the scope check below." : !cases.length && !suites.length ? "Select cases or suites to calculate execution instances." : "Calculating execution instances…"}</span></p> : <p className="run-data-inheritance">{scopeVerified ? <strong>{scopePlan.data.expected_instance_count} execution instances across {scopePlan.data.case_count} cases. </strong> : null}No {suiteMode ? "suite" : "run"} data override. Each case uses its nearest suite data set, then its case data, or executes once.</p>}
    {dataSetId && scopeVerified && !selectedValid ? <p role="alert">{selectedMissing.length ? `The linked data set is missing required parameters: ${selectedMissing.join(", ")}.` : "The linked data set has no usable data rows."} Update it or choose a matching data set before saving.</p> : null}
    <details><summary>How Data Inheritance Works</summary><p>Matching parameters use Run → Suite → Test Case → Shared Group priority when the corresponding override is enabled. Missing columns retain lower-level values; empty cells supply an empty string.</p><p>Keep <code>t.</code>, <code>s.</code>, and <code>r.</code> prefixes in CSV headers. Shared groups use one row. The highest linked execution scope supplies iterations; inherited rows must have one row or a matching count. Run data and steps are saved as a snapshot.</p></details>
    {scopePlan.isError ? <p role="alert">{scopePlan.error instanceof Error ? scopePlan.error.message : "The selected case scope could not be verified."} <button type="button" className="ghost-button" onClick={() => void scopePlan.refetch()}>Retry scope</button></p> : null}
    {dataQuery.isError ? <p role="alert">Test data could not be loaded. <button type="button" className="ghost-button" onClick={() => void dataQuery.refetch()}>Retry</button></p> : null}
    {feedback ? <p role={failed ? "alert" : "status"}>{feedback}</p> : null}
    </div>
  </section>;
}
