import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  buildStepParameterDefinitionsFromValues,
  getStepParameterQuery,
  getStepParameterScopeLabel,
  getStepParameterSuggestions,
  mergeStepParameterDefinitions,
  normalizeStepParameterValues,
  type StepParameterDefinition,
  type StepParameterQuery
} from "../lib/stepParameters";
import "./StepParameterSuggestions.css";

export function useStepParameterAutocomplete({
  availableParameters = [],
  parameterValues = {},
  onSelect
}: {
  availableParameters?: StepParameterDefinition[];
  parameterValues?: Record<string, string>;
  onSelect: (parameter: StepParameterDefinition, query: StepParameterQuery) => void;
}) {
  const id = `step-parameters-${useId().replace(/:/g, "")}`;
  const [query, setQuery] = useState<StepParameterQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const definitions = useMemo(() => mergeStepParameterDefinitions(
    availableParameters,
    buildStepParameterDefinitionsFromValues(parameterValues)
  ), [availableParameters, parameterValues]);
  const options = useMemo(() => getStepParameterSuggestions(definitions, query), [definitions, query]);
  const selectedIndex = Math.min(activeIndex, Math.max(0, options.length - 1));
  const dismiss = () => setQuery(null);
  const update = (text: string, start: number, end: number, element: HTMLElement) => {
    const next = getStepParameterQuery(text, start, end);
    if (query?.start !== next?.start || query?.query !== next?.query || query?.scope !== next?.scope) setActiveIndex(0);
    setQuery(next);
    setAnchor(element);
  };
  const select = (parameter: StepParameterDefinition) => {
    if (!query) return;
    onSelect(parameter, query);
    dismiss();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!query || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return true;
    }
    if (!options.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (Math.min(current, options.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return true;
    }
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      select(options[selectedIndex]);
      return true;
    }
    return false;
  };

  return {
    update,
    dismiss,
    onKeyDown,
    isOpen: Boolean(query),
    inputProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": query ? id : undefined,
      "aria-expanded": Boolean(query),
      "aria-activedescendant": query && options.length ? `${id}-${selectedIndex}` : undefined
    },
    menu: query && anchor ? <StepParameterSuggestions activeIndex={selectedIndex} anchor={anchor} id={id} onSelect={select} options={options} parameterValues={parameterValues} scope={query.scope} /> : null
  };
}

function StepParameterSuggestions({ activeIndex, anchor, id, onSelect, options, parameterValues, scope }: {
  activeIndex: number;
  anchor: HTMLElement;
  id: string;
  onSelect: (parameter: StepParameterDefinition) => void;
  options: StepParameterDefinition[];
  parameterValues: Record<string, string>;
  scope: StepParameterQuery["scope"];
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 260 });
  const values = normalizeStepParameterValues(parameterValues);
  useEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 300), 460, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.min(280, Math.max(100, below >= 160 || below >= above ? below : above));
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: below >= 160 || below >= above ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
        width,
        maxHeight: height
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor]);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return createPortal(
    <div className="step-parameter-suggestions" onMouseDown={(event) => event.preventDefault()} onPointerDown={(event) => event.preventDefault()} ref={menuRef} style={position}>
      <div className="step-parameter-suggestions-heading"><strong>{getStepParameterScopeLabel(scope)} parameters</strong><span>{options.length}</span></div>
      <div aria-label={`${getStepParameterScopeLabel(scope)} parameters`} id={id} role="listbox">
        {options.map((parameter, index) => <div
          aria-selected={index === activeIndex}
          className={`step-parameter-suggestion${index === activeIndex ? " is-active" : ""}`}
          data-option-index={index}
          id={`${id}-${index}`}
          key={parameter.name}
          onClick={() => onSelect(parameter)}
          role="option"
        >
          <span><code>{parameter.token}</code><small>{parameter.sourceLabel || parameter.scopeLabel}</small></span>
          <strong>{parameter.sensitive ? "Hidden value" : values[parameter.name] === undefined ? "No value yet" : values[parameter.name] || "Empty value"}</strong>
        </div>)}
      </div>
      {!options.length ? <div className="step-parameter-suggestions-empty" role="status">No matching parameters. Keep typing a new reference, or link Test Data.</div> : <div className="step-parameter-suggestions-help">↑ ↓ to choose · Enter or Tab to insert · Esc to close</div>}
    </div>,
    document.body
  );
}
