import { useMemo, useRef } from "react";

type GherkinEditorProps = {
  value: string;
  onChange: (value: string) => void;
  featureTitle: string;
};

const KEYWORD_PATTERN = /^(\s*)(Feature|Rule|Background|Scenario Outline|Scenario|Examples|Given|When|Then|And|But)(:)?(.*)$/i;
const STEP_KEYWORDS = new Set(["given", "when", "then", "and", "but"]);

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
    if (String(step.expected_result || "").trim()) {
      lines.push(`    Then ${String(step.expected_result).trim()}`);
    }
  });
  return lines.join("\n");
};

const validateGherkin = (value: string) => {
  const lines = value.split("\n");
  const issues: string[] = [];
  if (!lines.some((line) => /^\s*Feature\s*:/i.test(line))) issues.push("Add a Feature heading");
  if (!lines.some((line) => /^\s*Scenario(?: Outline)?\s*:/i.test(line))) issues.push("Add at least one Scenario");
  const examplesLine = lines.findIndex((line) => /^\s*Examples\s*:/i.test(line));
  if (examplesLine >= 0 && !lines.slice(examplesLine + 1).some((line) => /^\s*\|.*\|\s*$/.test(line))) {
    issues.push("Examples needs a data table");
  }
  return issues;
};

const appendBlock = (value: string, block: string) => `${value.trimEnd()}\n\n${block}\n`;

export function GherkinEditor({ value, onChange, featureTitle }: GherkinEditorProps) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const resolvedValue = value || starterDocument(featureTitle);
  const issues = useMemo(() => validateGherkin(resolvedValue), [resolvedValue]);
  const lines = resolvedValue.split("\n");

  const append = (block: string) => onChange(appendBlock(resolvedValue, block));

  return (
    <section className="gherkin-editor" aria-label="Gherkin test authoring">
      <div className="gherkin-editor-toolbar" role="toolbar" aria-label="Insert Gherkin section">
        <div>
          <strong>Behavior specification</strong>
          <span>Feature, setup, scenarios, and examples stay together as one executable document.</span>
        </div>
        <div className="gherkin-editor-actions">
          <button className="ghost-button compact" onClick={() => append("  Background:\n    Given ")} type="button">Background</button>
          <button className="ghost-button compact" onClick={() => append("  Scenario: \n    Given \n    When \n    Then ")} type="button">Scenario</button>
          <button className="ghost-button compact" onClick={() => append("  Scenario Outline: \n    Given <condition>\n    When <action>\n    Then <outcome>\n\n    Examples:\n      | condition | action | outcome |\n      |           |        |         |")} type="button">Outline + Examples</button>
        </div>
      </div>
      <div className="gherkin-code-shell">
        <pre aria-hidden="true" className="gherkin-highlight" ref={highlightRef}>
          {lines.map((line, index) => {
            const match = line.match(KEYWORD_PATTERN);
            if (!match) {
              const isTable = /^\s*\|.*\|\s*$/.test(line);
              const isComment = /^\s*#/.test(line);
              return <span className={isTable ? "is-table" : isComment ? "is-comment" : undefined} key={`${index}:${line}`}>{line || " "}{"\n"}</span>;
            }
            const [, indent, keyword, colon = "", rest] = match;
            return (
              <span key={`${index}:${line}`}>
                {indent}<strong className={STEP_KEYWORDS.has(keyword.toLowerCase()) ? "is-step-keyword" : "is-section-keyword"}>{keyword}{colon}</strong>{rest}{"\n"}
              </span>
            );
          })}
        </pre>
        <textarea
          aria-describedby="gherkin-editor-status"
          aria-label="Gherkin document"
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (!highlightRef.current) return;
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          rows={18}
          spellCheck={false}
          value={resolvedValue}
        />
      </div>
      <div className={issues.length ? "gherkin-editor-status has-issues" : "gherkin-editor-status is-valid"} id="gherkin-editor-status" role="status">
        <span>{lines.length} lines · {lines.filter((line) => /^\s*Scenario(?: Outline)?\s*:/i.test(line)).length} scenarios</span>
        <strong>{issues.length ? issues.join(" · ") : "Structure is ready"}</strong>
      </div>
    </section>
  );
}
