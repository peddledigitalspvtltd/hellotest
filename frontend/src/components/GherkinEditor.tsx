import { useId, useMemo, useRef, useState } from "react";
import { IconAlertTriangle, IconBraces, IconCheck, IconPlus } from "@tabler/icons-react";
import {
  composeGherkinDocument,
  matchGherkinKeyword,
  replaceGherkinBackground,
  replaceGherkinExamples,
  replaceGherkinScenarios,
  resolveGherkinParameterText,
  splitGherkinDocument,
  tokenizeGherkinInlineText,
  type GherkinDocumentSections
} from "../lib/gherkin";

type GherkinEditorProps = {
  value: string;
  onChange: (value: string) => void;
  featureTitle: string;
  parameterValues?: Record<string, string>;
  compact?: boolean;
  readOnly?: boolean;
};

type GherkinSectionSurfaceProps = {
  description: string;
  emptyMessage: string;
  kind: "background" | "scenarios" | "examples";
  label: string;
  onChange: (value: string) => void;
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
) => {
  const lines = [`Feature: ${featureTitle.trim() || "Describe the capability"}`];
  if (preconditions.length) {
    lines.push("", "  Background:");
    preconditions.forEach((step, index) => {
      lines.push(`    ${index === 0 ? "Given" : "And"} ${String(step.action || "Complete setup").trim()}`);
    });
  }
  lines.push("", `  Scenario: ${featureTitle.trim() || "Verify expected behavior"}`);
  steps.forEach((step, index) => {
    const action = String(step.action || "Perform the next action").trim();
    lines.push(`    ${index === 0 ? "When" : "And"} ${action}`);
    if (String(step.expected_result || "").trim()) lines.push(`    Then ${String(step.expected_result).trim()}`);
  });
  return lines.join("\n");
};

