import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { automationApi } from "../api.client";
import type { useRepositoryInspectAgent } from "./useRepositoryInspectAgent";

export function useAutomationBrowserPreflight({ enabled, projectId, caseId, startUrl, environmentId, configurationId, dataSetId, suiteId, integrationId, location, localAgent }: {
  enabled: boolean;
  projectId: string;
  caseId: string;
  startUrl: string;
  environmentId: string;
  configurationId: string;
  dataSetId: string;
  suiteId?: string;
  integrationId?: string;
  location: "remote" | "local";
  localAgent: ReturnType<typeof useRepositoryInspectAgent>;
}) {
  const [settledUrl, setSettledUrl] = useState(startUrl);
  useEffect(() => {
    const delay = setTimeout(() => setSettledUrl(startUrl), 400);
    return () => clearTimeout(delay);
  }, [startUrl]);
  const sameUrl = startUrl === settledUrl;
  const checkLocal = localAgent.check;
  useEffect(() => {
    if (enabled && location === "local") void checkLocal();
  }, [enabled, location, checkLocal]);
  const remote = useQuery({
    queryKey: ["automation-browser-preflight", projectId, caseId, settledUrl, environmentId, configurationId, dataSetId, suiteId, integrationId],
    queryFn: ({ signal }) => automationApi.browserPreflight({
      case_id: caseId, start_url: settledUrl,
      test_environment_id: environmentId || undefined, test_configuration_id: configurationId || undefined,
      test_data_set_id: dataSetId || undefined, test_suite_id: suiteId || undefined, integration_id: integrationId || undefined
    }, signal),
    enabled: enabled && sameUrl && location === "remote",
    retry: false, staleTime: 30_000, refetchOnWindowFocus: false
  });
  if (!enabled) return { checking: false, message: "", error: "", environment: undefined, recheck: undefined };
  if (location === "local") {
    const checking = ["unchecked", "checking"].includes(localAgent.state);
    return {
      checking,
      message: checking ? "Checking the paired browser…" : localAgent.agent?.agentId ? "Paired browser is connected. The build checks the Start URL on this computer." : "",
      error: !checking && !localAgent.agent?.agentId ? localAgent.message : "",
      environment: undefined, recheck: localAgent.openSetup
    };
  }
  const checking = !sameUrl || remote.isFetching;
  return {
    checking,
    message: checking ? "Checking the build browser and Start URL…" : remote.data ? "Start URL is reachable from the build browser." : "",
    error: !checking && remote.error instanceof Error ? remote.error.message : "",
    environment: remote.data?.environment,
    recheck: () => { void remote.refetch(); }
  };
}
