import { useMemo, useRef } from "react";
import { IconCheck, IconFileDescription, IconPlus } from "@tabler/icons-react";

type SpecKitSectionKey = "intent" | "outcomes" | "requirements" | "acceptance" | "edgeCases" | "nonFunctional";

type SpecKitSectionDefinition = {
  key: SpecKitSectionKey;
  heading: string;
  description: string;
  placeholder: string;
};

const SECTION_DEFINITIONS: SpecKitSectionDefinition[] = [
  { key: "intent", heading: "Intent", description: "Problem, scope, and intended product result.", placeholder: "Describe the problem and intended outcome." },
  { key: "outcomes", heading: "User outcomes", description: "People affected and the value they should receive.", placeholder: "Describe who benefits and how." },
  { key: "requirements", heading: "Functional requirements", description: "Observable product behavior required for delivery.", placeholder: "- The product MUST…" },
  { key: "acceptance", heading: "Acceptance criteria", description: "Reviewable rules that establish completion.", placeholder: "- Given… when… then…" },
  { key: "edgeCases", heading: "Edge cases", description: "Boundary, recovery, and failure behavior.", placeholder: "- When… the product SHOULD…" },
  { key: "nonFunctional", heading: "Non-functional requirements", description: "Performance, security, accessibility, and reliability.", placeholder: "- The experience MUST…" }
];

type SpecKitSections = Record<SpecKitSectionKey, string>;

const emptySections = (): SpecKitSections => ({
  intent: "",
  outcomes: "",
  requirements: "",
  acceptance: "",
  edgeCases: "",
  nonFunctional: ""
});

const normalizeHeading = (value: string) => value.trim().replace(/^#{1,6}\s*/, "").replace(/:$/, "").toLowerCase();

export function splitSpecKitDocument(value: string): SpecKitSections {
  const sections = emptySections();
  const headingByName = new Map(SECTION_DEFINITIONS.map((section) => [normalizeHeading(section.heading), section.key]));
  let activeKey: SpecKitSectionKey = "intent";

  value.split(/\r?\n/).forEach((line) => {
    const matchedKey = headingByName.get(normalizeHeading(line));
    if (matchedKey) {
      activeKey = matchedKey;
      return;
    }
    sections[activeKey] = `${sections[activeKey]}${sections[activeKey] ? "\n" : ""}${line}`;
  });

  SECTION_DEFINITIONS.forEach(({ key }) => {
    sections[key] = sections[key].trim();
  });
  return sections;
}

export function composeSpecKitDocument(sections: SpecKitSections) {
  return SECTION_DEFINITIONS
    .map(({ key, heading }) => `${heading}\n${sections[key].trim()}`.trimEnd())
    .join("\n\n");
}

const renderHighlightedSpecKitLine = (line: string, lineIndex: number) => {
  const fragments = line.split(/(\[[^\]]+\]|\b(?:MUST NOT|SHOULD NOT|MUST|SHOULD|MAY)\b|^\s*(?:[-*]|\d+\.)\s+)/gi);
  return (
    <span className="speckit-code-line" key={`${lineIndex}:${line}`}>
      {line ? fragments.map((fragment, fragmentIndex) => {
        const className = /^\[[^\]]+\]$/.test(fragment)
          ? "is-placeholder"
          : /^(?:MUST NOT|SHOULD NOT|MUST|SHOULD|MAY)$/i.test(fragment)
            ? "is-keyword"
            : /^\s*(?:[-*]|\d+\.)\s+$/.test(fragment)
              ? "is-marker"
              : undefined;
        return <span className={className} key={`${fragmentIndex}:${fragment}`}>{fragment}</span>;
      }) : " "}
    </span>
  );
};

function SpecKitSectionSurface({ definition, value, onChange }: {
  definition: SpecKitSectionDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const lines = (value || " ").split("\n");

  return (
    <section className={`speckit-section-card is-${definition.key}${value.trim() ? " has-content" : " is-empty"}`}>
      <header>
        <span className="speckit-section-index">{String(SECTION_DEFINITIONS.indexOf(definition) + 1).padStart(2, "0")}</span>
        <div><strong>{definition.heading}</strong><span>{definition.description}</span></div>
        <em>{["intent", "requirements", "acceptance"].includes(definition.key) ? "Required" : "Recommended"}</em>
      </header>
      <div className="speckit-code-shell">
        <div aria-hidden="true" className="speckit-line-numbers" ref={lineNumbersRef}>{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
        {!value.trim() ? <span className="speckit-empty-hint">{definition.placeholder}</span> : null}
        <pre aria-hidden="true" className="speckit-highlight" ref={highlightRef}>{lines.map(renderHighlightedSpecKitLine)}</pre>
        <textarea
          aria-label={`${definition.heading} specification`}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (highlightRef.current) {
              highlightRef.current.scrollTop = event.currentTarget.scrollTop;
              highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }
            if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          placeholder={definition.placeholder}
          spellCheck
          value={value}
        />
      </div>
    </section>
  );
}

export function SpecKitEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const sections = useMemo(() => splitSpecKitDocument(value), [value]);
  const populatedCount = SECTION_DEFINITIONS.filter(({ key }) => sections[key].trim()).length;

  const commit = (key: SpecKitSectionKey, content: string) => onChange(composeSpecKitDocument({ ...sections, [key]: content }));
  const appendRule = (key: SpecKitSectionKey, starter: string) => {
    const current = sections[key].trim();
    commit(key, `${current}${current ? "\n" : ""}${starter}`);
  };

  return (
    <section aria-label="Spec Kit Story authoring" className="speckit-editor">
      <div className="speckit-editor-toolbar" role="toolbar" aria-label="Spec Kit document actions">
        <div className="speckit-editor-heading"><span><IconFileDescription size={17} /></span><div><strong>Product specification</strong><small>Intent, requirements, completion rules, and operational constraints.</small></div></div>
        <div className="speckit-editor-actions">
          <button className="ghost-button compact" onClick={() => appendRule("requirements", "- The product MUST ")} type="button"><IconPlus size={13} />Requirement</button>
          <button className="ghost-button compact" onClick={() => appendRule("acceptance", "- Given , when , then ")} type="button"><IconPlus size={13} />Acceptance rule</button>
          <button className="ghost-button compact" onClick={() => appendRule("edgeCases", "- When , the product SHOULD ")} type="button"><IconPlus size={13} />Edge case</button>
        </div>
      </div>
      <div className="speckit-section-grid">
        {SECTION_DEFINITIONS.map((definition) => (
          <SpecKitSectionSurface definition={definition} key={definition.key} onChange={(content) => commit(definition.key, content)} value={sections[definition.key]} />
        ))}
      </div>
      <div className={populatedCount >= 3 ? "speckit-editor-status is-valid" : "speckit-editor-status has-issues"} role="status">
        <span><strong>{populatedCount}</strong> of {SECTION_DEFINITIONS.length} sections populated</span>
        <strong><IconCheck size={14} />Structured Story intent</strong>
      </div>
    </section>
  );
}
