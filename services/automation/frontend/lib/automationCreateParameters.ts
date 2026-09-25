import type { TestCase, TestDataSet, TestStep, TestSuite } from "@hellotest/platform/frontend/src/types";
import {
  buildDataSetParameterDefinitions, buildDataSetParameterValues, buildStepParameterDefinitionsFromValues,
  collectSensitiveDataSetParameterNames, collectStepParameters, combineStepParameterValues,
  excludeSensitiveStepParameterValues, mergeStepParameterDefinitions, normalizeStepParameterValues
} from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

export function buildAutomationCreateParameters({ dataSet, sources, draftSteps, suites, suiteIds }: {
  dataSet?: TestDataSet;
  sources: Array<{ testCase: Pick<TestCase, "parameter_values">; steps: TestStep[] }>;
  draftSteps: Array<Pick<TestStep, "id" | "action" | "expected_result">>;
  suites: Array<Pick<TestSuite, "id" | "parameter_values">>;
  suiteIds: string[];
}) {
  const sourceValues = Object.assign({}, ...[...sources].reverse().map(({ testCase }) => normalizeStepParameterValues(testCase.parameter_values || {}, "r")));
  const suiteValues = Object.assign({}, ...[...suiteIds].reverse().map((id) => normalizeStepParameterValues(suites.find((suite) => suite.id === id)?.parameter_values || {}, "s")));
  const values = excludeSensitiveStepParameterValues(
    combineStepParameterValues(buildDataSetParameterValues(dataSet), sourceValues, suiteValues),
    collectSensitiveDataSetParameterNames(dataSet)
  );
  const definitions = mergeStepParameterDefinitions(
    collectStepParameters([...sources.flatMap((source) => source.steps), ...draftSteps.map((step) => ({ ...step, automation_code: null, api_request: null }))]),
    buildStepParameterDefinitionsFromValues(values),
    buildDataSetParameterDefinitions(dataSet)
  );
  return { values, definitions };
}
