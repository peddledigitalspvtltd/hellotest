const STORY_SECTION_LABELS = [
  "acceptance criteri(?:on|a)",
  "a\\.?c\\.?",
  "definition of done",
  "gherkin(?: scenarios?)?",
  "bdd(?: scenarios?)?",
  "feature",
  "scenario(?: outline)?",
  "risks?",
  "open questions?",
  "dependencies",
  "out of scope"
];

const DEFECT_SECTION_LABELS = ["steps to reproduce", "reproduction steps", "expected results?", "actual results?", "environment", "root cause"];

const TEST_CASE_SECTION_LABELS = [
  "preconditions?",
  "test data",
  "(?:test )?steps?",
  "expected results?",
  "postconditions?",
  "acceptance criteri(?:on|a)",
  "a\\.?c\\.?",
  "gherkin(?: scenarios?)?",
  "bdd(?: scenarios?)?",
  "feature",
  "scenario(?: outline)?"
];

const BLOCK_BOUNDARY_PATTERN = /<(?:br|hr)\b[^>]*>|<\/(?:p|div|h[1-6]|li|ol|ul|blockquote|section|article)>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;

const decodeHtmlEntities = (value) => {
  if (typeof document === "undefined") {
    return value
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'");
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
};

const normalizeDescriptionLines = (value) => {
  if (!value) return [];

  return decodeHtmlEntities(
    value
      .replace(/\r\n?/g, "\n")
      .replace(BLOCK_BOUNDARY_PATTERN, "\n")
      .replace(HTML_TAG_PATTERN, " ")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
  )
    .split("\n")
    .map((line) => line
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\s*(?:[-+•]|\d+[.)])\s+/, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
};

const findStructuredSection = (line, profile) => {
  const labels = profile === "story" ? STORY_SECTION_LABELS : profile === "test-case" ? TEST_CASE_SECTION_LABELS : profile === "defect" ? DEFECT_SECTION_LABELS : [];
  let earliestIndex = -1;
  let earliestLabel = "";

  for (const label of labels) {
    const headingPattern = new RegExp(`^(${label})\\s*:?(?:\\s*)$`, "i");
    const leadingLabelPattern = new RegExp(`^(${label})\\s*:\\s*`, "i");
    const inlineLabelPattern = new RegExp(`\\b(${label})\\s*:\\s*`, "i");
    const headingMatch = line.match(headingPattern);
    const leadingMatch = line.match(leadingLabelPattern);
    const inlineMatch = line.match(inlineLabelPattern);
    const match = headingMatch || leadingMatch || inlineMatch;

    if (!match || match.index === undefined) continue;
    if (earliestIndex === -1 || match.index < earliestIndex) {
      earliestIndex = match.index;
      earliestLabel = match[1];
    }
  }

  return { index: earliestIndex, label: earliestLabel };
};

const trimAtStructuredSection = (lines, profile) => {
  const narrativeLines = [];
  let omittedSection = "";

  for (const line of lines) {
    const section = findStructuredSection(line, profile);
    if (section.index === -1) {
      narrativeLines.push(line);
      continue;
    }

    const narrativePrefix = line.slice(0, section.index).trim();
    if (narrativePrefix) narrativeLines.push(narrativePrefix);
    omittedSection = section.label;
    break;
  }

  return {
    narrativeText: narrativeLines.join(" ").replace(/\s+/g, " ").trim(),
    omittedSection
  };
};

export const truncateAtWordBoundary = (value, maxCharacters) => {
  if (value.length <= maxCharacters) {
    return { text: value, wasCharacterTruncated: false };
  }

  const safeLimit = Math.max(32, maxCharacters - 1);
  const candidate = value.slice(0, safeLimit).trimEnd();
  const lastWordBoundary = candidate.lastIndexOf(" ");
  const cutoff = lastWordBoundary >= Math.floor(safeLimit * 0.62)
    ? lastWordBoundary
    : safeLimit;

  return {
    text: `${candidate.slice(0, cutoff).trimEnd()}…`,
    wasCharacterTruncated: true
  };
};

export function summarizeCatalogDescription(
  value,
  {
    fallback,
    maxCharacters = 220,
    profile
  }
) {
  const lines = normalizeDescriptionLines(value);
  const fullText = lines.join(" ").replace(/\s+/g, " ").trim();
  const structuredSummary = trimAtStructuredSection(lines, profile);
  const narrativeText = structuredSummary.narrativeText || fallback;
  const truncated = truncateAtWordBoundary(narrativeText, maxCharacters);

  return {
    text: truncated.text,
    narrativeText,
    fullText,
    wasTruncated: truncated.wasCharacterTruncated || Boolean(structuredSummary.omittedSection),
    wasCharacterTruncated: truncated.wasCharacterTruncated,
    omittedSection: structuredSummary.omittedSection
  };
}
