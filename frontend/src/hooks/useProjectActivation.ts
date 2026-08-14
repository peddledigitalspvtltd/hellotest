import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import type {
  ProjectActivationCatalog,
  ProjectActivationResourceResolutions,
  ProjectActivationSiteSnapshot,
  ProjectActivationSnapshot,
  ProjectActivationSourceMapping,
  ProjectActivationStatus
} from "../types";

const ACTIVE_POLL_INTERVAL_MS = 1_800;
const BULK_INTAKE_POLL_MAX_ATTEMPTS = 28;

type BulkCatalogPollingBridge = {
  token: string;
  projectIds: string[];
};

const isActivationInProgress = (status?: ProjectActivationStatus) =>
  status === "queued" || status === "provisioning";

const isCatalogActivationInProgress = (catalog?: ProjectActivationCatalog) =>
  Boolean(catalog?.items.some((project) =>
    project.activation_status === "queued" || project.activation_status === "provisioning"
  ));

const catalogHasActivationMarker = (catalog: ProjectActivationCatalog, projectId: string) => {
  const project = catalog.items.find((item) => String(item.id) === String(projectId));
  if (!project) return false;
  const status = String(project.activation_status || "").toLowerCase();
  return Boolean(project.is_configured)
    || ["active", "queued", "provisioning", "failed", "blocked"].includes(status);
};

export function useProjectActivationCatalog(enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectActivation.projects(),
    queryFn: api.projectActivation.projects,
    enabled,
    retry: 1,
    staleTime: 60_000,
    refetchInterval: (query) => isCatalogActivationInProgress(query.state.data)
      ? ACTIVE_POLL_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false
  });
}

export function useProjectActivationAdmin(enabled = true) {
  const queryClient = useQueryClient();
  const [bulkCatalogBridge, setBulkCatalogBridge] = useState<BulkCatalogPollingBridge | null>(null);

  const siteQuery = useQuery({
    queryKey: queryKeys.projectActivation.site(),
    queryFn: api.projectActivation.site,
    enabled,
    retry: 1,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "provisioning"
        ? ACTIVE_POLL_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: false
  });

  const prepareMutation = useMutation({
    mutationFn: (resourceResolutions?: ProjectActivationResourceResolutions) =>
      api.projectActivation.prepareSite(resourceResolutions),
    onSuccess: (snapshot) => {
      queryClient.setQueryData<ProjectActivationSiteSnapshot>(
        queryKeys.projectActivation.site(),
        snapshot
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectActivation.projects(), exact: true });
    }
  });

  const bulkEnableMutation = useMutation({
    mutationFn: (projectIds: string[]) => api.projectActivation.bulkEnable(projectIds),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectActivation.projects(), exact: true });
      const acceptedProjectIds = result.batch_id
        ? result.items
          .slice(0, Math.max(0, result.accepted))
          .map((item) => String(item.project_id || "").trim())
          .filter(Boolean)
        : [];
      if (acceptedProjectIds.length) {
        setBulkCatalogBridge((current) => ({
          token: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          projectIds: [...new Set([...(current?.projectIds || []), ...acceptedProjectIds])]
        }));
      }
      result.items.forEach((item) => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projectActivation.status(item.project_id),
          exact: true
        });
      });
    }
  });

  useEffect(() => {
    if (!enabled || !bulkCatalogBridge?.projectIds.length) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const { token, projectIds } = bulkCatalogBridge;

    const stopBridge = () => {
      setBulkCatalogBridge((current) => current?.token === token ? null : current);
    };
    const pollCatalog = async () => {
      attempts += 1;
      try {
        const catalog = await queryClient.fetchQuery({
          queryKey: queryKeys.projectActivation.projects(),
          queryFn: api.projectActivation.projects,
          staleTime: 0
        });
        if (cancelled) return;
        if (projectIds.every((projectId) => catalogHasActivationMarker(catalog, projectId))) {
          stopBridge();
          return;
        }
      } catch {
        // A normal catalog error remains visible in the active query. The
        // bounded bridge continues because async intake may still succeed.
      }
      if (cancelled) return;
      if (attempts >= BULK_INTAKE_POLL_MAX_ATTEMPTS) {
        stopBridge();
        return;
      }
      timer = setTimeout(pollCatalog, ACTIVE_POLL_INTERVAL_MS);
    };

    timer = setTimeout(pollCatalog, ACTIVE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bulkCatalogBridge, enabled, queryClient]);

  const refresh = useCallback(() => Promise.all([
    siteQuery.refetch(),
    queryClient.invalidateQueries({ queryKey: queryKeys.projectActivation.projects(), exact: true })
  ]), [queryClient, siteQuery]);

  return {
    siteQuery,
    prepareMutation,
    bulkEnableMutation,
    prepare: (resourceResolutions?: ProjectActivationResourceResolutions) =>
      prepareMutation.mutateAsync(resourceResolutions),
    enableProjects: bulkEnableMutation.mutateAsync,
    isPollingBulkIntake: Boolean(bulkCatalogBridge),
    refresh
  };
}

export function useProjectActivation(projectId: string, enabled = true) {
  const queryClient = useQueryClient();
  const [requestedProjectId, setRequestedProjectId] = useState("");
  const [acknowledgedProjectId, setAcknowledgedProjectId] = useState("");

  const statusQuery = useQuery({
    queryKey: queryKeys.projectActivation.status(projectId),
    queryFn: () => api.projectActivation.status(projectId),
    enabled: enabled && Boolean(projectId),
    retry: 1,
    staleTime: 0,
    refetchInterval: (query) => isActivationInProgress(query.state.data?.status)
      ? ACTIVE_POLL_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false
  });

  const enableMutation = useMutation({
    mutationFn: (sourceMapping?: ProjectActivationSourceMapping) => api.projectActivation.enable({
      project_id: projectId,
      confirmed: true,
      ...(sourceMapping || {})
    }),
    onMutate: () => {
      setRequestedProjectId(projectId);
      setAcknowledgedProjectId("");
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData<ProjectActivationSnapshot>(
        queryKeys.projectActivation.status(projectId),
        snapshot
      );
    }
  });

  useEffect(() => {
    setRequestedProjectId("");
    setAcknowledgedProjectId("");
    enableMutation.reset();
  }, [projectId]);

  const openWorkspace = useCallback(() => {
    setAcknowledgedProjectId(projectId);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.featureFlags(projectId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.appTypes(projectId), exact: true }),
      queryClient.invalidateQueries({ queryKey: ["domain-metadata"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-health", projectId], exact: true })
    ]);
  }, [projectId, queryClient]);

  const snapshot = statusQuery.data;
  const showReadyConfirmation = snapshot?.status === "active"
    && requestedProjectId === projectId
    && acknowledgedProjectId !== projectId;
  const isWorkspaceReady = snapshot?.status === "active" && !showReadyConfirmation;

  return {
    snapshot,
    statusQuery,
    enableMutation,
    isWorkspaceReady,
    showReadyConfirmation,
    start: enableMutation.mutateAsync,
    retry: enableMutation.mutateAsync,
    refresh: statusQuery.refetch,
    openWorkspace
  };
}
