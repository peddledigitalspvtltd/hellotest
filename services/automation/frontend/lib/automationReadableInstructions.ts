import { parse } from "acorn";
import type { StepApiRequest } from "@hellotest/platform/frontend/src/types";
import { buildAutomationRepositoryFields, type AutomationRepositoryReference } from "./automationKeywordInputs";

type Ast = { type: string; start: number; end: number; [key: string]: any };
export type AutomationReadableContext = { repository?: AutomationRepositoryReference[]; parameterValues?: Record<string, string>; platform?: string };
export type ReadableAutomationInstruction = { label: string; args: string[]; kind: "action" | "assertion" | "control" | "custom" | "setup"; depth: number; text: string; detail?: string; contexts?: string[] };

const parameterKey = (value: string) => value.replace(/^@/, "").replace(/^([tsr])\.\[((?:\\.|[^\]\\])+)\]$/i, (_, scope, name) => `${scope}.${name.replace(/\\([\\\]])/g, "$1")}`).toLowerCase();
const parameterToken = (name: string) => {
  const [scope, ...parts] = name.replace(/^@/, "").split(".");
  const value = parts.join(".");
  return `@${scope}.${/^[A-Za-z_][\w.-]*$/.test(value) ? value : `[${value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}]`}`;
};
const quoted = (value: string) => /^@[tsr]\./i.test(value) ? value : JSON.stringify(value);
const methodName = (node: Ast | undefined): string => node?.type === "MemberExpression" ? String(node.computed ? node.property?.value ?? "" : node.property?.name ?? "") : "";
const unawait = (node: Ast): Ast => node.type === "AwaitExpression" ? node.argument : node;
const identifier = (node: Ast | undefined): string => node?.type === "Identifier" ? node.name : "";
const nodePath = (node: Ast | undefined): string => node?.type === "Identifier" ? node.name : node?.type === "MemberExpression" ? `${nodePath(node.object)}.${methodName(node)}` : "";
const cleanTree = (node: any, pageNames: Set<string>, resolve: (value: string) => string): any => {
  if (typeof node === "bigint") return String(node);
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(item => cleanTree(item, pageNames, resolve));
  if (["Identifier", "MemberExpression"].includes(node.type) && pageNames.has(nodePath(node))) return { type: "Identifier", name: "page" };
  if (node.type === "MemberExpression" && identifier(node.object) === "params" && typeof node.property?.value === "string") {
    const token = parameterToken(node.property.value), resolved = resolve(token);
    if (resolved !== token) return { type: "Literal", value: resolved };
  }
  if (node.type === "MemberExpression" && node.computed && node.property?.type === "Literal" && typeof node.property.value === "string") {
    return cleanTree({ ...node, computed: false, property: { type: "Identifier", name: node.property.value } }, pageNames, resolve);
  }
  const normalized = Object.fromEntries(Object.entries(node).filter(([key]) => !["start", "end", "raw"].includes(key)).map(([key, value]) => [key, node.type === "Literal" && key === "value" && typeof value === "string" ? resolve(value) : cleanTree(value, pageNames, resolve)]));
  // Plain locator options have value semantics: spelling/order of distinct keys
  // must not prevent matching the repository's equivalent locator expression.
  if (node.type === "ObjectExpression" && node.properties.every((property: Ast) => property.type === "Property" && property.kind === "init" && !property.computed && !property.method && ["Identifier", "Literal"].includes(property.key?.type))) {
    const names = node.properties.map((property: Ast) => String(property.key.name ?? property.key.value));
    if (new Set(names).size === names.length) normalized.properties = (normalized.properties as any[]).map((property, index) => ({ ...property, key: { type: "Identifier", name: names[index] } })).sort((left, right) => left.key.name.localeCompare(right.key.name));
  }
  return normalized;
};

