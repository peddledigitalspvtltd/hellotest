/** Keep initial and continuation requests bounded, regardless of group size. */
export const HIERARCHY_COMPLETE_LOAD_LIMIT = 25;
export const HIERARCHY_LARGE_PAGE_SIZE = 25;

export function getHierarchyPageSize(_reportedTotal: number | null | undefined, _pageIndex: number) {
  return HIERARCHY_LARGE_PAGE_SIZE;
}

export function getUnassignedPageSize(_hasCursor: boolean) {
  return HIERARCHY_LARGE_PAGE_SIZE;
}
