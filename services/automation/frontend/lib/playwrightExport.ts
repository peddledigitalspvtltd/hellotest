import { buildPlaywrightArtifact, createPlaywrightExecutionOptions, preparePlaywrightRepository } from "../../shared/playwrightArtifact.mjs";
import { dataOverrideEnabled } from "@hellotest/testing/frontend/lib/dataSetValidation";
import { resolveExecutionParameterContext } from "@hellotest/testing/frontend/lib/executionParameterContext";
import type { AutomationLearningCacheEntry, TestCase, TestDataSet, TestStep, SharedStepGroup, ExecutionCaseSnapshot, ExecutionStepSnapshot, TestDataOptions, TestEnvironment, TestConfiguration, Execution } from "@hellotest/platform/frontend/src/types";
import { buildDataSetParameterValues, combineStepParameterValues, collectSensitiveDataSetParameterNames, normalizeStepParameterName, normalizeStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { casePrivateParameterNames, collectPrivateParameterNames } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { evaluateTestDataTemplate, hasTestDataGeneratorTemplate } from "@hellotest/testing/frontend/lib/testDataGenerators";
import { formatAutomationSourceLines } from "./automationInstructions";

export function buildPlaywrightExport({testCase, steps, values, suiteValues = {}, dataSet, repository = [], baseURL = "", sensitiveNames = [], sharedGroups = [], dataSets = [], overrideSharedSteps = true, suiteOptions, environment, configuration, runtimeSettings = {}}: {
  testCase: Pick<TestCase,"title"|"id"> & Partial<Pick<TestCase,"test_data_options"|"effective_private_parameter_names"|"execution_hooks">>; steps: TestStep[]; values: Record<string,string>; suiteValues?: Record<string,string>;
  sharedGroups?: SharedStepGroup[]; dataSets?: TestDataSet[]; overrideSharedSteps?: boolean; suiteOptions?: TestDataOptions; environment?: TestEnvironment; configuration?: TestConfiguration;
  dataSet?: TestDataSet | null; repository?: AutomationLearningCacheEntry[]; baseURL?: string; sensitiveNames?: string[]; runtimeSettings?: Record<string, unknown>;
}) {
  const executionOptions = createPlaywrightExecutionOptions(runtimeSettings);
  const usedGroups = sharedGroups.filter(group => steps.some(step => step.reusable_group_id === group.id));
  const sourceDataSets = [dataSet, ...usedGroups.map(group => dataSets.find(item => item.id === group.test_data_set_id) || group.test_data_set)];
  const sourceValues = [values, normalizeStepParameterValues(suiteValues, "s"), ...usedGroups.map(group => group.parameter_values || {}),
    ...sourceDataSets.flatMap(item => !item ? [] : item.mode === "key_value"
      ? [Object.fromEntries(item.rows.map(row => [normalizeStepParameterName(String(row.key ?? "")), String(row.value ?? "")]))]
      : item.rows.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => [normalizeStepParameterName(name), String(value ?? "")])))),
    ...[environment, configuration].map(item => Object.fromEntries((item?.variables || []).map(entry => [normalizeStepParameterName(entry.key), String(entry.value ?? "")])))];
  const privateNames = collectPrivateParameterNames(sourceValues, [
    ...sensitiveNames, ...casePrivateParameterNames(testCase),
    ...(suiteOptions?.private_parameter_names || []).map(name => normalizeStepParameterName(name, "s")),
    ...sourceDataSets.flatMap(item => collectSensitiveDataSetParameterNames(item)),
    ...[environment, configuration].flatMap(item => (item?.variables || []).filter(entry => entry.is_secret).map(entry => normalizeStepParameterName(entry.key)))
  ]);
  const privateValues = new Set(sourceValues.flatMap(map => Object.entries(map).filter(([name, value]) => privateNames.has(normalizeStepParameterName(name)) && value !== "").map(([, value]) => value)));
  const generated = new Map<string,string>();
  const isPublic = (key: string, value: string) => value === "" || (!privateNames.has(normalizeStepParameterName(key)) && !privateValues.has(value));
  const safe = (input: Record<string,string>, rowIndex = 0) => Object.fromEntries(Object.entries(input).filter(([key,value]) => isPublic(key,value)).map(([key,value]) => {
    if (!hasTestDataGeneratorTemplate(value)) return [key,value];
    const cacheKey=JSON.stringify([rowIndex,key,value]);if (!generated.has(cacheKey)) generated.set(cacheKey,evaluateTestDataTemplate(value));
    return [key,generated.get(cacheKey)!];
  }).filter(([key,value]) => isPublic(key,value)));
  const rows = dataSet?.mode === "table" && dataSet.rows.length ? dataSet.rows.map(row => buildDataSetParameterValues({...dataSet,rows:[row]})) : [buildDataSetParameterValues(dataSet)];
  const reviewed=new Set(testCase.test_data_options?.parameter_overrides||[]);
  const reviewedValues=Object.fromEntries(Object.entries(values).filter(([name])=>reviewed.has(name)));
  const data = rows.map((row,rowIndex) => safe({...combineStepParameterValues(values, row, suiteValues),...reviewedValues},rowIndex));
  const sectionRows = rows.map((row,rowIndex) => steps.map(step => {
    const group = sharedGroups.find(group => group.id === step.reusable_group_id);
    const groupData = dataSets.find(item => item.id === group?.test_data_set_id) || group?.test_data_set;
    const groupRow = groupData?.mode === "table" ? {...groupData,rows:groupData.rows.slice(group?.test_data_row_index || 0,(group?.test_data_row_index || 0)+1)} : groupData;
    const inherited = combineStepParameterValues(group?.parameter_values || {},buildDataSetParameterValues(groupRow));
    const normalizeOptions = (options: TestDataOptions = {}) => ({...options,override_shared_steps:options.override_shared_sections ?? dataOverrideEnabled(options,"shared"),override_test_case_data:dataOverrideEnabled(options,"case"),override_suite_data:dataOverrideEnabled(options,"suite")});
    const policy = {version:2,case:normalizeOptions({...testCase.test_data_options,override_shared_steps:overrideSharedSteps,override_shared_sections:overrideSharedSteps}),suite:normalizeOptions(suiteOptions),run:normalizeOptions()};
    return safe(resolveExecutionParameterContext({execution:{test_environment: environment ? {snapshot:environment} : null,test_configuration:configuration ? {snapshot:configuration} : null} as Execution,caseSnapshot:{parameter_values:values,suite_parameter_values:suiteValues,test_data_set_snapshot:{mode:"table",rows:[row],data_scope_policy:policy,parameter_data_layers:{case:{rows:[row]}}}} as ExecutionCaseSnapshot,stepSnapshot:{...step,execution_id:"export",snapshot_step_id:step.id,shared_parameter_values:inherited} as ExecutionStepSnapshot}).values,rowIndex);
  }));
  const {objects,repositoryIssues} = preparePlaywrightRepository(repository);
  return buildPlaywrightArtifact({testCase,steps,rows:data,sectionRows,objects,repositoryIssues,baseURL,executionOptions,plainText:richTextToPlainText,formatSource:formatAutomationSourceLines});
}