/** Presentation only: decode parsed calls without evaluating source or changing executable instructions. */
export function buildReadableAutomationInstructions(code: string, context: AutomationReadableContext = {}): ReadableAutomationInstruction[] {
  if (!code.trim()) return [];
  const rows: ReadableAutomationInstruction[] = [];
  const pageNames = new Set(["page", "playwrightPage", "bindings.page", "bindings.playwrightPage"]), testNames = new Set(["test", "it"]), expectNames = new Set(["expect"]), namespaces = new Set<string>();
  const aliases = new Map<string, Ast>();
  const runtimeParameters = new Set<string>();
  const parameterValues = Object.fromEntries(Object.entries(context.parameterValues || {}).map(([key, value]) => [parameterKey(key), value]));
  const resolve = (value: string) => value.replace(/@([tsr]\.(?:\[(?:\\.|[^\]\\])+\]|[A-Za-z_][\w.-]*))/gi, (token, name) => parameterValues[parameterKey(name)] ?? token);
  const fields = buildAutomationRepositoryFields(context.repository || []).map(field => ({ ...field, semantic: "" }));
  const isPage = (node: Ast | undefined, seen = new Set<string>()): boolean => Boolean(node && (pageNames.has(nodePath(node)) || node.type === "Identifier" && aliases.has(node.name) && !seen.has(node.name) && isPage(aliases.get(node.name), new Set([...seen, node.name]))));
  const canonical = (node: Ast) => JSON.stringify(cleanTree(node, new Set([...pageNames, ...[...aliases.keys()].filter(name => isPage({ type: "Identifier", name, start: 0, end: 0 }))]), resolve));
  const fieldFor = (value: string, expression?: Ast) => {
    const target = resolve(value);
    const referenceKey = target.trim().toLowerCase();
    const canonicalField = fields.find(field => field.reference === target) || fields.find(field => field.reference.toLowerCase() === referenceKey);
    if (canonicalField) return canonicalField.reference;
    const aliasMatches = fields.filter(field => field.aliases.some(alias => alias.toLowerCase() === referenceKey));
    if (aliasMatches.length) return aliasMatches.length === 1 ? aliasMatches[0].reference : "";
    const direct = fields.filter(field => field.locator === target);
    if (direct.length === 1) return direct[0].reference;
    if (expression) {
      const key = canonical(expression);
      const matches = fields.filter(field => field.semantic === key);
      if (matches.length === 1) return matches[0].reference;
    }
    const named = fields.filter(field => field.objectName.toLowerCase() === referenceKey);
    if (named.length === 1) return named[0].reference;
    return "";
  };
  const value = (node: Ast | undefined, target = false, seen = new Set<string>()): string => {
    if (!node) return "";
    if (node.type === "Literal") return node.value === null ? "" : target ? resolve(String(node.value)) : String(node.value);
    if (node.type === "TemplateLiteral" && !node.expressions.length) return target ? resolve(node.quasis.map((part: any) => part.value.cooked ?? part.value.raw).join("")) : node.quasis.map((part: any) => part.value.cooked ?? part.value.raw).join("");
    if (node.type === "MemberExpression" && identifier(node.object) === "params") {
      const name = node.computed ? node.property?.value : node.property?.name;
      if (typeof name === "string") return runtimeParameters.has(parameterKey(name)) ? `runtime parameter ${name.replace(/^@/, "")} (see Source)` : target ? parameterValues[parameterKey(name)] ?? parameterToken(name) : parameterToken(name);
    }
    if (node.type === "Identifier") {
      if (node.name === "undefined") return "";
      if (aliases.has(node.name) && !seen.has(node.name)) return value(aliases.get(node.name), target, new Set([...seen, node.name]));
      return node.name;
    }
    if (node.type === "CallExpression" && ["Number", "String", "Boolean"].includes(identifier(node.callee))) return value(node.arguments[0], target, seen);
    if (node.type === "UnaryExpression") return node.operator === "!" ? `not ${value(node.argument, target, seen)}` : `${node.operator}${value(node.argument, target, seen)}`;
    if (["BinaryExpression", "LogicalExpression"].includes(node.type)) {
      const operators: Record<string, string> = { "===": "equals", "==": "equals", "!==": "does not equal", "!=": "does not equal", ">": "is greater than", "<": "is less than", ">=": "is at least", "<=": "is at most", "&&": "and", "||": "or" };
      return `${value(node.left, target, seen)} ${operators[node.operator] || node.operator} ${value(node.right, target, seen)}`;
    }
    if (node.type === "MemberExpression") return `${value(node.object, target, seen)} ${node.computed ? value(node.property, target, seen) : node.property?.name || "value"}`;
    if (node.type === "ArrayExpression") return node.elements.map((item: Ast) => value(item, target, seen)).join(", ");
    if (node.type === "TemplateLiteral") return node.quasis.map((part: any, index: number) => (part.value.cooked ?? part.value.raw) + (node.expressions[index] ? `{${value(node.expressions[index], target, seen)}}` : "")).join("");
    return "calculated value (see Source)";
  };
  const targetFor = (original: Ast | undefined, seen = new Set<string>()): string => {
    if (!original) return "Page";
    const node = unawait(original);
    if (isPage(node)) return "Page";
    if (node.type === "Identifier" && aliases.has(node.name) && !seen.has(node.name)) return targetFor(aliases.get(node.name), new Set([...seen, node.name]));
    if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
      const method = methodName(node.callee), receiver = node.callee.object;
      const exact = fieldFor("", node); if (exact) return exact;
      if (["first", "last", "nth"].includes(method)) return `${targetFor(receiver, seen)} (${method === "nth" ? `item ${Number(value(node.arguments[0])) + 1}` : method})`;
      const unscoped = isPage(receiver) || identifier(receiver) === "driver";
      if (["locator", "$", "$$"].includes(method)) {
        const selector = value(node.arguments[0], true);
        return (unscoped ? fieldFor(selector) : "") || (unscoped ? selector || "configured field" : `${targetFor(receiver, seen)} → ${selector || "configured field"}`);
      }
      if (method === "filter") {
        const options = node.arguments[0];
        const filters = options?.type === "ObjectExpression" ? options.properties.map((property: Ast) => {
          const key = property.key?.name || property.key?.value;
          return key === "hasText" ? `with text ${quoted(value(property.value, true))}` : key === "hasNotText" ? `without text ${quoted(value(property.value, true))}`
            : key === "has" ? `containing ${targetFor(property.value, seen)}` : key === "hasNot" ? `without ${targetFor(property.value, seen)}` : "with configured filter (see Source)";
        }) : ["with configured filter (see Source)"];
        return [targetFor(receiver, seen), ...filters].join(" ");
      }
      const methods: Record<string, string> = { getByRole: "role", getByLabel: "field", getByPlaceholder: "field", getByText: "text", getByTestId: "test ID", getByTitle: "title", getByAltText: "image" };
      if (method in methods) {
        const name = method === "getByRole" ? node.arguments[1]?.properties?.find((property: Ast) => (property.key?.name || property.key?.value) === "name")?.value : node.arguments[0];
        const description = value(name, true), role = method === "getByRole" ? value(node.arguments[0], true) : methods[method];
        const target = [description, role].filter(Boolean).join(" ") || "configured field";
        return unscoped ? target : `${targetFor(receiver, seen)} → ${target}`;
      }
    }
    const raw = value(node, true);
    return fieldFor(raw) || (pageNames.has(raw) ? "Page" : raw || "configured field");
  };
  const isLocator = (original: Ast | undefined, seen = new Set<string>()): boolean => {
    if (!original) return false;
    const node = unawait(original);
    if (node.type === "Identifier" && aliases.has(node.name) && !seen.has(node.name)) return isLocator(aliases.get(node.name), new Set([...seen, node.name]));
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
    const method = methodName(node.callee), receiver = node.callee.object;
    return ["locator", "$", "$$", "getByRole", "getByLabel", "getByPlaceholder", "getByText", "getByTestId", "getByTitle", "getByAltText", "first", "last", "nth", "filter"].includes(method)
      && (isPage(receiver) || identifier(receiver) === "driver" || isLocator(receiver, seen));
  };
  const add = (label: string, args: string[], kind: ReadableAutomationInstruction["kind"], depth: number, contexts: string[], text?: string, detail?: string) => rows.push({ label, args: args.filter(Boolean), kind, depth, contexts: [...contexts], text: text || [label, ...args.filter(Boolean)].join(" "), ...(detail ? { detail } : {}) });
  const expectedLiteral = (node: Ast | undefined) => Boolean(node && (node.type === "Literal" && typeof node.value === "string"
    || node.type === "MemberExpression" && identifier(node.object) === "params" && node.computed && node.property?.type === "Literal" && typeof node.property.value === "string"));
  const zeroArgumentRead = (node: Ast | undefined, method: string): Ast | null => {
    const call = node?.type === "AwaitExpression" ? node.argument : node;
    return call?.type === "CallExpression" && !call.optional && call.callee.type === "MemberExpression" && !call.callee.computed && !call.callee.optional && methodName(call.callee) === method && call.arguments.length === 0 ? call.callee.object : null;
  };
  const normalizedTextRead = (node: Ast | undefined): Ast | null => {
    const replaced = zeroArgumentRead(node, "trim");
    if (replaced?.type !== "CallExpression" || replaced.optional || replaced.callee.type !== "MemberExpression" || replaced.callee.computed || replaced.callee.optional || methodName(replaced.callee) !== "replace" || replaced.arguments.length !== 2
      || replaced.arguments[0]?.regex?.pattern !== "\\s+" || replaced.arguments[0]?.regex?.flags !== "g" || replaced.arguments[1]?.type !== "Literal" || replaced.arguments[1].value !== " ") return null;
    return zeroArgumentRead(replaced.callee.object, "innerText");
  };
  const normalizedExpected = (node: Ast | undefined): Ast | null => {
    if (expectedLiteral(node)) return node!;
    const replaced = zeroArgumentRead(node, "trim");
    if (replaced?.type !== "CallExpression" || replaced.optional || replaced.callee.type !== "MemberExpression" || replaced.callee.computed || replaced.callee.optional || methodName(replaced.callee) !== "replace" || replaced.arguments.length !== 2
      || replaced.arguments[0]?.regex?.pattern !== "\\s+" || replaced.arguments[0]?.regex?.flags !== "g" || replaced.arguments[1]?.value !== " ") return null;
    const string = replaced.callee.object;
    return string?.type === "CallExpression" && !string.optional && identifier(string.callee) === "String" && string.arguments.length === 1 && expectedLiteral(string.arguments[0]) ? string.arguments[0] : null;
  };
  // This is presentation for the compiler's closed read predicates. Unknown
  // callbacks remain explicit custom source; no callback is evaluated here.
  const pollDescription = (poll: Ast, matcher: string, args: Ast[]): string | null => {
    const callback = poll.arguments[0];
    if (poll.arguments.length !== 1 || callback?.type !== "ArrowFunctionExpression" || callback.params.length || callback.body.type === "BlockStatement" || args.length !== 1) return null;
    const body = callback.body;
    for (const [method, label] of [["url", "Page URL"], ["title", "Page title"]]) {
      const target = zeroArgumentRead(body, method);
      if (target && isPage(target) && expectedLiteral(args[0]) && (matcher === "toBe" || method === "url" && matcher === "toContain")) return `${label} ${matcher === "toContain" ? "contains" : "equals"} ${quoted(value(args[0]))}`;
    }
    if (matcher !== "toBe" || args[0].type !== "Literal" || args[0].value !== true || body.type !== "LogicalExpression" || body.operator !== "&&") return null;
    const visible = zeroArgumentRead(body.left, "isVisible");
    if (!visible || !isLocator(visible)) return null;
    const comparison = body.right;
    const contains = comparison.type === "CallExpression" && !comparison.optional && comparison.callee.type === "MemberExpression" && !comparison.callee.computed && !comparison.callee.optional && methodName(comparison.callee) === "includes" && comparison.arguments.length === 1;
    if (!contains && (comparison.type !== "BinaryExpression" || comparison.operator !== "===")) return null;
    const target = normalizedTextRead(contains ? comparison.callee.object : comparison.left);
    const expected = normalizedExpected(contains ? comparison.arguments[0] : comparison.right);
    if (!target || !expected || code.slice(target.start, target.end) !== code.slice(visible.start, visible.end)) return null;
    return `${targetFor(target)} is visible and rendered text ${contains ? "contains" : "equals"} ${quoted(value(expected))}`;
  };
  const callAction = (original: Ast, depth: number, contexts: string[], savedAs = ""): boolean => {
    const call = unawait(original); if (call.type !== "CallExpression") return false;
    const callee = call.callee, method = methodName(callee), receiver = callee.object;
    const root = identifier(receiver), helper = ["web", "api", "mobile", "android", "ios"].includes(root);
    const nativePage = isPage(receiver), keyboard = methodName(receiver) === "keyboard" && isPage(receiver.object);
    const args: Ast[] = call.arguments || [];
    const expectCall = receiver?.type === "MemberExpression" && methodName(receiver) === "not" ? receiver.object : receiver;
    const poll = expectCall?.type === "CallExpression" && expectCall.callee.type === "MemberExpression" && !expectCall.callee.computed && !expectCall.callee.optional && methodName(expectCall.callee) === "poll"
      && (expectNames.has(identifier(expectCall.callee.object)) || namespaces.has(identifier(expectCall.callee.object?.object)) && methodName(expectCall.callee.object) === "expect");
    if (poll) {
      const description = receiver === expectCall ? pollDescription(expectCall, method, args) : null;
      if (description) add("Poll until condition", [description], "assertion", depth, contexts);
      else add("Run custom code poll", [], "custom", depth, contexts, undefined, "Custom polling source is retained. Review Source for its callback, predicate and timeout.");
      return true;
    }
    const assertion = expectCall?.type === "CallExpression" && (expectNames.has(identifier(expectCall.callee)) || namespaces.has(identifier(expectCall.callee.object)) && methodName(expectCall.callee) === "expect");
    if (assertion) {
      const target = targetFor(expectCall.arguments[0]), not = receiver !== expectCall;
      const labels: Record<string, string> = { toBeVisible: "Verify visible", toBeHidden: "Verify hidden", toBeEnabled: "Verify enabled", toBeDisabled: "Verify disabled", toHaveText: "Verify text", toContainText: "Verify text contains", toHaveValue: "Verify value", toHaveURL: "Verify URL", toBeChecked: "Verify checked", toEqual: "Verify equals", toBe: "Verify equals", toBeTruthy: "Verify true", toBeFalsy: "Verify false", toContain: "Verify contains", toMatch: "Verify matches" };
      if (!labels[method]) return false;
      add(`${labels[method]}${not ? " (not)" : ""}`, [target, value(args[0])], "assertion", depth, contexts);return true;
    }
    const locatorReceiver = isLocator(receiver);
    if (!helper && !nativePage && !keyboard && !locatorReceiver) return false;
    const locatorTarget = helper || nativePage ? targetFor(args[0]) : targetFor(receiver);
    const supplied = helper || nativePage ? args[1] : args[0];
    const target = keyboard ? "Page keyboard" : locatorTarget;
    const suffix = savedAs ? `Save as ${savedAs}` : "";
    const basic: Record<string, string> = { click: "Click", dblclick: "Double click", rightClick: "Right click", hover: "Hover", tap: "Tap", doubleTap: "Double tap", longPress: "Long press", clear: "Clear", check: "Check", uncheck: "Uncheck", focus: "Focus", scrollIntoViewIfNeeded: "Scroll to", scrollIntoView: "Scroll to" };
    if (method in basic) {
      const options = helper || nativePage ? args[1] : args[0];
      const setting = (name: string) => options?.type === "ObjectExpression" ? options.properties.find((property: Ast) => (property.key?.name || property.key?.value) === name)?.value : undefined;
      const label = method === "click" && value(setting("button")) === "right" ? "Right click" : method === "click" && value(setting("clickCount")) === "2" ? "Double click" : basic[method];
      add(label, [target, suffix], "action", depth, contexts, undefined, options ? "Action options are retained in Source." : undefined);return true;
    }
    if (["fill", "type", "setValue", "addValue", "pressSequentially"].includes(method)) { const content = value(supplied);add("Type", [target, content || '""', suffix], "action", depth, contexts, `Type ${quoted(content)} into ${target}${suffix ? `; ${suffix}` : ""}`);return true; }
    if (method === "press") { const key = value(keyboard ? args[0] : supplied);add("Press", [key, target], "action", depth, contexts, `Press ${quoted(key)} in ${target}`);return true; }
    if (["select", "selectOption"].includes(method)) { const option = supplied?.type === "ObjectExpression" ? supplied.properties.find((property: Ast) => ["label", "value", "index"].includes(property.key?.name || property.key?.value)) : null;add("Select", [target, value(option?.value || supplied)], "action", depth, contexts);return true; }
    if (["goto", "openTab", "switchTab", "closeTab", "reload", "goBack", "goForward", "waitForLoadState", "wait", "waitForTimeout", "pause"].includes(method)) {
      const labels: Record<string, string> = { goto: "Open URL", openTab: "Open tab", switchTab: "Switch tab", closeTab: "Close tab", reload: "Reload page", goBack: "Go back", goForward: "Go forward", waitForLoadState: "Wait for page", wait: "Wait", waitForTimeout: "Wait", pause: "Wait" };
      add(labels[method], [value(args[0]), suffix], "action", depth, contexts);return true;
    }
    if (/^expect(?:Text|Visible|Hidden|Enabled|Displayed|NotDisplayed|Value|Url|Status|Json)$/.test(method)) {
      const labels: Record<string, string> = { expectText: "Verify text", expectVisible: "Verify visible", expectHidden: "Verify hidden", expectEnabled: "Verify enabled", expectDisplayed: "Verify visible", expectNotDisplayed: "Verify hidden", expectValue: "Verify value", expectUrl: "Verify URL", expectStatus: "Verify status", expectJson: "Verify JSON" };
      const contents = method === "expectText" && args.length === 1 ? ["Page", value(args[0])] : [method === "expectStatus" || method === "expectUrl" ? value(args[0]) : target, value(args[1])];
      add(labels[method], contents, "assertion", depth, contexts);return true;
    }
    if (["captureText", "captureValue", "text", "value", "innerText", "inputValue"].includes(method)) { add(method.toLowerCase().includes("value") ? "Read value" : "Read text", [target, value(supplied), suffix], "action", depth, contexts);return true; }
    if (["uploadFile", "uploadLocalFile", "uploadRemoteFile", "setInputFiles"].includes(method)) { add("Upload file", [target, value(supplied)], "action", depth, contexts);return true; }
    if (method === "screenshot") { add("Take screenshot", [value(args[0])], "action", depth, contexts);return true; }
    if (method === "request" && root === "api") { const property = (name: string) => args[0]?.type === "ObjectExpression" ? args[0].properties.find((item: Ast) => (item.key?.name || item.key?.value) === name)?.value : null;add("Send API request", [value(property("method")), value(property("url") || args[0]), suffix], "action", depth, contexts);return true; }
    if (method === "aiStep") { add("Follow AI instruction", [value(args[0])], "custom", depth, contexts, undefined, "AI-directed behavior; review Source and run evidence.");return true; }
    if (method === "evaluate" || method === "evaluateHandle") { add("Run browser JavaScript", [suffix], "custom", depth, contexts, undefined, "Custom browser behavior; review Source for its complete logic.");return true; }
    return false;
  };
  try {
    const tree = parse(code, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) as unknown as Ast;
    const inspectAliases = (node: Ast) => {
      if (node.type === "ImportDeclaration") {
        for (const specifier of node.specifiers || []) {
          if (["@playwright/test", "playwright/test"].includes(node.source.value)) {
            if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
            if (specifier.imported?.name === "test") testNames.add(specifier.local.name);
            if (specifier.imported?.name === "expect") expectNames.add(specifier.local.name);
          }
        }
      }
      if (node.type === "VariableDeclarator" && node.id.type === "ObjectPattern" && node.init?.type === "CallExpression" && identifier(node.init.callee) === "require" && ["@playwright/test", "playwright/test"].includes(node.init.arguments[0]?.value)) {
        for (const property of node.id.properties) {
          if (property.key?.name === "test") testNames.add(property.value.name);
          if (property.key?.name === "expect") expectNames.add(property.value.name);
        }
      }
      if (["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(node.type)) {
        if (node.params.length === 1 && node.params[0].type === "Identifier") { pageNames.add(`${node.params[0].name}.page`);pageNames.add(`${node.params[0].name}.playwrightPage`); }
        for (const parameter of node.params || []) for (const property of parameter.type === "ObjectPattern" ? parameter.properties : []) if (["page", "playwrightPage"].includes(property.key?.name) && property.value?.type === "Identifier") pageNames.add(property.value.name);
      }
      for (const item of Object.values(node)) for (const child of Array.isArray(item) ? item : [item]) if (child && typeof child === "object" && "type" in child) inspectAliases(child as Ast);
    };
    inspectAliases(tree);
    for (const field of fields) {
      if (!/^(?:page\.)?(?:getBy\w+|locator)\s*\(/.test(field.locator)) continue;
      try { const parsed = parse(field.locator.replace(/^(?=getBy\w+\s*\(|locator\s*\()/, "page."), { ecmaVersion: "latest" }) as any; field.semantic = canonical(parsed.body[0].expression); } catch { /* Unparseable locators still resolve through their reference. */ }
    }
    const restoreAliases = (snapshot: Map<string, Ast>) => { aliases.clear();snapshot.forEach((initial, name) => aliases.set(name, initial)); };
    const writtenNames = (node: Ast, names = new Set<string>()): Set<string> => {
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return names;
      const target = node.type === "AssignmentExpression" ? node.left : node.type === "UpdateExpression" ? node.argument : node.type === "VariableDeclarator" ? node.id : null;
      if (target?.type === "Identifier") names.add(target.name);
      for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) if (child && typeof child === "object" && "type" in child) writtenNames(child as Ast, names);
      return names;
    };
    const discardUncertainWrites = (node: Ast, snapshot: Map<string, Ast>) => { restoreAliases(snapshot);writtenNames(node).forEach(name => aliases.delete(name)); };
    const visit = (node: Ast, depth = 0, contexts: string[] = []) => {
      if (!node || depth > 30) { add("Run nested custom logic", [], "custom", depth, contexts, undefined, "Review Source for the full nested behavior.");return; }
      if (node.type === "Program") {
        const meaningful = node.body.filter((child: Ast) => !["ImportDeclaration", "EmptyStatement"].includes(child.type));
        const single = meaningful.length === 1 ? meaningful[0] : null;
        const expression = single?.type === "ExpressionStatement" ? single.expression : null;
        const entry = single?.type === "FunctionDeclaration" ? single : expression && ["FunctionExpression", "ArrowFunctionExpression"].includes(expression.type) ? expression
          : expression?.type === "AssignmentExpression" && ["module.exports", "exports.default"].includes(nodePath(expression.left)) && ["FunctionExpression", "ArrowFunctionExpression"].includes(expression.right.type) ? expression.right : null;
        if (entry) { visit(entry.body, depth, contexts);return; }
        node.body.forEach((child: Ast) => visit(child, depth, contexts));return;
      }
      if (node.type === "BlockStatement") {
        const outer = new Map(aliases);
        const locals = node.body.filter((child: Ast) => child.type === "VariableDeclaration" && child.kind !== "var").flatMap((child: Ast) => child.declarations.map((declaration: Ast) => identifier(declaration.id))).filter(Boolean);
        (node.body || []).forEach((child: Ast) => visit(child, depth, contexts));
        for (const name of locals) { if (outer.has(name)) aliases.set(name, outer.get(name)!);else aliases.delete(name); }
        return;
      }
      if (node.type === "CallExpression" && callAction(node, depth, contexts)) return;
      if (node.type === "ImportDeclaration") { if (!["@playwright/test", "playwright/test"].includes(node.source.value)) add("Load library", [String(node.source.value)], "setup", depth, contexts);return; }
      if (node.type === "ExportDefaultDeclaration" && ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.declaration.type)) { visit(node.declaration.body, depth, contexts);return; }
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) { add("Define helper", [node.id?.name || "custom function"], "setup", depth, contexts, undefined, "The helper's implementation remains in Source; it runs when called.");return; }
      if (node.type === "IfStatement") { const outer = new Map(aliases), condition = value(node.test);add("If", [condition], "control", depth, contexts);visit(node.consequent, depth + 1, [...contexts, `If ${condition}`]);restoreAliases(outer);if (node.alternate) { add("Otherwise", [], "control", depth, contexts);visit(node.alternate, depth + 1, [...contexts, `Otherwise (${condition})`]); }discardUncertainWrites(node, outer);return; }
      if (["ForOfStatement", "ForInStatement", "ForStatement", "WhileStatement", "DoWhileStatement"].includes(node.type)) {
        const label = node.type === "ForOfStatement" || node.type === "ForInStatement" ? "For each" : "Repeat while";
        const condition = node.right ? `${node.left.declarations?.[0]?.id?.name || node.left.name || "item"} in ${value(node.right)}` : node.test ? value(node.test) : "the configured loop continues";
        const outer = new Map(aliases);writtenNames(node).forEach(name => aliases.delete(name));
        add(label, [condition], "control", depth, contexts, undefined, node.type === "ForStatement" ? "Loop initialization and updates remain in Source." : undefined);visit(node.body, depth + 1, [...contexts, `${label} ${condition}`]);discardUncertainWrites(node, outer);return;
      }
      if (node.type === "TryStatement") { const outer = new Map(aliases);add("Try", [], "control", depth, contexts);visit(node.block, depth + 1, [...contexts, "Try"]);discardUncertainWrites(node, outer);if (node.handler) { add("On failure", [], "control", depth, contexts);visit(node.handler.body, depth + 1, [...contexts, "On failure"]); }discardUncertainWrites(node, outer);if (node.finalizer) { add("Always", [], "control", depth, contexts);visit(node.finalizer, depth + 1, [...contexts, "Always"]); }discardUncertainWrites(node, outer);return; }
      if (node.type === "VariableDeclaration") {
        for (const declaration of node.declarations) {
          const name = identifier(declaration.id) || "values", initial = declaration.init;
          if (declaration.id.type === "ObjectPattern" && initial?.type === "CallExpression" && identifier(initial.callee) === "require" && ["@playwright/test", "playwright/test"].includes(initial.arguments[0]?.value)) continue;
          if (initial && declaration.id.type === "Identifier") aliases.set(name, initial);
          if (initial && callAction(initial, depth, contexts, name)) continue;
          if (initial?.type === "CallExpression" && ["locator", "$", "$$"].includes(methodName(initial.callee)) || initial?.type === "CallExpression" && /^getBy/.test(methodName(initial.callee))) { add("Find field", [targetFor(initial), `as ${name}`], "setup", depth, contexts);continue; }
          add("Set value", [name, initial ? value(initial) : "not set"], "setup", depth, contexts);
        }return;
      }
      if (node.type === "ExpressionStatement") {
        const expression = unawait(node.expression);
        if (expression.type === "AssignmentExpression" && expression.left.type === "Identifier") {
          const name = expression.left.name;
          if (expression.operator === "=") { aliases.set(name, expression.right);if (!callAction(expression.right, depth, contexts, name)) add("Set value", [name, value(expression.right)], "setup", depth, contexts); }
          else { aliases.delete(name);add("Update value", [name], "setup", depth, contexts, undefined, "The calculation is retained in Source."); }
          return;
        }
        if (expression.type === "AssignmentExpression" && expression.left.type === "MemberExpression" && identifier(expression.left.object) === "params") {
          const name = expression.left.computed ? expression.left.property.value : expression.left.property.name;
          if (typeof name === "string") { delete parameterValues[parameterKey(name)];runtimeParameters.add(parameterKey(name));add("Set parameter", [name.replace(/^@/, ""), value(expression.right)], "setup", depth, contexts);return; }
        }
        if (expression.type === "UpdateExpression" && expression.argument.type === "Identifier") { aliases.delete(expression.argument.name);add("Update value", [expression.argument.name], "setup", depth, contexts);return; }
        if (expression.type === "CallExpression") {
          const method = methodName(expression.callee), root = identifier(expression.callee.object);
          const wrapper = testNames.has(identifier(expression.callee)) || namespaces.has(root) && method === "test";
          const step = method === "step" && (testNames.has(root) || root === "web");
          const callback = expression.arguments.find((argument: Ast) => ["ArrowFunctionExpression", "FunctionExpression"].includes(argument.type));
          if (["ArrowFunctionExpression", "FunctionExpression"].includes(expression.callee.type)) { visit(expression.callee.body, depth, contexts);return; }
          if ((wrapper || step) && callback) { if (step) add("Step", [value(expression.arguments[0])], "control", depth, contexts);visit(callback.body, step ? depth + 1 : depth, step ? [...contexts, `Step ${value(expression.arguments[0])}`] : contexts);return; }
          if (callAction(expression, depth, contexts)) return;
          add("Run custom instruction", [identifier(expression.callee) || method || "configured operation"], "custom", depth, contexts, undefined, "Custom code is retained. Review Source for its complete behavior.");return;
        }
      }
      if (node.type === "EmptyStatement") return;
      if (node.type === "ReturnStatement") { if (node.argument && callAction(node.argument, depth, contexts)) return;add("Return result", [value(node.argument)], "control", depth, contexts);return; }
      if (node.type === "ThrowStatement") { add("Stop with error", [value(node.argument)], "control", depth, contexts);return; }
      add("Run custom JavaScript", [], "custom", depth, contexts, undefined, "Custom code is retained. Review Source for its complete behavior.");
    };
    visit(tree);
    return rows;
  } catch {
    return [{ label: "Review incomplete instructions", args: [], kind: "custom", depth: 0, text: "Review incomplete instructions in Source", detail: "This draft cannot be interpreted safely yet. Its complete source is preserved." }];
  }
}

