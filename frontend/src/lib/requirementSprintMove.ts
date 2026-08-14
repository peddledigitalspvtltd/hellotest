import type { Requirement, RequirementIteration } from "../types";

// Jira Software accepts at most 50 issues in a single Sprint move. Keeping the
// UI batch aligned with that boundary also makes partial failures observable:
// every fulfilled Qaira request represents one completed Jira mutation.
export const JIRA_SPRINT_MOVE_BATCH_SIZE = 50;
export const REQUIREMENT_SPRINT_MOVE_PERSISTENCE_TTL_MS = 30 * 60_000;
export const REQUIREMENT_SPRINT_MOVE_PERSISTENCE_LIMIT = 100;
export const REQUIREMENT_SPRINT_SETTLEMENT_CONFIRMATIONS = 2;
export const REQUIREMENT_SPRINT_SETTLEMENT_INTERVAL_MS = 1_500;

const REQUIREMENT_SPRINT_MOVE_STORAGE_PREFIX = "qaira.requirements.confirmed-sprint-moves.v1";
const REQUIREMENT_SPRINT_EXPANSION_STORAGE_PREFIX = "qaira.requirements.expanded-sprints.v1";
const REQUIREMENT_SPRINT_EXPANSION_LIMIT = 12;

type RequirementSprintMoveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ConfirmedRequirementSprintMove = {
  requirement: Requirement;
  targetKind: "sprint" | "backlog";
  targetIterationId: string | null;
  targetSprintId: string | null;
  targetSprintName: string | null;
  targetSprintState: string | null;
  confirmedAt: number;
  settlementObservationCount?: number;
  lastSettlementObservedAt?: number | null;
};

const normalizedValue = (value?: string | null) => String(value || "").trim().toLowerCase();

export function mergeRequirementSprintCatalog(
  iterations: RequirementIteration[],
  requirements: Requirement[]
) {
  const catalog = [...iterations];
  const iterationBySprintId = new Map(
    catalog
      .filter((iteration) => iteration.jira_sprint_id)
      .map((iteration) => [String(iteration.jira_sprint_id), iteration])
  );
  const iterationByName = new Map(
    catalog.map((iteration) => [
      normalizedValue(iteration.jira_sprint_name || iteration.name),
      iteration
    ])
  );

  for (const requirement of requirements) {
    const sprintId = String(requirement.sprint_id || "");
    const sprintName = String(requirement.sprint || "").trim();
    if (!sprintId && !sprintName) continue;
    if (sprintId ? iterationBySprintId.has(sprintId) : iterationByName.has(normalizedValue(sprintName))) continue;

    const observed: RequirementIteration = {
      id: sprintId
        ? `jira-sprint-${sprintId}`
        : `observed-sprint-${encodeURIComponent(normalizedValue(sprintName))}`,
      project_id: requirement.project_id,
      name: sprintName || `Sprint ${sprintId}`,
      jira_sprint_id: sprintId || null,
      jira_sprint_name: sprintName || null,
      source: "jira",
      state: requirement.sprint_state || null,
      status: requirement.sprint_state || null,
      start_date: requirement.sprint_start_date || null,
      end_date: requirement.sprint_end_date || null,
      complete_date: requirement.sprint_complete_date || null,
      requirement_ids: []
    };
    catalog.push(observed);
    if (sprintId) iterationBySprintId.set(sprintId, observed);
    iterationByName.set(normalizedValue(observed.name), observed);
  }

  return catalog;
}

export function projectRequirementSprintScopeEvidence(
  requirement: Requirement,
  scopedIteration: RequirementIteration
): Requirement {
  const sprintId = String(requirement.sprint_id || "");
  const sprintName = String(requirement.sprint || "").trim();
  if (sprintId || sprintName) return requirement;

  const scopedSprintId = String(scopedIteration.jira_sprint_id || "");
  const isJiraSprint = Boolean(scopedSprintId || scopedIteration.source === "jira");
  if (isJiraSprint) {
    return {
      ...requirement,
      sprint_id: scopedSprintId || null,
      sprint: scopedIteration.jira_sprint_name || scopedIteration.name,
      sprint_state: scopedIteration.state || scopedIteration.status || null
    };
  }

  return requirement.iteration_id
    ? requirement
    : { ...requirement, iteration_id: scopedIteration.id };
}

