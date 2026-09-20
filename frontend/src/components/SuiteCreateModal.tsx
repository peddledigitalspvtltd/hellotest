import type { TestDataOptions } from "../types";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TagIcon } from "./AppIcons";
import { DialogCloseButton } from "./DialogCloseButton";
import { FormField } from "./FormField";
import { InfoTooltip } from "./InfoTooltip";
import { RichTextEditor } from "./RichTextEditor";
import { RunDataSetup } from "./RunDataSetup";
import { TestCasePicker } from "./TestCasePicker";
import { TileCardSuiteIcon } from "./TileCardPrimitives";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useDomainSuggestions } from "../hooks/useDomainOptions";
import { resolveDomainSuggestionValue } from "../lib/domainOptions";
import { formatReferenceList, parseReferenceList } from "../lib/externalReferences";
import type { TestCase, TestSuite } from "../types";
import "./suite-authoring-reference.css";
import "./create-suite-modal.css";

export type SuiteCreateInput = {
  name: string;
  description: string;
  labels: string[];
  selectedIds: string[];
  test_data_set_id?: string;
  test_data_options?: TestDataOptions;
  parallel_enabled?: boolean;
  parallel_count?: number;
};

export type SuiteCreateModalProps = {
  mode: "create" | "edit";
  projectId: string;
  appTypeId: string;
  suite: TestSuite | null;
  childSuites: TestSuite[];
  appTypeCases: TestCase[];
  availableLabels: string[];
  canConfigureParallelAutomation: boolean;
  selectedCaseIds: string[];
  onClose: () => void;
  onSubmit: (input: SuiteCreateInput) => void;
  isSaving: boolean;
};

