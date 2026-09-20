import type { TestDataOptions, TestDataSet } from "../types";
import { normalizeStepParameterName } from "./stepParameters";

export function dataOverrideEnabled(options: TestDataOptions, layer: "case" | "suite" | "shared") {
  if (layer === "shared") return options.override_shared_steps !== false;
  return (layer === "case" ? options.override_test_case_data : options.override_suite_data)
    ?? (options.override_lower_scopes !== false);
}

export function missingDataSetParameters(dataSet: Pick<TestDataSet, "mode" | "columns" | "rows">, required: Array<{ name: string }>) {
  const names = dataSet.mode === "key_value" ? dataSet.rows.map(row => row.key) : dataSet.columns;
  const available = new Set(names.map(name => normalizeStepParameterName(name)).filter(Boolean));
  return [...new Set(required.map(item => normalizeStepParameterName(item.name)).filter(name => name && !available.has(name)))].sort();
}
