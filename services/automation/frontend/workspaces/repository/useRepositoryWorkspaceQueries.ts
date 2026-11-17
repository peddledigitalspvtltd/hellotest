import { automationQueryKeys } from "../../lib/automationQueryKeys";
import { collectRepositoryPages } from "../../lib/repositoryEntries";
import { useQuery } from "@tanstack/react-query";
import { useRepositoryInspectAgent } from "@hellotest/automation/frontend/hooks/useRepositoryInspectAgent";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import {REPOSITORY_PAGE_SIZE} from '../../lib/automationWorkspaceSupport';
import type {SessionPayload} from '@hellotest/platform/frontend/src/types';
export function useRepositoryWorkspaceQueries({projectId,appTypeId,session,canInspectRepository,canViewObjectRepository}:{projectId:string;appTypeId:string;session:SessionPayload|null;canInspectRepository:boolean;canViewObjectRepository:boolean}){
const inspectAgent = useRepositoryInspectAgent(Boolean(session) && canInspectRepository, projectId);
const inspectCapabilities = useQuery({
    queryKey: ["repository-inspection-capabilities", projectId],
    queryFn: ({ signal }) => api.repositoryInspection.capabilities(projectId, { signal }),
    enabled: Boolean(session && projectId) && canInspectRepository,
    staleTime: 30000,
    retry: false
});
const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: ({ signal }) => api.appTypes.list({ project_id: projectId }, { signal }),
    enabled: Boolean(projectId && session)
});
const learningCacheQuery = useQuery({
    queryKey: automationQueryKeys.repository(projectId, appTypeId),
    queryFn: async ({ signal }) => {
        const queryScope = appTypeId
            ? { app_type_id: appTypeId }
            : { project_id: projectId || undefined };
        return collectRepositoryPages<AutomationLearningCacheEntry>(page => api.testCases.learningCache({ ...queryScope, ...page }, { signal }), { signal, pageSize: REPOSITORY_PAGE_SIZE });
    },
    enabled: Boolean((projectId || appTypeId) && session && canViewObjectRepository)
});
const appTypes = asArray(appTypesQuery.data);
const learningCache = canViewObjectRepository&&!learningCacheQuery.isError?asArray(learningCacheQuery.data):[];
return {appTypesQuery,learningCacheQuery,inspectAgent,inspectCapabilities,appTypes,learningCache};
}
export type RepositoryWorkspaceQueries=ReturnType<typeof useRepositoryWorkspaceQueries>;