export function requirementMatchesSprint(
  requirement: Requirement,
  move: ConfirmedRequirementSprintMove
) {
  if (move.targetKind === "backlog") {
    return !requirement.sprint_id
      && !normalizedValue(requirement.sprint)
      && !requirement.iteration_id;
  }

  // A Jira Sprint id is authoritative. Do not accept a cached Sprint name or
  // legacy Qaira iteration property as confirmation of a native Jira move.
  if (move.targetSprintId) {
    return String(requirement.sprint_id || "") === move.targetSprintId;
  }

  return (Boolean(move.targetIterationId) && requirement.iteration_id === move.targetIterationId)
    || normalizedValue(requirement.sprint) === normalizedValue(move.targetSprintName);
}

export function requirementSprintMoveIsSettled(
  requirements: Requirement[],
  move: ConfirmedRequirementSprintMove
) {
  const evidence = requirements.filter((requirement) => requirement.id === move.requirement.id);
  if (!evidence.some((requirement) => requirementMatchesSprint(requirement, move))) return false;

  if (move.targetKind === "backlog") {
    return evidence.every((requirement) =>
      !requirement.sprint_id
      && !normalizedValue(requirement.sprint)
      && !requirement.iteration_id
    );
  }

  if (move.targetSprintId) {
    // A stale source-Sprint page can briefly coexist with the confirmed target
    // page while Jira refreshes its search index. Keep projecting the move
    // until every loaded response positively confirms the target Sprint id.
    return evidence.every((requirement) => {
      const sprintId = String(requirement.sprint_id || "");
      return sprintId === move.targetSprintId;
    });
  }

  return evidence.every((requirement) => {
    if (requirement.iteration_id && requirement.iteration_id !== move.targetIterationId) return false;
    const sprintName = normalizedValue(requirement.sprint);
    return !sprintName || sprintName === normalizedValue(move.targetSprintName);
  });
}

/**
 * Jira accepts a Sprint move before every JQL-backed view necessarily sees the
 * new Sprint field value. Requiring two separated, agreeing observations keeps
 * a single transient response from removing the optimistic bridge too early.
 * Any contradictory observation resets the confirmation sequence.
 */
export function observeRequirementSprintMoveSettlement(
  requirements: Requirement[],
  move: ConfirmedRequirementSprintMove,
  observedAt = Date.now()
): { move: ConfirmedRequirementSprintMove; settled: boolean } {
  if (!requirementSprintMoveIsSettled(requirements, move)) {
    if (!move.settlementObservationCount && !move.lastSettlementObservedAt) {
      return { move, settled: false };
    }
    return {
      move: {
        ...move,
        settlementObservationCount: 0,
        lastSettlementObservedAt: null
      },
      settled: false
    };
  }

  const previousCount = Math.max(0, Number(move.settlementObservationCount || 0));
  const previousObservedAt = Number(move.lastSettlementObservedAt || 0);
  const canCountObservation = !previousObservedAt
    || observedAt - previousObservedAt >= REQUIREMENT_SPRINT_SETTLEMENT_INTERVAL_MS;
  const settlementObservationCount = canCountObservation
    ? previousCount + 1
    : previousCount;
  const nextMove = canCountObservation
    ? {
        ...move,
        settlementObservationCount,
        lastSettlementObservedAt: observedAt
      }
    : move;

  return {
    move: nextMove,
    settled: settlementObservationCount >= REQUIREMENT_SPRINT_SETTLEMENT_CONFIRMATIONS
  };
}

export function projectConfirmedRequirementSprintMove(
  move: ConfirmedRequirementSprintMove,
  current?: Requirement | null
): Requirement {
  return {
    ...move.requirement,
    ...(current || {}),
    iteration_id: move.targetIterationId,
    sprint: move.targetSprintName,
    sprint_id: move.targetSprintId,
    sprint_state: move.targetSprintState
  };
}

export function createConfirmedRequirementSprintMove(
  requirement: Requirement,
  iteration: RequirementIteration,
  confirmedAt = Date.now()
): ConfirmedRequirementSprintMove {
  return {
    requirement,
    targetKind: "sprint",
    targetIterationId: iteration.id,
    targetSprintId: iteration.jira_sprint_id ? String(iteration.jira_sprint_id) : null,
    targetSprintName: iteration.jira_sprint_name || iteration.name,
    targetSprintState: iteration.state || iteration.status || null,
    confirmedAt,
    settlementObservationCount: 0,
    lastSettlementObservedAt: null
  };
}

export function createConfirmedRequirementBacklogMove(
  requirement: Requirement,
  confirmedAt = Date.now()
): ConfirmedRequirementSprintMove {
  return {
    requirement,
    targetKind: "backlog",
    targetIterationId: null,
    targetSprintId: null,
    targetSprintName: null,
    targetSprintState: null,
    confirmedAt,
    settlementObservationCount: 0,
    lastSettlementObservedAt: null
  };
}

