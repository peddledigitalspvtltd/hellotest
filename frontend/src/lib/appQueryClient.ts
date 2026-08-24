import { QueryClient } from "@tanstack/react-query";

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);

export const shouldRetryQuery = (failureCount: number, error: unknown) => {
  if (failureCount >= 1) return false;
  const status = Number((error as { status?: unknown } | null)?.status || 0);
  if (!status) return true;
  return status >= 500 || TRANSIENT_HTTP_STATUSES.has(status);
};

export const createAppQueryClient = () => new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false
    },
    queries: {
      gcTime: 10 * 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: shouldRetryQuery,
      staleTime: 30_000,
      structuralSharing: true
    }
  }
});
