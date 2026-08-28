export type GherkinKeywordKind = "section" | "step";

export type GherkinKeywordMatch = {
  colon: string;
  indent: string;
  keyword: string;
  kind: GherkinKeywordKind;
  rest: string;
};

export type GherkinInlineSegment = {
  type: "text" | "parameter" | "string";
  value: string;
};

export type GherkinScenarioSection = {
  scenario: string;
  examples: string;
};

export type GherkinDocumentSections = {
  preamble: string;
  background: string;
  scenarios: GherkinScenarioSection[];
};

const GHERKIN_KEYWORD_PATTERN = /^(\s*)(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenarios|Scenario|Examples|Example|Given|When|Then|And|But|\*)(:)?(.*)$/i;
const GHERKIN_STEP_KEYWORDS = new Set(["given", "when", "then", "and", "but", "*"]);
const GHERKIN_INLINE_PATTERN = /(@(?:(?:t|s|r)\.)?[A-Za-z][A-Za-z0-9_-]*|<\s*(?:(?:t|s|r)\.)?[A-Za-z][A-Za-z0-9_-]*\s*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi;
const GHERKIN_ANGLE_PARAMETER_PATTERN = /<\s*((?:(?:t|s|r)\.)?[A-Za-z][A-Za-z0-9_-]*)\s*>/gi;
const GHERKIN_AT_PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?([A-Za-z][A-Za-z0-9_-]*)/gi;
const GHERKIN_SCENARIO_HEADING = /^\s*Scenario(?: Outline| Template)?\s*:/i;
const GHERKIN_EXAMPLES_HEADING = /^\s*(?:Examples|Scenarios)\s*:/i;

const trimBlankLines = (lines: string[]) => {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
};

const normalizeGherkinBlock = (value: string) => trimBlankLines(String(value || "").replace(/\r\n/g, "\n").split("\n")).join("\n");

const splitBlocksAtHeadings = (value: string, pattern: RegExp) => {
  const lines = value.split("\n");
  const starts = lines.reduce<number[]>((indices, line, index) => {
    if (pattern.test(line)) indices.push(index);
    return indices;
  }, []);
  if (!starts.length) return value.trim() ? [value.trim()] : [];
  return starts.map((start, index) => trimBlankLines(lines.slice(start, starts[index + 1] ?? lines.length)).join("\n"));
};

/** Splits a stored Gherkin document into UI sections without losing the
 * Scenario-to-Examples relationship needed when the document is recomposed. */
export function splitGherkinDocument(value: string): GherkinDocumentSections {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const scenarioHeadings = lines.reduce<number[]>((indices, line, index) => {
    if (GHERKIN_SCENARIO_HEADING.test(line)) indices.push(index);
    return indices;
  }, []);
  const scenarioStarts = scenarioHeadings.map((headingIndex) => {
    let start = headingIndex;
    while (start > 0 && /^\s*@\S+/.test(lines[start - 1])) start -= 1;
    return start;
  });
  const firstScenario = scenarioStarts[0] ?? lines.length;
  const backgroundStart = lines.slice(0, firstScenario).findIndex((line) => /^\s*Background\s*:/i.test(line));
  const preambleEnd = backgroundStart >= 0 ? backgroundStart : firstScenario;
  const preamble = trimBlankLines(lines.slice(0, preambleEnd)).join("\n");
  const background = backgroundStart >= 0
    ? trimBlankLines(lines.slice(backgroundStart, firstScenario)).join("\n")
    : "";
  const scenarios = scenarioStarts.map((start, index) => {
    const block = trimBlankLines(lines.slice(start, scenarioStarts[index + 1] ?? lines.length));
    const examplesStart = block.findIndex((line) => GHERKIN_EXAMPLES_HEADING.test(line));
    return {
      scenario: trimBlankLines(block.slice(0, examplesStart < 0 ? block.length : examplesStart)).join("\n"),
      examples: examplesStart < 0 ? "" : trimBlankLines(block.slice(examplesStart)).join("\n")
    };
  });

  return { preamble, background, scenarios };
}

export function composeGherkinDocument(sections: GherkinDocumentSections) {
  return [
    normalizeGherkinBlock(sections.preamble),
    normalizeGherkinBlock(sections.background),
    ...sections.scenarios.flatMap((item) => [normalizeGherkinBlock(item.scenario), normalizeGherkinBlock(item.examples)])
  ].filter((block) => block.trim()).join("\n\n");
}

export function replaceGherkinBackground(sections: GherkinDocumentSections, background: string): GherkinDocumentSections {
  return { ...sections, background: normalizeGherkinBlock(background) };
}

export function replaceGherkinScenarios(sections: GherkinDocumentSections, value: string): GherkinDocumentSections {
  const scenarios = splitBlocksAtHeadings(value, GHERKIN_SCENARIO_HEADING);
  return {
    ...sections,
    scenarios: scenarios.map((scenario, index) => ({ scenario, examples: sections.scenarios[index]?.examples || "" }))
  };
}

export function replaceGherkinExamples(sections: GherkinDocumentSections, value: string): GherkinDocumentSections {
  const examples = splitBlocksAtHeadings(value, GHERKIN_EXAMPLES_HEADING);
  const outlineIndices = sections.scenarios.reduce<number[]>((indices, item, index) => {
    if (/^\s*Scenario(?: Outline| Template)\s*:/i.test(item.scenario)) indices.push(index);
    return indices;
  }, []);
  const targetIndices = outlineIndices.length ? outlineIndices : sections.scenarios.map((_, index) => index);
  const scenarios = sections.scenarios.map((item) => ({ ...item, examples: "" }));
  examples.forEach((example, index) => {
    const targetIndex = targetIndices[index] ?? targetIndices[targetIndices.length - 1];
    if (targetIndex !== undefined) scenarios[targetIndex].examples = example;
  });
  return { ...sections, scenarios };
}

function normalizeGherkinParameterName(value: string, fallbackScope = "t") {
  const trimmed = value.trim().replace(/^@+/, "");
  const scopedMatch = trimmed.match(/^([tsr])\.(.+)$/i);
  const scope = String(scopedMatch?.[1] || fallbackScope).toLowerCase();
  const name = String(scopedMatch?.[2] || trimmed).trim().toLowerCase();
  return name ? `${scope}.${name}` : "";
}

function normalizeGherkinParameterValues(values: Record<string, string>) {
  return Object.entries(values).reduce<Record<string, string>>((normalized, [name, value]) => {
    const key = normalizeGherkinParameterName(name);
    if (key) normalized[key] = value;
    return normalized;
  }, {});
}

export function matchGherkinKeyword(line: string): GherkinKeywordMatch | null {
  const match = line.match(GHERKIN_KEYWORD_PATTERN);

  if (!match) {
    return null;
  }

  const [, indent, keyword, colon = "", rest] = match;

  return {
    indent,
    keyword,
    colon,
    rest,
    kind: GHERKIN_STEP_KEYWORDS.has(keyword.toLowerCase()) ? "step" : "section"
  };
}

export function tokenizeGherkinInlineText(text: string): GherkinInlineSegment[] {
  if (!text) {
    return [];
  }

  const segments: GherkinInlineSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(GHERKIN_INLINE_PATTERN)) {
    const index = match.index || 0;

    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }

    const value = match[0];
    segments.push({
      type: value.startsWith("@") || value.startsWith("<") ? "parameter" : "string",
      value
    });
    cursor = index + value.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}