function requirementSprintMoveStorageKey(scope: string) {
  return `${REQUIREMENT_SPRINT_MOVE_STORAGE_PREFIX}:${encodeURIComponent(scope)}`;
}

function normalizedPersistedMove(
  requirementId: string,
  candidate: unknown,
  now: number
): ConfirmedRequirementSprintMove | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const value = candidate as Partial<ConfirmedRequirementSprintMove>;
  const requirement = value.requirement;
  const confirmedAt = Number(value.confirmedAt);
  if (!requirement || typeof requirement !== "object" || String(requirement.id || "") !== requirementId) return null;
  const targetKind = value.targetKind === "backlog" ? "backlog" : "sprint";
  if (targetKind === "sprint" && (!String(value.targetIterationId || "") || !String(value.targetSprintName || ""))) return null;
  if (!Number.isFinite(confirmedAt) || confirmedAt > now + 60_000 || now - confirmedAt > REQUIREMENT_SPRINT_MOVE_PERSISTENCE_TTL_MS) return null;
  const persistedObservationCount = Number(value.settlementObservationCount || 0);
  const persistedObservationAt = Number(value.lastSettlementObservedAt || 0);

  return {
    requirement,
    targetKind,
    targetIterationId: targetKind === "backlog" ? null : String(value.targetIterationId),
    targetSprintId: value.targetSprintId ? String(value.targetSprintId) : null,
    targetSprintName: targetKind === "backlog" ? null : String(value.targetSprintName),
    targetSprintState: targetKind === "backlog"
      ? null
      : value.targetSprintState ? String(value.targetSprintState) : null,
    confirmedAt,
    settlementObservationCount: Number.isFinite(persistedObservationCount)
      ? Math.max(0, Math.min(REQUIREMENT_SPRINT_SETTLEMENT_CONFIRMATIONS, Math.trunc(persistedObservationCount)))
      : 0,
    lastSettlementObservedAt: Number.isFinite(persistedObservationAt)
      && persistedObservationAt > 0
      && persistedObservationAt <= now + 60_000
      ? persistedObservationAt
      : null
  };
}

export function prunePersistedRequirementSprintMoves(
  moves: Record<string, ConfirmedRequirementSprintMove>,
  now = Date.now()
) {
  return Object.fromEntries(
    Object.entries(moves)
      .map(([requirementId, move]) => [requirementId, normalizedPersistedMove(requirementId, move, now)] as const)
      .filter((entry): entry is readonly [string, ConfirmedRequirementSprintMove] => Boolean(entry[1]))
      .sort((left, right) => right[1].confirmedAt - left[1].confirmedAt)
      .slice(0, REQUIREMENT_SPRINT_MOVE_PERSISTENCE_LIMIT)
  );
}

export function readPersistedRequirementSprintMoves(
  storage: RequirementSprintMoveStorage | null,
  scope: string,
  now = Date.now()
) {
  if (!storage || !scope) return {};
  const key = requirementSprintMoveStorageKey(scope);
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const moves = prunePersistedRequirementSprintMoves(
      parsed?.version === 1 && parsed?.moves && typeof parsed.moves === "object" ? parsed.moves : {},
      now
    );
    if (!Object.keys(moves).length) storage.removeItem(key);
    return moves;
  } catch {
    try { storage.removeItem(key); } catch { /* Storage can be unavailable in a restricted iframe. */ }
    return {};
  }
}

export function writePersistedRequirementSprintMoves(
  storage: RequirementSprintMoveStorage | null,
  scope: string,
  moves: Record<string, ConfirmedRequirementSprintMove>,
  now = Date.now()
) {
  if (!storage || !scope) return;
  const key = requirementSprintMoveStorageKey(scope);
  try {
    const persisted = prunePersistedRequirementSprintMoves(moves, now);
    if (!Object.keys(persisted).length) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ version: 1, moves: persisted }));
  } catch {
    // Jira remains authoritative when browser storage is unavailable. The
    // in-memory projection still covers the current page lifecycle.
  }
}

export function readPersistedRequirementSprintExpansion(
  storage: RequirementSprintMoveStorage | null,
  scope: string
) {
  if (!storage || !scope) return [];
  const key = `${REQUIREMENT_SPRINT_EXPANSION_STORAGE_PREFIX}:${encodeURIComponent(scope)}`;
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    if (!Array.isArray(parsed)) {
      storage.removeItem(key);
      return [];
    }
    return [...new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean))]
      .slice(-REQUIREMENT_SPRINT_EXPANSION_LIMIT);
  } catch {
    try { storage.removeItem(key); } catch { /* Storage can be unavailable in a restricted iframe. */ }
    return [];
  }
}

