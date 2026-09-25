import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconDatabase, IconSearch } from "@tabler/icons-react";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { buildAutomationRepositoryFields } from "../lib/automationKeywordInputs";
import { buildStepParameterDefinitionsFromValues, excludeSensitiveStepParameterValues, insertStepParameterReference, mergeStepParameterDefinitions, normalizeStepParameterValues, type StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useStepParameterAutocomplete } from "@hellotest/platform/frontend/src/shared/components/StepParameterSuggestions";
import "./AutomationAuthoringInputs.css";

export function AutomationParameterInput({ value, onChange, ariaLabel, placeholder, availableParameters = [], parameterValues = {}, disabled, insertionMode = "replace" }: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  availableParameters?: StepParameterDefinition[];
  parameterValues?: Record<string, string>;
  disabled?: boolean;
  insertionMode?: "replace" | "insert";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef({ start: value.length, end: value.length });
  const definitions = useMemo(() => mergeStepParameterDefinitions(availableParameters, buildStepParameterDefinitionsFromValues(parameterValues)), [availableParameters, parameterValues]);
  const safeValues = useMemo(() => excludeSensitiveStepParameterValues(parameterValues, definitions.filter((item) => item.sensitive).map((item) => item.name)), [definitions, parameterValues]);
  const autocomplete = useStepParameterAutocomplete({
    availableParameters: definitions,
    parameterValues: safeValues,
    onSelect: (parameter, query) => {
      const next = insertStepParameterReference(value, query, parameter);
      onChange(next.value);
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.caret, next.caret); });
    }
  });
  const update = (input: HTMLInputElement) => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    selectionRef.current = { start, end };
    autocomplete.update(input.value, start, end, input);
  };
  const choose = (token: string) => {
    if (!token) return;
    const { start, end } = selectionRef.current;
    const next = insertionMode === "insert" ? value.slice(0, start) + token + value.slice(end) : token;
    onChange(next);
    const caret = insertionMode === "insert" ? start + token.length : token.length;
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(caret, caret); });
  };
  return <div className="automation-parameter-input">
    <input
      {...autocomplete.inputProps}
      aria-label={ariaLabel}
      disabled={disabled}
      onBlur={autocomplete.dismiss}
      onChange={(event) => { onChange(event.target.value); update(event.currentTarget); }}
      onClick={(event) => update(event.currentTarget)}
      onKeyDown={autocomplete.onKeyDown}
      onKeyUp={(event) => { if (!["Escape", "Enter", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) update(event.currentTarget); }}
      onSelect={(event) => { const input = event.currentTarget; selectionRef.current = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length }; }}
      placeholder={placeholder}
      ref={inputRef}
      role="combobox"
      value={value}
    />
    <label className="automation-parameter-select" title="Choose a parameter or Test Data column">
      <IconDatabase aria-hidden="true" size={16} />
      <select aria-label={`Choose parameter for ${ariaLabel}`} disabled={disabled || !definitions.length} onChange={(event) => choose(event.target.value)} value="">
        <option value="">Parameters</option>
        {(["t", "s", "r"] as const).map((scope) => <optgroup key={scope} label={scope === "t" ? "Test case" : scope === "s" ? "Suite" : "Run"}>
          {definitions.filter((parameter) => parameter.scope === scope).map((parameter) => <option key={parameter.name} value={parameter.token}>{parameter.token} · {parameter.sensitive ? "Hidden value" : safeValues[parameter.name] ?? "No value yet"}</option>)}
        </optgroup>)}
      </select>
    </label>
    {autocomplete.menu}
  </div>;
}

