import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { DialogCloseButton } from "./DialogCloseButton";
import { FormField } from "./FormField";
import { TestDataIcon } from "./AppIcons";
import type { StepParameterDefinition } from "../lib/stepParameters";
import { evaluateTestDataTemplate, hasTestDataGeneratorTemplate, TEST_DATA_GENERATOR_TEMPLATES } from "../lib/testDataGenerators";

type StepParameterDialogInputState = {
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
};

type UtilityTemplate = {
  id: string;
  label: string;
  token: string;
  custom?: boolean;
};

const DEFAULT_UTILITY_TEMPLATES: UtilityTemplate[] = [
  { id: "random-number", label: "Random number", token: TEST_DATA_GENERATOR_TEMPLATES.randomNumber },
  { id: "random-string", label: "Random string", token: TEST_DATA_GENERATOR_TEMPLATES.randomString },
  { id: "ai-data", label: "AI data", token: TEST_DATA_GENERATOR_TEMPLATES.aiData },
  { id: "yopmail", label: "Yopmail email", token: TEST_DATA_GENERATOR_TEMPLATES.yopmail },
  { id: "today", label: "Today", token: TEST_DATA_GENERATOR_TEMPLATES.date },
  { id: "tomorrow", label: "Tomorrow", token: TEST_DATA_GENERATOR_TEMPLATES.tomorrow }
];

