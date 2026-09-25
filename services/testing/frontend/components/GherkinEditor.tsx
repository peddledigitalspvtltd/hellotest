import { type CSSProperties, type ChangeEvent, type ReactNode, type UIEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconAlertTriangle, IconBraces, IconCheck, IconPlus, IconTrash } from "@tabler/icons-react";
import { StepParameterizedText } from "./StepParameterizedText";
import { GherkinStepTextField } from "./GherkinStepTextField";
import { useGherkinStepReorder } from "./GherkinStepReorder";
import { BEHAVIOR_KEYWORDS, composeBehaviorBlock, parseBehaviorBlock, type BehaviorKeyword, type BehaviorStep } from "../lib/gherkinBehavior";
import { useStepParameterAutocomplete } from "@hellotest/platform/frontend/src/shared/components/StepParameterSuggestions";
import { excludeSensitiveStepParameterValues, insertStepParameterReference, type StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import {
  composeGherkinDocument,
  setGherkinFeatureTitle,
  matchGherkinKeyword,
  replaceGherkinBackground,
  resolveGherkinParameterText,
  splitGherkinDocument,
  tokenizeGherkinInlineText,
  structuredCaseToGherkin,
  type GherkinDocumentSections
} from "../lib/gherkin";

type GherkinEditorProps = {
  value: string;
  onChange: (value: string) => void;
  featureTitle: string;
  featureTitleLocked?: boolean;
  availableParameters?: StepParameterDefinition[];
  parameterValues?: Record<string, string>;
  compact?: boolean;
  readOnly?: boolean;
  exampleColumns?: string[];
  exampleRows?: Array<Record<string, string>>;
  minimalBehaviorEditor?: boolean;
  allowMultipleScenarios?: boolean;
};


function MinimalBehaviorBlock({ availableParameters, autoFocus = false, heading, headingLabel, onChange, parameterValues, readOnly, value }: { availableParameters: StepParameterDefinition[]; autoFocus?: boolean; heading: string; headingLabel: "Background" | "Scenario" | "Scenario Outline"; onChange: (value: string) => void; parameterValues: Record<string, string>; readOnly: boolean; value: string }) {
  const parsed = parseBehaviorBlock(value);
  const steps: BehaviorStep[] = parsed.steps.length ? parsed.steps : [{ keyword: "Given", text: "" }];
  const commit = (nextHeading: string, nextSteps: BehaviorStep[]) => onChange(composeBehaviorBlock(value, headingLabel, nextHeading, nextSteps));
  const reorder = useGherkinStepReorder(steps, (next) => commit(heading, next));
  const insertAfter = (index: number) => {
    const next = [...steps];
    next.splice(index + 1, 0, { keyword: steps[index]?.keyword === "When" ? "Then" : "And", text: "", group: steps[index]?.group });
    commit(heading, next);
  };
  const blocks = steps.reduce<Array<{ group?: BehaviorStep["group"]; indices: number[] }>>((result, step, index) => {
    const previous = result[result.length - 1];
    if (step.group && previous?.group?.id === step.group.id) previous.indices.push(index);
    else result.push({ group: step.group, indices: [index] });
    return result;
  }, []);
  const renderStep = (index: number) => {
    const step = steps[index];
    return <div {...(!readOnly ? reorder.rowProps(index) : {})} className="gherkin-minimal-step" key={index}>
      <select aria-label={`Gherkin keyword for behavior step ${index + 1}`} className={`is-${step.keyword.toLowerCase()}`} disabled={readOnly} onChange={(event) => commit(heading, steps.map((item, itemIndex) => itemIndex === index ? { ...item, keyword: event.target.value as BehaviorKeyword } : item))} value={step.keyword}>{BEHAVIOR_KEYWORDS.map((keyword) => <option key={keyword}>{keyword}</option>)}</select>
      {readOnly ? <span className="gherkin-minimal-description"><StepParameterizedText fallback={resolveGherkinParameterText(step.text, parameterValues) || step.text} text={step.text} values={parameterValues} /></span> : <GherkinStepTextField availableParameters={availableParameters} ariaLabel={`Behavior step ${index + 1}`} onChange={(text) => commit(heading, steps.map((item, itemIndex) => itemIndex === index ? { ...item, text } : item))} parameterValues={parameterValues} placeholder="Describe behavior and use parameters where needed" value={step.text} />}
      {!readOnly ? <span className="gherkin-minimal-step-actions"><button aria-label={`Insert behavior step after ${index + 1}`} onClick={() => insertAfter(index)} title="Insert behavior step" type="button">+</button>{reorder.controls(index, `behavior step ${index + 1}`)}<button aria-label={`Remove behavior step ${index + 1}`} disabled={steps.length === 1} onClick={() => commit(heading, steps.filter((_, itemIndex) => itemIndex !== index))} type="button"><IconTrash size={13} /></button></span> : null}
    {step.followingLines?.some((line) => line.trim()) ? <pre className="gherkin-minimal-step-arguments" style={{ gridColumn: "1 / -1", whiteSpace: "pre-wrap", margin: 0 }}>{resolveGherkinParameterText(step.followingLines.join("\n"), parameterValues)}</pre> : null}</div>;
  };
  return <section className="gherkin-minimal-block">
    <div className="gherkin-minimal-heading"><strong>{headingLabel}:</strong>{headingLabel !== "Background" ? <input autoFocus={autoFocus} aria-label={`${headingLabel} name`} disabled={readOnly} onChange={(event) => commit(event.target.value, steps)} placeholder="Describe the behavior" value={heading} /> : null}</div>
    <div className="gherkin-minimal-steps">{blocks.map((block) => block.group ? (
      <details className="gherkin-shared-step-group" key={`${block.group.id}:${block.indices[0]}`}>
        <summary><strong>{block.group.name}</strong><span>{block.indices.length} behavior step{block.indices.length === 1 ? "" : "s"}</span></summary>
        <div className="gherkin-minimal-steps">{block.indices.map(renderStep)}</div>
      </details>
    ) : block.indices.map(renderStep))}</div>
    {!readOnly ? <button className="gherkin-minimal-add-step" onClick={() => commit(heading, [...steps, { keyword: steps[steps.length - 1]?.keyword === "When" ? "Then" : "And", text: "" }])} type="button"><IconPlus size={14} />Add behavior step</button> : null}
  </section>;
}

type GherkinSectionSurfaceProps = {
  availableParameters: StepParameterDefinition[];
  actions?: ReactNode;
  autoFocus?: boolean;
  description: string;
  emptyMessage: string;
  invalid?: boolean;
  kind: "background" | "scenarios" | "examples";
  label: string;
  onChange: (value: string) => void;
  onAutoFocus?: () => void;
  onEditingChange: (editing: boolean) => void;
  parameterValues: Record<string, string>;
  readOnly: boolean;
  value: string;
};

const starterDocument = (featureTitle: string) => `Feature: ${featureTitle.trim() || "Describe the capability"}

  Background:
    Given the required preconditions are satisfied

  Scenario: Describe the expected behavior
    When the user performs an action
    Then the expected outcome is observed`;

export const buildGherkinFromSteps = (
  featureTitle: string,
  preconditions: Array<{ action?: string | null }>,
  steps: Array<{ action?: string | null; expected_result?: string | null }>
) => structuredCaseToGherkin({ title: featureTitle, preconditions, steps });

const validateGherkin = (value: string) => {
  const lines = value.split("\n");
  const issues: string[] = [];
  const featureLine = lines.find((line) => /^\s*Feature\s*:/i.test(line));
  if (!featureLine) issues.push("Add a Feature heading");
  else if (!featureLine.replace(/^\s*Feature\s*:\s*/i, "").trim()) issues.push("Name the Feature");
  const scenarioIndices = lines.reduce<number[]>((indices, line, index) => {
    if (/^\s*Scenario(?: Outline| Template)?\s*:/i.test(line)) indices.push(index);
    return indices;
  }, []);
  if (!scenarioIndices.length) issues.push("Add at least one Scenario");
  scenarioIndices.forEach((start, scenarioIndex) => {
    const heading = lines[start];
    const end = scenarioIndices[scenarioIndex + 1] ?? lines.length;
    if (!heading.replace(/^\s*Scenario(?: Outline| Template)?\s*:\s*/i, "").trim()) issues.push(`Name Scenario ${scenarioIndex + 1}`);
    if (!lines.slice(start + 1, end).some((line) => /^\s*(?:Given|When|Then|And|But|\*)\b/i.test(line))) issues.push(`Add behavior steps to Scenario ${scenarioIndex + 1}`);
  });
  lines.forEach((line, index) => {
    if (!/^\s*(?:Examples|Scenarios)\s*:/i.test(line)) return;
    const tableRows: string[] = [];
    for (const candidate of lines.slice(index + 1)) {
      if (/^\s*\|.*\|\s*$/.test(candidate)) { tableRows.push(candidate); continue; }
      if (!candidate.trim() && !tableRows.length) continue;
      break;
    }
    if (tableRows.length < 2) issues.push("Examples needs a header and at least one data row");
    else {
      const columnCount = tableRows[0].split("|").slice(1, -1).length;
      if (tableRows.some((row) => row.split("|").slice(1, -1).length !== columnCount)) issues.push("Examples rows must use the same number of columns");
    }
  });
  lines.forEach((line, index) => {
    if (!/^\s*Scenario(?: Outline| Template)\s*:/i.test(line)) return;
    const nextScenarioOffset = lines.slice(index + 1).findIndex((candidate) => /^\s*Scenario(?: Outline| Template)?\s*:/i.test(candidate));
    const blockEnd = nextScenarioOffset < 0 ? lines.length : index + 1 + nextScenarioOffset;
    if (!lines.slice(index + 1, blockEnd).some((candidate) => /^\s*(?:Examples|Scenarios)\s*:/i.test(candidate))) issues.push("Every Scenario Outline needs Examples");
  });
  return [...new Set(issues)];
};

const renderInlineText = (text: string, lineIndex: number) => tokenizeGherkinInlineText(text).map((segment, segmentIndex) => (
  <span className={segment.type === "parameter" ? "is-parameter" : segment.type === "string" ? "is-string" : undefined} key={`${lineIndex}:${segmentIndex}:${segment.value}`}>{segment.value}</span>
));

const renderHighlightedLine = (line: string, index: number) => {
  const match = matchGherkinKeyword(line);
  if (!match) {
    const isTable = /^\s*\|.*\|\s*$/.test(line);
    const isComment = /^\s*#/.test(line);
    const isTag = /^\s*@/.test(line);
    const isDocString = /^\s*(?:"""|```)/.test(line);
    return <span className={`gherkin-code-line${isTable ? " is-table" : isComment ? " is-comment" : isTag ? " is-tag" : isDocString ? " is-doc-string" : ""}`} key={`${index}:${line}`}>{line ? (isTag || isComment ? line : renderInlineText(line, index)) : " "}</span>;
  }
  return <span className="gherkin-code-line" key={`${index}:${line}`}>{match.indent}<strong className={match.kind === "step" ? "is-step-keyword" : "is-section-keyword"}>{match.keyword}{match.colon}</strong><span className="is-description">{renderInlineText(match.rest, index)}</span></span>;
};

function GherkinSectionSurface({ availableParameters, actions, autoFocus = false, description, emptyMessage, invalid = false, kind, label, onAutoFocus, onChange, onEditingChange, parameterValues, readOnly, value }: GherkinSectionSurfaceProps) {
  const sectionId = useId().replace(/:/g, "");
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [activeLineTop, setActiveLineTop] = useState(14);
  const autocomplete = useStepParameterAutocomplete({
    availableParameters,
    parameterValues,
    onSelect: (parameter, query) => {
      const next = insertStepParameterReference(value, query, parameter);
      onChange(next.value);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(next.caret, next.caret);
      });
    }
  });
  const updateSuggestions = (target: HTMLTextAreaElement) => autocomplete.update(target.value, target.selectionStart, target.selectionEnd, target);
  const displayValue = useMemo(() => isEditing ? value : resolveGherkinParameterText(value, parameterValues), [isEditing, parameterValues, value]);
  const lines = (displayValue || " ").split("\n");

  useEffect(() => {
    if (!autoFocus || readOnly || !textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    updateActiveLine(textarea);
    onAutoFocus?.();
  }, [autoFocus, onAutoFocus, readOnly]);

  const updateActiveLine = (target: HTMLTextAreaElement) => {
    const style = window.getComputedStyle(target);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const paddingTop = Number.parseFloat(style.paddingTop) || 14;
    const lineIndex = target.value.slice(0, target.selectionStart).split("\n").length - 1;
    setActiveLineTop(paddingTop + (lineIndex * lineHeight) - target.scrollTop);
  };

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop;
      highlightRef.current.scrollLeft = target.scrollLeft;
    }
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = target.scrollTop;
    updateActiveLine(target);
  };

  const changeValue = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
    updateActiveLine(event.target);
    updateSuggestions(event.target);
  };

  return (
    <section className={`gherkin-section-card is-${kind}${value.trim() ? " has-content" : " is-empty"}${invalid ? " has-validation-issue" : ""}`} aria-labelledby={`${sectionId}-title`}>
      <header>
        <div className="gherkin-section-title">
          <div>
            <strong id={`${sectionId}-title`}>{label}</strong>
            <span id={`${sectionId}-description`}>{description}</span>
          </div>
          <em>{kind === "scenarios" ? "Required" : "Optional"}</em>
        </div>
        {actions ? <div className="gherkin-section-actions">{actions}</div> : null}
      </header>
      {!value.trim() ? <div className="gherkin-section-empty"><span>{emptyMessage}</span></div> : (
        <div className="gherkin-code-shell" style={{ "--gherkin-visible-lines": Math.max(lines.length, 1) } as CSSProperties}>
          <div aria-hidden="true" className="gherkin-line-numbers" ref={lineNumbersRef}>{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
          {!value.trim() ? <span className="gherkin-section-empty-hint">{emptyMessage}</span> : null}
          {isEditing ? <span aria-hidden="true" className="gherkin-active-line" style={{ top: activeLineTop } as CSSProperties} /> : null}
          <pre aria-hidden={readOnly ? undefined : true} aria-label={readOnly ? `${label} Gherkin` : undefined} className="gherkin-highlight" ref={highlightRef} role={readOnly ? "region" : undefined} tabIndex={readOnly ? 0 : -1}>{lines.map(renderHighlightedLine)}</pre>
          {!readOnly ? <textarea
            {...autocomplete.inputProps}
            aria-describedby={`${sectionId}-description`}
            aria-invalid={invalid || undefined}
            aria-label={`${label} Gherkin`}
            onBlur={() => { setIsEditing(false); onEditingChange(false); autocomplete.dismiss(); }}
            onChange={changeValue}
            onClick={(event) => { updateActiveLine(event.currentTarget); updateSuggestions(event.currentTarget); }}
            onFocus={(event) => { setIsEditing(true); onEditingChange(true); updateActiveLine(event.currentTarget); }}
            onKeyDown={autocomplete.onKeyDown}
            onKeyUp={(event) => {
              updateActiveLine(event.currentTarget);
              if (!["Escape", "Enter", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) updateSuggestions(event.currentTarget);
            }}
            onScroll={syncScroll}
            onSelect={(event) => updateActiveLine(event.currentTarget)}
            ref={textareaRef}
            role="combobox"
            spellCheck={false}
            value={value}
          /> : null}
        </div>
      )}
      {autocomplete.menu}
    </section>
  );
}

const escapeExampleCell = (value: string) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const composeLinkedExamples = (columns: string[], rows: Array<Record<string, string>>) => [
  "Examples:",
  `  | ${columns.map(escapeExampleCell).join(" | ")} |`,
  ...rows.map((row) => `  | ${columns.map((column) => escapeExampleCell(row[column] || "")).join(" | ")} |`)
].join("\n");

export function GherkinEditor({ value, onChange, featureTitle, featureTitleLocked = false, availableParameters = [], parameterValues: suppliedParameterValues = {}, compact = false, readOnly = false, exampleColumns = [], exampleRows = [], minimalBehaviorEditor = false, allowMultipleScenarios = false }: GherkinEditorProps) {
  const editorId = useId().replace(/:/g, "");
  const parameterValues = useMemo(() => excludeSensitiveStepParameterValues(suppliedParameterValues, availableParameters.filter((parameter) => parameter.sensitive).map((parameter) => parameter.name)), [availableParameters, suppliedParameterValues]);
  const [editingSection, setEditingSection] = useState("");
  const [focusTarget, setFocusTarget] = useState("");
  const parsedSections = useMemo(() => splitGherkinDocument(featureTitleLocked ? setGherkinFeatureTitle(value, featureTitle) : value), [featureTitle, featureTitleLocked, value]);
  const [sections, setSections] = useState<GherkinDocumentSections>(parsedSections);
  const lastEmittedDocumentRef = useRef(value);
  const hadLinkedExamplesRef = useRef(Boolean(exampleColumns.length && exampleRows.length));
  const resolvedValue = useMemo(() => composeGherkinDocument(sections), [sections]);
  const issues = useMemo(() => validateGherkin(resolvedValue), [resolvedValue]);
  const preambleLines = sections.preamble.split("\n");
  const featureIndex = preambleLines.findIndex((line) => /^\s*Feature\s*:/i.test(line));
  const featureName = featureIndex >= 0 ? preambleLines[featureIndex].replace(/^\s*Feature\s*:\s*/i, "") : "";
  const preambleMetadata = preambleLines.filter((_, index) => index !== featureIndex).filter((line) => line.trim());
  const scenarioCount = sections.scenarios.length;
  const hasLinkedExamples = Boolean(exampleColumns.length && exampleRows.length);
  const hasResolvedData = resolveGherkinParameterText(resolvedValue, parameterValues) !== resolvedValue;
  const statusId = `${editorId}-status`;
  const commit = (next: GherkinDocumentSections) => {
    const document = featureTitleLocked ? setGherkinFeatureTitle(composeGherkinDocument(next), featureTitle) : composeGherkinDocument(next);
    setSections(featureTitleLocked ? splitGherkinDocument(document) : next);
    lastEmittedDocumentRef.current = document;
    onChange(document);
  };

  useEffect(() => {
    if (value === lastEmittedDocumentRef.current && (!featureTitleLocked || featureName === featureTitle.trim())) return;
    lastEmittedDocumentRef.current = value;
    setSections(parsedSections);
    setEditingSection("");
    setFocusTarget("");
  }, [featureName, featureTitle, featureTitleLocked, parsedSections, value]);

  useEffect(() => {
    if (readOnly || !sections.scenarios.length) return;
    if ((!exampleColumns.length || !exampleRows.length) && hadLinkedExamplesRef.current) {
      hadLinkedExamplesRef.current = false;
      commit({ ...sections, scenarios: sections.scenarios.map((item) => ({ ...item, examples: "", scenario: item.scenario.replace(/^(\s*)Scenario(?: Outline| Template)\s*:/im, "$1Scenario:") })) });
      return;
    }
    if (!exampleColumns.length || !exampleRows.length) return;
    hadLinkedExamplesRef.current = true;
    const examples = composeLinkedExamples(exampleColumns, exampleRows);
    const nextScenarios = sections.scenarios.map((item) => ({
      scenario: item.scenario.replace(/^(\s*)Scenario\s*:/im, "$1Scenario Outline:"),
      examples
    }));
    if (nextScenarios.every((item, index) => item.scenario === sections.scenarios[index].scenario && item.examples === sections.scenarios[index].examples)) return;
    commit({ ...sections, scenarios: nextScenarios });
  }, [exampleColumns, exampleRows, readOnly, sections]);

  const updateFeatureName = (name: string) => {
    const nextPreamble = [...preambleLines];
    if (featureIndex >= 0) nextPreamble[featureIndex] = `Feature: ${name}`;
    else nextPreamble.push(`Feature: ${name}`);
    commit({ ...sections, preamble: nextPreamble.join("\n") });
  };
  const addBackground = () => {
    setFocusTarget("background");
    commit(replaceGherkinBackground(sections, "Background:\n  Given "));
  };
  const addBackgroundStep = () => {
    setFocusTarget("background");
    commit(replaceGherkinBackground(
      sections,
      `${sections.background.trimEnd() || "Background:"}\n  ${/^\s*Background\s*:\s*$/i.test(sections.background.trim()) ? "Given" : "And"} `
    ));
  };
  const addScenario = () => {
    setFocusTarget(`scenario-${sections.scenarios.length}`);
    commit({ ...sections, preamble: sections.preamble.trim() ? sections.preamble : `Feature: ${featureTitle.trim() || "Story behavior"}`, scenarios: [...sections.scenarios, { scenario: "Scenario: \n  Given \n  When \n  Then ", examples: "" }] });
  };
  const addOutline = () => {
    setFocusTarget(`scenario-${sections.scenarios.length}`);
    commit({ ...sections, scenarios: [...sections.scenarios, { scenario: "Scenario Outline: \n  Given <condition>\n  When <action>\n  Then <outcome>", examples: "Examples:\n  | condition | action | outcome |\n  |           |        |         |" }] });
  };
  const updateScenario = (index: number, field: "scenario" | "examples", nextValue: string) => commit({
    ...sections,
    scenarios: sections.scenarios.map((item, scenarioIndex) => {
      if (scenarioIndex !== index) return item;
      if (field === "examples" && nextValue.trim()) return { ...item, examples: nextValue, scenario: item.scenario.replace(/^(\s*)Scenario\s*:/im, "$1Scenario Outline:") };
      return { ...item, [field]: nextValue };
    })
  });
  const createExamples = (index: number) => {
    setFocusTarget(`examples-${index}`);
    updateScenario(index, "examples", "Examples:\n  | value |\n  |       |");
  };
  const addExampleRow = (index: number) => {
    const examples = sections.scenarios[index]?.examples.trimEnd() || "Examples:\n  | value |";
    const header = examples.split("\n").find((line) => /^\s*\|.*\|\s*$/.test(line));
    const columnCount = Math.max(1, header?.split("|").slice(1, -1).length || 1);
    const row = `  | ${Array.from({ length: columnCount }, () => "     ").join(" | ")} |`;
    setFocusTarget(`examples-${index}`);
    updateScenario(index, "examples", `${examples}\n${row}`);
  };
  const removeScenario = (index: number) => commit({ ...sections, scenarios: sections.scenarios.filter((_, scenarioIndex) => scenarioIndex !== index) });
  const insertStarter = () => {
    setFocusTarget("background");
    commit(splitGherkinDocument(starterDocument(featureTitle)));
  };

  return (
    <section className={`gherkin-editor is-sectioned${minimalBehaviorEditor ? " is-document-layout" : ""}${compact ? " is-compact" : ""}${readOnly ? " is-readonly" : ""}`} aria-label="Gherkin test authoring">
      <div className="gherkin-editor-toolbar" role="group" aria-label="Gherkin document overview">
        <div className="gherkin-editor-heading"><span className="gherkin-editor-icon"><IconBraces size={17} /></span><div><strong>Gherkin specification</strong><span>Write executable behavior with focused setup, scenarios, and example data.</span></div></div>
        <div className="gherkin-editor-toolbar-end">
          {!readOnly && !resolvedValue.trim() ? <button className="gherkin-insert-starter" onClick={insertStarter} type="button"><IconPlus size={14} />Insert starter</button> : null}
          <span className={`gherkin-editor-state${issues.length ? " has-issues" : " is-valid"}`}>{issues.length ? <IconAlertTriangle size={14} /> : <IconCheck size={14} />}{readOnly ? issues.length ? "Needs review" : "Details" : issues.length ? `${issues.length} check${issues.length === 1 ? "" : "s"}` : "Ready"}</span>
        </div>
      </div>
      <div className="gherkin-section-grid">
        <div className="gherkin-feature-bar">
          <div><span>Feature:</span><small>{featureTitleLocked ? "Linked Requirement" : "Capability under test"}</small></div>
          {readOnly || featureTitleLocked ? <strong>{(featureTitleLocked ? featureTitle : resolveGherkinParameterText(featureName, parameterValues)) || "No Feature defined"}</strong> : <input aria-invalid={!featureName.trim() || undefined} aria-label="Feature name" onChange={(event) => updateFeatureName(event.target.value)} placeholder={featureTitle.trim() ? `e.g. ${featureTitle.trim()}` : "Name the behavior this specification covers"} value={featureName} />}
          {preambleMetadata.length ? <small>{preambleMetadata.join(" · ")}</small> : null}
        </div>
        {minimalBehaviorEditor ? (sections.background.trim() ? <MinimalBehaviorBlock availableParameters={availableParameters} heading="" headingLabel="Background" onChange={(background) => commit(replaceGherkinBackground(sections, background))} parameterValues={parameterValues} readOnly={readOnly} value={sections.background} /> : !readOnly ? <button className="gherkin-minimal-add-background" onClick={addBackground} type="button"><IconPlus size={14} />Add Background</button> : null) :
        <GherkinSectionSurface
          availableParameters={availableParameters}
          actions={!readOnly ? sections.background ? <button className="gherkin-section-action" onClick={addBackgroundStep} type="button"><IconPlus size={14} />Add step</button> : <button className="gherkin-section-action" onClick={addBackground} type="button"><IconPlus size={14} />Create</button> : undefined}
          autoFocus={focusTarget === "background"}
          description="Setup shared by every scenario. Keep it empty when no common precondition exists."
          emptyMessage="No Background is needed yet. Create one only for setup shared by every scenario."
          invalid={Boolean(sections.background.trim()) && !/^\s*Background\s*:/i.test(sections.background)}
          kind="background"
          label="Background"
          onAutoFocus={() => setFocusTarget("")}
          onChange={(background) => commit(replaceGherkinBackground(sections, background))}
          onEditingChange={(editing) => setEditingSection(editing ? "Background" : "")}
          parameterValues={parameterValues}
          readOnly={readOnly}
          value={sections.background}
        />}
        <section aria-labelledby={`${editorId}-scenarios-title`} className="gherkin-scenario-region">
          <header className="gherkin-scenario-region-head">
            <div><strong id={`${editorId}-scenarios-title`}>{scenarioCount === 1 ? "Scenario" : "Scenarios"}</strong><span>{scenarioCount ? `${scenarioCount} behavior flow${scenarioCount === 1 ? "" : "s"}.` : "Create the first observable behavior flow."}</span></div>
            {allowMultipleScenarios && !readOnly ? <button className="ghost-button compact gherkin-add-scenario" onClick={addScenario} type="button"><IconPlus size={14} />Add Scenario</button> : null}
          </header>
          {!sections.scenarios.length ? <div className="gherkin-region-empty"><span>No Scenario is defined. Insert the starter structure to begin.</span></div> : (
            <div className="gherkin-scenario-list">
              {sections.scenarios.map((item, index) => {
                const isOutline = /^\s*Scenario(?: Outline| Template)\s*:/im.test(item.scenario);
                const scenarioHeading = item.scenario.match(/^[ \t]*Scenario(?: Outline| Template)?[ \t]*:[ \t]*(.*)$/im);
                const scenarioIsInvalid = !scenarioHeading?.[1]?.trim() || !/^\s*(?:Given|When|Then|And|But|\*)\b/im.test(item.scenario);
                const exampleRows = item.examples.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
                return (
                  <div className="gherkin-scenario-block" key={index}>
                    {minimalBehaviorEditor && allowMultipleScenarios && !readOnly ? <button aria-label={`Remove scenario ${index + 1}`} className="gherkin-section-action is-danger gherkin-remove-scenario" onClick={() => removeScenario(index)} title="Remove scenario" type="button"><IconTrash size={14} /></button> : null}
                    {minimalBehaviorEditor ? <MinimalBehaviorBlock
                      availableParameters={availableParameters}
                      autoFocus={focusTarget === `scenario-${index}`}
                      heading={scenarioHeading?.[1] || ""}
                      headingLabel={isOutline || item.examples.trim() ? "Scenario Outline" : "Scenario"}
                      onChange={(nextScenario) => updateScenario(index, "scenario", nextScenario)}
                      parameterValues={parameterValues}
                      readOnly={readOnly}
                      value={item.scenario}
                    /> : <GherkinSectionSurface
                      availableParameters={availableParameters}
                      actions={!readOnly ? <button aria-label={`Remove scenario ${index + 1}`} className="gherkin-section-action is-danger" onClick={() => removeScenario(index)} title="Remove scenario" type="button"><IconTrash size={14} /></button> : undefined}
                      autoFocus={focusTarget === `scenario-${index}`}
                      description={`${index + 1} of ${scenarioCount} · ${isOutline ? "Data-driven flow" : "Given, When, and Then behavior"}`}
                      emptyMessage="Write a Scenario heading and its observable behavior."
                      invalid={scenarioIsInvalid}
                      kind="scenarios"
                      label={isOutline ? "Scenario Outline" : "Scenario"}
                      onAutoFocus={() => setFocusTarget("")}
                      onChange={(nextScenario) => updateScenario(index, "scenario", nextScenario)}
                      onEditingChange={(editing) => setEditingSection(editing ? `Scenario ${index + 1}` : "")}
                      parameterValues={parameterValues}
                      readOnly={readOnly}
                      value={item.scenario}
                    />}
                    {!hasLinkedExamples && (isOutline || item.examples.trim()) ? <GherkinSectionSurface
                      availableParameters={availableParameters}
                      actions={!readOnly ? item.examples.trim()
                        ? <button className="gherkin-section-action" onClick={() => addExampleRow(index)} type="button"><IconPlus size={14} />Add row</button>
                        : <button className="gherkin-section-action" onClick={() => createExamples(index)} type="button"><IconPlus size={14} />Create table</button>
                        : undefined}
                      autoFocus={focusTarget === `examples-${index}`}
                      description={`Data rows owned by Scenario Outline ${index + 1}.`}
                      emptyMessage="Add a header and at least one data row for this Scenario Outline."
                      invalid={exampleRows.length < 2}
                      kind="examples"
                      label="Examples"
                      onAutoFocus={() => setFocusTarget("")}
                      onChange={(nextExamples) => updateScenario(index, "examples", nextExamples)}
                      onEditingChange={(editing) => setEditingSection(editing ? `Examples ${index + 1}` : "")}
                      parameterValues={parameterValues}
                      readOnly={readOnly}
                      value={item.examples}
                    /> : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <div aria-label="Gherkin document status" className={issues.length ? "gherkin-editor-status has-issues" : "gherkin-editor-status is-valid"} id={statusId}>
        <span className="gherkin-editor-metrics"><strong>{scenarioCount}</strong> scenario{scenarioCount === 1 ? "" : "s"}<i />{resolvedValue.trim() ? resolvedValue.split("\n").length : 0} lines</span>
        <span className="gherkin-editor-display-mode">{editingSection ? `Editing ${editingSection} variables` : hasResolvedData ? "Showing associated data values" : "Showing authoring template"}</span>
        <strong>{issues.length ? <IconAlertTriangle size={14} /> : <IconCheck size={14} />}{issues.length ? issues.join(" · ") : "Valid structure"}</strong>
      </div>
    </section>
  );
}
