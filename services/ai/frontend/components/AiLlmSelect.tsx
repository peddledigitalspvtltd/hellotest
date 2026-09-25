import { useEffect, useId, useRef } from "react";
import "./AiLlmSelect.css";

type AiLlmSelectProps = {
  integrations: readonly { id: string; name: string; model?: string | null; is_active?: boolean; type?: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
  autoLabel?: string;
  defaultIntegrationId?: string;
  scopeKey?: string;
};

export function AiLlmSelect({ integrations, value, onChange, disabled = false, id, autoLabel = "Configured LLM", defaultIntegrationId = "", scopeKey }: AiLlmSelectProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const userSelected = useRef(false);
  const activeIntegrations = integrations.filter((integration) => integration.is_active !== false && (!integration.type || integration.type === "llm"));
  const defaultId = activeIntegrations.some((integration) => integration.id === defaultIntegrationId)
    ? defaultIntegrationId : activeIntegrations.length === 1 ? activeIntegrations[0].id : "";
  const requestedDefault = useRef("");
  useEffect(() => {
    userSelected.current = false;
    requestedDefault.current = "";
  }, [scopeKey]);
  useEffect(() => {
    if (!value && !disabled && !userSelected.current && defaultId && requestedDefault.current !== defaultId) {
      requestedDefault.current = defaultId;
      onChange(defaultId);
    }
  }, [defaultId, disabled, onChange, value]);
  const unavailable = Boolean(value && !activeIntegrations.some((integration) => integration.id === value));

  return (
    <label className="ai-llm-select" htmlFor={inputId}>
      <span id={`${inputId}-label`}>LLM</span>
      <select aria-labelledby={`${inputId}-label`} disabled={disabled} id={inputId} onChange={(event) => { userSelected.current = true; onChange(event.target.value); }} value={value}>
        <option value="">{autoLabel}</option>
        {unavailable ? <option disabled value={value}>{value} (unavailable)</option> : null}
        {activeIntegrations.map((integration) => (
          <option key={integration.id} value={integration.id}>
            {integration.name}{integration.model ? ` · ${integration.model}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
