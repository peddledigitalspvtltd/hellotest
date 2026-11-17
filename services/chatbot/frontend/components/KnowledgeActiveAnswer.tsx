import { memo } from "react";
import type { KnowledgeCitation } from "@hellotest/platform/frontend/src/types";
import { FormattedText as KnowledgeFormattedText } from "@hellotest/platform/frontend/src/shared/components/FormattedText";
import { knowledgeCitationHref } from "@hellotest/platform/frontend/src/shared/lib/knowledgeCitation";

export type KnowledgeActiveAnswerDelivery = {
  answerId: string;
  text: string;
  citations: KnowledgeCitation[];
  sectionIndex: number;
  sectionCount: number;
};

export const KnowledgeActiveAnswer = memo(function KnowledgeActiveAnswer({ delivery }: { delivery: KnowledgeActiveAnswerDelivery }) {
  return <article aria-label="Answer delivery" className="grounded-assistant-message grounded-assistant-active-answer" data-answer-id={delivery.answerId}>
    <div className="grounded-assistant-message-label"><strong>HelloTest</strong><span className="grounded-assistant-answer-delivery-status" role="status" aria-live="polite">Delivering checked sections · {Math.min(delivery.sectionIndex + 1, delivery.sectionCount)} of {delivery.sectionCount}</span></div>
    {delivery.citations.length ? <div className="grounded-assistant-active-evidence" aria-label="Evidence for this answer">
      <strong>Evidence cards</strong>
      <ul>{delivery.citations.map((citation, index) => {
        const href = knowledgeCitationHref(citation);
        const title = citation.title || citation.label || "Project source";
        return <li key={`${citation.id}-${index}`}>{href ? <a href={href} rel="noreferrer" target={href.startsWith("/") ? undefined : "_blank"}>{title}</a> : <span>{title}</span>}</li>;
      })}</ul>
    </div> : null}
    <div className="grounded-assistant-message-content"><KnowledgeFormattedText className="grounded-assistant-structured-answer" text={delivery.text} /></div>
    <small className="grounded-assistant-active-answer-note">Each delivered section comes from the saved answer contract and its checked citations.</small>
  </article>;
});
