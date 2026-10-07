import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@hellotest/platform/frontend/src/lib/api";

// Catalog fetching and lifecycle refresh belong here, independently of view tabs.
export function useKnowledgeCatalog(projectId: string, canManage: boolean) {
  const cache = useQueryClient();
  const previousJobs = useRef("");
  const overviewQuery = useQuery({
    queryKey: ["knowledge-overview", projectId],
    queryFn: ({ signal }) => api.knowledgeRepo.overview(projectId, { signal }),
    enabled: Boolean(projectId), placeholderData: undefined, retry: 1, staleTime: 15_000,
    refetchInterval: query => {
      const jobs = query.state.data?.recent_jobs || query.state.data?.recent_ingestions || [];
      return jobs.some(job => ["queued", "running", "processing"].includes(String(job.status))) ? 3_000 : false;
    }
  });
  const collectionsQuery = useQuery({
    queryKey: ["knowledge-collections", projectId],
    queryFn: ({ signal }) => api.knowledgeRepo.collections.list(projectId, { signal }),
    enabled: Boolean(projectId), placeholderData: undefined, retry: 1, staleTime: 30_000
  });
  const sourcesQuery = useQuery({
    queryKey: ["knowledge-sources", projectId, canManage],
    queryFn: ({ signal }) => api.knowledgeRepo.sources(projectId, { includeArchived: canManage, signal }),
    enabled: Boolean(projectId), placeholderData: undefined, retry: 1, staleTime: 15_000
  });
  const signature = (overviewQuery.data?.recent_jobs || overviewQuery.data?.recent_ingestions || []).map(job => `${job.id}:${job.status}`).join("|");
  useEffect(() => {
    if (previousJobs.current && previousJobs.current !== signature) {
      void cache.invalidateQueries({ queryKey: ["knowledge-sources", projectId] });
      void cache.invalidateQueries({ queryKey: ["knowledge-collections", projectId] });
    }
    previousJobs.current = signature;
  }, [signature, projectId, cache]);
  return { overviewQuery, collectionsQuery, sourcesQuery };
}
