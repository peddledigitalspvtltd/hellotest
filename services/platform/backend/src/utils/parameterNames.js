const { normalizeParameterKey } = require("./stepParameterResolution");
const { parse } = require("acorn");
const PARAMETER = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const tokenFor = name => {
  const raw = name.slice(2);
  return `@${name.slice(0, 2)}${/^[a-z][a-z0-9_-]*$/i.test(raw) ? raw : `[${raw.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}]`}`;
};

// Only runtime binding surfaces make code strings data references. Imports,
// annotations, screenshots, logging and ordinary string literals are content.
const interpolatedMethods = new Set(['goto','locator','getByRole','getByText','getByLabel','getByPlaceholder','getByTestId','getByTitle','getByAltText','fill','type','press','pressSequentially','selectOption','filter',
  'toHaveText','toContainText','toHaveValue','toHaveValues','toHaveAttribute','toHaveClass','toHaveCSS','toHaveURL','toHaveTitle','toHaveCount','toEqual','toBe','toMatch','toMatchObject','toContain','toContainEqual']);
function collectCodeParameterNames(code) {
  let tree;
  try { tree = parse(String(code || ''), { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
  catch { return []; } // The source validator reports malformed/custom code.
  const names = new Set();
  const add = value => {
    for (const match of String(value || '').matchAll(PARAMETER)) {
      if (!match[1]) continue;
      const name = normalizeParameterKey(match[0]);
      if (name) names.add(name);
    }
  };
  const walkArguments = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string') add(node.value);
    else if (node.type === 'ArrayExpression') node.elements.forEach(walkArguments);
    else if (node.type === 'ObjectExpression') node.properties.forEach(property => property.type === 'Property' && walkArguments(property.value));
  };
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MemberExpression' && node.computed && node.object?.type === 'Identifier' && node.object.name === 'params' && node.property?.type === 'Literal' && typeof node.property.value === 'string' && /^[tsr]\.[^\u0000-\u001f\u007f]+$/i.test(node.property.value)) names.add(normalizeParameterKey(node.property.value));
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const callee = node.callee;
      const method = callee.computed ? callee.property?.value : callee.property?.name;
      const keyword = callee.object?.type === 'Identifier' && ['web','api','mobile','android','ios'].includes(callee.object.name);
      if (keyword || interpolatedMethods.has(method)) node.arguments.forEach(walkArguments);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(tree);
  return [...names].filter(Boolean);
}

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
    addText(step.action, gherkin); addText(step.expected_result, gherkin);
    collectCodeParameterNames(step.automation_code).forEach(name => names.add(name));
    const api = step.api_request || {};
    addText(api.url); addText(api.body);
    for (const row of api.headers || []) { addText(row.key); addText(row.value); }
    for (const row of api.validations || []) { addText(row.target); addText(row.expected); }
    // Captures supply output after a step; they are not required input columns.
  }
  names.delete("");
  return [...names];
}

module.exports = { collectCaseParameterNames, collectCodeParameterNames, tokenFor };
