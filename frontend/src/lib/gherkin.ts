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

export type StructuredGherkinStep = {
  action: string;
  expected_result: string;
};

export type StructuredGherkinDocument = {
  preconditions: StructuredGherkinStep[];
  steps: StructuredGherkinStep[];
  exampleColumns: string[];
  exampleRows: Record<string, string>[];
};

export type SharedGherkinKeyword = "Given" | "When" | "Then" | "And" | "But" | "*";

export type SharedGherkinStep = {
  keyword: SharedGherkinKeyword;
  text: string;
  argument?: string;
};

export const SHARED_GHERKIN_KEYWORDS: SharedGherkinKeyword[] = ["Given", "When", "Then", "And", "But", "*"];

const GHERKIN_KEYWORD_PATTERN = /^(\s*)(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenarios|Scenario|Examples|Example|Given|When|Then|And|But|\*)(:)?(.*)$/i;
const GHERKIN_STEP_KEYWORDS = new Set(["given", "when", "then", "and", "but", "*"]);
const GHERKIN_INLINE_PATTERN = /(@(?:(?:t|s|r)\.)?(?:\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)|<\s*(?:(?:t|s|r)\.)?[A-Za-z][A-Za-z0-9_-]*\s*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi;
const GHERKIN_ANGLE_PARAMETER_PATTERN = /<\s*((?:(?:t|s|r)\.)?[A-Za-z][A-Za-z0-9_-]*)\s*>/gi;
const GHERKIN_AT_PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const GHERKIN_PARAMETER_PATTERN = new RegExp(`${GHERKIN_ANGLE_PARAMETER_PATTERN.source}|${GHERKIN_AT_PARAMETER_PATTERN.source}`, "gi");
const GHERKIN_SCENARIO_HEADING = /^\s*Scenario(?: Outline| Template)?\s*:/i;
const GHERKIN_EXAMPLES_HEADING = /^\s*(?:Examples|Scenarios)\s*:/i;
const GHERKIN_RICH_TEXT_TAG_NAMES = "a|b|blockquote|br|code|div|em|h[1-6]|i|li|ol|p|s|span|strike|strong|u|ul";
const GHERKIN_RICH_TEXT_MARKUP_EVIDENCE = new RegExp(
  `<\\/(?:${GHERKIN_RICH_TEXT_TAG_NAMES})\\s*>|<(?:br)(?:\\s[^>]*)?\\/?>|<(?:${GHERKIN_RICH_TEXT_TAG_NAMES})\\s+[^>]*>`,
  "i"
);
const GHERKIN_RICH_TEXT_TAG_PATTERN = new RegExp(
  `<\\/?(?:${GHERKIN_RICH_TEXT_TAG_NAMES})(?:\\s[^>]*)?\\/?>`,
  "gi"
);

const decodeGherkinHtmlEntities = (value: string) => {
  let decoded = value;

  // Rich-text content may have been escaped more than once while moving
  // between a structured step and a Gherkin document.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#(?:39|x27);/gi, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&");
    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
};

/** Converts rich-text editor output into a plain Gherkin description while
 * preserving angle-bracket Examples parameters such as <customer>. */
export function gherkinDescriptionToPlainText(value?: string | null): string {
  const source = String(value || "");
  if (/(?:^|\n)[ \t]*(?:"""|```)/.test(source)) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const structuralLines = gherkinStructuralLines(lines);
    return lines.map((line, index) => structuralLines[index] ? gherkinDescriptionToPlainText(line) : line).join("\n");
  }
  const decoded = decodeGherkinHtmlEntities(source);

  if (!GHERKIN_RICH_TEXT_MARKUP_EVIDENCE.test(decoded)) {
    return decoded;
  }

  return decoded
    .replace(/<\s*(?:script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|iframe|object|embed)\s*>/gi, " ")
    .replace(GHERKIN_RICH_TEXT_TAG_PATTERN, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Removes editor markup only from Gherkin headings and behavior lines. Table
 * cells, tags, comments, doc strings, and authored whitespace remain intact. */
export function sanitizeGherkinDocumentText(value?: string | null) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const structuralLines = gherkinStructuralLines(lines);
  return lines.map((line, index) => {
    if (!structuralLines[index]) return line;
    const match = matchGherkinKeyword(line);
    if (!match || !match.rest || !GHERKIN_RICH_TEXT_MARKUP_EVIDENCE.test(decodeGherkinHtmlEntities(match.rest))) {
      return line;
    }

    const description = gherkinDescriptionToPlainText(match.rest);
    return `${match.indent}${match.keyword}${match.colon}${description ? ` ${description}` : ""}`;
  }).join("\n");
}

/** Heading-like text inside an argument is data rather than document syntax. */
function gherkinStructuralLines(lines: string[]) {
  let docStringDelimiter = "";
  return lines.map((line) => {
    const delimiter = line.trim().match(/^("""|```)/)?.[1];
    if (delimiter) {
      if (!docStringDelimiter) docStringDelimiter = delimiter;
      else if (docStringDelimiter === delimiter) docStringDelimiter = "";
      return "";
    }
    return docStringDelimiter ? "" : line;
  });
}

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
  const lines = sanitizeGherkinDocumentText(value).split("\n");
  const structuralLines = gherkinStructuralLines(lines);
  const scenarioHeadings = structuralLines.reduce<number[]>((indices, line, index) => {
    if (GHERKIN_SCENARIO_HEADING.test(line)) indices.push(index);
    return indices;
  }, []);
  const scenarioStarts = scenarioHeadings.map((headingIndex) => {
    let start = headingIndex;
    while (start > 0 && /^\s*@\S+/.test(structuralLines[start - 1])) start -= 1;
    return start;
  });
  const firstScenario = scenarioStarts[0] ?? lines.length;
  const backgroundStart = structuralLines.slice(0, firstScenario).findIndex((line) => /^\s*Background\s*:/i.test(line));
  const preambleEnd = backgroundStart >= 0 ? backgroundStart : firstScenario;
  const preamble = trimBlankLines(lines.slice(0, preambleEnd)).join("\n");
  const background = backgroundStart >= 0
    ? trimBlankLines(lines.slice(backgroundStart, firstScenario)).join("\n")
    : "";
  const scenarios = scenarioStarts.map((start, index) => {
    const block = trimBlankLines(lines.slice(start, scenarioStarts[index + 1] ?? lines.length));
    const examplesStart = gherkinStructuralLines(block).findIndex((line) => GHERKIN_EXAMPLES_HEADING.test(line));
    return {
      scenario: trimBlankLines(block.slice(0, examplesStart < 0 ? block.length : examplesStart)).join("\n"),
      examples: examplesStart < 0 ? "" : trimBlankLines(block.slice(examplesStart)).join("\n")
    };
  });

  return { preamble, background, scenarios };
}

export function composeGherkinDocument(sections: GherkinDocumentSections) {
  return sanitizeGherkinDocumentText([
    normalizeGherkinBlock(sections.preamble),
    normalizeGherkinBlock(sections.background),
    ...sections.scenarios.flatMap((item) => [normalizeGherkinBlock(item.scenario), normalizeGherkinBlock(item.examples)])
  ].filter((block) => block.trim()).join("\n\n"));
}

/** Keeps a case's Feature aligned with its linked story without rewriting its
 * scenario names, tags, examples, or authored steps. */
export function setGherkinFeatureTitle(value: string, title: string) {
  const name = gherkinDescriptionToPlainText(title).replace(/\s+/g, " ").trim();
  if (!name) return value;
  if (!String(value || "").trim()) return `Feature: ${name}`;
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  let docStringDelimiter = "";
  const headingIndex = lines.findIndex((line) => {
    const delimiter = line.trim().match(/^("""|```)/)?.[1];
    if (delimiter) {
      if (!docStringDelimiter) docStringDelimiter = delimiter;
      else if (docStringDelimiter === delimiter) docStringDelimiter = "";
      return false;
    }
    return !docStringDelimiter && /^[ \t]*Feature\s*:/i.test(line);
  });
  if (headingIndex >= 0) {
    const indent = lines[headingIndex].match(/^[ \t]*/)?.[0] || "";
    lines[headingIndex] = `${indent}Feature: ${name}`;
  } else {
    const bodyIndex = lines.findIndex((line) => line.trim() && !/^\s*(?:#|@)/.test(line));
    const insertAt = bodyIndex < 0 ? lines.length : bodyIndex;
    lines.splice(insertAt, 0, `Feature: ${name}`, "");
  }
  return lines.join("\n");
}

/** Reads reusable behavior from both current fragments and older documents.
 * Step arguments stay attached to their step when it is edited or reordered. */
export function parseSharedStepGherkin(value: string): SharedGherkinStep[] {
  const steps: SharedGherkinStep[] = [];
  let current: SharedGherkinStep | undefined;
  let docStringDelimiter = "";
  for (const line of sanitizeGherkinDocumentText(value).split("\n")) {
    const delimiter = line.trim().match(/^("""|```)/)?.[1];
    if (delimiter && current) {
      if (!docStringDelimiter) docStringDelimiter = delimiter;
      else if (docStringDelimiter === delimiter) docStringDelimiter = "";
    } else if (!docStringDelimiter) {
      const match = line.match(/^\s*(Given|When|Then|And|But|\*)(?:[ \t]+(.*)|$)/i);
      if (match) {
        current = {
          keyword: SHARED_GHERKIN_KEYWORDS.find((keyword) => keyword.toLowerCase() === match[1].toLowerCase()) || "And",
          text: gherkinDescriptionToPlainText(match[2] || "")
        };
        steps.push(current);
        continue;
      }
      if (/^\s*(?:Feature|Rule|Background|Scenario(?: Outline| Template)?|Examples|Scenarios)\s*:/i.test(line)) {
        current = undefined;
        continue;
      }
      if (/^\s*# (?:Shared Step Group \[[^\]]+\]:.*|End Shared Step Group \[[^\]]+\])\s*$/.test(line)) continue;
    }
    if (current && line.trim()) current.argument = current.argument ? `${current.argument}\n${line}` : line;
  }
  return steps;
}

export function composeSharedStepGherkin(steps: SharedGherkinStep[]) {
  return steps.map((step) => `${step.keyword} ${gherkinDescriptionToPlainText(step.text)}${step.argument ? `\n${step.argument}` : ""}`).join("\n");
}

/** Shared groups are step fragments, independent of any Feature or Scenario. */
export function structuredStepsToSharedGherkin(steps: Array<{ action?: string | null; expected_result?: string | null }>) {
  const behavior: SharedGherkinStep[] = [];
  steps.forEach((step) => {
    const action = gherkinDescriptionToPlainText(step.action).trim();
    const expected = gherkinDescriptionToPlainText(step.expected_result).trim();
    if (action) behavior.push({ keyword: "When", text: action });
    if (expected) behavior.push({ keyword: "Then", text: expected });
  });
  return composeSharedStepGherkin(behavior);
}

export function sharedStepGherkinToStructuredSteps(value: string, { normalizeParameters = false }: { normalizeParameters?: boolean } = {}): StructuredGherkinStep[] {
  const result: StructuredGherkinStep[] = [];
  let phase: "action" | "expected" = "action";
  parseSharedStepGherkin(value).forEach((step) => {
    const authoredText = [step.text, step.argument].filter(Boolean).join("\n").trim();
    const text = normalizeParameters ? normalizeGherkinParameterReferences(authoredText) : authoredText;
    if (!text) return;
    if (step.keyword === "Then") phase = "expected";
    else if (step.keyword === "Given" || step.keyword === "When") phase = "action";
    if (phase === "expected") {
      const current = result[result.length - 1];
      if (current) current.expected_result = current.expected_result ? `${current.expected_result}\n${text}` : text;
      else result.push({ action: "", expected_result: text });
    } else result.push({ action: text, expected_result: "" });
  });
  return result;
}

/** Retains each existing step's identity and capabilities when behavior is
 * edited or reordered in Gherkin. New rows receive fresh metadata. */
export function mergeGherkinStepMetadata<T extends StructuredGherkinStep>(
  steps: StructuredGherkinStep[],
  previousSteps: T[],
  createStep: () => T
): T[] {
  const normalize = (value: string) => gherkinDescriptionToPlainText(value).trim();
  const usedIndices = new Set<number>();
  const matches = steps.map(() => -1);
  for (const matchExpected of [true, false]) {
    steps.forEach((step, index) => {
      if (matches[index] >= 0) return;
      const previousIndex = previousSteps.findIndex((previous, candidate) => (
        !usedIndices.has(candidate)
        && normalize(previous.action) === normalize(step.action)
        && (!matchExpected || normalize(previous.expected_result) === normalize(step.expected_result))
      ));
      if (previousIndex >= 0) {
        matches[index] = previousIndex;
        usedIndices.add(previousIndex);
      }
    });
  }
  return steps.map((step, index) => {
    let previousIndex = matches[index];
    if (previousIndex < 0 && previousSteps[index] && !usedIndices.has(index)) {
      previousIndex = index;
      usedIndices.add(index);
    }
    return { ...(previousIndex >= 0 ? previousSteps[previousIndex] : createStep()), ...step };
  });
}

const escapeTableCell = (value: unknown) => String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").trim();

/** Converts the complete structured case model to Gherkin without inventing
 * behavior. Preconditions become Background, actions become When/And and
 * expected results become Then/And. A table data set produces one outline. */
export function structuredCaseToGherkin({
  title,
  featureTitle,
  preconditions = [],
  steps = [],
  columns = [],
  rows = []
}: {
  title: string;
  featureTitle?: string;
  preconditions?: Array<{ action?: string | null; expected_result?: string | null }>;
  steps?: Array<{ action?: string | null; expected_result?: string | null }>;
  columns?: string[];
  rows?: Record<string, unknown>[];
}) {
  const scenarioTitle = gherkinDescriptionToPlainText(title).replace(/\s+/g, " ").trim() || "Describe the capability";
  const resolvedFeatureTitle = gherkinDescriptionToPlainText(featureTitle || title).replace(/\s+/g, " ").trim() || scenarioTitle;
  const meaningfulPreconditions = preconditions.filter((step) => gherkinDescriptionToPlainText(step.action || step.expected_result).trim());
  const meaningfulSteps = steps.filter((step) => gherkinDescriptionToPlainText(step.action || step.expected_result).trim());
  const exampleColumns = columns.map((column) => column.trim()).filter(Boolean);
  const hasExamples = exampleColumns.length > 0 && rows.length > 0;
  const lines = [`Feature: ${resolvedFeatureTitle}`];

  if (meaningfulPreconditions.length) {
    lines.push("", "  Background:");
    meaningfulPreconditions.forEach((step, index) => {
      const action = gherkinDescriptionToPlainText(step.action || step.expected_result).trim();
      lines.push(`    ${index === 0 ? "Given" : "And"} ${action}`);
    });
  }

  lines.push("", `  ${hasExamples ? "Scenario Outline" : "Scenario"}: ${scenarioTitle}`);
  meaningfulSteps.forEach((step) => {
    const action = gherkinDescriptionToPlainText(step.action).trim();
    const expected = gherkinDescriptionToPlainText(step.expected_result).trim();
    if (action) lines.push(`    When ${action}`);
    if (expected) lines.push(`    Then ${expected}`);
  });

  if (hasExamples) {
    lines.push("", "    Examples:", `      | ${exampleColumns.map(escapeTableCell).join(" | ")} |`);
    rows.forEach((row) => lines.push(`      | ${exampleColumns.map((column) => escapeTableCell(row[column])).join(" | ")} |`));
  }

  return lines.join("\n");
}

const parseTableRow = (line: string) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|").replace(/\\\\/g, "\\"));

/** Maps authored Gherkin back to the structured editor. Then/And outcomes are
 * attached to the preceding action, and Background lines remain preconditions. */
export function gherkinToStructuredCase(value: string): StructuredGherkinDocument {
  const sections = splitGherkinDocument(value);
  const parseBehavior = (block: string, background = false) => {
    const result: StructuredGherkinStep[] = [];
    let phase: "action" | "expected" = "action";
    parseSharedStepGherkin(block).forEach((step) => {
      const keyword = step.keyword.toLowerCase();
      const text = [step.text, step.argument].filter(Boolean).join("\n").trim();
      if (!text) return;
      if (background) {
        result.push({ action: text, expected_result: "" });
        return;
      }
      if (keyword === "then") phase = "expected";
      else if (keyword === "when" || keyword === "given") phase = "action";
      if (phase === "expected") {
        const current = result[result.length - 1];
        if (current) current.expected_result = current.expected_result ? `${current.expected_result}\n${text}` : text;
        else result.push({ action: "", expected_result: text });
      } else {
        result.push({ action: text, expected_result: "" });
      }
    });
    return result;
  };

  const preconditions = parseBehavior(sections.background, true);
  const steps = sections.scenarios.flatMap((section) => parseBehavior(section.scenario));
  const firstExamples = sections.scenarios.map((section) => section.examples).find(Boolean) || "";
  const table = firstExamples.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line)).map(parseTableRow);
  const exampleColumns = table[0] || [];
  const exampleRows = table.slice(1).map((cells) => Object.fromEntries(exampleColumns.map((column, index) => [column, cells[index] || ""])));
  return { preconditions, steps, exampleColumns, exampleRows };
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

function normalizeGherkinParameterName(value: string, fallbackScope = "r") {
  const trimmed = value.trim().replace(/^@+/, "");
  const scopedMatch = trimmed.match(/^([tsr])\.(.+)$/i);
  const scope = String(scopedMatch?.[1] || fallbackScope).toLowerCase();
  const rawName = String(scopedMatch?.[2] || trimmed);
  const quoted = rawName.match(/^\[((?:\\.|[^\]\\\r\n])+)\]$/);
  const name = (quoted ? quoted[1].replace(/\\([\\\]])/g, "$1") : rawName).trim().toLowerCase();
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
  const candidates = [normalizeGherkinParameterName(name)];

  for (const candidate of candidates) {
    if (candidate && Object.prototype.hasOwnProperty.call(values, candidate)) {
      return values[candidate];
    }
  }

  return null;
}

/** Call only for Gherkin text: XML/HTML angle brackets are not parameters. */
export function normalizeGherkinParameterReferences(text: string) {
  return text.replace(GHERKIN_ANGLE_PARAMETER_PATTERN, (token, name: string) => {
    const key = normalizeGherkinParameterName(name);
    return key ? `@${key}` : token;
  });
}

/**
 * Resolves test-case, suite, and run data for read-only Gherkin display while
 * preserving unresolved tokens. The stored authoring document is never changed.
 */
export function resolveGherkinParameterText(text: string, parameterValues: Record<string, string> = {}) {
  const normalizedValues = normalizeGherkinParameterValues(parameterValues);

  return sanitizeGherkinDocumentText(text).split("\n").map((line) => {
    // A leading @ is a Gherkin tag, not a test-data variable.
    if (/^\s*(?:@|#)/.test(line)) return line;

    return line.replace(GHERKIN_PARAMETER_PATTERN, (token, angleName: string | undefined, scope: string | undefined, name: string, offset: number, source: string) => {
      if (angleName) {
        const resolvedValue = resolveAngleParameter(angleName, normalizedValues);
        return resolvedValue === null ? token : resolvedValue;
      }
      if (!scope && /^[tsr]$/i.test(name) && source[offset + token.length] === ".") return token;
      const key = normalizeGherkinParameterName(`${scope || "r"}.${name}`);
      return Object.prototype.hasOwnProperty.call(normalizedValues, key) ? normalizedValues[key] : token;
    });
  }).join("\n");
}