const validateGherkin = (value: string) => {
  const lines = value.split("\n");
  const issues: string[] = [];
  if (!lines.some((line) => /^\s*Feature\s*:/i.test(line))) issues.push("Add a Feature heading");
  if (!lines.some((line) => /^\s*Scenario(?: Outline| Template)?\s*:/i.test(line))) issues.push("Add at least one Scenario");
  lines.forEach((line, index) => {
    if (!/^\s*(?:Examples|Scenarios)\s*:/i.test(line)) return;
    const tableRows: string[] = [];
    for (const candidate of lines.slice(index + 1)) {
      if (/^\s*\|.*\|\s*$/.test(candidate)) { tableRows.push(candidate); continue; }
      if (!candidate.trim() && !tableRows.length) continue;
      break;
    }
    if (tableRows.length < 2) issues.push("Examples needs a header and at least one data row");
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

function GherkinSectionSurface({ description, emptyMessage, kind, label, onChange, onEditingChange, parameterValues, readOnly, value }: GherkinSectionSurfaceProps) {
  const sectionId = useId().replace(/:/g, "");
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = useMemo(() => isEditing ? value : resolveGherkinParameterText(value, parameterValues), [isEditing, parameterValues, value]);
  const lines = (displayValue || " ").split("\n");

  return (
    <section className={`gherkin-section-card is-${kind}${value.trim() ? " has-content" : " is-empty"}`} aria-labelledby={`${sectionId}-title`}>
      <header>
        <span className="gherkin-section-index">{kind === "background" ? "01" : kind === "scenarios" ? "02" : "03"}</span>
        <div><strong id={`${sectionId}-title`}>{label}</strong><span>{description}</span></div>
        <em>{kind === "scenarios" ? "Required" : "Optional"}</em>
      </header>
      {readOnly && !value.trim() ? <div className="gherkin-section-empty"><span>{emptyMessage}</span></div> : (
        <div className="gherkin-code-shell">
          <div aria-hidden="true" className="gherkin-line-numbers" ref={lineNumbersRef}>{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
          {!value.trim() ? <span className="gherkin-section-empty-hint">{emptyMessage}</span> : null}
          <pre aria-label={readOnly ? `${label} preview` : undefined} aria-readonly={readOnly || undefined} className="gherkin-highlight" ref={highlightRef} tabIndex={readOnly ? 0 : -1}>{lines.map(renderHighlightedLine)}</pre>
          {!readOnly ? <textarea
            aria-label={`${label} Gherkin`}
            onBlur={() => { setIsEditing(false); onEditingChange(false); }}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => { setIsEditing(true); onEditingChange(true); }}
            onScroll={(event) => {
              if (highlightRef.current) { highlightRef.current.scrollTop = event.currentTarget.scrollTop; highlightRef.current.scrollLeft = event.currentTarget.scrollLeft; }
              if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            spellCheck={false}
            value={value}
          /> : null}
        </div>
      )}
    </section>
  );
}

const scenarioText = (sections: GherkinDocumentSections) => sections.scenarios.map((item) => item.scenario).filter(Boolean).join("\n\n");
const examplesText = (sections: GherkinDocumentSections) => sections.scenarios.map((item) => item.examples).filter(Boolean).join("\n\n");

export function GherkinEditor({ value, onChange, featureTitle, parameterValues = {}, compact = false, readOnly = false }: GherkinEditorProps) {
  const editorId = useId().replace(/:/g, "");
  const [editingSection, setEditingSection] = useState("");
  const resolvedValue = value || starterDocument(featureTitle);
  const sections = useMemo(() => splitGherkinDocument(resolvedValue), [resolvedValue]);
  const issues = useMemo(() => validateGherkin(resolvedValue), [resolvedValue]);
  const preambleLines = sections.preamble.split("\n");
  const featureIndex = preambleLines.findIndex((line) => /^\s*Feature\s*:/i.test(line));
  const featureName = featureIndex >= 0 ? preambleLines[featureIndex].replace(/^\s*Feature\s*:\s*/i, "") : featureTitle;
  const preambleMetadata = preambleLines.filter((_, index) => index !== featureIndex).filter((line) => line.trim());
  const scenarios = scenarioText(sections);
  const examples = examplesText(sections);
  const scenarioCount = sections.scenarios.length;
  const hasResolvedData = resolveGherkinParameterText(resolvedValue, parameterValues) !== resolvedValue;
  const statusId = `${editorId}-status`;
  const commit = (next: GherkinDocumentSections) => onChange(composeGherkinDocument(next));

  const updateFeatureName = (name: string) => {
    const nextPreamble = [...preambleLines];
    if (featureIndex >= 0) nextPreamble[featureIndex] = `Feature: ${name}`;
    else nextPreamble.push(`Feature: ${name}`);
    commit({ ...sections, preamble: nextPreamble.join("\n") });
  };
  const addBackground = () => commit(replaceGherkinBackground(sections, sections.background || "Background:\n  Given "));
  const addScenario = () => commit({ ...sections, scenarios: [...sections.scenarios, { scenario: "Scenario: \n  Given \n  When \n  Then ", examples: "" }] });
  const addOutline = () => commit({ ...sections, scenarios: [...sections.scenarios, { scenario: "Scenario Outline: \n  Given <condition>\n  When <action>\n  Then <outcome>", examples: "Examples:\n  | condition | action | outcome |\n  |           |        |         |" }] });

  return (
    <section className={`gherkin-editor is-sectioned${compact ? " is-compact" : ""}${readOnly ? " is-readonly" : ""}`} aria-label="Gherkin test authoring">
      <div className="gherkin-editor-toolbar" role="toolbar" aria-label="Gherkin document actions">
        <div className="gherkin-editor-heading"><span className="gherkin-editor-icon"><IconBraces size={17} /></span><div><strong>Behavior specification</strong><span>Feature context with separately managed setup, behavior, and data.</span></div></div>
        {readOnly ? <span className="gherkin-editor-preview-badge"><IconCheck size={14} />Preview</span> : <div className="gherkin-editor-actions">
          <button className="ghost-button compact" disabled={Boolean(sections.background)} onClick={addBackground} type="button"><IconPlus size={13} />Background</button>
          <button className="ghost-button compact" onClick={addScenario} type="button"><IconPlus size={13} />Scenario</button>
          <button className="ghost-button compact" onClick={addOutline} type="button"><IconPlus size={13} />Outline + Examples</button>
        </div>}
      </div>
      <div className="gherkin-feature-bar">
        <span>Feature</span>
        {readOnly ? <strong>{resolveGherkinParameterText(featureName, parameterValues)}</strong> : <input aria-label="Feature name" onChange={(event) => updateFeatureName(event.target.value)} value={featureName} />}
        {preambleMetadata.length ? <small>{preambleMetadata.join(" · ")}</small> : null}
      </div>
      <div className="gherkin-section-grid">
        <GherkinSectionSurface description="Shared setup that runs before each scenario." emptyMessage="No shared Background is required for this Test Case." kind="background" label="Background" onChange={(background) => commit(replaceGherkinBackground(sections, background))} onEditingChange={(editing) => setEditingSection(editing ? "Background" : "")} parameterValues={parameterValues} readOnly={readOnly} value={sections.background} />
        <GherkinSectionSurface description="Given, When, and Then behavior flows." emptyMessage="Add at least one Scenario with observable behavior." kind="scenarios" label="Scenarios" onChange={(nextScenarios) => commit(replaceGherkinScenarios(sections, nextScenarios))} onEditingChange={(editing) => setEditingSection(editing ? "Scenarios" : "")} parameterValues={parameterValues} readOnly={readOnly} value={scenarios} />
        <GherkinSectionSurface description="Data rows associated with Scenario Outlines." emptyMessage="Examples appear here when a Scenario Outline needs data rows." kind="examples" label="Examples" onChange={(nextExamples) => commit(replaceGherkinExamples(sections, nextExamples))} onEditingChange={(editing) => setEditingSection(editing ? "Examples" : "")} parameterValues={parameterValues} readOnly={readOnly} value={examples} />
      </div>
      <div className={issues.length ? "gherkin-editor-status has-issues" : "gherkin-editor-status is-valid"} id={statusId} role="status">
        <span className="gherkin-editor-metrics"><strong>{scenarioCount}</strong> scenario{scenarioCount === 1 ? "" : "s"}<i />{resolvedValue.split("\n").length} lines</span>
        <span className="gherkin-editor-display-mode">{editingSection ? `Editing ${editingSection} variables` : hasResolvedData ? "Showing associated data values" : "Showing authoring template"}</span>
        <strong>{issues.length ? <IconAlertTriangle size={14} /> : <IconCheck size={14} />}{issues.length ? issues.join(" · ") : "Valid structure"}</strong>
      </div>
    </section>
  );
}
