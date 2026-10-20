import { normalizeStepParameterName, normalizeStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";

type PrivateParameterSource = {
  test_data_options?: { private_parameter_names?: string[] };
  effective_private_parameter_names?: string[];
};

const sensitiveName = /password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;

export function isPrivateParameterName(name: string) {
  return sensitiveName.test(name);
}

/** Privacy is durable name-only metadata, independent of the originating
 * environment or Data Set still being available to this view. */
export function casePrivateParameterNames(source?: PrivateParameterSource | null) {
  return [...new Set([
    ...(source?.test_data_options?.private_parameter_names || []),
    ...(source?.effective_private_parameter_names || [])
  ].map(name => normalizeStepParameterName(name, "t")).filter(Boolean))];
}

/** An exact public alias of a private value is private too. Read every source
 * before precedence merges so replacing a private key cannot expose an alias.
 * Empty values never make unrelated empty inputs private. */
export function collectPrivateParameterNames(valueMaps: ReadonlyArray<Record<string, string>>, privateNames: Iterable<string> = []) {
  const entries = valueMaps.flatMap(values => Object.entries(normalizeStepParameterValues(values)));
  const names = new Set(Array.from(privateNames, name => normalizeStepParameterName(name)).filter(Boolean));
  for (const [name] of entries) if (isPrivateParameterName(name)) names.add(name);
  const privateValues = new Set(entries.filter(([name, value]) => names.has(name) && value !== "").map(([, value]) => value));
  for (const [name, value] of entries) if (value !== "" && privateValues.has(value)) names.add(name);
  return names;
}

/** Save only authored bindings. Existing unedited values keep their original
 * precedence; a new value or explicit blank is a deliberate case override. */
export function caseParameterSaveOptions(
  options: TestDataOptions | undefined,
  ownValues: Record<string, string>,
  savedValues: Record<string, string> = {},
  privateNames: Iterable<string> = [],
  explicitOverrideNames: Iterable<string> = []
): TestDataOptions {
  const own = normalizeStepParameterValues(ownValues, "t");
  const saved = normalizeStepParameterValues(savedValues, "t");
  const changed = Object.keys(own).filter(name => !Object.prototype.hasOwnProperty.call(saved, name) || own[name] !== saved[name]);
  const overrides = new Set([...(options?.parameter_overrides || []).map(name => normalizeStepParameterName(name, "t")), ...Array.from(explicitOverrideNames, name => normalizeStepParameterName(name, "t")), ...changed]);
  const hidden = collectPrivateParameterNames([own, saved], [...(options?.private_parameter_names || []), ...privateNames]);
  return {
    ...options,
    parameter_overrides: [...overrides].filter(name => Object.prototype.hasOwnProperty.call(own, name)).sort(),
    private_parameter_names: [...hidden].filter(name => Object.prototype.hasOwnProperty.call(own, name)).sort()
  };
}

/** Inventory for editors: preserve hidden rows without carrying their values
 * into public previews or definition metadata. */
export function caseParameterDefinitionValues(valueMaps: ReadonlyArray<Record<string, string>>, privateNames: Iterable<string> = []) {
  return Object.fromEntries([
    ...valueMaps.flatMap(values => Object.keys(normalizeStepParameterValues(values, "t"))),
    ...Array.from(privateNames, name => normalizeStepParameterName(name, "t"))
  ].filter(Boolean).map(name => [name, ""]));
}

/** Browser draft storage contains public edits only. Private replacements stay
 * in memory until the authorized case save completes. */
export function caseParameterDraftValues(values: Record<string, string>, privateNames: Iterable<string> = []) {
  const own = normalizeStepParameterValues(values, "t");
  const hidden = collectPrivateParameterNames([own], privateNames);
  return Object.fromEntries(Object.entries(own).filter(([name]) => !hidden.has(name)));
}

/** A public draft must not erase saved private bindings, including when an old
 * browser draft still contains a plaintext private value. */
export function restoreCaseParameterDraftValues(draft: Record<string, string>, savedValues: Record<string, string>, privateNames: Iterable<string> = []) {
  const saved = normalizeStepParameterValues(savedValues, "t");
  const hidden = collectPrivateParameterNames([draft, saved], privateNames);
  return {
    ...Object.fromEntries(Object.entries(saved).filter(([name]) => hidden.has(name))),
    ...caseParameterDraftValues(draft, hidden)
  };
}
