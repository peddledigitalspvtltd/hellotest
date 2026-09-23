const invalidResponse = () => Object.assign(new Error("The AI provider did not return a complete JSON draft. Please generate the preview again."), {
  statusCode: 502,
  code: "AI_INVALID_OUTPUT"
});

// Parse complete JSON before looking for an embedded block: slicing at the
// first brace corrupts array responses and braces inside quoted JSON strings.
const parseAiJson = (content) => {
  const text = String(content || "").trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  for (const candidate of [text, unfenced]) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object") return value;
    } catch { /* A provider may put explanatory text around a JSON block. */ }
  }
  const start = unfenced.search(/[\[{]/);
  if (start < 0) throw invalidResponse();
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < unfenced.length; index += 1) {
    const character = unfenced[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const opening = stack.pop();
      if (opening !== (character === "}" ? "{" : "[")) break;
      if (!stack.length) {
        try { return JSON.parse(unfenced.slice(start, index + 1)); } catch { break; }
      }
    }
  }
  throw invalidResponse();
};

module.exports = { parseAiJson };
