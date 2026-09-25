import type { UseQueryResult } from "@tanstack/react-query";

const EMPTY_ITEMS: never[] = [];

export function optionalQueryView<TItem, TError>(query: UseQueryResult<TItem[], TError>, enabled: boolean): UseQueryResult<TItem[], TError>;
export function optionalQueryView<TData, TError>(query: UseQueryResult<TData, TError>, enabled: boolean, emptyData: TData): UseQueryResult<TData, TError>;
/** Hide unavailable optional data without deleting another observer's cache. */
export function optionalQueryView<TData, TError>(
  query: UseQueryResult<TData, TError>,
  enabled: boolean,
  emptyData: TData = EMPTY_ITEMS as TData
): UseQueryResult<TData, TError> {
  if (enabled) return query;

  const emptyView: UseQueryResult<TData, TError> = {
    ...query,
    data: emptyData,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    status: "success",
    fetchStatus: "idle",
    isEnabled: false,
    isError: false,
    isFetched: false,
    isFetchedAfterMount: false,
    isFetching: false,
    isLoading: false,
    isInitialLoading: false,
    isPending: false,
    isLoadingError: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    promise: Promise.resolve(emptyData),
    // React Query's refetch bypasses enabled. Optional callers must not be able
    // to issue a forbidden request through a retry/refresh control either.
    refetch: async () => emptyView
  };
  return emptyView;
}
