import type { Execution, ExecutionCaseSnapshot, ExecutionDataSetSnapshot, KeyValueEntry } from "../types";
import { normalizeGherkinParameterReferences } from "./gherkin";
import {
  buildDataSetParameterDefinitions, buildDataSetParameterValues, buildStepParameterDefinitionsFromValues,
  collectSensitiveDataSetParameterNames, collectStepParameters, mergeStepParameterDefinitions,
  normalizeStepParameterName, normalizeStepParameterValues, parseStepParameterName,
  type StepParameterDefinition, type StepParameterSource, type StepParameterScope
} from "./stepParameters";

export type EffectiveParameterEntry = {
  name: string; token: string; value: string | null; source: string | null;
  sourceLabel: string; template: string | null; sensitive: boolean; resolved: boolean;
};
type ParameterLayer = {
  source: string; sourceLabel: string; scope: StepParameterScope;
  values: Record<string, string>; templates?: Record<string, string>; sensitiveNames?: string[];
};

export function resolveStepParameterContext(layers: ParameterLayer[], definitions: StepParameterDefinition[] = []) {
  const selected = new Map<string, EffectiveParameterEntry>();
  const sensitive = new Set(definitions.filter((item) => item.sensitive).map((item) => item.name));
  for (const layer of layers) {
    const hiddenNames = (layer.sensitiveNames || []).map((name) => normalizeStepParameterName(name, layer.scope)).filter(Boolean);
    hiddenNames.forEach((name) => sensitive.add(name));
    const templates = normalizeStepParameterValues(layer.templates || {}, layer.scope);
    for (const [name, value] of Object.entries(normalizeStepParameterValues(layer.values, layer.scope))) {
      selected.set(name, { name, token: parseStepParameterName(name)!.token, value, source: layer.source,
        sourceLabel: layer.sourceLabel, template: templates[name] ?? null, sensitive: false, resolved: true });
    }
    // Redacted rows still supply the effective value; retain their source even
    // though no secret value is admitted to the frontend interpolation map.
    for (const name of hiddenNames) selected.set(name, { name, token: parseStepParameterName(name)!.token,
      value: null, source: layer.source, sourceLabel: layer.sourceLabel, template: null, sensitive: true, resolved: true });
  }
  for (const definition of definitions) {
    if (!selected.has(definition.name)) selected.set(definition.name, { name: definition.name, token: definition.token,
      value: null, source: null, sourceLabel: "Not supplied", template: null, sensitive: false, resolved: false });
  }
  const entries = [...selected.values()].map((entry) => sensitive.has(entry.name)
    ? { ...entry, value: null, template: null, sensitive: true, resolved: true }
    : entry).sort((left, right) => left.name.localeCompare(right.name));
  return {
    entries,
    values: Object.fromEntries(entries.filter((entry) => entry.resolved && !entry.sensitive).map((entry) => [entry.name, entry.value ?? ""])),
    unresolved: entries.filter((entry) => !entry.resolved).map((entry) => entry.name)
  };
}

const variableValues = (entries: KeyValueEntry[] = []) => Object.fromEntries(entries.map((entry) => [entry.key, String(entry.value ?? "")]));
const variableLayer = (source: string, sourceLabel: string, snapshot?: { variables?: KeyValueEntry[]; template_variables?: KeyValueEntry[] } | null): ParameterLayer => ({
  source, sourceLabel, scope: "r", values: variableValues(snapshot?.variables), templates: variableValues(snapshot?.template_variables),
  sensitiveNames: (snapshot?.variables || []).filter((entry) => entry.is_secret).map((entry) => entry.key)
});

