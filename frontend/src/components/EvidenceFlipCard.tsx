import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./EvidenceFlipCard.css";

type EvidenceFlipCardProps = {
  caption: string;
  className?: string;
  evidence: string[];
  frontAccessory?: ReactNode;
  label: string;
  tone?: "danger" | "warning" | "success" | "info";
  value: ReactNode;
};

/**
 * A compact, two-sided evidence surface for inline metric cards.
 *
 * Modal evidence viewers deliberately use their own interaction pattern. This
 * component is for cards that would otherwise grow the surrounding layout when
 * their evidence is revealed.
 */
export function EvidenceFlipCard({
  caption,
  className,
  evidence,
  frontAccessory,
  label,
  tone,
  value
}: EvidenceFlipCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const frontButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const evidenceId = useId();

  useEffect(() => {
    if (!shouldRestoreFocusRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      (isFlipped ? backButtonRef.current : frontButtonRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isFlipped]);

  const showFace = (nextFlippedState: boolean) => {
    shouldRestoreFocusRef.current = true;
    setIsFlipped(nextFlippedState);
  };

  return (
    <article
      className={[
        "evidence-flip-card",
        "project-stat-card",
        "metric-ribbon-card",
        tone,
        isFlipped ? "is-flipped" : "",
        className
      ].filter(Boolean).join(" ")}
    >
      <div className="evidence-flip-card-inner">
        <div aria-hidden={isFlipped} className="evidence-flip-card-face evidence-flip-card-front">
          {frontAccessory && !isFlipped ? <span className="evidence-flip-card-front-accessory">{frontAccessory}</span> : null}
          <button
            aria-controls={evidenceId}
            aria-expanded={isFlipped}
            aria-label={`View evidence for ${label}`}
            className="project-stat-card-trigger metric-evidence-trigger"
            onClick={() => showFace(true)}
            ref={frontButtonRef}
            tabIndex={isFlipped ? -1 : 0}
            type="button"
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{caption}</small>
            <span className="metric-evidence-hint">View evidence</span>
          </button>
        </div>

        <div
          aria-hidden={!isFlipped}
          className="evidence-flip-card-face evidence-flip-card-back"
          id={evidenceId}
        >
          <div className="evidence-flip-card-back-heading">
            <span>{label}</span>
            <strong>Evidence</strong>
          </div>
          <ul aria-label={`${label} evidence`} className="project-stat-evidence">
            {evidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <button
            aria-label={`Back to ${label} metric`}
            className="evidence-flip-card-back-button"
            onClick={() => showFace(false)}
            ref={backButtonRef}
            tabIndex={isFlipped ? 0 : -1}
            type="button"
          >
            Back to metric
          </button>
        </div>
      </div>
    </article>
  );
}