export function writePersistedRequirementSprintExpansion(
  storage: RequirementSprintMoveStorage | null,
  scope: string,
  iterationIds: string[]
) {
  if (!storage || !scope) return;
  const key = `${REQUIREMENT_SPRINT_EXPANSION_STORAGE_PREFIX}:${encodeURIComponent(scope)}`;
  try {
    const normalized = [...new Set(iterationIds.map((value) => String(value || "").trim()).filter(Boolean))]
      .slice(-REQUIREMENT_SPRINT_EXPANSION_LIMIT);
    if (!normalized.length) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    // Expansion is a convenience preference; Jira Sprint membership remains
    // authoritative when browser storage is unavailable.
  }
}

export function resolveRequirementSprintIteration(
  requirement: Requirement,
  iterations: RequirementIteration[],
  scopedIteration?: RequirementIteration | null
) {
  const sprintId = String(requirement.sprint_id || "");
  if (sprintId) {
    const identifiedIteration = iterations.find((iteration) => String(iteration.jira_sprint_id || "") === sprintId);
    if (identifiedIteration) return identifiedIteration;
    return String(scopedIteration?.jira_sprint_id || "") === sprintId
      ? scopedIteration || undefined
      : undefined;
  }

  const sprintName = normalizedValue(requirement.sprint);
  if (sprintName) {
    const namedIteration = iterations.find((iteration) =>
      [iteration.jira_sprint_name, iteration.name]
        .some((candidate) => normalizedValue(candidate) === sprintName)
    );
    if (namedIteration) return namedIteration;
    return scopedIteration
      && [scopedIteration.jira_sprint_name, scopedIteration.name]
        .some((candidate) => normalizedValue(candidate) === sprintName)
      ? scopedIteration
      : undefined;
  }

  // A Story returned by /requirement-iterations/:id/requirements was selected
  // by Jira JQL for this exact Sprint. Use that scoped membership when Jira
  // transiently omits the Sprint custom field from the row. An explicit native
  // Sprint id or a resolvable Sprint name above always wins once Jira returns
  // it, so this fallback converges to Jira truth instead of pinning stale UI
  // state.
  if (scopedIteration) {
    return scopedIteration;
  }

  // Local membership remains available only for a legacy Qaira-owned
  // iteration. Native Jira Sprints are derived from Jira's Sprint field/JQL;
  // stale project-property ids must never make an unassigned Story immovable.
  const explicitIteration = iterations.find((iteration) =>
    iteration.id === requirement.iteration_id
    && iteration.source !== "jira"
    && !iteration.jira_sprint_id
  );
  if (explicitIteration) return explicitIteration;

  return iterations.find((iteration) =>
    iteration.source !== "jira"
    && !iteration.jira_sprint_id
    && (iteration.requirement_ids || []).map(String).includes(requirement.id)
  );
}

export function resolveRequirementSprintIterationFromEvidence(
  evidence: Array<{
    requirement: Requirement;
    scopedIteration?: RequirementIteration | null;
  }>,
  iterations: RequirementIteration[]
) {
  let resolved: RequirementIteration | undefined;
  let resolvedRank = 0;

  evidence.forEach(({ requirement, scopedIteration }) => {
    const direct = resolveRequirementSprintIteration(requirement, iterations);
    const candidate = direct
      || (scopedIteration
        ? resolveRequirementSprintIteration(requirement, iterations, scopedIteration)
        : undefined);
    if (!candidate) return;

    const sprintId = String(requirement.sprint_id || "");
    const sprintName = normalizedValue(requirement.sprint);
    const hasMatchingNativeEvidence = sprintId
      ? String(candidate.jira_sprint_id || "") === sprintId
      : Boolean(sprintName) && [candidate.jira_sprint_name, candidate.name]
        .some((value) => normalizedValue(value) === sprintName);
    const rank = hasMatchingNativeEvidence
      ? 3
      : direct
        ? 1
        : 2;

    // Preserve the first observation within an equal evidence tier. Duplicate
    // expanded Sprint pages can briefly disagree, but neither scoped page is
    // more authoritative merely because React Query returned it later.
    if (rank > resolvedRank) {
      resolved = candidate;
      resolvedRank = rank;
    }
  });

  return resolved;
}
