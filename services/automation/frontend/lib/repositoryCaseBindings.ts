import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import { collectRepositoryStepReferences, collectRouteScopedLocatorKeys, isRepositoryMemberUsed } from "./repositoryLocators";
import { getObjectRole, getRepositoryHtmlTag, getRepositoryMemberName, getRepositoryScreenKey, getRepositoryScreenUrl, getScreenName, isNonElementRepositoryEntry } from "./repositoryEntryPresentation";

export type RepositoryCaseStep = { id: string; automation_code?: string | null; automation_source_sha256?: string | null; automation_context_sha256?: string | null; objectRefs: string[] };
export type RepositoryBindingMember = { entry: AutomationLearningCacheEntry; pageName: string; memberName: string; htmlTag: string; role: string; ref: string };
export type RepositoryBindingPage = { screenName: string; pageName: string; appTypeId: string; url: string; members: RepositoryBindingMember[] };

/** Derive case bindings from current instructions, never capture ownership.
 * Route ambiguity and witnessed source/context digests use the same policy as
 * playback authoring. Callers clear those digests when a draft changes. */
export function collectCaseRepositoryPages({ entries, steps, values = {}, caseId }: {
  entries: AutomationLearningCacheEntry[]; steps: RepositoryCaseStep[]; values?: Record<string, string>; caseId: string;
}): { pages: RepositoryBindingPage[]; members: RepositoryBindingMember[] } {
  const grouped = new Map<string, AutomationLearningCacheEntry[]>();
  for (const entry of entries) {
    const key = getRepositoryScreenKey(entry);
    const group = grouped.get(key) || [];
    group.push(entry); grouped.set(key, group);
  }
  const pages: RepositoryBindingPage[] = Array.from(grouped.entries()).sort(([, left], [, right]) => getScreenName(left[0]).localeCompare(getScreenName(right[0]))).map(([screenName, rows]) => {
    const pageName = getScreenName(rows[0]);
    return { screenName, pageName, appTypeId: rows.find(entry => entry.app_type_id)?.app_type_id || "", url: getRepositoryScreenUrl(rows), members: rows.filter(entry => !isNonElementRepositoryEntry(entry)).map(entry => ({ entry, pageName, memberName: getRepositoryMemberName(entry), htmlTag: getRepositoryHtmlTag(entry), role: getObjectRole(entry), ref: `${pageName}.${getRepositoryMemberName(entry)}` })) };
  });
  const allMembers = pages.flatMap(page => page.members), references = collectRepositoryStepReferences(steps, values);
  const canonicalReferences = new Set(allMembers.map(member => member.ref)), routeScopedLocatorKeys = collectRouteScopedLocatorKeys(allMembers);
  const members = allMembers.filter(member => isRepositoryMemberUsed(member, caseId, steps, { includeCaseOwned: false, references, canonicalReferences, routeScopedLocatorKeys }));
  const used = new Set(members.map(member => member.entry.id));
  return { pages: pages.map(page => ({ ...page, members: page.members.filter(member => used.has(member.entry.id)) })).filter(page => page.members.length), members };
}
