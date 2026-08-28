import type { DomainMetadata, RequirementIteration, RequirementRelease } from "../types";

export type JiraDeliveryVersion = NonNullable<DomainMetadata["jira"]>["versions"][number];
export type JiraDeliverySprint = NonNullable<DomainMetadata["jira"]>["sprints"][number];

export type DeliveryScopeOptionSource = "hellotest" | "jira" | "current";

export type DeliveryScopeOption = {
  value: string;
  label: string;
  source: DeliveryScopeOptionSource;
  sourceId: string | null;
  state: string | null;
};

export type DeliveryScopeCatalogInput = {
  releases?: readonly RequirementRelease[];
  iterations?: readonly RequirementIteration[];
  jiraVersions?: readonly JiraDeliveryVersion[];
  jiraSprints?: readonly JiraDeliverySprint[];
};

export type DeliveryScopeOptionInput = DeliveryScopeCatalogInput & {
  currentRelease?: string | null;
  currentSprint?: string | null;
  includeClosedSprints?: boolean;
};

export type DeliveryScopePrefillInput = {
  releaseId?: string | null;
  releaseToken?: string | null;
  sprintId?: string | null;
  sprintToken?: string | null;
};

export type ResolvedDeliveryScopePrefill = {
  release: string;
  sprint: string;
  unresolvedReleaseId: boolean;
  unresolvedSprintId: boolean;
};

const cleanValue = (value: unknown) => String(value || "").trim();
const comparableValue = (value: unknown) => cleanValue(value).toLocaleLowerCase();

const releaseValue = (release: RequirementRelease) =>
  cleanValue(release.fix_version) || cleanValue(release.name);

const sprintValue = (iteration: RequirementIteration) =>
  cleanValue(iteration.jira_sprint_name) || cleanValue(iteration.name);

const sprintState = (iteration: RequirementIteration) =>
  cleanValue(iteration.state || iteration.status) || null;

const optionLabel = (name: string, secondary: string, state?: string | null) => {
  const parts = [name];
  if (secondary && comparableValue(secondary) !== comparableValue(name)) parts.push(secondary);
  if (state) parts.push(state.replace(/_/g, " "));
  return parts.filter(Boolean).join(" · ");
};

const addUniqueOption = (
  options: DeliveryScopeOption[],
  keys: Set<string>,
  option: DeliveryScopeOption
) => {
  const key = comparableValue(option.value);
  if (!key || keys.has(key)) return;
  keys.add(key);
  options.push(option);
};

const preserveCurrentOption = (
  options: DeliveryScopeOption[],
  currentValue: string | null | undefined
): DeliveryScopeOption[] => {
  const current = cleanValue(currentValue);
  if (!current) return options;

  const currentKey = comparableValue(current);
  const matchingIndex = options.findIndex((option) => comparableValue(option.value) === currentKey);
  if (matchingIndex >= 0) {
    if (options[matchingIndex].value === current) return options;
    return options.map((option, index) => index === matchingIndex ? { ...option, value: current } : option);
  }

  return [{
    value: current,
    label: current,
    source: "current" as const,
    sourceId: null,
    state: null
  }, ...options];
};

const findReleaseScopeValue = (
  token: string | null | undefined,
  { releases = [], jiraVersions = [] }: DeliveryScopeCatalogInput
) => {
  const rawToken = cleanValue(token);
  if (!rawToken) return null;
  const [sourcePrefix, prefixedToken] = rawToken.includes(":")
    ? rawToken.split(/:(.*)/s, 2)
    : ["", rawToken];
  const lookupToken = cleanValue(prefixedToken);
  const lookupKey = comparableValue(lookupToken);
  const normalizedPrefix = comparableValue(sourcePrefix);

  const nativeRelease = releases.find((release) => {
    if (normalizedPrefix && !["release", "hellotest"].includes(normalizedPrefix)) return false;
    return [release.id, release.fix_version, release.name]
      .some((value) => comparableValue(value) === lookupKey);
  }) || (!normalizedPrefix ? releases.find((release) => [release.id, release.fix_version, release.name]
    .some((value) => comparableValue(value) === lookupKey)) : null);
  if (nativeRelease) return releaseValue(nativeRelease);

  const jiraVersion = jiraVersions.find((version) => {
    if (normalizedPrefix && !["jira", "version"].includes(normalizedPrefix)) return false;
    return [version.id, version.name].some((value) => comparableValue(value) === lookupKey);
  }) || (!normalizedPrefix ? jiraVersions.find((version) => [version.id, version.name]
    .some((value) => comparableValue(value) === lookupKey)) : null);
  return jiraVersion ? cleanValue(jiraVersion.name) : null;
};

