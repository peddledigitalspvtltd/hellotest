import { useMemo } from "react";
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import {getRepositoryScreenKey,isScreenRepositoryRecord,getScreenName,isNonElementRepositoryEntry,getRepositoryMemberName,splitRepositoryRole,getRepositoryHtmlTag,getObjectRole,getRepositoryScreenUrl} from '../../lib/automationWorkspaceSupport';
import type {RepositoryWorkspaceScope} from './repositoryWorkspaceTypes';
import type {RepositoryWorkspaceState} from './useRepositoryWorkspaceState';
import type {RepositoryWorkspaceQueries} from './useRepositoryWorkspaceQueries';
import {collectCaseRepositoryPages} from '../../lib/repositoryCaseBindings';
export function useRepositoryWorkspaceModel({projectId,appTypeId,caseBindings}:RepositoryWorkspaceScope,state:RepositoryWorkspaceState,queries:RepositoryWorkspaceQueries){
const {
    selectedRepositoryId,
    selectedScreenName,
    repositoryDraft,
} = state;const {
    learningCache,
} = queries;
const usedBindings = useMemo(()=>caseBindings?collectCaseRepositoryPages({entries:learningCache,steps:caseBindings.sourceAccess?caseBindings.steps:caseBindings.steps.map(step=>({id:step.id,objectRefs:step.objectRefs})),values:caseBindings.parameterValues,caseId:caseBindings.caseId}):null,[learningCache,caseBindings]);
const groupedRepository = useMemo(() => {
    const grouped = new Map<string, AutomationLearningCacheEntry[]>();
    learningCache.filter(entry=>!usedBindings||usedBindings.pages.some(page=>page.screenName===getRepositoryScreenKey(entry))&&(isScreenRepositoryRecord(entry)||usedBindings.members.some(member=>member.entry.id===entry.id))).forEach((entry) => {
        const screenKey = getRepositoryScreenKey(entry);
        grouped.set(screenKey, [...(grouped.get(screenKey) || []), entry]);
    });
    return Array.from(grouped.entries()).sort(([, leftEntries], [, rightEntries]) => getScreenName(leftEntries[0]).localeCompare(getScreenName(rightEntries[0])));
}, [learningCache,usedBindings]);
const activeScreenEntries = useMemo(() => {
    const selected = groupedRepository.find(([screenKey]) => screenKey === selectedScreenName);
    return selected?.[1] || groupedRepository[0]?.[1] || [];
}, [groupedRepository, selectedScreenName]);
const activeScreenKey = groupedRepository.find(([screenKey]) => screenKey === selectedScreenName)?.[0] || groupedRepository[0]?.[0] || "";
const activeScreenName = activeScreenEntries.length ? getScreenName(activeScreenEntries[0]) : "";
const activeScreenRecord = activeScreenEntries.find(isScreenRepositoryRecord) || activeScreenEntries[0] || null;
const selectedRepositoryEntry = activeScreenEntries.find((entry) => entry.id === selectedRepositoryId && !isNonElementRepositoryEntry(entry))
    || activeScreenEntries.find((entry) => !isNonElementRepositoryEntry(entry))
    || null;
const activeRepositoryAppTypeId = activeScreenRecord?.app_type_id
    || selectedRepositoryEntry?.app_type_id
    || activeScreenEntries.find((entry) => entry.app_type_id)?.app_type_id
    || appTypeId
    || "";
const activeRepositoryProjectId = activeScreenRecord?.project_id
    || selectedRepositoryEntry?.project_id
    || activeScreenEntries.find((entry) => entry.project_id)?.project_id
    || projectId
    || "";
const allPageObjectModels = useMemo(() => {
    return groupedRepository.map(([screenKey, entries]) => {
        const screenName = getScreenName(entries[0]);
        const screenAppTypeId = entries.find((entry) => entry.app_type_id)?.app_type_id || "";
        const members = entries.filter((entry) => !isNonElementRepositoryEntry(entry)).map((entry) => ({
            entry,
            pageName: screenName,
            memberName: entry.id === selectedRepositoryId && repositoryDraft.object_name.trim() ? repositoryDraft.object_name.trim() : getRepositoryMemberName(entry),
            htmlTag: entry.id === selectedRepositoryId && repositoryDraft.object_role.trim() ? splitRepositoryRole(repositoryDraft.object_role, getRepositoryHtmlTag(entry), getObjectRole(entry)).tag : getRepositoryHtmlTag(entry),
            role: entry.id === selectedRepositoryId && repositoryDraft.object_role.trim() ? splitRepositoryRole(repositoryDraft.object_role, getRepositoryHtmlTag(entry), getObjectRole(entry)).role : getObjectRole(entry),
            ref: `${screenName}.${entry.id === selectedRepositoryId && repositoryDraft.object_name.trim() ? repositoryDraft.object_name.trim() : getRepositoryMemberName(entry)}`
        }));
        return {
            screenName: screenKey,
            pageName: screenName,
            appTypeId: screenAppTypeId,
            url: getRepositoryScreenUrl(entries),
            members
        };
    });
}, [groupedRepository, repositoryDraft.object_name, repositoryDraft.object_role, selectedRepositoryId]);
const pageObjectModels=usedBindings?usedBindings.pages:allPageObjectModels;
const activePageObject = pageObjectModels.find((page) => page.screenName === selectedScreenName) || pageObjectModels[0] || null;
const allObjectMembers = useMemo(() => pageObjectModels.flatMap((page) => page.members), [pageObjectModels]);

return {usedBindings,groupedRepository,activeScreenEntries,activeScreenKey,activeScreenName,activeScreenRecord,selectedRepositoryEntry,activeRepositoryAppTypeId,activeRepositoryProjectId,allPageObjectModels,pageObjectModels,activePageObject,allObjectMembers};
}
export type RepositoryWorkspaceModel=ReturnType<typeof useRepositoryWorkspaceModel>;
