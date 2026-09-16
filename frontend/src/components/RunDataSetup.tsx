import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconFileImport, IconDatabase, IconCheck } from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { optionalQueryView } from "../lib/optionalQueryView";
import { api } from "../lib/api";
import { parseRunDataCsv } from "../lib/runDataTemplate";
import { RunParameterTemplateButton } from "./RunParameterTemplateButton";
import type { TestCase, TestSuite } from "../types";
import "./RunDataSetup.css";

export function RunDataSetup({ projectId, appTypeId, executionId, cases, suites = [], dataSetId, onDataSetChange, environmentId, configurationId, disabled = false, suiteMode = false }: {
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
  const [draft, setDraft] = useState<ReturnType<typeof parseRunDataCsv> | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const selection = JSON.stringify([cases.map(item => item.id).sort(), suites.map(item => item.id).sort()]);
  useLayoutEffect(() => {
    scopeVersion.current += 1;
    fileVersion.current += 1;
    activeSave.current = null;
    setDraft(null); setFeedback(""); setName(""); setBusy(false); setFailed(false);
    return () => {
      scopeVersion.current += 1;
      fileVersion.current += 1;
      activeSave.current = null;
    };
  }, [scope]);
  const dataQuery = optionalQueryView(useQuery({ queryKey: ["test-data-sets", projectId, appTypeId], queryFn: () => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId }), enabled: Boolean(projectId && appTypeId && canView) }), canView);
  const canInspectPlan = Boolean(enabled && projectId && appTypeId && (cases.length || suites.length)
    && (executionId ? can("run.view") : can("testcase.view") && (!suites.length || can("suite.view")))
    && (!dataSetId || canView || Boolean(executionId)));
  const scopePlan = useQuery({ queryKey: ["run-parameter-plan", projectId, appTypeId, executionId, selection, dataSetId, environmentId, configurationId],
    queryFn: () => api.executions.parameterPlan({ project_id: projectId, app_type_id: appTypeId, execution_id: executionId, test_environment_id: can("environment.view") ? environmentId || (executionId ? "" : undefined) : undefined, test_configuration_id: can("configuration.view") ? configurationId || (executionId ? "" : undefined) : undefined, suite_ids: suites.map(item => item.id), test_case_ids: cases.map(item => item.id), test_data_set_id: canView ? dataSetId || (executionId ? "" : undefined) : undefined }),
    enabled: canInspectPlan, staleTime: 30_000 });
  const visibleData = canView ? dataQuery.data || [] : [];
  const selectedData = visibleData.find(item => item.id === dataSetId);
  const scopeVerified = canInspectPlan && scopePlan.isSuccess && !scopePlan.isFetching;
  const caseCount = scopeVerified ? scopePlan.data.case_count : null;
  const rows = selectedData ? selectedData.mode === "key_value" ? 1 : selectedData.rows.length : null;
  const readFile = async (file?: File) => {
    if (!file || busy || disabled || !canCreate) return;
    const requestScope = scopeVersion.current;
    const requestFile = ++fileVersion.current;
    const isCurrent = () => scopeVersion.current === requestScope && fileVersion.current === requestFile;
    setDraft(null); setName(""); setFeedback(""); setFailed(false);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Use a CSV file smaller than 5 MB.");
      const parsed = parseRunDataCsv(await file.text());
      if (!isCurrent()) return;
      setDraft(parsed); setName(file.name.replace(/\.csv$/i, "").replace(/[-_]+/g, " "));
    } catch (error) { if (isCurrent()) { setFailed(true); setFeedback(error instanceof Error ? error.message : "Unable to read this CSV."); } }
    if (isCurrent() && fileInput.current) fileInput.current.value = "";
  };
  const save = async () => {
    if (!draft || !name.trim() || busy || disabled || !canCreate || activeSave.current) return;
    const request = Symbol("save-data-set");
    const requestScope = scopeVersion.current;
    activeSave.current = request;
    const isCurrent = () => scopeVersion.current === requestScope && activeSave.current === request;
    setBusy(true); setFailed(false); setFeedback("");
    try {
      const response = await api.testDataSets.create({ project_id: projectId, app_type_id: appTypeId, name: name.trim(), mode: "table", columns: draft.columns, rows: draft.rows });
      await client.invalidateQueries({ queryKey: ["test-data-sets", projectId] });
      if (!isCurrent()) return;
      onDataSetChange(response.id); setDraft(null); setFeedback("Test data saved and selected.");
    } catch (error) { if (isCurrent()) { setFailed(true); setFeedback(error instanceof Error ? error.message : "Unable to save test data. Your imported rows are retained for retry."); } }
    finally { if (isCurrent()) { activeSave.current = null; setBusy(false); } }
  };
  if (!enabled) return null;
  return <section className="run-data-setup" aria-label={suiteMode ? "Suite test data" : "Run test data setup"}>
    <header><IconDatabase size={18} aria-hidden="true" /><div><strong>{suiteMode ? "Suite test data" : "Data-driven execution"}</strong><p>{suiteMode ? "Reuse a data set for this suite and its child suites." : "Each selected case executes once for every row in the selected data set."}</p></div></header>
    {suiteMode ? <label className="run-data-selector">Linked data set<select value={dataSetId} disabled={disabled || busy || !canView} onChange={event => onDataSetChange(event.target.value)}><option value="">Inherit parent suite or case data</option>{dataSetId && !selectedData ? <option value={dataSetId}>Current data set</option> : null}{visibleData.map(item => <option key={item.id} value={item.id}>{item.name} · {item.mode === "key_value" ? "1 instance" : `${item.rows.length} rows`}</option>)}</select></label> : null}
    <div className="run-data-actions"><RunParameterTemplateButton executionId={executionId} appTypeId={appTypeId} projectId={projectId} cases={cases} suites={suites} environmentId={can("environment.view") ? environmentId : undefined} configurationId={can("configuration.view") ? configurationId : undefined} dataSetId={canView ? dataSetId : undefined} disabled={disabled || busy || !canInspectPlan} fileName={suiteMode ? "suite-parameter-template.csv" : "run-parameter-template.csv"} />
      {canCreate ? <><button className="ghost-button" type="button" disabled={disabled || busy} onClick={() => fileInput.current?.click()}><IconFileImport size={16} aria-hidden="true" />Import filled CSV</button><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={event => void readFile(event.target.files?.[0])} /></> : null}
    </div>
    {draft ? <div className="run-data-import-preview"><label>Data set name<input value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><p><strong>{draft.rows.length} rows</strong> · {draft.columns.length} parameter columns</p><div className="run-data-column-list">{draft.columns.map(column => <code key={column}>{column}</code>)}</div><div className="run-data-actions"><button className="primary-button" type="button" disabled={busy || disabled || !name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save and select data"}</button><button className="ghost-button" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel import</button></div></div> : null}
    {dataSetId ? <p className="run-data-instance-summary">{caseCount !== null ? <IconCheck size={16} aria-hidden="true" /> : null}<span>{caseCount !== null ? <><strong>{executionId || rows === null ? `${scopePlan.data?.expected_instance_count} execution instances across ${caseCount} cases` : `${caseCount} cases × ${rows} ${rows === 1 ? "row" : "rows"} = ${scopePlan.data?.expected_instance_count} execution instances`}</strong> · Includes child suites</> : scopePlan.isError ? "Execution instance count is unavailable. Retry the scope check below." : !cases.length && !suites.length ? "Select cases or suites to calculate execution instances." : "Calculating execution instances…"}</span></p> : <p className="run-data-inheritance">{scopeVerified ? <strong>{scopePlan.data.expected_instance_count} execution instances across {scopePlan.data.case_count} cases. </strong> : null}No {suiteMode ? "suite" : "run"} data override. Each case uses its nearest suite data set, then its case data, or executes once.</p>}
    <details><summary>Parameter scopes and overrides</summary><p><code>@name</code> and <code>@r.name</code> use run scope. <code>@t.name</code> uses test-case scope; <code>@s.name</code> uses suite scope. Keep these prefixes in CSV column names to choose what you override.</p><p>The selected data row overrides saved defaults, environment and configuration values. Empty cells supply an empty string; omit a column to keep its default. A run data set replaces suite/case data. Data and steps are frozen when the run is created.</p></details>
    {scopePlan.isError ? <p role="alert">The selected case scope could not be verified. <button type="button" className="ghost-button" onClick={() => void scopePlan.refetch()}>Retry scope</button></p> : null}
    {dataQuery.isError ? <p role="alert">Test data could not be loaded. <button type="button" className="ghost-button" onClick={() => void dataQuery.refetch()}>Retry</button></p> : null}
    {feedback ? <p role={failed ? "alert" : "status"}>{feedback}</p> : null}
  </section>;
}
