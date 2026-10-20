import { useEffect, useId, useState } from "react";
import { IconApi, IconArrowDown, IconArrowUp, IconBrandAndroid, IconBrandApple, IconClipboard, IconCut, IconWorld } from "@tabler/icons-react";
import { AddIcon, CopyIcon, PencilIcon, RefreshIcon, SparkIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { excludeSensitiveStepParameterValues, type StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { collectPrivateParameterNames } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import type { TestStep, TestStepType } from "@hellotest/platform/frontend/src/types";
import { GherkinStepTextField } from "@hellotest/testing/frontend/components/GherkinStepTextField";
import { StepParameterizedText } from "@hellotest/testing/frontend/components/StepParameterizedText";
import { parseApiRequestSource } from "../lib/apiRequestSource";
import type { AutomationRepositoryReference } from "../lib/automationKeywordInputs";
import { stripAutomationSettingsComments } from "../lib/automationInstructions";
import { applyAutomationStepOptions, parseAutomationStepOptions, type AutomationStepOptions } from "../lib/automationStepOptions";
import { AutomationCodeLines } from "./AutomationCodeLines";
import { AutomationInstructionPreview } from "./AutomationInstructionPreview";
import { AutomationIconButton, AutomationOverlay } from "./AutomationOverlay";
import "./AutomationAuthoring.css";
import "./AutomationWorkspace.css";
import "./SharedAutomationSectionsEditor.css";

export type SharedAutomationSectionChange = Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">;

export type SharedAutomationSectionsEditorProps = {
  sections: TestStep[];
  canEdit: boolean;
  canViewCode: boolean;
  parameters: StepParameterDefinition[];
  values: Record<string, string>;
  repository: AutomationRepositoryReference[];
  view: "instructions" | "source";
  onUpdate: (id: string, change: SharedAutomationSectionChange) => void;
  onInsert: (index: number, input: SharedAutomationSectionChange) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onCopy: (ids: string[]) => void;
  onCut: (ids: string[]) => void;
  onPaste: (index: number) => void;
  onRemove: (ids: string[]) => void;
  onEditInstructions: (id: string) => void;
  onImprove?: (id: string) => void;
  canPaste: boolean;
  selectedIds: string[];
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
};

type SectionDialog = {
  id: string | null;
  index: number;
  input: SharedAutomationSectionChange;
  apiSource: string;
  options: AutomationStepOptions;
  originalOptions: AutomationStepOptions;
  error: string;
};

const PLATFORMS: TestStepType[] = ["web", "api", "android", "ios"];
const EXECUTION_OPTIONS = [
  ["optional", "Optional step"],
  ["skip", "Skip step"],
  ["screenshotOnFailure", "Screenshot on failure"]
] as const;

function platformLabel(platform: TestStepType) {
  return platform === "ios" ? "iOS" : platform === "android" ? "Android" : platform.toUpperCase();
}

function PlatformIcon({ platform }: { platform: TestStepType }) {
  if (platform === "api") return <IconApi size={17} />;
  if (platform === "android") return <IconBrandAndroid size={17} />;
  if (platform === "ios") return <IconBrandApple size={17} />;
  return <IconWorld size={17} />;
}

/** Edits the group's local draft; the containing group owns persistence and permissions. */
export function SharedAutomationSectionsEditor({
  sections, canEdit, canViewCode, parameters, values, repository, view,
  onUpdate, onInsert, onMove, onCopy, onCut, onPaste, onRemove,
  onEditInstructions, onImprove, canPaste, selectedIds, onSelect, onSelectAll
}: SharedAutomationSectionsEditorProps) {
  const instanceId = useId().replace(/:/g, "");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<SectionDialog | null>(null);
  const selected = sections.filter(section => selectedIds.includes(section.id)).map(section => section.id);
  const sensitiveNames = [...collectPrivateParameterNames([values], parameters.filter(parameter => parameter.sensitive).map(parameter => parameter.name))];
  const safeValues = excludeSensitiveStepParameterValues(values, sensitiveNames);
  const canEditImplementation = canEdit && canViewCode;

  useEffect(() => {
    if (!canEdit || (dialog?.id && !sections.some(section => section.id === dialog.id))) setDialog(null);
  }, [canEdit, dialog?.id, sections]);

  const guarded = (callback: () => void) => () => { if (canEdit) callback(); };
  const openCreate = (index: number) => {
    if (!canEdit) return;
    const input: SharedAutomationSectionChange = { action: "", expected_result: "", step_type: "web", automation_code: "", api_request: null };
    const options = parseAutomationStepOptions(input);
    setDialog({ id: null, index, input, apiSource: "", options, originalOptions: options, error: "" });
  };
  const openEdit = (section: TestStep, index: number) => {
    if (!canEdit) return;
    const input: SharedAutomationSectionChange = {
      action: section.action, expected_result: section.expected_result,
      step_type: section.step_type || "web", automation_code: section.automation_code || "",
      api_request: section.api_request || null
    };
    const options = parseAutomationStepOptions(input);
    setDialog({ id: section.id, index, input, apiSource: input.api_request ? JSON.stringify(input.api_request, null, 2) : "", options, originalOptions: options, error: "" });
  };
  const updateInput = (change: Partial<SharedAutomationSectionChange>) => {
    if (!canEdit) return;
    setDialog(current => current ? { ...current, input: { ...current.input, ...change }, error: "" } : null);
  };
  const applyDialog = () => {
    if (!canEdit || !dialog || !dialog.input.action?.trim()) return;
    if (dialog.id && !sections.some(section => section.id === dialog.id)) return;
    try {
      const input = { ...dialog.input };
      if (canViewCode && input.step_type === "api") input.api_request = dialog.apiSource.trim() ? parseApiRequestSource(dialog.apiSource) : null;
      const optionsChanged = JSON.stringify(dialog.options) !== JSON.stringify(dialog.originalOptions);
      // Avoid reformatting a full program when only the section's wording changed.
      if (canViewCode && optionsChanged) input.automation_code = applyAutomationStepOptions(input.automation_code || "", dialog.options);
      if (dialog.id) onUpdate(dialog.id, input);
      else onInsert(Math.min(dialog.index, sections.length), input);
      setDialog(null);
    } catch (error) {
      setDialog(current => current ? { ...current, error: error instanceof Error ? error.message : "Unable to apply this section." } : null);
    }
  };

  return <section className="automation-program-sections shared-automation-sections-editor" aria-label="Shared automation sections">
    <div className="automation-plan-actions">
      {canEdit ? <>
        <label className="checkbox-field"><input aria-label="Select all sections" type="checkbox" checked={sections.length > 0 && selected.length === sections.length} disabled={!sections.length} onChange={event => { if (canEdit) onSelectAll(event.target.checked); }} />Select all</label>
        <button className="ghost-button compact" type="button" disabled={!selected.length} onClick={guarded(() => onCopy(selected))}><CopyIcon size={14} />Copy selected sections</button>
        <button className="ghost-button compact" type="button" disabled={!selected.length} onClick={guarded(() => onCut(selected))}><IconCut size={14} />Cut selected sections</button>
        <button className="ghost-button compact" type="button" disabled={!canPaste} onClick={guarded(() => onPaste(sections.length))}><IconClipboard size={14} />Paste sections</button>
        <button className="ghost-button compact" type="button" disabled={!selected.length} onClick={guarded(() => onRemove(selected))}><TrashIcon size={14} />Remove selected sections</button>
        <button className="primary-button compact" type="button" onClick={() => openCreate(sections.length)}><AddIcon size={14} />Add section</button>
      </> : <span className="muted">{sections.length} {sections.length === 1 ? "section" : "sections"}</span>}
    </div>
    {!sections.length ? <p className="muted">No sections yet. Add a named section and its executable instructions.</p> : null}
    {sections.map((section, index) => {
      const name = richTextToPlainText(section.action || "Untitled section");
      const platform = section.step_type || "web";
      const expanded = expandedIds.includes(section.id);
      const regionId = `shared-section-${instanceId}-${section.id}`;
      const code = section.automation_code || "";
      const hasProgram = Boolean(stripAutomationSettingsComments(code).trim());
      const editInstructions = () => { if (canEditImplementation) onEditInstructions(section.id); };
      return <article className="automation-plan-row automation-program-section" key={section.id}>
        <div className="automation-plan-summary">
          {canEdit ? <input aria-label={`Select section ${index + 1}`} type="checkbox" checked={selectedIds.includes(section.id)} onChange={event => { if (canEdit) onSelect(section.id, event.target.checked); }} /> : null}
          <button type="button" aria-label={`Section ${index + 1}: ${name}`} aria-controls={regionId} aria-expanded={expanded} onClick={() => setExpandedIds(current => current.includes(section.id) ? current.filter(id => id !== section.id) : [...current, section.id])}>
            <span className="automation-section-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
            <span className="automation-plan-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="automation-section-platform" title={platformLabel(platform)} aria-label={platformLabel(platform)}><PlatformIcon platform={platform} /></span>
            <span className="automation-plan-copy"><strong><StepParameterizedText text={name} values={values} sensitiveNames={sensitiveNames} /></strong>{section.expected_result ? <small><span className="automation-section-expect">Expect</span> <StepParameterizedText text={richTextToPlainText(section.expected_result)} values={values} sensitiveNames={sensitiveNames} /></small> : null}</span>
          </button>
          {canEdit ? <div className="automation-section-tools">
            <AutomationIconButton label={`Move ${name} up`} disabled={index === 0} onClick={guarded(() => onMove(section.id, "up"))}><IconArrowUp size={15} /></AutomationIconButton>
            <AutomationIconButton label={`Move ${name} down`} disabled={index === sections.length - 1} onClick={guarded(() => onMove(section.id, "down"))}><IconArrowDown size={15} /></AutomationIconButton>
            <AutomationIconButton label={`Edit ${name}`} onClick={() => openEdit(section, index)}><PencilIcon size={15} /></AutomationIconButton>
            {canViewCode ? <AutomationIconButton label={`Add instruction to ${name}`} onClick={editInstructions}><AddIcon size={15} /></AutomationIconButton> : null}
            <CatalogActionMenu label={`${name} actions`} actions={[
              { label: "Insert before", icon: <AddIcon size={15} />, onClick: () => openCreate(index) },
              { label: "Insert after", icon: <AddIcon size={15} />, onClick: () => openCreate(index + 1) },
              ...(onImprove ? [{ label: "Improve wording", icon: <SparkIcon size={15} />, onClick: guarded(() => onImprove(section.id)) }] : []),
              { label: "Copy section", icon: <CopyIcon size={15} />, onClick: guarded(() => onCopy([section.id])) },
              { label: "Cut section", icon: <IconCut size={15} />, onClick: guarded(() => onCut([section.id])) },
              { label: "Paste after section", icon: <IconClipboard size={15} />, disabled: !canPaste, onClick: guarded(() => onPaste(index + 1)) },
              ...(canViewCode ? [{ label: "Clear implementation", icon: <RefreshIcon size={15} />, tone: "danger" as const, onClick: guarded(() => onUpdate(section.id, { action: section.action, expected_result: section.expected_result, step_type: platform, automation_code: "", api_request: null })) }] : []),
              { label: "Remove section", icon: <TrashIcon size={15} />, tone: "danger", onClick: guarded(() => onRemove([section.id])) }
            ]} />
          </div> : null}
        </div>
        <div id={regionId} hidden={!expanded}>
          {expanded && !canViewCode ? <p className="muted">Executable instructions are hidden by your role.</p> : null}
          {expanded && canViewCode ? <AutomationInstructionPreview
            view={view} sectionName={name}
            code={platform === "api" ? "" : code}
            apiRequest={platform === "api" ? section.api_request : null}
            context={{ repository, parameterValues: safeValues, platform }}
            renderArgument={argument => <StepParameterizedText text={argument} values={values} sensitiveNames={sensitiveNames} />}
            emptyAction={canEditImplementation ? <button className="ghost-button compact" type="button" onClick={editInstructions}><AddIcon size={13} />Add instruction</button> : undefined}
          /> : null}
          {expanded && canEditImplementation && (hasProgram || section.api_request) ? <div className="automation-plan-actions"><button className="ghost-button compact" type="button" onClick={editInstructions}>Edit instructions</button></div> : null}
        </div>
      </article>;
    })}
    {dialog && canEdit ? <AutomationOverlay title={dialog.id ? "Edit section" : "Add section"} subtitle="Changes apply to this group draft. Save the Shared Section Group to persist them." icon={dialog.id ? <PencilIcon size={20} /> : <AddIcon size={20} />} onClose={() => setDialog(null)} variant="dialog">
      <fieldset className="automation-plan-editor" style={{ border: 0, margin: 0, minWidth: 0 }}>
        <div className="automation-plan-behavior-fields">
          <label className="form-field"><span>Section name</span><GherkinStepTextField ariaLabel="Section name" availableParameters={parameters} parameterValues={values} value={dialog.input.action || ""} onChange={action => updateInput({ action })} placeholder="For example, sign in with valid credentials" /></label>
          <label className="form-field"><span>Expected result</span><GherkinStepTextField ariaLabel="Expected result" availableParameters={parameters} parameterValues={values} value={dialog.input.expected_result || ""} onChange={expected_result => updateInput({ expected_result })} placeholder="Describe the expected outcome" /></label>
        </div>
        <label className="form-field"><span>Platform</span><select aria-label="Section platform" value={dialog.input.step_type || "web"} disabled={!canViewCode} onChange={event => updateInput({ step_type: event.target.value as TestStepType })}>{PLATFORMS.map(platform => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}</select></label>
        {canViewCode && dialog.input.step_type === "api" ? <label className="form-field"><span>API request JSON</span><textarea aria-label="API request JSON" className="automation-code-input" spellCheck={false} rows={12} value={dialog.apiSource} onChange={event => { const apiSource = event.target.value; setDialog(current => current ? { ...current, apiSource, error: "" } : null); }} placeholder={'{"method":"GET","url":"https://example.test/api","validations":[{"kind":"status","expected":"200"}]}'} /><small>Keep empty for a section without an API request. Authored requests, validations and captures are preserved.</small></label> : null}
        {canViewCode && (dialog.input.step_type !== "api" || stripAutomationSettingsComments(dialog.input.automation_code || "").trim()) ? view === "source" ? <label className="form-field"><span>Executable code</span><textarea aria-label="Executable code" className="automation-code-input" spellCheck={false} rows={12} value={dialog.input.automation_code || ""} onChange={event => updateInput({ automation_code: event.target.value })} /></label> : <AutomationCodeLines mode="instructions" value={dialog.input.automation_code || ""} onChange={automation_code => updateInput({ automation_code })} /> : null}
        {canViewCode ? <details><summary>Execution options</summary><div className="automation-plan-actions">{EXECUTION_OPTIONS.map(([key, label]) => <label className="checkbox-field" key={key}><input type="checkbox" checked={dialog.options[key]} onChange={event => { const checked = event.target.checked; setDialog(current => current ? { ...current, options: { ...current.options, [key]: checked } } : null); }} />{label}</label>)}</div></details> : null}
        {dialog.error ? <p className="error-text" role="alert">{dialog.error}</p> : null}
        <div className="automation-plan-actions"><button className="primary-button compact" type="button" disabled={!dialog.input.action?.trim()} onClick={applyDialog}>{dialog.id ? "Apply section" : "Add section"}</button><button className="ghost-button compact" type="button" onClick={() => setDialog(null)}>Cancel</button></div>
      </fieldset>
    </AutomationOverlay> : null}
  </section>;
}
