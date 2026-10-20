import { buildDataSetParameterValues, collectSensitiveDataSetParameterNames, normalizeStepParameterName, normalizeStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { hasTestDataGeneratorTemplate } from "@hellotest/testing/frontend/lib/testDataGenerators";
import { collectPrivateParameterNames } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";

type EngineerStep = {
  step_id?: string; test_case_id?: string; manual_test_case_id?: string; manual_step_id?: string;
  action?: string; expected_result?: string;
};
type EngineerDataOptions = {
  manual: boolean; caseId: string; activityId?: string; dataAllowed: boolean;
  initialParameterValues?: Record<string, string>; buildData?: unknown; pending?: boolean;
};
export type EngineerParameterResolution = {
  missing: string[]; private: string[]; deferred: string[]; pending: boolean; unavailable: boolean;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const names = (value: unknown) => (Array.isArray(value) ? value : []).filter((key): key is string => typeof key === "string").map(key => normalizeStepParameterName(key)).filter(Boolean);
const sensitive = /password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;
const codeParameter = /\bparams\s*\[\s*(["'])(?:\\.|[^\\\r\n])*?\1\s*\]/g;
const textParameter = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const tokens = () => new RegExp(`${codeParameter.source}|${textParameter.source}`, "gi");

function parameterKey(token: string) {
  if (!/^params\s*\[/.test(token)) return normalizeStepParameterName(token, "r");
  const match = token.match(/^params\s*\[\s*(["'])((?:\\.|[^\\\r\n])*?)\1\s*\]$/);
  // Match the runtime's literal scoped params syntax without evaluating code.
  if (!match || /\\(?![\\"'])/.test(match[2])) return "";
  const key = match[2].replace(/\\([\\"'])/g, "$1");
  return /^@?[tsr]\./i.test(key) ? normalizeStepParameterName(key) : "";
}

/** Dataset defaults follow the build resolver; explicitly reviewed own keys
 * retain their higher priority, including blanks. Generators stay deferred. */
export function initialEngineerParameterValues(caseValues: Record<string, string>, dataSet?: Parameters<typeof buildDataSetParameterValues>[0],
  options: { parameter_overrides?: string[]; private_parameter_names?: string[]; effective_private_parameter_names?: string[] } = {}) {
  const ownValues = normalizeStepParameterValues(caseValues);
  const values = { ...ownValues, ...buildDataSetParameterValues(dataSet) };
  for (const reference of options.parameter_overrides || []) {
    const name = normalizeStepParameterName(reference, "t");
    if (Object.prototype.hasOwnProperty.call(ownValues, name)) values[name] = ownValues[name];
  }
  const privateNames = collectPrivateParameterNames([ownValues, values], [
    ...collectSensitiveDataSetParameterNames(dataSet),
    ...(options.private_parameter_names || []).map(name => normalizeStepParameterName(name, "t")),
    ...(options.effective_private_parameter_names || []).map(name => normalizeStepParameterName(name, "t"))
  ]);
  for (const key of Object.keys(values)) if (sensitive.test(key)) privateNames.add(key);
  const privateValues = new Set([...privateNames].map(key => values[key]).filter(value => typeof value === "string" && value !== ""));
  if (dataSet?.mode === "key_value") for (const row of dataSet.rows || []) {
    const value = String(row.value ?? "");
    if (value && privateNames.has(normalizeStepParameterName(String(row.key || "")))) privateValues.add(value);
  }
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => !privateNames.has(key) && !privateValues.has(value)));
}

/** Project public data only. Active/history labels use the immutable build
 * snapshot, while idle labels use saved defaults. Neither path generates data. */
export function projectEngineerStepData<T extends EngineerStep>(step: T, options: EngineerDataOptions): { step: T; resolution: EngineerParameterResolution } {
  const resolution: EngineerParameterResolution = { missing: [], private: [], deferred: [], pending: false, unavailable: false };
  if (!options.dataAllowed) return { step, resolution: { ...resolution, unavailable: true } };
  const candidate = record(options.buildData);
  const frozen = candidate.schema_version === 1 && candidate.kind === "automation_build_data" && candidate.test_case_id === options.caseId ? candidate : undefined;
  if (options.activityId && !frozen) return { step, resolution: { ...resolution, pending: options.pending === true, unavailable: true } };
  const rawValues = normalizeStepParameterValues(Object.fromEntries(Object.entries(record(options.activityId ? frozen?.parameter_values : options.initialParameterValues)).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
  const privateNames = new Set(names(frozen?.private_parameter_references));
  for (const key of Object.keys(rawValues)) if (sensitive.test(key)) privateNames.add(key);
  const privateValues = new Set([...privateNames].map(key => rawValues[key]).filter(value => typeof value === "string" && value !== ""));
  for (const [key, value] of Object.entries(rawValues)) if (privateValues.has(value)) privateNames.add(key);
  const deferred = new Set([...names(frozen?.deferred_parameter_references), ...Object.entries(rawValues).filter(([, value]) => hasTestDataGeneratorTemplate(value)).map(([key]) => key)]);
  const values = Object.fromEntries(Object.entries(rawValues).filter(([key]) => !privateNames.has(key) && !deferred.has(key)));
  const bindingKey=(token:string)=>{
    const key=parameterKey(token);
    if(!key||!token.startsWith('@')||/^@[tsr]\./i.test(token))return key;
    if(options.activityId){const binding=record(frozen?.unscoped_parameter_bindings)[key];return typeof binding==='string'?normalizeStepParameterName(binding):key;}
    return !Object.prototype.hasOwnProperty.call(rawValues,key)&&Object.prototype.hasOwnProperty.call(rawValues,`t.${key.slice(2)}`)?`t.${key.slice(2)}`:key;
  };
  const referenced = new Set<string>();
  for (const value of [step.action, step.expected_result]) for (const match of String(value || "").matchAll(tokens())) {
    const key = bindingKey(match[0]);
    if (key) {
      referenced.add(key);
      if (!options.activityId && !Object.prototype.hasOwnProperty.call(rawValues, key) && hasTestDataGeneratorTemplate(match[0])) deferred.add(key);
    }
  }
  for (const key of referenced) {
    if (privateNames.has(key)) resolution.private.push(key);
    else if (deferred.has(key)) resolution.deferred.push(key);
    else if (!Object.prototype.hasOwnProperty.call(values, key)) resolution.missing.push(key);
  }
  const project = (input: string | undefined) => String(input || "").replace(tokens(), token => {
    const key = bindingKey(token);
    return key && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : token;
  });
  const rows = options.manual ? frozen?.manual_steps : frozen?.steps;
  const resolved = (Array.isArray(rows) ? rows.map(record) : []).find(row => options.manual
    ? row.manual_test_case_id === step.manual_test_case_id && row.manual_step_id === step.manual_step_id
    : row.step_id === step.step_id);
  // Snapshot labels have already been projected once by the backend. Resolving
  // them again could reinterpret an @token inside a literal public input.
  return { step: { ...step,
    action: typeof resolved?.action === "string" ? resolved.action : project(step.action),
    expected_result: typeof resolved?.expected_result === "string" ? resolved.expected_result : project(step.expected_result)
  }, resolution };
}
