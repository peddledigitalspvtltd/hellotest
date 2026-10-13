/** Read the scoped repository without a total-row cutoff; abort stale navigation. */
export async function collectRepositoryPages<T extends { id: string }>(
  fetchPage: (page: { limit: number; offset: number }) => Promise<T[]>,
  { signal, pageSize = 200 }: { signal?: AbortSignal; pageSize?: number } = {}
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error('Repository page size must be a positive integer.');
  }
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    signal?.throwIfAborted();
    const page = await fetchPage({ limit: pageSize, offset });
    signal?.throwIfAborted();
    if (!Array.isArray(page)) throw new Error('The object repository returned an invalid page.');
    let added = 0;
    for (const item of page) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(item);
      added++;
    }
    if (page.length < pageSize) return rows;
    if (!added) throw new Error('The object repository repeated a page. Retry the current application scope.');
  }
}
