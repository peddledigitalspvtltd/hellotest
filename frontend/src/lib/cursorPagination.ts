export type CursorPage<T> = {
  items: T[];
  next_cursor: string | null;
};

export async function loadAllCursorPages<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
  { maxPages = 100 }: { maxPages?: number } = {}
) {
  const items: T[] = [];
  const visitedCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    const nextCursor = page.next_cursor || undefined;

    if (!nextCursor) return items;
    if (visitedCursors.has(nextCursor)) throw new Error("Pagination stopped because the server returned a repeated cursor.");

    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error(`Pagination exceeded the ${maxPages}-page safety limit.`);
}
