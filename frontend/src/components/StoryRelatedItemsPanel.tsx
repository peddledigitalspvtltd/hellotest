import { IconBook } from "@tabler/icons-react";
import { TestCaseIcon } from "./AppIcons";
import { RelatedWorkItemsPanel, type RelatedWorkItem } from "./RelatedWorkItemsPanel";
import { richTextToPlainText } from "./RichTextEditor";
import { api } from "../lib/api";
import { asArray, getVerifiedNextPageCursor } from "../lib/collectionGuards";
import type { Requirement, RequirementRelatedItem, TestCase } from "../types";

export function StoryRelatedItemsPanel({ allStories, canUpdate, deliveryEvidenceVisible, items, navigate, onReplace, projectId, selectedStoryId, testCases }: {
  allStories: Requirement[]; canUpdate: boolean; deliveryEvidenceVisible: boolean; items: RequirementRelatedItem[];
  navigate: (to: string) => void; onReplace: (ids: string[]) => Promise<void>; projectId: string; selectedStoryId: string; testCases: TestCase[];
}) {
  const visibleItems = [...new Map(items.filter(item => deliveryEvidenceVisible || item.hellotest_kind === "requirement")
    .map(item => [`${item.hellotest_kind}:${item.id}:${item.relation}`, item])).values()];
  const linkedStoryIds = [...new Set(items.filter(item => item.hellotest_kind === "requirement").map(item => item.id))];
  const routes = { "test-case": "/test-cases?case=", "test-suite": "/design?suite=", "test-run": "/executions?execution=", bug: "/issues?issue=", requirement: "/backlog?requirement=" };
  const rows: RelatedWorkItem[] = visibleItems.map(item => {
    const story = allStories.find(story => story.id === item.id);
    const testCase = item.hellotest_kind === "test-case" ? testCases.find(testCase => testCase.id === item.id || Boolean(item.display_id && testCase.display_id === item.display_id)) : undefined;
    const route = item.hellotest_kind ? routes[item.hellotest_kind] : undefined;
    return {
      id: item.id, key: `${item.hellotest_kind}:${item.id}:${item.relation}`, displayId: item.display_id, title: item.title,
      description: richTextToPlainText(item.description || story?.description || testCase?.description || ""),
      relation: item.relation, status: item.status || testCase?.status, sprint: item.sprint || story?.sprint,
      owner: item.assignee_name || testCase?.assignee_name,
      icon: item.hellotest_kind === "test-case" ? <TestCaseIcon /> : <IconBook />,
      canUnlink: canUpdate && item.hellotest_kind === "requirement",
      onOpen: route ? () => navigate(`${route}${encodeURIComponent(item.id)}`) : undefined
    };
  });
  return <RelatedWorkItemsPanel key={selectedStoryId} ariaLabel="Story related items" items={rows}
    onUnlink={canUpdate ? item => onReplace(linkedStoryIds.filter(id => id !== item.id)) : undefined}
    linking={canUpdate ? {
      scopeKey: `story:${projectId}:${selectedStoryId}`,
      loadCandidates: async ({ search, cursor }) => {
        const page = await api.requirements.listPage({ project_id: projectId, search: search || undefined, page_size: 25, cursor, projection: "summary" });
        return { items: asArray(page.items).filter(story => story.id !== selectedStoryId).map(story => ({
          id: story.id, displayId: story.display_id, title: story.title, description: richTextToPlainText(story.description || ""),
          status: story.status, sprint: story.sprint, relation: "relates to", icon: <IconBook />,
          onOpen: () => navigate(`/backlog?requirement=${encodeURIComponent(story.id)}`)
        })), nextCursor: getVerifiedNextPageCursor(page) || undefined };
      },
      onLink: item => onReplace([...new Set([...linkedStoryIds, item.id])])
    } : undefined} />;
}

