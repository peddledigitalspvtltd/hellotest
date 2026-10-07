import { useRef, useState, type ReactNode } from "react";
import { IconArrowUpRight, IconChevronDown, IconDatabase, IconSparkles } from "@tabler/icons-react";
import { manualContextInstructions, updateManualContextInstructions } from "../lib/aiDesignStudio";
import "./AgenticAuthoringCanvas.css";

export type AiContextChip = { id: string; label: string; count?: number; onClick?: () => void };

/** Intent remains separate from the reviewed evidence packs sent to the model. */
export function AiIntentCanvas({
  value, onChange, onSubmit, disabled = false, submitDisabled = false, hasOutput = false,
  title = "What should we cover?", label = "Additional instructions", placeholder = "Describe the outcome, constraints, and what matters most.",
  chips = [], options, suggestions = []
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  submitDisabled?: boolean;
  hasOutput?: boolean;
  title?: string;
  label?: string;
  placeholder?: string;
  chips?: AiContextChip[];
  options?: ReactNode;
  suggestions?: Array<{ label: string; instruction: string }>;
}) {
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const instructions = manualContextInstructions(value);
  const update = (next: string) => {
    try { onChange(updateManualContextInstructions(value, next)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Shorten your instructions."); }
  };
  const content = <>
    <textarea aria-invalid={Boolean(error) || undefined} aria-label={label} disabled={disabled}
      onChange={event => update(event.target.value)} onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          if (!disabled && !submitDisabled) onSubmit();
        }
      }} placeholder={placeholder} ref={input} rows={hasOutput ? 3 : 4} value={instructions} />
    {error ? <p className="ai-intent-canvas__error" role="alert">{error}</p> : null}
    {!hasOutput && suggestions.length ? <div className="ai-intent-canvas__starters" aria-label="Suggested instructions">
      {suggestions.map(suggestion => <button disabled={disabled} key={suggestion.label} onClick={() => {
        update([instructions.trim(), suggestion.instruction].filter(Boolean).join("\n")); input.current?.focus();
      }} type="button">{suggestion.label}<IconArrowUpRight size={13} aria-hidden="true" /></button>)}
    </div> : null}
  </>;
  return <section className={`ai-intent-canvas${hasOutput ? " is-compact" : ""}`} aria-label="Agent instructions">
    {hasOutput ? <details>
      <summary><span><IconSparkles size={15} aria-hidden="true" />Run brief</span><strong>{instructions.trim() || "Use the attached context"}</strong><IconChevronDown size={15} aria-hidden="true" /></summary>
      {content}
    </details> : <><header><span><IconSparkles size={16} aria-hidden="true" />Make a proposal</span><h2>{title}</h2></header>{content}</>}
    <div className="ai-intent-canvas__context">
      <div className="ai-intent-canvas__chips" aria-label="Attached context">
        {chips.map(chip => chip.onClick ? <button className="ai-context-chip" disabled={disabled} key={chip.id} onClick={chip.onClick} type="button"><IconDatabase size={14} aria-hidden="true" /><span>{chip.label}</span>{typeof chip.count === "number" ? <small>{chip.count}</small> : null}</button>
          : <span className="ai-context-chip" key={chip.id}><IconDatabase size={14} aria-hidden="true" /><span>{chip.label}</span>{typeof chip.count === "number" ? <small>{chip.count}</small> : null}</span>)}
      </div>
      {options ? <div className="ai-intent-canvas__options">{options}</div> : null}
    </div>
  </section>;
}
