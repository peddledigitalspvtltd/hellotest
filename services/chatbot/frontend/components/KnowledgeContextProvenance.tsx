import type { KnowledgeAssistantMessage } from "@hellotest/platform/frontend/src/types";
import { knowledgeContextProvenance } from "../lib/knowledgeAnswer";

export function KnowledgeContextProvenance({ message }: { message: KnowledgeAssistantMessage }) {
  const context = knowledgeContextProvenance(message);
  if (!context) return null;
  return <section className="knowledge-context-provenance" aria-label="Context for this answer">
    <strong>Context for this answer</strong>
    <dl>
      <div><dt>Evidence plan</dt><dd>{context.planning}</dd></div>
      <div><dt>Retrieval</dt><dd>{context.transport}</dd></div>
      {context.requestedStrategy ? <div><dt>Planned retrieval</dt><dd>{context.requestedStrategy}</dd></div> : null}
      {context.appliedStrategy ? <div><dt>Observed retrieval</dt><dd>{context.appliedStrategy}</dd></div> : null}
      <div><dt>Retrieved evidence</dt><dd>{context.evidenceCount} item{context.evidenceCount === 1 ? "" : "s"} · {context.sourceCount} source{context.sourceCount === 1 ? "" : "s"}{context.versionCount ? ` · ${context.versionCount} document version${context.versionCount === 1 ? "" : "s"}` : ""}{context.liveCount ? ` · ${context.liveCount} live snapshot${context.liveCount === 1 ? "" : "s"}` : ""}</dd></div>
      <div><dt>Knowledge relationships</dt><dd>{context.relationshipCount} witnessed link{context.relationshipCount === 1 ? "" : "s"} in this context</dd></div>
      <div><dt>Task history</dt><dd>{context.memory}{context.outcomeRecorded ? " · response outcome recorded" : ""}</dd></div>
    </dl>
    {context.contextHref ? <a href={context.contextHref}>Open this task’s Context Graph</a> : null}
    <small>This records retrieved evidence and task events. It does not verify what reached the model or whether a proposed action ran.</small>
  </section>;
}
