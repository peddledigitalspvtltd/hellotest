import type { TestDataOptions } from "../types";
import { useLayoutEffect, useRef, useState } from "react";
import { IconDownload } from "@tabler/icons-react";
import { api } from "../lib/api";
import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { normalizeGherkinParameterReferences } from "../lib/gherkin";
import { downloadParameterCsvTemplate } from "../lib/executionParameterContext";
import { buildDataSetParameterDefinitions, buildStepParameterDefinitionsFromValues, collectStepParameters, mergeStepParameterDefinitions, normalizeStepParameterValues } from "../lib/stepParameters";
import type { TestCase, TestSuite, TestStep } from "../types";

export function RunParameterTemplateButton({ parameterValues, dataOptions, suiteContextId, suiteMode = false, cases, suites = [], projectId, appTypeId = "", executionId, onPlan, fileName = "run-parameter-template.csv", environmentId: requestedEnvironmentId = "", configurationId: requestedConfigurationId = "", dataSetId: requestedDataSetId = "", disabled = false }: {
  parameterValues?: Record<string, string>;
  suiteContextId?: string; dataOptions?: TestDataOptions; suiteMode?: boolean;
  cases: Array<TestCase & { steps?: TestStep[] }>; suites?: TestSuite[]; projectId: string; appTypeId?: string; executionId?: string; fileName?: string; onPlan?: (plan: { case_count: number; suite_count: number; parameter_count: number }) => void; environmentId?: string; configurationId?: string; dataSetId?: string; disabled?: boolean;
}) {
  const { can } = useCapabilityAccess(projectId);
  const environmentId = can("environment.view") ? requestedEnvironmentId : "";
  const configurationId = can("configuration.view") ? requestedConfigurationId : "";
  const dataSetId = can("data.view") ? requestedDataSetId : "";
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const active = useRef<{ cancelled: boolean } | null>(null);
  const selectionKey = JSON.stringify([
    projectId, appTypeId, executionId, environmentId, configurationId, dataSetId, disabled, dataOptions, parameterValues, suiteMode, suiteContextId,
    cases.map((item) => [item.id, item.title, item.authoring_mode, item.gherkin_document, Object.keys(item.parameter_values || {}).sort(), item.steps?.map((step) => [step.id, step.action, step.expected_result, step.automation_code, step.api_request])]),
    suites.map((suite) => [suite.id, Object.keys(suite.parameter_values || {}).sort()])
  ]);
  useLayoutEffect(() => {
    const interrupted = active.current !== null;
    active.current = null;
    setBusy(false);
    setFailed(false);
    setFeedback(interrupted ? "The selection changed. Download the template again for the current scope." : "");
    return () => {
      if (active.current) active.current.cancelled = true;
    };
  }, [selectionKey]);
  const download = async () => {
    if (active.current || disabled) return;
    if (executionId ? !can("run.view") : !can("testcase.view") || (suites.length && !can("suite.view"))) return;
    const request = { cancelled: false };
    active.current = request;
    const isCurrent = () => active.current === request && !request.cancelled;
    setBusy(true); setFeedback(""); setFailed(false);
    try {
      if (appTypeId) {
        const plan = await api.executions.parameterPlan({ parameter_values: parameterValues, suite_context_id: suiteContextId, test_data_options: dataOptions, data_scope: suiteMode ? "suite" : "run", project_id: projectId, app_type_id: appTypeId, execution_id: executionId,
          suite_ids: suites.map(suite => suite.id), test_case_ids: cases.map(item => item.id),
          test_environment_id: can("environment.view") ? environmentId || (executionId ? "" : undefined) : undefined, test_configuration_id: can("configuration.view") ? configurationId || (executionId ? "" : undefined) : undefined, test_data_set_id: can("data.view") ? dataSetId || (executionId || suiteContextId ? "" : undefined) : undefined });
        if (!isCurrent()) return;
        onPlan?.({ case_count: plan.case_count, suite_count: plan.suite_count, parameter_count: plan.parameters.length });
        if (!plan.parameters.length) { setFeedback("No parameters are declared in the selected scope yet."); return; }
        downloadParameterCsvTemplate(plan.parameters.map(item => ({ ...item, rawName: item.name.slice(2), label: item.name.slice(2), scopeLabel: item.scope, stepIds: [], occurrenceCount: item.case_count })), fileName);
        setFeedback(`${plan.parameters.length} parameter columns from ${plan.case_count} cases and ${plan.suite_count} suites downloaded, including child suites.`);
        return;
      }
      for (const [needed, permission] of [[cases.some((item) => !Array.isArray(item.steps)), "testcase.view"], [environmentId, "environment.view"], [configurationId, "configuration.view"], [dataSetId, "data.view"]] as const) {
        if (needed && !can(permission)) throw new Error(`Permission required to include this source: ${permission}.`);
      }
      const uniqueCases = [...new Map(cases.map((item) => [item.id, item])).values()];
      const missing = uniqueCases.filter((item) => !Array.isArray(item.steps));
      const fetchedSteps: TestStep[] = [];
      for (let offset = 0; offset < missing.length; offset += 50) {
        fetchedSteps.push(...await api.testSteps.list({ test_case_ids: missing.slice(offset, offset + 50).map((item) => item.id).join(",") }));
        if (!isCurrent()) return;
      }
      const [environments, configurations, dataSets] = await Promise.all([
        environmentId ? api.testEnvironments.list({ project_id: projectId }) : Promise.resolve([]),
        configurationId ? api.testConfigurations.list({ project_id: projectId }) : Promise.resolve([]),
        dataSetId ? api.testDataSets.list({ project_id: projectId }) : Promise.resolve([])
      ]);
      if (!isCurrent()) return;
      const environment = environments.find((item) => item.id === environmentId);
      const configuration = configurations.find((item) => item.id === configurationId);
      const dataSet = dataSets.find((item) => item.id === dataSetId);
      if ((environmentId && !environment) || (configurationId && !configuration) || (dataSetId && !dataSet)) throw new Error("A selected run resource is no longer available. Refresh its selection and retry.");
      const declarations = mergeStepParameterDefinitions(
        ...uniqueCases.map((item) => {
          const gherkin = item.authoring_mode === "gherkin";
          const normalize = (value: string | null | undefined) => gherkin ? normalizeGherkinParameterReferences(value || "") : value || "";
          return mergeStepParameterDefinitions(buildStepParameterDefinitionsFromValues(item.parameter_values), collectStepParameters([
            { id: `${item.id}:title`, action: normalize(item.title), expected_result: normalize(item.gherkin_document), automation_code: null, api_request: null },
            ...(item.steps || fetchedSteps.filter((step) => step.test_case_id === item.id)).map((step) => ({ ...step, action: normalize(step.action), expected_result: normalize(step.expected_result) }))
          ]));
        }),
        ...suites.map((suite) => buildStepParameterDefinitionsFromValues(normalizeStepParameterValues(suite.parameter_values, "s"))),
        ...[environment, configuration].map((resource) => buildStepParameterDefinitionsFromValues(normalizeStepParameterValues(Object.fromEntries((resource?.variables || []).map((entry) => [entry.key, ""])), "r"))),
        buildDataSetParameterDefinitions(dataSet)
      );
      if (!declarations.length) { setFeedback("No parameters are declared in the selected scope yet."); return; }
      downloadParameterCsvTemplate(declarations, fileName);
      setFeedback(`${declarations.length} parameter columns downloaded. Fill the values before attaching this CSV as test data.`);
    } catch (error) {
      if (!isCurrent()) return;
      setFailed(true); setFeedback(error instanceof Error ? error.message : "The parameter template could not be prepared. Retry.");
    } finally {
      if (isCurrent()) { active.current = null; setBusy(false); }
    }
  };
  return <div className="run-parameter-template-control">
    <button className="ghost-button template-download-action" disabled={disabled || busy || !projectId} onClick={() => void download()} type="button"><IconDownload aria-hidden="true" size={15} />{busy ? "Preparing parameter template…" : "Download parameter template"}</button>
    {feedback ? <p role={failed ? "alert" : "status"} style={{ fontSize: ".75rem", lineHeight: 1.5, overflowWrap: "anywhere" }}>{feedback}</p> : null}
  </div>;
}
