import type { EngineRunEnvelope, EngineRunRecord } from "../contracts/hellotest.js";

const runs = new Map<string, EngineRunRecord>();
const envelopes = new Map<string, EngineRunEnvelope>();

export function saveRun(record: EngineRunRecord, envelope?: EngineRunEnvelope) {
  runs.set(record.id, record);

  if (envelope) {
    envelopes.set(record.id, envelope);
  }

  return record;
}

export function getRun(id: string) {
  return runs.get(id) || null;
}

export function getRunEnvelope(id: string) {
  return envelopes.get(id) || null;
}

export function updateRun(id: string, updater: (record: EngineRunRecord) => EngineRunRecord) {
  const existing = runs.get(id);

  if (!existing) {
    return null;
  }

  const next = updater(existing);
  runs.set(id, next);
  return next;
}

export function listRuns() {
  return Array.from(runs.values()).sort((left, right) => right.created_at.localeCompare(left.created_at));
}
