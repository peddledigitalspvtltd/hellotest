import { parse } from "acorn";
import type { TestStep } from "@hellotest/platform/frontend/src/types";
import {
  extractStepParameterMatches, formatStepParameterToken, normalizeStepParameterName,
  normalizeStepParameterValues, parseStepParameterName, type StepParameterScope
} from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

/** Change bindings by parsed identity; similarly named inputs and literal data
 * values must survive a scope change unchanged. */
export function replaceParameterScopeReferences(text: string, name: string, scope: StepParameterScope) {
  const source = parseStepParameterName(name)!;
  const token = formatStepParameterToken(scope, source.rawName);
  let result = text;
  for (const match of extractStepParameterMatches(text, { knownLegacyNames: [source.name] }).reverse()) {
    if (match.name === source.name) result = result.slice(0, match.index) + token + result.slice(match.index + match.token.length);
  }
  return result;
}

const bindingMethods = new Set(["goto", "locator", "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByTitle", "getByAltText", "fill", "type", "press", "pressSequentially", "selectOption", "filter", "toHaveText", "toContainText", "toHaveValue", "toHaveValues", "toHaveAttribute", "toHaveClass", "toHaveCSS", "toHaveURL", "toHaveTitle", "toHaveCount", "toEqual", "toBe", "toMatch", "toMatchObject", "toContain", "toContainEqual"]);
function replaceCodeReferences(code: string, name: string, scope: StepParameterScope) {
  if (!code.trim()) return code;
  let tree;
  try { tree = parse(code, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
  catch { throw new Error("Correct the automation source before changing this parameter's scope."); }
  const replacements = new Map<number, { end: number; value: string }>();
  const target = `${scope}.${parseStepParameterName(name)!.rawName}`;
  const argumentStrings = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Literal" && typeof node.value === "string") {
      const next = replaceParameterScopeReferences(node.value, name, scope);
      if (next !== node.value) replacements.set(node.start, { end: node.end, value: JSON.stringify(next) });
    } else if (node.type === "TemplateLiteral") node.quasis.forEach((part: any) => {
      const value = part.value.cooked ?? part.value.raw;
      const next = replaceParameterScopeReferences(value, name, scope);
      if (next !== value) replacements.set(part.start, { end: part.end, value: next.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") });
    });
    else if (node.type === "ArrayExpression") node.elements.forEach(argumentStrings);
    else if (node.type === "ObjectExpression") node.properties.forEach((property: any) => property.type === "Property" && argumentStrings(property.value));
  };
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "MemberExpression" && node.computed && node.object?.type === "Identifier" && node.object.name === "params" && node.property?.type === "Literal" && typeof node.property.value === "string" && normalizeStepParameterName(node.property.value) === name) {
      replacements.set(node.property.start, { end: node.property.end, value: JSON.stringify(target) });
    }
    if (node.type === "CallExpression" && node.callee?.type === "MemberExpression") {
      const callee = node.callee;
      const method = callee.computed ? callee.property?.value : callee.property?.name;
      const keyword = callee.object?.type === "Identifier" && ["web", "api", "mobile", "android", "ios"].includes(callee.object.name);
      if (keyword || bindingMethods.has(method)) node.arguments.forEach(argumentStrings);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(tree);
  let result = code;
  for (const [start, replacement] of [...replacements].sort(([a], [b]) => b - a)) result = result.slice(0, start) + replacement.value + result.slice(replacement.end);
  return result;
}

export function migrateCaseParameterScope<T extends Pick<TestStep, "action" | "expected_result" | "automation_code" | "api_request">>({ name, scope, values, title, description, gherkin_document, steps }: {
  name: string; scope: StepParameterScope; values: Record<string, string>;
  title: string; description: string; gherkin_document: string; steps: T[];
}) {
  const source = parseStepParameterName(name);
  if (!source) throw new Error("Select a valid parameter.");
  const target = `${scope}.${source.rawName}`;
  const parameter_values = normalizeStepParameterValues(values, "t");
  if (target !== source.name && Object.prototype.hasOwnProperty.call(parameter_values, target)) throw new Error(`${formatStepParameterToken(scope, source.rawName)} already exists. Choose a different name before changing scope.`);
  if (Object.prototype.hasOwnProperty.call(parameter_values, source.name)) {
    parameter_values[target] = parameter_values[source.name];
    if (target !== source.name) delete parameter_values[source.name];
  }
  const replace = (text: string) => replaceParameterScopeReferences(text, source.name, scope);
  const replaceApi = (value: unknown): unknown => typeof value === "string" ? replace(value)
    : Array.isArray(value) ? value.map(replaceApi)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceApi(item)])) : value;
  const replaceRequest = (request: TestStep["api_request"]) => {
    const next = replaceApi(request) as TestStep["api_request"];
    // Capture targets are names rather than @tokens. Keep their identity in
    // sync with consumers, without rewriting capture paths or literal names.
    if (next && request?.captures) next.captures = request.captures.map(capture => ({ ...capture,
      parameter: typeof capture.parameter === "string" && normalizeStepParameterName(capture.parameter) === source.name
        ? target : capture.parameter }));
    return next;
  };
  let inExamples = false, exampleHeader = false;
  const lines = gherkin_document.split("\n").map(line => {
    if (/^\s*(?:Examples|Example|Scenarios)\s*:/i.test(line)) { inExamples = true; exampleHeader = true; return line; }
    if (/^\s*(?:#|@)/.test(line)) return line;
    if (inExamples && /^\s*\|/.test(line)) {
      if (!exampleHeader) return line; // Examples rows are literal test data.
      exampleHeader = false;
      return line.split("|").map(cell => normalizeStepParameterName(cell.trim()) === source.name ? cell.replace(cell.trim(), target) : cell).join("|");
    }
    const authoredLine = /^\s*(?:Feature|Rule|Background|Scenario(?: Outline| Template)?|Given|When|Then|And|But|\*)(?:\s|:|$)/i.test(line);
    if (authoredLine) { inExamples = false; exampleHeader = false; }
    if (inExamples || !authoredLine) return line;
    // Angle references belong to authored Gherkin, never HTML descriptions.
    return replace(line).replace(/<([^<>\r\n]+)>/g, (token, key: string) => normalizeStepParameterName(key) === source.name ? `<${target}>` : token);
  });
  return {
    parameter_values, title: replace(title), description: replace(description), gherkin_document: lines.join("\n"),
    steps: steps.map(step => ({ ...step, action: replace(step.action || ""), expected_result: replace(step.expected_result || ""),
      automation_code: replaceCodeReferences(step.automation_code || "", source.name, scope), api_request: replaceRequest(step.api_request) }))
  };
}
