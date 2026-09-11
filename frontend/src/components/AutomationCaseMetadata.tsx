import { useId, useState } from "react";
import { useDomainOptions } from "../hooks/useDomainOptions";
import { AddIcon, TrashIcon } from "./AppIcons";
import { RichTextEditor } from "./RichTextEditor";
import { GherkinStepTextField } from "./GherkinStepTextField";
import { StepParameterizedText } from "./StepParameterizedText";
import type { TestStepType } from "../types";
import type { StepParameterDefinition } from "../lib/stepParameters";
import "./AutomationAuthoring.css";

export type AutomationMetadata = {
  title: string; description: string; status: string; priority: string;
  manualCaseIds: string[]; requirementIds: string[]; moduleIds: string[]; suiteIds: string[]; dataSetId: string;
};
export const emptyAutomationMetadata: AutomationMetadata = {
  title: "", description: "", status: "active", priority: "3", manualCaseIds: [], requirementIds: [], moduleIds: [], suiteIds: [], dataSetId: ""
};
type LinkOption = { id: string; title: string; detail?: string };

function RecordLinks({ label, options, value, onChange, disabled }: { label: string; options: LinkOption[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const selected = options.filter((option) => value.includes(option.id));
  const visible = options.filter((option) => `${option.title} ${option.detail || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <details className="automation-record-links">
    <summary><strong>{label}</strong><span>{value.length ? `${value.length} linked` : "Link records"}</span></summary>
    {selected.length ? <div className="automation-selected-links">{selected.map((item) => <span key={item.id}>{item.title}</span>)}</div> : null}
    <div className="automation-record-picker">
      <input aria-label={`Search ${label.toLowerCase()}`} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} value={search} />
      <div className="automation-record-options">
        {visible.map((option) => <label key={option.id}><input checked={value.includes(option.id)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))} type="checkbox" /><span><strong>{option.title}</strong>{option.detail ? <small>{option.detail}</small> : null}</span></label>)}
        {!visible.length ? <p className="muted">{options.length ? "No matching records." : `No ${label.toLowerCase()} available.`}</p> : null}
      </div>
    </div>
  </details>;
}

export function AutomationCaseMetadata({ value, onChange, manualCases, requirements, modules, suites, dataSets, disabled = false }: {
  value: AutomationMetadata; onChange: (change: Partial<AutomationMetadata>) => void;
  manualCases: LinkOption[]; requirements: LinkOption[]; modules: LinkOption[]; suites: LinkOption[]; dataSets: LinkOption[]; disabled?: boolean;
}) {
  const id = useId();
  const statuses = useDomainOptions("test_cases.statuses", ["active", "draft", "ready", "retired"].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })), [value.status]);
  return <div className="automation-metadata-form">
    <div className="automation-metadata-primary">
      <label className="form-field"><span>Automation case name</span><input autoComplete="off" disabled={disabled} onChange={(event) => onChange({ title: event.target.value })} placeholder="e.g. Customer completes checkout" required value={value.title} /></label>
      <label className="form-field"><span>Status</span><select disabled={disabled} onChange={(event) => onChange({ status: event.target.value })} value={value.status}>{statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="form-field"><span>Priority</span><select disabled={disabled} onChange={(event) => onChange({ priority: event.target.value })} value={value.priority}>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>P{priority}</option>)}</select></label>
    </div>
    <div className="form-field"><label htmlFor={`${id}-description`}>Description</label><RichTextEditor aria-label="Automation case description" appearance="canonical" disabled={disabled} id={`${id}-description`} onChange={(description) => onChange({ description })} placeholder="What should this automation verify?" rows={2} value={value.description} /></div>
    <div className="automation-metadata-links" aria-label="Automation case links">
      <RecordLinks disabled={disabled} label="Test cases" onChange={(manualCaseIds) => onChange({ manualCaseIds })} options={manualCases} value={value.manualCaseIds} />
      <RecordLinks disabled={disabled} label="Stories" onChange={(requirementIds) => onChange({ requirementIds })} options={requirements} value={value.requirementIds} />
      <RecordLinks disabled={disabled} label="Modules" onChange={(moduleIds) => onChange({ moduleIds })} options={modules} value={value.moduleIds} />
      <RecordLinks disabled={disabled} label="Suites" onChange={(suiteIds) => onChange({ suiteIds })} options={suites} value={value.suiteIds} />
    </div>
    <label className="form-field"><span>Linked data set</span><select disabled={disabled} onChange={(event) => onChange({ dataSetId: event.target.value })} value={value.dataSetId}><option value="">No linked data set</option>{dataSets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
  </div>;
}

export type AutomationDraftBehavior = { id: string; action: string; expected_result: string; step_type: TestStepType; precondition: boolean };
export function AutomationDraftPlan({ value, onChange, availableParameters, parameterValues }: {
  value: AutomationDraftBehavior[]; onChange: (steps: AutomationDraftBehavior[]) => void;
  availableParameters?: StepParameterDefinition[]; parameterValues?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const update = (id: string, change: Partial<AutomationDraftBehavior>) => onChange(value.map((step) => step.id === id ? { ...step, ...change } : step));
  return <div className="automation-draft-plan">
    {[true, false].map((precondition) => <section key={String(precondition)}>
      <header><strong>{precondition ? "Preconditions" : "Steps"}</strong><span>{value.filter((step) => step.precondition === precondition).length}</span></header>
      {value.filter((step) => step.precondition === precondition).map((step, index) => <details className="automation-draft-behavior" key={step.id} onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded((current) => current[step.id] === open ? current : { ...current, [step.id]: open });
      }} open={expanded[step.id] ?? true}>
        <summary><span>{index + 1}</span><strong><StepParameterizedText text={step.action} values={parameterValues} fallback={precondition ? "New precondition" : "New step"} /></strong><small>{step.step_type.toUpperCase()}</small></summary>
        <div className="automation-draft-behavior-fields"><label className="form-field"><span>Action</span><GherkinStepTextField availableParameters={availableParameters} parameterValues={parameterValues} ariaLabel={`Draft ${precondition ? "precondition" : "step"} ${index + 1} action`} onChange={(action) => update(step.id, { action })} value={step.action} /></label><label className="form-field"><span>Expected result</span><GherkinStepTextField availableParameters={availableParameters} parameterValues={parameterValues} ariaLabel={`Draft ${precondition ? "precondition" : "step"} ${index + 1} expected result`} onChange={(expected_result) => update(step.id, { expected_result })} value={step.expected_result} /></label><div className="action-row"><select aria-label={`Draft step ${index + 1} type`} onChange={(event) => update(step.id, { step_type: event.target.value as TestStepType })} value={step.step_type}>{["web", "api", "android", "ios"].map((type) => <option key={type}>{type}</option>)}</select><button aria-label={`Remove draft step ${index + 1}`} className="ghost-button compact" onClick={() => onChange(value.filter((item) => item.id !== step.id))} type="button"><TrashIcon size={14} />Remove</button></div></div>
      </details>)}
      <button className="ghost-button compact" onClick={() => onChange([...value, { id: crypto.randomUUID(), action: "", expected_result: "", step_type: "web", precondition }])} type="button"><AddIcon size={14} />{precondition ? "Add precondition" : "Add step"}</button>
    </section>)}
  </div>;
}