export function AutomationRepositoryFieldPicker({ value, onChange, objectRepository, ariaLabel = "Object Repository field", placeholder = "Choose a field or enter a locator", disabled, selectionValue = "reference" }: {
  value: string;
  onChange: (value: string) => void;
  objectRepository: AutomationLearningCacheEntry[];
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  selectionValue?: "reference" | "locator";
}) {
  const id = `automation-repository-${useId().replace(/:/g, "")}`;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedScreen, setSelectedScreen] = useState("");
  const close = () => setIsOpen(false);
  const dialogRef = useDialogFocus<HTMLDivElement>({ active: isOpen, onClose: close });
  const fields = useMemo(() => buildAutomationRepositoryFields(objectRepository), [objectRepository]);
  const filteredFields = useMemo(() => fields.filter((field) => `${field.screenName} ${field.objectName} ${field.htmlTag} ${field.locator}`.toLowerCase().includes(search.trim().toLowerCase())), [fields, search]);
  const screens = useMemo(() => Array.from(new Set(filteredFields.map((field) => field.screenName))).sort(), [filteredFields]);
  const effectiveScreen = screens.includes(selectedScreen) ? selectedScreen : screens[0];
  const currentField = fields.find((field) => field.reference === value || field.locator === value);
  useEffect(() => { if (isOpen) setSelectedScreen(currentField?.screenName || ""); }, [currentField?.screenName, isOpen]);
  return <>
    <div className="automation-repository-target-field">
      <input aria-label={ariaLabel} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} title={currentField ? `${currentField.reference} · ${currentField.locator}` : undefined} value={value} />
      <button aria-label={`Choose ${ariaLabel}`} className="automation-repository-search-button" disabled={disabled} onClick={() => { setSearch(""); setIsOpen(true); }} title="Choose a screen, then a field" type="button"><IconSearch size={17} /></button>
    </div>
    {isOpen ? createPortal(<div className="modal-backdrop automation-repository-picker-backdrop" onClick={close} role="presentation">
      <div aria-labelledby={`${id}-title`} aria-modal="true" className="modal-card resource-modal-card automation-repository-picker-modal" onClick={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="resource-modal-header"><h2 className="dialog-title" id={`${id}-title`}>Choose a repository field</h2><DialogCloseButton label="Close repository field picker" onClick={close} /></div>
        <div className="automation-repository-picker-body">
          <label className="automation-repository-picker-search"><span>Search screens or fields</span><input data-autofocus="true" onChange={(event) => setSearch(event.target.value)} placeholder="Screen, field, or locator" value={search} /></label>
          <div className="automation-repository-picker-grid">
            <div aria-label="Repository screens" className="automation-repository-screen-list">{screens.map((screenName) => <button aria-pressed={screenName === effectiveScreen} className={screenName === effectiveScreen ? "is-selected" : ""} key={screenName} onClick={() => setSelectedScreen(screenName)} type="button"><strong>{screenName}</strong><span>{filteredFields.filter((field) => field.screenName === screenName).length} fields</span></button>)}</div>
            <div aria-label="Fields in selected screen" className="automation-repository-field-list">{filteredFields.filter((field) => field.screenName === effectiveScreen).map((field) => <button key={field.id} onClick={() => { onChange(selectionValue === "locator" ? field.locator : field.reference); close(); }} type="button"><strong>{field.objectName}</strong><span>{field.htmlTag}</span><code>{field.locator}</code></button>)}{!filteredFields.length ? <div className="empty-state compact">{fields.length ? "No matching fields." : "No repository fields available. You can enter a locator directly."}</div> : null}</div>
          </div>
        </div>
      </div>
    </div>, document.body) : null}
  </>;
}

export function AutomationReferencedParameters({ parameters, values = {} }: { parameters: StepParameterDefinition[]; values?: Record<string, string> }) {
  const normalizedValues = normalizeStepParameterValues(values);
  if (!parameters.length) return null;
  return <div aria-label="Referenced parameters" className="automation-referenced-parameters">{parameters.map((parameter) => <span key={parameter.name} title={parameter.sourceLabel || parameter.scopeLabel}><code>{parameter.token}</code><strong>{parameter.sensitive ? "Hidden value" : normalizedValues[parameter.name] ?? "No value yet"}</strong></span>)}</div>;
}
