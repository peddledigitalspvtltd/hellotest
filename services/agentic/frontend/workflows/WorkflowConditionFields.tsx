import { useId, useRef } from "react";
import type { AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";
import "./WorkflowConditionFields.css";

type Comparison = {
  conditionPath?: string;
  conditionOperator?: string;
  conditionValue?: string;
};
const unary = new Set(["exists", "notExists", "isEmpty", "notEmpty", "isTrue", "isFalse"]);
const comparisons = [
  ["equals", "Equals"], ["notEquals", "Does not equal"],
  ["exists", "Exists"], ["notExists", "Does not exist"],
  ["isEmpty", "Is empty"], ["notEmpty", "Is not empty"],
  ["isTrue", "Is true"], ["isFalse", "Is false"],
  ["contains", "Contains"], ["notContains", "Does not contain"],
  ["startsWith", "Starts with"], ["endsWith", "Ends with"],
  ["greater", "Greater than"], ["greaterOrEqual", "Greater than or equal"],
  ["less", "Less than"], ["lessOrEqual", "Less than or equal"],
] as const;
const initial: Comparison = { conditionPath: "input.status", conditionOperator: "equals", conditionValue: '"passed"' };
const validJson = (value: string) => { try { JSON.parse(value); return true; } catch { return false; } };

export function WorkflowConditionFields({ data, onChange, defaultPath = "input.status", routingHint = true }: {
  data: AgenticWorkflowNodeData;
  onChange: (patch: Partial<AgenticWorkflowNodeData>) => void;
  defaultPath?: string;
  routingHint?: boolean;
}) {
  const id = useId();
  const focusTarget = useRef<number | null>(null);
  const initialRow = { ...initial, conditionPath: defaultPath };
  const rows: Comparison[] = Array.isArray(data.conditions) && data.conditions.length
    ? data.conditions.map(value => value && typeof value === "object" && !Array.isArray(value) ? {
      conditionPath: String(value.conditionPath ?? initialRow.conditionPath),
      conditionOperator: String(value.conditionOperator ?? initial.conditionOperator),
      conditionValue: String(value.conditionValue ?? initial.conditionValue),
    } : { ...initialRow }) : [{
      conditionPath: String(data.conditionPath ?? initialRow.conditionPath),
      conditionOperator: String(data.conditionOperator ?? initial.conditionOperator),
      conditionValue: String(data.conditionValue ?? initial.conditionValue),
    }];
  const grouped = rows.length > 1;
  const save = (next: Comparison[]) => onChange(next.length === 1
    ? { ...next[0], conditions: undefined, conditionCombinator: undefined }
    : { conditions: next, conditionCombinator: data.conditionCombinator === "any" ? "any" : "all" });
  const change = (index: number, patch: Comparison) => save(rows.map((row, position) => position === index ? { ...row, ...patch } : row));
  return <div className="workflow-conditions">
    {grouped ? <label>
      <span>Combine conditions</span>
      <select aria-label="Combine conditions" value={data.conditionCombinator === "any" ? "any" : "all"}
        onChange={event => onChange({ conditionCombinator: event.target.value })}>
        <option value="all">All conditions (AND)</option>
        <option value="any">Any condition (OR)</option>
      </select>
    </label> : null}
    {rows.map((row, index) => {
      const suffix = index ? ` ${index + 1}` : "";
      const operator = row.conditionOperator || "equals";
      const value = row.conditionValue ?? "";
      const invalid = !unary.has(operator) && !validJson(value);
      return <div className="workflow-condition" role="group" aria-label={`Condition ${index + 1}`} key={index}>
        {grouped ? <div className="workflow-condition-heading">
          <span>Condition {index + 1}</span>
          <button type="button" aria-label={`Remove condition ${index + 1}`} onClick={() => {
            focusTarget.current = Math.min(index, rows.length - 2);
            save(rows.filter((_, position) => position !== index));
          }}>Remove</button>
        </div> : null}
        <label>
          <span>Value path</span>
          <input aria-label={`Value path${suffix}`} value={row.conditionPath ?? ""} placeholder="input.status" spellCheck={false}
            ref={element => { if (element && focusTarget.current === index) { focusTarget.current = null; element.focus(); } }}
            onChange={event => change(index, { conditionPath: event.target.value })} />
        </label>
        <label>
          <span>Comparison</span>
          <select aria-label={`Comparison${suffix}`} value={operator} onChange={event => change(index, { conditionOperator: event.target.value })}>
            {comparisons.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        {!unary.has(operator) ? <label>
          <span>Compare with JSON</span>
          <input aria-label={`Compare with JSON${suffix}`} value={value} placeholder={'"passed"'} spellCheck={false}
            aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error-${index}` : undefined}
            onChange={event => change(index, { conditionValue: event.target.value })} />
          {invalid ? <small id={`${id}-error-${index}`} className="workflow-condition-error">Enter JSON, such as "passed", 3, or true.</small> : null}
        </label> : null}
      </div>;
    })}
    <button type="button" className="workflow-condition-add" disabled={rows.length >= 20}
      onClick={() => { focusTarget.current = rows.length; save([...rows, { ...initialRow }]); }}>Add condition</button>
    {rows.length >= 20 ? <p className="studio-caption">Maximum 20 conditions.</p> : null}
    {routingHint && <p className="studio-caption">Connect true and false to separate branches. The unselected branch is skipped.</p>}
  </div>;
}
