import { useId, useMemo, useRef, useState } from "react";
import { excludeSensitiveStepParameterValues, insertStepParameterReference, mapStepParameterSegments, type StepParameterDefinition } from "../lib/stepParameters";
import { gherkinDescriptionToPlainText } from "../lib/gherkin";
import { StepParameterizedText } from "./StepParameterizedText";
import { useStepParameterAutocomplete } from "./StepParameterSuggestions";

type GherkinStepTextFieldProps = {
  ariaLabel: string;
  onChange: (value: string) => void;
  parameterValues?: Record<string, string>;
  availableParameters?: StepParameterDefinition[];
  placeholder?: string;
  value: string;
};

/**
 * Keeps the authored parameter token as the input value while presenting its
 * resolved value whenever the field is not being edited. This deliberately
 * avoids writing generated/test-data values back into the Gherkin source.
 */
export function GherkinStepTextField({
  ariaLabel,
  onChange,
  parameterValues = {},
  availableParameters = [],
  placeholder,
  value
}: GherkinStepTextFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mappingId = useId().replace(/:/g, "");
  const plainValue = useMemo(() => gherkinDescriptionToPlainText(value), [value]);
  const safeValues = useMemo(() => excludeSensitiveStepParameterValues(parameterValues, availableParameters.filter((parameter) => parameter.sensitive).map((parameter) => parameter.name)), [availableParameters, parameterValues]);
  const autocomplete = useStepParameterAutocomplete({
    availableParameters,
    parameterValues: safeValues,
    onSelect: (parameter, query) => {
      const next = insertStepParameterReference(plainValue, query, parameter);
      onChange(next.value);
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.caret, next.caret); });
    }
  });
  const updateSuggestions = (input: HTMLInputElement) => autocomplete.update(input.value, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, input);
  const parameterSegments = useMemo(
    () => mapStepParameterSegments(plainValue, safeValues).filter((segment) => segment.type === "token"),
    [safeValues, plainValue]
  );
  const hasParameters = parameterSegments.length > 0;

  return (
    <div className={`gherkin-step-text-field${isEditing ? " is-editing" : " is-previewing"}${hasParameters ? " has-parameters" : ""}`}>
      <input
        {...autocomplete.inputProps}
        aria-describedby={isEditing && hasParameters ? mappingId : undefined}
        aria-label={ariaLabel}
        className="gherkin-step-text-input"
        onBlur={() => {
          if (plainValue !== value) onChange(plainValue);
          setIsEditing(false);
          autocomplete.dismiss();
        }}
        onChange={(event) => { onChange(event.target.value); updateSuggestions(event.currentTarget); }}
        onFocus={() => setIsEditing(true)}
        onClick={(event) => updateSuggestions(event.currentTarget)}
        onKeyDown={autocomplete.onKeyDown}
        onKeyUp={(event) => {
          if (!["Escape", "Enter", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) updateSuggestions(event.currentTarget);
        }}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        value={plainValue}
      />

      {!isEditing && hasParameters ? (
        <span aria-hidden="true" className="gherkin-step-resolved-preview">
          <StepParameterizedText fallback={plainValue} text={plainValue} values={safeValues} />
        </span>
      ) : null}

      {isEditing && hasParameters ? (
        <span aria-live="polite" className="gherkin-step-parameter-map" id={mappingId} role="status">
          {parameterSegments.map((segment, index) => segment.type === "token" ? (
            <span className={segment.resolvedValue === null ? "is-unresolved" : "is-resolved"} key={`${segment.name}-${index}`}>
              <code>{segment.token}</code>
              <i aria-hidden="true">→</i>
              <strong>{availableParameters.some((parameter) => parameter.name === segment.name && parameter.sensitive) ? "Hidden value" : segment.resolvedValue === null ? "No value" : segment.resolvedValue || "Empty value"}</strong>
            </span>
          ) : null)}
        </span>
      ) : null}
      {autocomplete.menu}
    </div>
  );
}
