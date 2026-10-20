import type { TestCase, TestDataSet, TestStep, TestSuite } from "@hellotest/platform/frontend/src/types";
import {
  buildCaseParameterValues, collectCaseStepParameters, collectSensitiveDataSetParameterNames, combineStepParameterValues,
  excludeSensitiveStepParameterValues, normalizeStepParameterName, normalizeStepParameterValues
} from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { casePrivateParameterNames, collectPrivateParameterNames } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";

export function buildAutomationCreateParameters({ dataSet, sources, draftSteps, suites, suiteIds }: {
  dataSet?: TestDataSet;
  sources: Array<{ testCase: Pick<TestCase, "parameter_values" | "inherited_parameter_values" | "effective_parameter_values" | "effective_parameter_overrides" | "test_data_options" | "effective_private_parameter_names">; steps: TestStep[] }>;
  draftSteps: Array<Pick<TestStep, "id" | "action" | "expected_result">>;
  suites: Array<Pick<TestSuite, "id" | "parameter_values">>;
  suiteIds: string[];
}) {
  const sourceValueMaps = sources.map(({ testCase }) => normalizeStepParameterValues(testCase.effective_parameter_values || {
    ...testCase.inherited_parameter_values, ...testCase.parameter_values
  }, "t"));
  const sourceValues: Record<string,string> = {};
  const chosenOverrides = new Set<string>();
  sourceValueMaps.forEach((values,index) => {
    const priorities = new Set((sources[index].testCase.effective_parameter_overrides || sources[index].testCase.test_data_options?.parameter_overrides || []).map(name => normalizeStepParameterName(name,"t")));
    for (const [name,value] of Object.entries(values)) if (!Object.prototype.hasOwnProperty.call(sourceValues,name) && (value !== "" || priorities.has(name))) {
      sourceValues[name] = value;
      if (priorities.has(name)) chosenOverrides.add(name);
    }
  });
  sourceValueMaps.forEach(values => { for (const [name,value] of Object.entries(values)) if (!Object.prototype.hasOwnProperty.call(sourceValues,name)) sourceValues[name] = value; });
  const suiteValues = Object.assign({}, ...[...suiteIds].reverse().map((id) => normalizeStepParameterValues(suites.find((suite) => suite.id === id)?.parameter_values || {}, "s")));
  const combinedValues = combineStepParameterValues(buildCaseParameterValues({inheritedValues:sourceValues,dataSet,inheritedOverrideNames:chosenOverrides}), suiteValues);
  const sensitiveNames = collectPrivateParameterNames([...sourceValueMaps, combinedValues], [
    ...collectSensitiveDataSetParameterNames(dataSet), ...sources.flatMap(({testCase}) => casePrivateParameterNames(testCase))
  ]);
  const definitions = collectCaseStepParameters({
    steps: [...sources.flatMap(source => source.steps), ...draftSteps.map(step => ({ ...step, automation_code: null, api_request: null }))],
    inheritedValues: sourceValues, availableValues: combinedValues, dataSet,
    privateNames: sources.flatMap(({ testCase }) => casePrivateParameterNames(testCase))
  }).map(parameter => sensitiveNames.has(parameter.name) ? { ...parameter, sensitive: true } : parameter);
  const names = new Set(definitions.map(parameter => parameter.name));
  const values = Object.fromEntries(Object.entries(excludeSensitiveStepParameterValues(combinedValues, sensitiveNames)).filter(([name]) => names.has(name)));
  return { values, definitions };
}
