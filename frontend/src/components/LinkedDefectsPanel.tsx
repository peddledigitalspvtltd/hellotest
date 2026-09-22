import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { BugIcon } from "./AppIcons";
import { RelatedWorkItemsPanel, type RelatedWorkItem } from "./RelatedWorkItemsPanel";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { optionalQueryView } from "../lib/optionalQueryView";
import { asArray, getVerifiedNextPageCursor } from "../lib/collectionGuards";
import { richTextToPlainText } from "./RichTextEditor";
import type { RequirementDefectLink, TestCaseDefectLink } from "../types";

type DefectLink = RequirementDefectLink | TestCaseDefectLink;
const EMPTY_DEFECTS: DefectLink[] = [];

export function LinkedDefectsPanel({ canUpdate: allowUpdate, initialDefects = EMPTY_DEFECTS, itemId, onSaved, projectId, subject }: {
  canUpdate: boolean; initialDefects?: DefectLink[]; itemId: string;
  onSaved?: (defectIds: string[]) => void; projectId: string; subject: "requirement" | "test-case";
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = useCapabilityAccess(projectId);
  const canView = can("feedback.view");
  const canUpdate = allowUpdate && canView && can("feedback.manage") && can(subject === "test-case" ? "testcase.update" : "requirement.update");
  const activeScope = useRef<string | null>(null);
  const scope = `${projectId}:${subject}:${itemId}`;
  useEffect(() => { activeScope.current = scope; return () => { activeScope.current = null; }; }, [scope]);
  const linkedDefectsQuery = optionalQueryView(useQuery({
    queryKey: ["linked-defects", subject, itemId],
    queryFn: () => subject === "test-case" ? api.testCaseDefects.listIssues(itemId) : Promise.resolve(initialDefects),
    enabled: canView && Boolean(itemId), staleTime: 30_000
  }), canView);
  const replaceLinks = useMutation({
    mutationFn: (issueIds: string[]) => subject === "requirement" ? api.requirementDefects.replace(itemId, issueIds) : api.testCaseDefects.replace(itemId, issueIds)
  });
  const linkedDefects = linkedDefectsQuery.data || initialDefects;
  const saveLinks = async (nextIds: string[], added?: RelatedWorkItem) => {
    if (!canUpdate) return;
    await replaceLinks.mutateAsync(nextIds);
    const byId = new Map([...initialDefects, ...linkedDefects].map(item => [item.id, item]));
    if (added) byId.set(added.id, { id: added.id, title: added.title, status: added.status || null, link_source: "manual" });
    const nextDefects = nextIds.map(id => byId.get(id)).filter((item): item is DefectLink => Boolean(item));
    queryClient.setQueryData(["linked-defects", subject, itemId], nextDefects);
    if (activeScope.current === scope) onSaved?.(nextIds);
    await Promise.all([
      ...(subject === "test-case" ? [queryClient.invalidateQueries({ queryKey: ["linked-defects", subject, itemId] })] : []),
      queryClient.invalidateQueries({ queryKey: [subject === "requirement" ? "requirements" : "global-test-cases"] }),
      ...(subject === "requirement" ? [
        queryClient.invalidateQueries({ queryKey: ["requirement-detail", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["requirement-route-detail", projectId] })
      ] : [])
    ]);
  };
  if (!canView) return <p className="muted">Defect links are unavailable. Existing links are retained.</p>;
  return <div className="linked-defects-panel"><RelatedWorkItemsPanel key={scope} ariaLabel="Linked defects" title="Linked defects" eyebrow="Quality" description="Track quality findings and preserve the evidence path from failure to resolution."
    items={linkedDefects.map(defect => ({ id: defect.id, title: defect.title, relation: defect.link_source === "automatic" ? "linked from failed run" : "relates to", status: defect.status, icon: <BugIcon />, canUnlink: canUpdate, onOpen: () => navigate(`/issues?issue=${encodeURIComponent(defect.id)}`) }))}
    isLoading={linkedDefectsQuery.isLoading}
    notice={linkedDefectsQuery.isError ? <p className="related-work-error" role="alert">Defect links could not be loaded. <button type="button" onClick={() => void linkedDefectsQuery.refetch()}>Retry</button></p> : null}
    linking={canUpdate && !linkedDefectsQuery.isError ? {
      scopeKey: `defects:${scope}`,
      loadCandidates: async ({ search, cursor }) => {
        const page = await api.issues.listPage({ project_id: projectId, q: search || undefined, cursor, page_size: 25, projection: "summary" });
        return { items: asArray(page.items).map(defect => ({ id: defect.id, displayId: defect.display_id, title: defect.title, description: richTextToPlainText(defect.message || ""), relation: "relates to", status: defect.status, icon: <BugIcon />, onOpen: () => navigate(`/issues?issue=${encodeURIComponent(defect.id)}`) })), nextCursor: getVerifiedNextPageCursor(page) || undefined };
      },
      onLink: defect => saveLinks([...new Set([...linkedDefects.map(item => item.id), defect.id])], defect)
    } : undefined}
    onUnlink={canUpdate && !linkedDefectsQuery.isError ? defect => saveLinks(linkedDefects.map(item => item.id).filter(id => id !== defect.id)) : undefined}
  /></div>;
}