export function readableAutomationInstructionText(instruction: ReadableAutomationInstruction) {
  const scope = instruction.contexts?.length && instruction.kind !== "control" ? `${instruction.contexts.join(" / ")}: ` : "";
  return `${scope}${instruction.text}${instruction.kind === "custom" ? " (review Source for complete behavior)" : ""}`;
}

export function readableApiInstructions(request: StepApiRequest): ReadableAutomationInstruction[] {
  const row = (label: string, args: string[], kind: ReadableAutomationInstruction["kind"]): ReadableAutomationInstruction => ({ label, args, kind, depth: 0, text: [label, ...args].join(" ") });
  const labels: Record<string, string> = { status: "Verify status", header: "Verify response header", header_present: "Verify response header exists", body_contains: "Verify response body contains", body_not_contains: "Verify response body excludes", json_path: "Verify JSON path", json_schema: "Verify JSON schema", response_time: "Verify response time" };
  const operators: Record<string, string> = { eq: "equals", ne: "does not equal", contains: "contains", matches: "matches", exists: "exists", lt: "less than", lte: "at most", gt: "greater than", gte: "at least" };
  return [row("Send request", [request.method || "GET", request.url || "URL not configured"], "action"), ...(request.validations || []).map(validation => row(labels[validation.kind] || "Verify response", [validation.target || "", operators[validation.operator || "eq"], validation.expected || ""].filter(Boolean), "assertion")), ...(request.captures || []).map(capture => row("Capture response", [capture.path || "response path not configured", `as ${capture.parameter || "parameter not configured"}`], "action"))];
}
