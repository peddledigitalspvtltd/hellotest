import type { TestCase } from '../types';

export const RUN_PICKER_ID_BATCH_SIZE = 200;

export function runPickerIdBatches(ids: readonly string[]) {
  const unique = [...new Set(ids.map(String).filter(Boolean))].sort();
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += RUN_PICKER_ID_BATCH_SIZE) {
    batches.push(unique.slice(index, index + RUN_PICKER_ID_BATCH_SIZE));
  }
  return batches;
}

/** A parameter-plan request needs selected identities, never the whole case library. */
export function runCaseReferences(ids: readonly string[], known: readonly TestCase[]): TestCase[] {
  const byId = new Map(known.map(item => [item.id, item]));
  return [...new Set(ids)].map(id => byId.get(id) || {
    id, title: id, description: null, suite_id: null, requirement_id: null,
    automated: null, priority: null, status: null, detail_complete: false, summary_complete: false
  });
}

/** Keep unresolved selections while exact-ID metadata is arriving. */
export function retainEligibleRunCases(ids: readonly string[], known: ReadonlyMap<string, TestCase>, automatedOnly: boolean) {
  return automatedOnly ? ids.filter(id => !known.has(id) || known.get(id)?.automated === 'yes') : [...ids];
}

export async function loadRunPickerCaseBatch(
  ids: readonly string[],
  readPage: (query: { ids: string; page_size: number; cursor?: string }) => Promise<{ items: TestCase[]; next_cursor?: string | null; is_last?: boolean }>
) {
  if (!ids.length) return [];
  const expected = new Set(ids);
  const rows = new Map<string, TestCase>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readPage({ ids: [...expected].join(','), page_size: 25, cursor });
    for (const row of page.items || []) if (expected.has(row.id)) rows.set(row.id, row);
    if (page.is_last !== false && !page.next_cursor) break;
    const next = page.next_cursor || undefined;
    if (!next || seenCursors.has(next)) throw new Error('Selected Test Case details could not be completed. Retry the selection lookup.');
    seenCursors.add(next);
    cursor = next;
  } while (cursor);
  return [...rows.values()];
}