function SuiteLabelsField({
  value,
  onChange,
  availableLabels
}: {
  value: string;
  onChange: (value: string) => void;
  availableLabels: string[];
}) {
  const suggestedLabels = useDomainSuggestions("test_suites.labels", availableLabels);
  const [draftLabel, setDraftLabel] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputId = `suite-label-${useId().replace(/:/g, "")}`;
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = useMemo(() => parseReferenceList(value), [value]);
  const filteredLabels = useMemo(() => {
    const search = draftLabel.trim().toLowerCase();
    const selected = new Set(selectedLabels.map((label) => label.toLowerCase()));
    return suggestedLabels
      .filter((label) => !selected.has(label.value.toLowerCase()))
      .filter((label) => !search || `${label.label} ${label.value}`.toLowerCase().includes(search));
  }, [suggestedLabels, draftLabel, selectedLabels]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node | null)) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const commitLabel = (label: string) => {
    const normalizedLabel = resolveDomainSuggestionValue(label, suggestedLabels);

    if (!normalizedLabel) {
      return;
    }

    if (!selectedLabels.some((item) => item.toLowerCase() === normalizedLabel.toLowerCase())) {
      onChange(formatReferenceList([...selectedLabels, normalizedLabel]));
    }

    setDraftLabel("");
    setIsMenuOpen(false);
  };

  const removeLabel = (labelToRemove: string) => {
    onChange(formatReferenceList(selectedLabels.filter((label) => label.toLowerCase() !== labelToRemove.toLowerCase())));
  };

  return (
    <FormField className="canonical-labels-field" composite inputId={inputId} label="Labels" labelIcon={<TagIcon size={15} />}>
      <div className="requirement-label-picker" ref={pickerRef}>
        <div className="requirement-label-combobox">
          <div className="requirement-label-entry">
            <input
              aria-autocomplete="list"
              aria-expanded={isMenuOpen}
              aria-label="Select or add suite labels"
              id={inputId}
              placeholder="Select or add label"
              role="combobox"
              value={draftLabel}
              onChange={(event) => {
                setDraftLabel(event.target.value);
                setIsMenuOpen(true);
              }}
              onFocus={() => setIsMenuOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitLabel(draftLabel);
                }

                if (event.key === "Escape") {
                  setIsMenuOpen(false);
                }
              }}
            />
            {draftLabel.trim() ? (
              <button className="ghost-button requirement-label-add-button" onClick={() => commitLabel(draftLabel)} type="button">
                Add
              </button>
            ) : null}
          </div>
          {isMenuOpen && (filteredLabels.length || draftLabel.trim()) ? (
            <div className="requirement-label-menu" role="listbox" aria-label="Available suite labels">
              {filteredLabels.map((label) => (
                <button className="requirement-label-menu-option" key={label.value} onClick={() => commitLabel(label.value)} role="option" type="button">
                  {label.label}
                </button>
              ))}
              {draftLabel.trim() && !filteredLabels.some((label) => [label.value, label.label].some(value => value.toLowerCase() === draftLabel.trim().toLowerCase())) ? (
                <button className="requirement-label-menu-option is-add" onClick={() => commitLabel(draftLabel)} role="option" type="button">
                  Add "{draftLabel.trim()}"
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {selectedLabels.length ? (
          <div className="requirement-label-chip-row">
            {selectedLabels.map((label) => (
              <span className="requirement-label-chip" key={label}>
                <span>{label}</span>
                <button aria-label={`Remove ${label}`} onClick={() => removeLabel(label)} type="button">x</button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </FormField>
  );
}

export function SuiteCreateModal({
  mode,
  projectId,
  appTypeId,
  suite,
  childSuites,
  appTypeCases,
  availableLabels,
  canConfigureParallelAutomation,
  selectedCaseIds,
  onClose,
  onSubmit,
  isSaving
}: SuiteCreateModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: isSaving, onClose });

  const [dataSetValid, setDataSetValid] = useState(true);
  const [dataOptions, setDataOptions] = useState<TestDataOptions>(suite?.test_data_options || {});
  const [dataSetId, setDataSetId] = useState(suite?.test_data_set_id || "");
  const [name, setName] = useState(() => (mode === "edit" && suite ? suite.name : ""));
  const [description, setDescription] = useState(() => (mode === "edit" && suite ? suite.description || "" : ""));
  const [labelsText, setLabelsText] = useState(() => (mode === "edit" && suite ? formatReferenceList(suite.labels) : ""));
  const [parallelEnabled, setParallelEnabled] = useState(() => canConfigureParallelAutomation && Boolean(mode === "edit" && suite?.parallel_enabled));
  const [parallelCount, setParallelCount] = useState(() => Math.max(1, Number(mode === "edit" ? suite?.parallel_count || 1 : 1)));
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(() => [...new Set(selectedCaseIds)]);
  const [resolvedSelectedItems, setResolvedSelectedItems] = useState<TestCase[]>([]);
  const selectedCases = useMemo(() => {
    const byId = new Map([...appTypeCases, ...resolvedSelectedItems].map(item => [item.id, item]));
    return localSelectedIds.map(id => byId.get(id) || ({ id, title: id } as TestCase));
  }, [appTypeCases, localSelectedIds, resolvedSelectedItems]);

  return (
    <div className="modal-backdrop suite-authoring-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-busy={isSaving}
        aria-describedby="suite-editor-description"
        className="modal-card suite-create-modal suite-authoring-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="suite-editor-title"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <div className="suite-reference-title-row">
              <span aria-hidden="true" className="suite-reference-title-icon"><TileCardSuiteIcon /></span>
              <div className="suite-reference-title-copy">
                <h2 className="dialog-title" id="suite-editor-title">{mode === "edit" ? "Edit Suite" : "Create Suite"}</h2>
                <p id="suite-editor-description">
                  {mode === "edit"
                    ? "Update suite metadata and reusable Test Case order."
                    : "Define suite metadata and choose reusable Test Cases."}
                </p>
              </div>
            </div>
          </div>
          <DialogCloseButton disabled={isSaving} label={`Close ${mode === "edit" ? "suite editor" : "create suite"}`} onClick={onClose} />
        </div>

        <form
          className="form-grid suite-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dataSetValid) return;
            onSubmit({
              name,
              description,
              labels: parseReferenceList(labelsText),
              parallel_enabled: canConfigureParallelAutomation && parallelEnabled,
              parallel_count: canConfigureParallelAutomation && parallelEnabled ? parallelCount : 1,
              test_data_options: dataOptions, test_data_set_id: dataSetId,
              selectedIds: localSelectedIds
            });
          }}
        >
          <div className="suite-modal-body suite-reference-modal-body">
            <section className="suite-modal-config-grid suite-reference-config" aria-labelledby="suite-configuration-heading">
              <div className="suite-reference-section-heading">
                <h3 id="suite-configuration-heading">Configuration</h3>
                <p>Define the metadata for your {mode === "edit" ? "test suite" : "new test suite"}.</p>
              </div>
              <FormField label="Suite name" required>
                <input
                  autoFocus
                  disabled={isSaving}
                  placeholder="e.g., Q4 Reliability Regression"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <FormField label="Description">
                <RichTextEditor
                  appearance="canonical"
                  aria-label="Suite description"
                  disabled={isSaving}
                  onChange={setDescription}
                  placeholder="Describe the purpose and scope of this suite..."
                  rows={7}
                  value={description}
                />
              </FormField>
              {/* Expand children, while the unsaved selection supplies this suite's own cases. */}
              <RunDataSetup onValidityChange={setDataSetValid} parameterValues={suite?.parameter_values} suiteContextId={suite?.id} dataOptions={dataOptions} onDataOptionsChange={setDataOptions} suiteMode projectId={projectId} appTypeId={appTypeId} suites={childSuites} cases={selectedCases} dataSetId={dataSetId} onDataSetChange={setDataSetId} disabled={isSaving} />
              <SuiteLabelsField
                availableLabels={availableLabels}
                value={labelsText}
                onChange={setLabelsText}
              />
              {canConfigureParallelAutomation ? (
                <details className="suite-reference-advanced">
                  <summary>Advanced execution</summary>
                  <FormField label="Suite parallel execution">
                    <div className="execution-parallel-control">
                      <label>
                        <input checked={parallelEnabled} disabled={isSaving} onChange={(event) => setParallelEnabled(event.target.checked)} type="checkbox" />
                        <span>Run this suite in parallel</span>
                      </label>
                      <input
                        aria-label="Suite parallel count"
                        disabled={isSaving || !parallelEnabled}
                        max={50}
                        min={1}
                        onChange={(event) => setParallelCount(Math.max(1, Number(event.target.value) || 1))}
                        type="number"
                        value={parallelCount}
                      />
                    </div>
                  </FormField>
                </details>
              ) : null}
              <aside className="suite-reference-pro-tip">
                <InfoTooltip
                  content="Suites can be exported to the connected workspace after creation. Keep labels aligned with your project tags."
                  label="Suite creation tip"
                />
                <div>
                  <strong>Pro Tip</strong>
                  <p>Suites can be exported to the connected workspace after creation. Ensure the labels match your project tags.</p>
                </div>
              </aside>
            </section>

            <div className="suite-modal-picker-shell">
              <TestCasePicker
                projectId={projectId}
                appTypeId={appTypeId}
                initialItems={appTypeCases}
                allowReorder
                disabled={isSaving}
                emptyMessage="No test cases available in this app type yet."
                heading="Test Case Selection"
                presentation="inline"
                selectionContext="suite"
                onChange={setLocalSelectedIds}
                onItemsResolved={setResolvedSelectedItems}
                selectedIds={localSelectedIds}
              />
            </div>
          </div>

          <div className="action-row suite-modal-actions">
            <div className="suite-reference-footer-summary" aria-live="polite">
              <strong>{localSelectedIds.length} selected</strong>
              <span aria-hidden="true" />
              <small>HelloTest Test Studio</small>
            </div>
            <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={isSaving || !name.trim() || !dataSetValid} type="submit">
              {isSaving ? "Saving…" : (
                <>
                  <TileCardSuiteIcon />
                  <span>{mode === "edit" ? "Save Suite" : "Create Suite"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
