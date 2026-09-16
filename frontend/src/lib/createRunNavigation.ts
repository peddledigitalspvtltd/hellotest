import type { Requirement, RequirementIteration, RequirementRelease, TestCase } from '../types';

export type CreateRunNavigationPrefill = {
  projectId: string;
  appTypeId: string;
  testCaseIds: string[];
  release: string;
  sprint: string;
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function readCreateRunNavigation(state: unknown): CreateRunNavigationPrefill | null {
  if (!record(state) || !record(state.createRun)) return null;
  const input = state.createRun;
  const projectId = text(input.projectId), appTypeId = text(input.appTypeId);
  const testCaseIds = [...new Set((Array.isArray(input.testCaseIds) ? input.testCaseIds : []).map(text).filter(Boolean))];
  if (!projectId || !appTypeId || !testCaseIds.length) return null;
  return { projectId, appTypeId, testCaseIds, release: text(input.release), sprint: text(input.sprint) };
}

export function clearCreateRunNavigation(search: string, state: unknown) {
  const params = new URLSearchParams(search);
  for (const key of ['create', 'project', 'release_id', 'release', 'sprint_id', 'sprint', 'mode']) params.delete(key);
  let nextState = state;
  if (record(state) && Object.prototype.hasOwnProperty.call(state, 'createRun')) {
    const { createRun: _consumed, ...rest } = state;
    nextState = Object.keys(rest).length ? rest : null;
  }
  return { search: params.size ? `?${params}` : '', state: nextState };
}

/** Derive defaults only when selected Stories agree; never pick an arbitrary release or sprint. */
export function deriveCreateRunDelivery(
  ids: readonly string[],
  cases: readonly Pick<TestCase, 'id' | 'requirement_id' | 'requirement_ids'>[],
  requirements: readonly Requirement[],
  releases: readonly RequirementRelease[],
  iterations: readonly RequirementIteration[]
) {
  const key = (value: unknown) => text(value).toLocaleLowerCase();
  const selectedIds = new Set(ids);
  const caseById = new Map(cases.map(item => [item.id, item]));
  const requirementIds = new Set(ids.flatMap(id => {
    const item = caseById.get(id);
    return [...(item?.requirement_ids || []), item?.requirement_id || ''].filter(Boolean);
  }));
  const iterationByReference = new Map<string, RequirementIteration>();
  for (const iteration of iterations) {
    for (const reference of [iteration.id, iteration.jira_sprint_id, iteration.jira_sprint_name, iteration.name]) {
      if (key(reference)) iterationByReference.set(key(reference), iteration);
    }
  }
  const releaseValues = new Set<string>(), sprintValues = new Set<string>();
  for (const requirement of requirements) {
    if (!requirementIds.has(requirement.id) && !requirement.test_case_ids?.some(id => selectedIds.has(id))) continue;
    const iteration = [requirement.iteration_id, requirement.sprint_id, requirement.sprint]
      .map(value => iterationByReference.get(key(value))).find(Boolean)
      || iterations.find(item => item.requirement_ids?.includes(requirement.id));
    const release = releases.find(item => item.requirement_ids?.includes(requirement.id)
      || Boolean(iteration && item.sprint_ids?.some(id => [iteration.id, iteration.jira_sprint_id, iteration.jira_sprint_name, iteration.name].some(value => key(value) === key(id)))));
    const releaseValue = text(requirement.fix_version || release?.fix_version || release?.name || requirement.release);
    const sprintValue = text(iteration?.jira_sprint_name || iteration?.name || requirement.sprint);
    if (releaseValue) releaseValues.add(releaseValue);
    if (sprintValue) sprintValues.add(sprintValue);
  }
  return {
    release: releaseValues.size === 1 ? [...releaseValues][0] : '',
    sprint: sprintValues.size === 1 ? [...sprintValues][0] : ''
  };
}

export function createRunDeliveryUpdates(
  prefill: Pick<CreateRunNavigationPrefill, 'release' | 'sprint'>,
  edited: { release: boolean; sprint: boolean },
  derived: { release: string; sprint: string }
) {
  return {
    release: !prefill.release && !edited.release ? derived.release : undefined,
    sprint: !prefill.sprint && !edited.sprint ? derived.sprint : undefined
  };
}

export function createRunSelectionReadiness(
  ids: readonly string[],
  cases: readonly Pick<TestCase, 'id'>[],
  resolution: { selectionKey: string; pending: boolean; error: unknown; unavailableIds: string[] } | null
): 'ready' | 'pending' | 'unavailable' {
  const knownIds = new Set(cases.map(item => item.id));
  if (ids.every(id => knownIds.has(id))) return 'ready';
  if (!resolution || resolution.selectionKey !== JSON.stringify(ids) || resolution.pending) return 'pending';
  if (resolution.error || resolution.unavailableIds.length) return 'unavailable';
  // The lookup can settle one render before its rows reach onItemsResolved.
  return 'pending';
}