function resolveAngleParameter(name: string, values: Record<string, string>) {
  const hasExplicitScope = /^[tsr]\./i.test(name);
  const candidates = hasExplicitScope
    ? [normalizeGherkinParameterName(name)]
    : ["t", "s", "r"].map((scope) => normalizeGherkinParameterName(`${scope}.${name}`));

  for (const candidate of candidates) {
    if (candidate && Object.prototype.hasOwnProperty.call(values, candidate)) {
      return values[candidate];
    }
  }

  return null;
}

/**
 * Resolves test-case, suite, and run data for read-only Gherkin display while
 * preserving unresolved tokens. The stored authoring document is never changed.
 */
export function resolveGherkinParameterText(text: string, parameterValues: Record<string, string> = {}) {
  const normalizedValues = normalizeGherkinParameterValues(parameterValues);

  return text.split("\n").map((line) => {
    // A leading @ is a Gherkin tag, not a test-data variable.
    if (/^\s*(?:@|#)/.test(line)) return line;

    const resolvedAngles = line.replace(GHERKIN_ANGLE_PARAMETER_PATTERN, (token, name: string) => {
      const resolvedValue = resolveAngleParameter(name, normalizedValues);
      return resolvedValue === null ? token : resolvedValue;
    });

    return resolvedAngles.replace(GHERKIN_AT_PARAMETER_PATTERN, (token, scope: string | undefined, name: string) => {
      const key = normalizeGherkinParameterName(`${scope || "t"}.${name}`);
      return Object.prototype.hasOwnProperty.call(normalizedValues, key) ? normalizedValues[key] : token;
    });
  }).join("\n");
}