export function resolveExecutionParameterContext({ execution, caseSnapshot, steps = [], caseTitle, dataSetRow, rowIndex = 0, capturedValues = {} }: {
  execution: Execution | null; caseSnapshot: ExecutionCaseSnapshot | null; steps?: StepParameterSource[];
  caseTitle?: string; dataSetRow?: Record<string, unknown> | null; rowIndex?: number | null; capturedValues?: Record<string, string>;
}) {
  const snapshot = caseSnapshot?.test_data_set_snapshot || execution?.test_data_set?.snapshot || null;
  const isGherkinText = (value?: string | null) => /^\s*(?:Given|When|Then|And|But|Scenario(?: Outline)?|Feature|Background)\b/i.test(value || "");
  const isGherkinCase = steps.some((step) => isGherkinText(step.action) || isGherkinText(step.expected_result));
  const title = caseTitle ?? caseSnapshot?.test_case_title ?? "";
  const declarationSteps = steps.map((step) => ({ ...step,
    action: isGherkinText(step.action) ? normalizeGherkinParameterReferences(step.action || "") : step.action,
    expected_result: isGherkinText(step.expected_result) ? normalizeGherkinParameterReferences(step.expected_result || "") : step.expected_result
  }));
  const selectedRow = dataSetRow ?? snapshot?.rows?.[rowIndex ?? 0];
  const dataSet = snapshot?.mode === "table" ? { ...snapshot, rows: selectedRow ? [selectedRow] : [] } as ExecutionDataSetSnapshot : snapshot;
  const definitions = mergeStepParameterDefinitions(
    collectStepParameters([...declarationSteps, { id: "case-title", action: isGherkinCase ? normalizeGherkinParameterReferences(title) : title, expected_result: null, automation_code: null, api_request: null }]),
    buildStepParameterDefinitionsFromValues(caseSnapshot?.parameter_values),
    buildStepParameterDefinitionsFromValues(normalizeStepParameterValues(caseSnapshot?.suite_parameter_values, "s")),
    buildDataSetParameterDefinitions(snapshot)
  );
  const dataSetTemplates = snapshot?.template_rows
    ? buildDataSetParameterValues({ ...snapshot, rows: snapshot.mode === "table" ? [snapshot.template_rows[rowIndex ?? 0] || {}] : snapshot.template_rows }) : {};
  return resolveStepParameterContext([
    { source: "case", sourceLabel: "Case default", scope: "t", values: caseSnapshot?.parameter_values || {}, templates: caseSnapshot?.parameter_template_values },
    { source: "suite", sourceLabel: "Suite value", scope: "s", values: caseSnapshot?.suite_parameter_values || {}, templates: caseSnapshot?.suite_parameter_template_values },
    variableLayer("environment", "Run environment", execution?.test_environment?.snapshot),
    variableLayer("configuration", "Run configuration", execution?.test_configuration?.snapshot),
    { source: "run", sourceLabel: "Run value", scope: "r", values: (execution as (Execution & { parameter_values?: Record<string, string> }) | null)?.parameter_values || {} },
    { source: "data_set", sourceLabel: snapshot ? `${snapshot.name || "Test data"}${snapshot.mode === "table" ? ` · Row ${(rowIndex ?? 0) + 1}` : ""}` : "Test data", scope: "t", values: buildDataSetParameterValues(dataSet), templates: dataSetTemplates, sensitiveNames: collectSensitiveDataSetParameterNames(snapshot) },
    { source: "capture", sourceLabel: "Captured output", scope: "t", values: capturedValues }
  ], definitions);
}

/** Canonical scoped headers preserve namespaces and include declared-but-empty values. */
export function buildParameterCsvTemplate(parameters: StepParameterDefinition[] | EffectiveParameterEntry[]) {
  const names = [...new Set(parameters.map((item) => normalizeStepParameterName(item.name)).filter(Boolean))].sort();
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return names.length ? `\uFEFF${names.map(quote).join(",")}\r\n${names.map(() => '""').join(",")}\r\n` : "";
}

export function downloadParameterCsvTemplate(parameters: StepParameterDefinition[] | EffectiveParameterEntry[], fileName = "parameter-template.csv") {
  const csv = buildParameterCsvTemplate(parameters);
  if (!csv) return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
