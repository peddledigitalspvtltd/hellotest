import { useLayoutEffect, useRef, useState } from "react";
import { IconDownload } from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { hasPermission } from "../lib/permissions";
import { normalizeGherkinParameterReferences } from "../lib/gherkin";
import { downloadParameterCsvTemplate } from "../lib/executionParameterContext";
import { buildDataSetParameterDefinitions, buildStepParameterDefinitionsFromValues, collectStepParameters, mergeStepParameterDefinitions, normalizeStepParameterValues } from "../lib/stepParameters";
import type { TestCase, TestSuite, TestStep } from "../types";

export function RunParameterTemplateButton({ cases, suites = [], projectId, environmentId = "", configurationId = "", dataSetId = "", disabled = false }: {
  cases: Array<TestCase & { steps?: TestStep[] }>; suites?: TestSuite[]; projectId: string; environmentId?: string; configurationId?: string; dataSetId?: string; disabled?: boolean;
}) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const active = useRef<{ cancelled: boolean } | null>(null);
  const selectionKey = JSON.stringify([
    projectId, environmentId, configurationId, dataSetId, disabled,
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
    if (active.current) return;
    const request = { cancelled: false };
    active.current = request;
    const isCurrent = () => active.current === request && !request.cancelled;
    setBusy(true); setFeedback(""); setFailed(false);
    try {
      for (const [needed, permission] of [[cases.some((item) => !Array.isArray(item.steps)), "testcase.view"], [environmentId, "environment.view"], [configurationId, "configuration.view"], [dataSetId, "data.view"]] as const) {
        if (needed && !hasPermission(session, permission, projectId)) throw new Error(`Permission required to include this source: ${permission}.`);
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
      downloadParameterCsvTemplate(declarations, "run-parameter-template.csv");
      setFeedback(`${declarations.length} parameter columns downloaded. Fill the values before attaching this CSV as test data.`);
    } catch (error) {
      if (!isCurrent()) return;
      setFailed(true); setFeedback(error instanceof Error ? error.message : "The parameter template could not be prepared. Retry.");
    } finally {
      if (isCurrent()) { active.current = null; setBusy(false); }
    }
  };
  return <div className="run-parameter-template-control">
    <button className="ghost-button" disabled={disabled || busy || !projectId} onClick={() => void download()} type="button"><IconDownload aria-hidden="true" size={15} />{busy ? "Preparing parameter template…" : "Download parameter template"}</button>
    {feedback ? <p role={failed ? "alert" : "status"} style={{ fontSize: ".75rem", lineHeight: 1.5, overflowWrap: "anywhere" }}>{feedback}</p> : null}
  </div>;
}
