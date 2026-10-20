import { parseStepParameterName, type StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

export type AutomationBuildParameterPlan = {
  test_case_id: string;
  test_suite_id?: string | null;
  parameter_plan_key: string;
  parameter_values: Record<string, string>;
  parameter_references: string[];
  private_parameter_references: string[];
  missing_parameter_references: string[];
  empty_parameter_references?: string[];
  deferred_parameter_references: string[];
};

export type AutomationBuildParameterContext = {
  test_environment_id?: string;
  test_configuration_id?: string;
  test_data_set_id?: string;
  test_suite_id?: string;
  test_suite_ids_by_case?: Record<string, string | null>;
};

/** A suite selection belongs to a case. Batch reviews must never apply the
 * active case's selection to another case's inherited @s defaults. */
export function automationBuildParameterRequest(context: AutomationBuildParameterContext, caseId: string) {
  const { test_suite_ids_by_case, ...shared } = context;
  return test_suite_ids_by_case && Object.prototype.hasOwnProperty.call(test_suite_ids_by_case, caseId)
    ? { ...shared, test_suite_id: test_suite_ids_by_case[caseId] || undefined }
    : shared;
}

const privateName = /password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;
const own = (value: object, name: string) => Object.prototype.hasOwnProperty.call(value, name);
export const isPrivateBuildParameterName = (name: string) => privateName.test(name);

/** The server owns resolution and availability. The dialog never evaluates
 * generators or substitutes tokens in public values returned by the plan. */
export function automationBuildParameterReview(plan: AutomationBuildParameterPlan) {
  const privateNames = new Set(plan.private_parameter_references);
  const deferredNames = new Set(plan.deferred_parameter_references);
  const missingNames = new Set(plan.missing_parameter_references);
  const emptyNames = new Set(plan.empty_parameter_references || []);
  const unsetNames = new Set([...missingNames, ...emptyNames]);
  const definitions: StepParameterDefinition[] = [...new Set(plan.parameter_references)].flatMap(name => {
    const parameter = parseStepParameterName(name);
    if (!parameter || parameter.name !== name) return [];
    return [{ ...parameter, label: parameter.rawName, stepIds: [], occurrenceCount: 0,
      sourceLabel: "configured build data", sensitive: privateNames.has(name) && !unsetNames.has(name) }];
  });
  const values = Object.fromEntries(definitions.flatMap(parameter =>
    !privateNames.has(parameter.name) && !deferredNames.has(parameter.name) && !isPrivateBuildParameterName(parameter.name)
      && own(plan.parameter_values, parameter.name) && typeof plan.parameter_values[parameter.name] === "string"
      ? [[parameter.name, plan.parameter_values[parameter.name]]] : []));
  return { definitions, values, missingNames, emptyNames, unsetNames, privateNames, deferredNames };
}

/** Only authored changes and the reviewed missing blanks become overrides.
 * Untouched inherited/private defaults and deferred bindings stay in place. */
export function automationBuildParameterOverrides(plan: AutomationBuildParameterPlan, edits: Record<string, string>) {
  const { definitions, values, unsetNames, deferredNames } = automationBuildParameterReview(plan);
  return Object.fromEntries(definitions.flatMap(parameter => {
    const name = parameter.name;
    if (deferredNames.has(name)) return [];
    if (own(edits, name) && typeof edits[name] === "string") {
      return unsetNames.has(name) || !own(values, name) || edits[name] !== values[name] ? [[name, edits[name]]] : [];
    }
    return unsetNames.has(name) ? [[name, ""]] : [];
  }));
}
