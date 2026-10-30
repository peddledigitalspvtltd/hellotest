import type {AgenticWorkflowRun} from "@hellotest/platform/frontend/src/types";
import {useCapabilityAccess} from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import {savedSprintCaseIds, sprintReviewLinks} from "./sprintDraftResults";

export function WorkflowLibraryReviewActions({run, nodeId, accepted = {}}: {run: AgenticWorkflowRun; nodeId?: string; accepted?: Record<string, string>}) {
  const {can} = useCapabilityAccess(run.project_id);
  const ids = savedSprintCaseIds(run, accepted, nodeId);
  const links = sprintReviewLinks(run, ids);
  if (!can("testcase.view") || !links.length) return null;
  return <div className="studio-toolbar" aria-label="Review saved workflow Test Cases">
    <span>{ids.length} saved Test Case{ids.length === 1 ? "" : "s"} · Pending review</span>
    {links.map((link, index) => <a className="ghost-button" key={link.href} href={link.href}>{links.length === 1 ? "Review generated Test Cases" : `Review batch ${index + 1} · ${link.count} cases`}</a>)}
  </div>;
}
