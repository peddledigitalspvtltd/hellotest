import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./EvidenceFlipCard.css";

type EvidenceFlipCardProps = {
  actionDisabled?: boolean;
  actionLabel?: string;
  autoResetMs?: number;
  caption: string;
  className?: string;
  evidence: ReactNode[];
  frontAccessory?: ReactNode;
  frontIcon?: ReactNode;
  frontVisual?: ReactNode;
  label: string;
  maxEvidenceItems?: number;
  onAction?: () => void;
  resetOnChange?: boolean;
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
  actionDisabled = false,
  actionLabel,
  autoResetMs = 10_000,
  caption,
  className,
  evidence,
  frontAccessory,
  frontIcon,
  frontVisual,
  label,
  maxEvidenceItems = 4,
  onAction,
  resetOnChange = true,
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

  useEffect(() => {
    if (!isFlipped || autoResetMs <= 0) return;
    const timer = window.setTimeout(() => {
      shouldRestoreFocusRef.current = false;
      setIsFlipped(false);
    }, autoResetMs);
    return () => window.clearTimeout(timer);
  }, [autoResetMs, isFlipped]);

  useEffect(() => {
    if (!resetOnChange) return;
    shouldRestoreFocusRef.current = false;
    setIsFlipped(false);
  }, [caption, label, resetOnChange, value]);

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
        tone ? `tone-${tone}` : "",
        isFlipped ? "is-flipped" : "",
        className
      ].filter(Boolean).join(" ")}
    >
      <div className="evidence-flip-card-inner">
        <div aria-hidden={isFlipped} className="evidence-flip-card-face evidence-flip-card-front">
          {frontAccessory && !isFlipped ? <span className="evidence-flip-card-front-accessory">{frontAccessory}</span> : null}
          <button
            aria-controls={evidenceId}
            aria-describedby={`${evidenceId}-value ${evidenceId}-caption`}
            aria-expanded={isFlipped}
            aria-label={`View evidence for ${label}`}
            className="project-stat-card-trigger metric-evidence-trigger"
            onClick={() => showFace(true)}
            ref={frontButtonRef}
            tabIndex={isFlipped ? -1 : 0}
            type="button"
          >
            {frontIcon ? <span className="evidence-flip-card-front-icon" aria-hidden="true">{frontIcon}</span> : null}
            <span>{label}</span>
            <strong id={`${evidenceId}-value`}>{value}</strong>
            {frontVisual ? <span aria-hidden="true" className="evidence-flip-card-front-visual">{frontVisual}</span> : null}
            <small id={`${evidenceId}-caption`}>{caption}</small>
            <span className="metric-evidence-hint">View evidence</span>
          </button>
        </div>

        <div
          aria-hidden={!isFlipped}
          className="evidence-flip-card-face evidence-flip-card-back"
          id={evidenceId}
        >
          <button
            aria-label={`Back to ${label} metric`}
            className="evidence-flip-card-back-button"
            onClick={() => showFace(false)}
            ref={backButtonRef}
            tabIndex={isFlipped ? 0 : -1}
            title="Back to metric"
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15">
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>Back</span>
          </button>
          <div className="evidence-flip-card-back-heading">
            <span>{label}</span>
            <strong>Evidence</strong>
          </div>
          <ul aria-label={`${label} evidence`} className="project-stat-evidence">
            {evidence.slice(0, maxEvidenceItems).map((item, index) => <li key={`${label}-evidence-${index}`}>{item}</li>)}
            {evidence.length > maxEvidenceItems ? <li>{evidence.length - maxEvidenceItems} more evidence signal{evidence.length - maxEvidenceItems === 1 ? "" : "s"}</li> : null}
          </ul>
          {onAction ? (
            <button
              className="evidence-flip-card-action-button"
              disabled={actionDisabled}
              onClick={onAction}
              tabIndex={isFlipped ? 0 : -1}
              type="button"
            >
              {actionLabel || "Open details"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
