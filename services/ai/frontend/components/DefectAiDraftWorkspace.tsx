import { useAiOutputSizing } from "../lib/useAiOutputSizing";
import type { ReactNode } from "react";
import { SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";

export function DefectAiDraftWorkspace({ hasDraft, children, emptyAction, statusContent }: {
  hasDraft: boolean;
  children?: ReactNode;
  emptyAction?: ReactNode;
  statusContent?: ReactNode;
}) {
  const outputRef = useAiOutputSizing<HTMLDivElement>(children, "textarea");
  if (hasDraft) return <div className="story-studio-inspector defect-studio-inspector" ref={outputRef}>{statusContent}{children}</div>;
  return <div className="story-studio-inspector-empty">
    {statusContent}<SparkIcon /><h2>Your Defect draft will appear here</h2>
    <p>Describe the failure, add supporting evidence, and generate a draft for review.</p>
    {emptyAction}
  </div>;
}
