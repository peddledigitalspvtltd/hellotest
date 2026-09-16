import { api } from './api';
import type { TestCase } from '../types';
import type { TestCasePickerFilters } from './testCaseCatalog';

/** Resolve an explicitly chosen scope, never an unfiltered catalogue. */
export async function resolveTestCasePickerScope(filters: TestCasePickerFilters, signal?: AbortSignal): Promise<TestCase[]> {
  if (!filters.ids && !filters.module_id && !filters.suite_id && !filters.suite_ids && !filters.requirement_id) return [];
  const ids = filters.ids?.split(',').filter(Boolean);
  const scopes = ids?.length
    ? Array.from({ length: Math.ceil(ids.length / 200) }, (_, index) => ({ ...filters, ids: ids.slice(index * 200, (index + 1) * 200).join(',') }))
    : [filters];
  const rows = new Map<string, TestCase>();
  for (const scope of scopes) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await api.testCases.listPicker({ ...scope, page_size: 25, cursor }, { signal });
      page.items.forEach((row) => rows.set(row.id, row));
      if (page.is_last) break;
      if (!page.next_cursor || seen.has(page.next_cursor)) throw new Error('Test Case selection could not be fully loaded. Please retry.');
      cursor = page.next_cursor;
      seen.add(cursor);
    } while (cursor);
  }
  return [...rows.values()];
}
