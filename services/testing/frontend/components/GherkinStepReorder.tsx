import { useId, useRef, useState, type DragEvent } from "react";
import { IconGripVertical } from "@tabler/icons-react";
import { canMoveGherkinStep, gherkinDropPosition, moveGherkinStep } from "../lib/gherkinStepReorder";
import "./GherkinStepReorder.css";

export function useGherkinStepReorder<T>(steps: T[], onChange: (steps: T[]) => void) {
  const editorId = useId();
  const dragging = useRef<number | null>(null);
  const [drop, setDrop] = useState<{ row: number; after: boolean } | null>(null);
  const move = (from: number, to: number) => {
    const next = moveGherkinStep(steps, from, to);
    if (next !== steps) onChange(next);
  };
  const reset = () => { dragging.current = null; setDrop(null); };
  const dropTarget = (event: DragEvent<HTMLElement>, row: number) => {
    const from = dragging.current;
    if (from === null) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const after = event.clientY >= bounds.top + bounds.height / 2;
    const to = gherkinDropPosition(from, row, after);
    return canMoveGherkinStep(steps, from, to) ? { from, to, after } : null;
  };
  return {
    move,
    rowProps: (row: number) => ({
      "data-gherkin-drop": drop?.row === row ? drop.after ? "after" : "before" : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const target = dropTarget(event, row);
        if (!target) { setDrop(null); return; }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDrop({ row, after: target.after });
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const target = dropTarget(event, row);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer.getData("application/x-gherkin-step") === editorId) move(target.from, target.to);
        reset();
      }
    }),
    controls: (index: number, label: string) => (
      <span className="gherkin-step-reorder-controls">
        <button
          aria-label={`Drag ${label} to reorder`}
          className="gherkin-step-drag-handle"
          disabled={steps.length < 2}
          draggable={steps.length > 1}
          onDragEnd={reset}
          onDragStart={(event) => {
            dragging.current = index;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-gherkin-step", editorId);
            event.stopPropagation();
          }}
          title="Drag to any position, or use Move to position"
          type="button"
        ><IconGripVertical size={14} /></button>
        <select
          aria-label={`Move ${label} to position`}
          className="gherkin-step-position-select"
          disabled={steps.length < 2}
          onChange={(event) => move(index, Number(event.target.value))}
          title={`Step ${index + 1} — choose a new position`}
          value={index}
        >
          {steps.map((_, position) => <option disabled={!canMoveGherkinStep(steps, index, position)} key={position} value={position}>{position + 1}</option>)}
        </select>
      </span>
    )
  };
}
