const { normalizeParameterKey } = require("./stepParameterResolution");
const PARAMETER = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const tokenFor = name => {
  const raw = name.slice(2);
  return `@${name.slice(0, 2)}${/^[a-z][a-z0-9_-]*$/i.test(raw) ? raw : `[${raw.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}]`}`;
};

function collectCaseParameterNames(item, steps = []) {
  const names = new Set(Object.keys(item.parameter_values || {}).map(key => normalizeParameterKey(key)));
  const addText = (text, gherkin = false) => {
    let source = String(text || "");
    if (gherkin) source = source.split("\n").filter(line => !/^\s*[@#]/.test(line)).join("\n")
      .replace(/<([A-Za-z][A-Za-z0-9_.-]*)>/g, (_, name) => `@${name}`);
    for (const match of source.matchAll(PARAMETER)) {
      if (!match[1] && /^[tsr]$/i.test(match[2]) && source[(match.index || 0) + match[0].length] === ".") continue;
      names.add(normalizeParameterKey(match[0]));
    }
  };
  const gherkin = item.authoring_mode === "gherkin";
  addText(item.title, gherkin); addText(item.gherkin_document, true);
  for (const step of steps) {
    addText(step.action, gherkin); addText(step.expected_result, gherkin); addText(step.automation_code);
    const api = step.api_request || {};
    addText(api.url); addText(api.body);
    for (const row of api.headers || []) { addText(row.key); addText(row.value); }
    for (const row of api.validations || []) { addText(row.target); addText(row.expected); }
    // Captures supply output after a step; they are not required input columns.
  }
  names.delete("");
  return [...names];
}

module.exports = { collectCaseParameterNames, tokenFor };
