import { useId } from "react";
import "./AiLlmSelect.css";

type AiLlmSelectProps = {
  integrations: readonly { id: string; name: string; model?: string | null }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
  autoLabel?: string;
};

export function AiLlmSelect({ integrations, value, onChange, disabled = false, id, autoLabel = "Configured LLM" }: AiLlmSelectProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const unavailable = Boolean(value && !integrations.some((integration) => integration.id === value));

  return (
    <label className="ai-llm-select" htmlFor={inputId}>
      <span id={`${inputId}-label`}>LLM</span>
      <select aria-labelledby={`${inputId}-label`} disabled={disabled} id={inputId} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{autoLabel}</option>
        {unavailable ? <option disabled value={value}>{value} (unavailable)</option> : null}
        {integrations.map((integration) => (
          <option key={integration.id} value={integration.id}>
            {integration.name}{integration.model ? ` · ${integration.model}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