export function StepParameterDialog({
  title,
  subtitle,
  parameters,
  values,
  onChange,
  onClose,
  headerContent,
  getInputState,
  defaultValues = {},
  overrideValues = {},
  previewValues = {},
  scopeLabels,
  onReset,
  onRefreshPreviews
}: {
  title: string;
  subtitle: string;
  parameters: StepParameterDefinition[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onClose: () => void;
  headerContent?: ReactNode;
  getInputState?: (parameter: StepParameterDefinition) => StepParameterDialogInputState;
  defaultValues?: Record<string, string>;
  overrideValues?: Record<string, string>;
  previewValues?: Record<string, string>;
  scopeLabels?: Partial<Record<"t" | "s" | "r", string>>;
  onReset?: (name: string) => void;
  onRefreshPreviews?: () => void;
}) {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const { getLlmIntegrationId, getPrompt } = useAiPromptRegistry(Boolean(session));
  const generateAiData = useMutation({ mutationFn: api.testDataSets.previewAiData });
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    t: false,
    s: true,
    r: true
  });
  const groupedParameters = [
    {
      scope: "t",
      title: `${scopeLabels?.t || "Test"} Params`,
      items: parameters.filter((parameter) => parameter.scope === "t")
    },
    {
      scope: "s",
      title: `${scopeLabels?.s || "Suite"} Params`,
      items: parameters.filter((parameter) => parameter.scope === "s")
    },
    {
      scope: "r",
      title: `${scopeLabels?.r || "Run"} Params`,
      items: parameters.filter((parameter) => parameter.scope === "r")
    }
  ].filter((group) => group.items.length);
  const parameterCount = parameters.length;
  const dynamicParameterCount = parameters.filter((parameter) => hasTestDataGeneratorTemplate(values[parameter.name])).length;
  const [activeUtilityParameter, setActiveUtilityParameter] = useState("");
  const [utilityDrafts, setUtilityDrafts] = useState<Record<string, string>>({});
  const [utilityFeedbackByParameter, setUtilityFeedbackByParameter] = useState<Record<string, string>>({});
  const [customUtilityTemplates, setCustomUtilityTemplates] = useState<UtilityTemplate[]>([]);
  const [customUtilityLabel, setCustomUtilityLabel] = useState("");
  const [customUtilityToken, setCustomUtilityToken] = useState("");
  const utilityTemplates = [...DEFAULT_UTILITY_TEMPLATES, ...customUtilityTemplates];
  const toggleParameterGroup = (scope: string) => {
    setCollapsedGroups((current) => {
      const willCollapseSelected = !current[scope];
      return {
        t: true,
        s: true,
        r: true,
        [scope]: willCollapseSelected
      };
    });
  };

  const addCustomUtilityTemplate = () => {
    const label = customUtilityLabel.trim();
    const token = customUtilityToken.trim();

    if (!label || !token) {
      return;
    }

    setCustomUtilityTemplates((current) => [
      ...current,
      {
        id: `custom-${Date.now()}`,
        label,
        token,
        custom: true
      }
    ]);
    if (activeUtilityParameter) {
      setUtilityDrafts((current) => ({ ...current, [activeUtilityParameter]: token }));
      onChange(activeUtilityParameter, token);
      setUtilityFeedbackByParameter((current) => ({
        ...current,
        [activeUtilityParameter]: `Custom utility saved. Example for a new run: ${evaluateTestDataTemplate(token) || "—"}`
      }));
    }
    setCustomUtilityLabel("");
    setCustomUtilityToken("");
    setActiveUtilityParameter("");
  };

  const selectUtility = (parameterName: string, utilityId: string) => {
    if (!utilityId) return;
    if (utilityId === "__custom__") {
      setUtilityDrafts((current) => ({
        ...current,
        [parameterName]: current[parameterName] ?? values[parameterName] ?? ""
      }));
      setActiveUtilityParameter(parameterName);
      return;
    }

    const utility = utilityTemplates.find((template) => template.id === utilityId);
    if (!utility) return;
    const sampleValue = evaluateTestDataTemplate(utility.token);
    setUtilityDrafts((current) => ({ ...current, [parameterName]: utility.token }));
    setUtilityFeedbackByParameter((current) => ({
      ...current,
      [parameterName]: `${utility.label} selected. Example for a new run: ${sampleValue || "—"}`
    }));
    onChange(parameterName, utility.token);
    setActiveUtilityParameter("");
  };

  const resolveAiDataTemplate = async (parameterName: string, template: string) => {
    const match = template.trim().match(/^\{\{\s*aiData\s*:\s*([^}]+)\}\}$/i);
    if (!match || !projectId) return false;
    const criterion = match[1].trim();
    setUtilityFeedbackByParameter((current) => ({ ...current, [parameterName]: `Generating ${criterion} with the configured LLM…` }));
    try {
      const preview = await generateAiData.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        prompt: criterion,
        field_context: parameterName,
        sample_count: 8,
        prompt_instruction: getPrompt("ai.test_data.synthetic") || undefined,
        integration_id: getLlmIntegrationId("ai.test_data.synthetic") || undefined
      });
      onChange(parameterName, preview.randomized_template);
      setUtilityDrafts((current) => ({ ...current, [parameterName]: preview.randomized_template }));
      setUtilityFeedbackByParameter((current) => ({ ...current, [parameterName]: preview.fallback_used ? "The LLM was unavailable; a safe reviewed fallback pool will randomize each run." : `${preview.suggestions.length} LLM-generated values reviewed and saved as a randomized run-time pool.` }));
    } catch (error) {
      setUtilityFeedbackByParameter((current) => ({ ...current, [parameterName]: error instanceof Error ? error.message : "Unable to generate AI data." }));
    }
    return true;
  };

  const applyUtilityTemplate = async (parameterName: string) => {
    const template = utilityDrafts[parameterName] || "";
    if (await resolveAiDataTemplate(parameterName, template)) return;
    const sampleValue = evaluateTestDataTemplate(template);

    onChange(parameterName, template);
    setUtilityFeedbackByParameter((current) => ({
      ...current,
      [parameterName]: sampleValue
        ? `Template saved. Example for a new run: ${sampleValue}`
        : "Saved an empty generator template."
    }));
  };

  const applyUtilityStaticValue = (parameterName: string) => {
    const template = utilityDrafts[parameterName] || "";
    const sampleValue = evaluateTestDataTemplate(template);

    onChange(parameterName, sampleValue);
    setUtilityDrafts((currentDrafts) => ({
      ...currentDrafts,
      [parameterName]: sampleValue
    }));
    setUtilityFeedbackByParameter((current) => ({
      ...current,
      [parameterName]: sampleValue
        ? `Static value saved now: ${sampleValue}`
        : "Saved an empty static value."
    }));
  };

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-labelledby="step-parameter-dialog-title"
        aria-modal="true"
        className="modal-card suite-create-modal step-parameter-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="suite-create-header step-parameter-dialog-header">
          <div className="suite-create-title">
            <div className="step-parameter-dialog-title-row">
              <TestDataIcon size={18} />
              <h2 className="dialog-title" id="step-parameter-dialog-title">{title}</h2>
            </div>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <div className="step-parameter-dialog-head-meta">
            {dynamicParameterCount && onRefreshPreviews ? (
              <button className="ghost-button compact" onClick={onRefreshPreviews} type="button">
                Refresh previews
              </button>
            ) : null}
            <span className="count-pill">{parameterCount} field{parameterCount === 1 ? "" : "s"}</span>
            <DialogCloseButton label={`Close ${title}`} onClick={onClose} />
          </div>
        </div>

        <div className="step-parameter-dialog-body">
          {headerContent ? <div className="step-parameter-dialog-header-slot">{headerContent}</div> : null}
          {parameters.length ? (
            <div className="step-parameter-list">
              {groupedParameters.map((group, groupIndex) => (
                <section className="step-parameter-group" key={group.scope}>
                  <div
                    className="step-parameter-group-head"
                    onClick={() => toggleParameterGroup(group.scope)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleParameterGroup(group.scope);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <button
                      aria-expanded={!collapsedGroups[group.scope]}
                      className="step-parameter-group-toggle"
                      data-autofocus={groupIndex === 0 ? "true" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleParameterGroup(group.scope);
                      }}
                      type="button"
                    >
                      <span aria-hidden="true">{collapsedGroups[group.scope] ? "+" : "-"}</span>
                      <strong>{group.title}</strong>
                    </button>
                    <span>{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                  </div>
                  {!collapsedGroups[group.scope] ? (
                    <div className="step-parameter-group-items">
                      {group.items.map((parameter) => {
                        const configuredInputState = getInputState?.(parameter) || {};
                        const inputState = parameter.sensitive
                          ? { ...configuredInputState, disabled: true, placeholder: "Hidden value", hint: "This linked value stays hidden and is resolved when the test runs." }
                          : configuredInputState;
                        const hasDefaultValue = Object.prototype.hasOwnProperty.call(defaultValues, parameter.name);
                        const hasOverrideValue = Object.prototype.hasOwnProperty.call(overrideValues, parameter.name);
                        const currentValue = parameter.sensitive ? "" : values[parameter.name] ?? "";
                        const isDynamicValue = hasTestDataGeneratorTemplate(currentValue);
                        const previewValue = parameter.sensitive ? "" : previewValues[parameter.name] ?? currentValue;
                        const sourceLabel = hasOverrideValue
                          ? "Test Case override"
                          : hasDefaultValue
                            ? parameter.sourceLabel ? `Inherited from ${parameter.sourceLabel}` : "Inherited from Data Set"
                            : scopeLabels?.[parameter.scope] || parameter.scopeLabel;

                        return (
                          <div className="step-parameter-row" key={parameter.name}>
                            <FormField
                              label={parameter.label || parameter.token}
                              hint={inputState.hint || (parameter.occurrenceCount
                                ? `${parameter.occurrenceCount} reference${parameter.occurrenceCount === 1 ? "" : "s"} in this design`
                                : `Available from ${parameter.sourceLabel || (parameter.source === "data_set" ? "the linked Data Set" : parameter.scopeLabel + " defaults")}`)}
                            >
                              <div className="step-parameter-row-meta">
                                <code>{parameter.token}</code>
                                <span className={isDynamicValue ? "step-parameter-mode-badge is-dynamic" : "step-parameter-mode-badge is-static"}>
                                  {isDynamicValue ? "Dynamic" : "Static"}
                                </span>
                                <span className="step-parameter-source-badge">{sourceLabel}</span>
                              </div>
                              <div className="step-parameter-input-row">
                                <input
                                  disabled={inputState.disabled}
                                  placeholder={inputState.placeholder || `Value for ${parameter.token}`}
                                  value={currentValue}
                                  onChange={(event) => onChange(parameter.name, event.target.value)}
                                  onBlur={(event) => { void resolveAiDataTemplate(parameter.name, event.target.value); }}
                                />
                                <label className="step-parameter-utility-select">
                                  <span aria-hidden="true" className="step-parameter-utility-select-icon"><TestDataIcon size={17} /></span>
                                  <span className="sr-only">Data utility for {parameter.token}</span>
                                  <select
                                    aria-label={`Data utility for ${parameter.token}`}
                                    disabled={inputState.disabled}
                                    onChange={(event) => selectUtility(parameter.name, event.target.value)}
                                    value=""
                                  >
                                    <option value="">Data utilities…</option>
                                    <optgroup label="Data utilities">
                                      {DEFAULT_UTILITY_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
                                    </optgroup>
                                    {customUtilityTemplates.length ? (
                                      <optgroup label="Saved utilities">
                                        {customUtilityTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
                                      </optgroup>
                                    ) : null}
                                    <option value="__custom__">Create custom utility…</option>
                                  </select>
                                </label>
                              </div>
                              {isDynamicValue ? (
                                <div className="step-parameter-resolved-preview">
                                  <span>Resolved preview</span>
                                  <strong>{previewValue || "—"}</strong>
                                </div>
                              ) : null}
                              {hasDefaultValue && hasOverrideValue && onReset ? (
                                <button className="link-button step-parameter-reset-button" disabled={inputState.disabled} onClick={() => onReset(parameter.name)} type="button">
                                  Reset to Data Set value
                                </button>
                              ) : null}
                              {activeUtilityParameter === parameter.name && !parameter.sensitive ? (
                                <div aria-label={`Data utilities for ${parameter.token}`} className="step-parameter-utility-panel" role="dialog">
                                  <div className="step-parameter-utility-modal-head">
                                    <div>
                                      <strong>Custom data utility</strong>
                                      <span>Compose a reusable value template for {parameter.token}, then keep it dynamic or resolve one static sample.</span>
                                    </div>
                                    <button className="ghost-button compact" onClick={() => setActiveUtilityParameter("")} type="button">Close</button>
                                  </div>
                                  <div className="step-parameter-utility-add-row">
                                    <input
                                      aria-label="Template label"
                                      placeholder="Template label"
                                      value={customUtilityLabel}
                                      onChange={(event) => setCustomUtilityLabel(event.target.value)}
                                    />
                                    <input
                                      aria-label="Template token"
                                      placeholder="{{aiData:customer email}}"
                                      value={customUtilityToken}
                                      onChange={(event) => setCustomUtilityToken(event.target.value)}
                                    />
                                    <button className="ghost-button" onClick={addCustomUtilityTemplate} type="button">
                                      Save utility
                                    </button>
                                  </div>
                                  <textarea
                                    className="step-parameter-utility-template"
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setUtilityDrafts((currentDrafts) => ({
                                        ...currentDrafts,
                                        [parameter.name]: nextValue
                                      }));
                                      setUtilityFeedbackByParameter((current) => ({
                                        ...current,
                                        [parameter.name]: ""
                                      }));
                                    }}
                                    placeholder="Example: ORD-{{randomNumber:6}}-{{date:YYYYMMDD}}"
                                    rows={3}
                                    value={utilityDrafts[parameter.name] || ""}
                                  />
                                  <div className="step-parameter-utility-footer">
                                    <button className="primary-button" disabled={generateAiData.isPending} onClick={() => void applyUtilityTemplate(parameter.name)} title="Save the template so every run resolves a fresh value" type="button">
                                      {generateAiData.isPending ? "Generating…" : "Generate / randomize each run"}
                                    </button>
                                    <button className="ghost-button" onClick={() => applyUtilityStaticValue(parameter.name)} title="Resolve the template now and save the generated value as static data" type="button">
                                      Use static sample
                                    </button>
                                    <span>Template keeps values dynamic; static sample writes one generated value into this reference.</span>
                                  </div>
                                  {utilityFeedbackByParameter[parameter.name] ? (
                                    <span className="step-parameter-utility-feedback">{utilityFeedbackByParameter[parameter.name]}</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </FormField>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">No Test Params are referenced or inherited from a linked Data Set yet.</div>
          )}
        </div>

        <div className="step-parameter-dialog-footer">
          <button className="ghost-button" onClick={onClose} type="button">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
