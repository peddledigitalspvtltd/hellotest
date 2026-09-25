const normalizeFeatureTitle = (value) => {
  let title = typeof value === "string" ? value : "";
  for (let pass = 0; pass < 2; pass += 1) {
    title = title
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:39|x27);/gi, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&");
  }
  return title
    .replace(/<\/?(?:a|b|blockquote|br|code|div|em|h[1-6]|i|li|ol|p|s|span|strike|strong|u|ul)(?:\s[^>]*)?\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/** The primary linked requirement names the Feature; authored scenario names,
 * parameters, examples, tags, and step arguments remain untouched. */
const setGherkinFeatureTitle = (document, requirementTitle) => {
  const title = normalizeFeatureTitle(requirementTitle);
  if (!title || typeof document !== "string" || !document.trim()) return document;
  const lines = document.replace(/\r\n/g, "\n").split("\n");
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
    lines[headingIndex] = `${indent}Feature: ${title}`;
  } else {
    const bodyIndex = lines.findIndex((line) => line.trim() && !/^\s*(?:#|@)/.test(line));
    lines.splice(bodyIndex < 0 ? lines.length : bodyIndex, 0, `Feature: ${title}`, "");
  }
  return lines.join("\n");
};

module.exports = { setGherkinFeatureTitle };
