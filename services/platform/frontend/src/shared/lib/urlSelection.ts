export type RoutableRecord = {
  id: string;
  display_id?: string | null;
  legacy_display_ids?: string[];
};

export function matchesRoutableId(item: RoutableRecord, routeValue?: string | null) {
  if (!routeValue) {
    return false;
  }

  return item.id === routeValue || item.display_id === routeValue || item.legacy_display_ids?.includes(routeValue) === true;
}

export function findByRoutableId<T extends RoutableRecord>(items: T[], routeValue?: string | null) {
  if (!routeValue) {
    return null;
  }

  return items.find((item) => matchesRoutableId(item, routeValue)) || null;
}

export function getRoutableId(item: RoutableRecord | null | undefined) {
  return item?.display_id || item?.id || "";
}