const findSprintScopeValue = (
  token: string | null | undefined,
  { iterations = [], jiraSprints = [] }: DeliveryScopeCatalogInput
) => {
  const rawToken = cleanValue(token);
  if (!rawToken) return null;
  const [sourcePrefix, prefixedToken] = rawToken.includes(":")
    ? rawToken.split(/:(.*)/s, 2)
    : ["", rawToken];
  const lookupToken = cleanValue(prefixedToken);
  const lookupKey = comparableValue(lookupToken);
  const normalizedPrefix = comparableValue(sourcePrefix);

  const nativeSprint = iterations.find((iteration) => {
    if (normalizedPrefix && !["sprint", "iteration", "hellotest"].includes(normalizedPrefix)) return false;
    return [iteration.id, iteration.jira_sprint_id, iteration.jira_sprint_name, iteration.name]
      .some((value) => comparableValue(value) === lookupKey);
  }) || (!normalizedPrefix ? iterations.find((iteration) => [iteration.id, iteration.jira_sprint_id, iteration.jira_sprint_name, iteration.name]
    .some((value) => comparableValue(value) === lookupKey)) : null);
  if (nativeSprint) return sprintValue(nativeSprint);

  const jiraSprint = jiraSprints.find((sprint) => {
    if (normalizedPrefix && !["jira", "sprint"].includes(normalizedPrefix)) return false;
    return [sprint.id, sprint.name].some((value) => comparableValue(value) === lookupKey);
  }) || (!normalizedPrefix ? jiraSprints.find((sprint) => [sprint.id, sprint.name]
    .some((value) => comparableValue(value) === lookupKey)) : null);
  return jiraSprint ? cleanValue(jiraSprint.name) : null;
};

export function resolveReleaseScopeValue(
  token: string | null | undefined,
  input: DeliveryScopeCatalogInput
) {
  return findReleaseScopeValue(token, input) || cleanValue(token);
}

export function resolveSprintScopeValue(
  token: string | null | undefined,
  input: DeliveryScopeCatalogInput
) {
  return findSprintScopeValue(token, input) || cleanValue(token);
}

export function resolveDeliveryScopePrefill(
  prefill: DeliveryScopePrefillInput,
  input: DeliveryScopeCatalogInput
): ResolvedDeliveryScopePrefill {
  const releaseId = cleanValue(prefill.releaseId);
  const sprintId = cleanValue(prefill.sprintId);
  const releaseToken = cleanValue(prefill.releaseToken);
  const sprintToken = cleanValue(prefill.sprintToken);
  const releaseFromId = releaseId ? findReleaseScopeValue(releaseId, input) : null;
  const sprintFromId = sprintId ? findSprintScopeValue(sprintId, input) : null;

  return {
    release: releaseToken ? resolveReleaseScopeValue(releaseToken, input) : releaseFromId || "",
    sprint: sprintToken ? resolveSprintScopeValue(sprintToken, input) : sprintFromId || "",
    unresolvedReleaseId: Boolean(!releaseToken && releaseId && !releaseFromId),
    unresolvedSprintId: Boolean(!sprintToken && sprintId && !sprintFromId)
  };
}

export function buildDeliveryScopeOptions({
  releases = [],
  iterations = [],
  jiraVersions = [],
  jiraSprints = [],
  currentRelease,
  currentSprint,
  includeClosedSprints = false
}: DeliveryScopeOptionInput) {
  const releaseOptions: DeliveryScopeOption[] = [];
  const releaseKeys = new Set<string>();

  releases.forEach((release) => {
    const value = releaseValue(release);
    addUniqueOption(releaseOptions, releaseKeys, {
      value,
      label: optionLabel(cleanValue(release.name) || value, value, cleanValue(release.state) || null),
      source: "hellotest",
      sourceId: cleanValue(release.id) || null,
      state: cleanValue(release.state) || null
    });
  });

  jiraVersions.filter((version) => !version.archived).forEach((version) => {
    const value = cleanValue(version.name);
    addUniqueOption(releaseOptions, releaseKeys, {
      value,
      label: optionLabel(value, "", version.released ? "released" : null),
      source: "jira",
      sourceId: cleanValue(version.id) || null,
      state: version.released ? "released" : null
    });
  });

  const currentSprintKey = comparableValue(currentSprint);
  const sprintOptions: DeliveryScopeOption[] = [];
  const sprintKeys = new Set<string>();

  iterations.forEach((iteration) => {
    const value = sprintValue(iteration);
    const state = sprintState(iteration);
    if (
      !includeClosedSprints
      && comparableValue(state) === "closed"
      && comparableValue(value) !== currentSprintKey
    ) return;
    addUniqueOption(sprintOptions, sprintKeys, {
      value,
      label: optionLabel(value, "", state),
      source: "hellotest",
      sourceId: cleanValue(iteration.id) || null,
      state
    });
  });

  jiraSprints.forEach((sprint) => {
    const value = cleanValue(sprint.name);
    const state = cleanValue(sprint.state) || null;
    if (
      !includeClosedSprints
      && comparableValue(state) === "closed"
      && comparableValue(value) !== currentSprintKey
    ) return;
    addUniqueOption(sprintOptions, sprintKeys, {
      value,
      label: optionLabel(value, "", state),
      source: "jira",
      sourceId: cleanValue(sprint.id) || null,
      state
    });
  });

  const compareOptions = (left: DeliveryScopeOption, right: DeliveryScopeOption) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" });

  return {
    releaseOptions: preserveCurrentOption(releaseOptions.sort(compareOptions), currentRelease),
    sprintOptions: preserveCurrentOption(sprintOptions.sort(compareOptions), currentSprint)
  };
}
