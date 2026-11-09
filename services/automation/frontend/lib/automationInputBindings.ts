import { parse } from "acorn";
import type { TestStep } from "@hellotest/platform/frontend/src/types";
import { extractStepParameterMatches, parseStepParameterName } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

type Node = { type: string; start: number; end: number; [key: string]: any };
export type AutomationInputBinding = { id: string; label: string; value: string; start?: number; end?: number; path?: Array<string | number> };
type BindingStep = Pick<TestStep, "automation_code" | "api_request" | "step_type">;
const method = (node: Node) => node.callee?.type === "MemberExpression" && !node.callee.computed ? node.callee.property.name : "";
const literal = (node?: Node) => node?.type === "Literal" && typeof node.value === "string" ? node.value
  : node?.type === "TemplateLiteral" && !node.expressions.length ? node.quasis.map((part: any) => part.value.cooked ?? part.value.raw).join("") : null;
const isBinding = (value: string) => {
  const matches = extractStepParameterMatches(value);
  return /^@[tsr]\./i.test(value) && matches.length === 1 && matches[0].index === 0 && matches[0].token.length === value.length;
};
const isPage = (node?: Node) => node?.type === "Identifier" && ["page", "playwrightPage"].includes(node.name);
type Binding = { kind: string; init?: Node; mutable: boolean };
type Scope = { parent?: Scope; functionScope: boolean; bindings: Map<string, Binding> };
/** Resolve lexical const aliases only. Shadowing, writes and mutable bindings
 * cannot make an unrelated helper's arguments look like locator input data. */
function locatorAliases(tree: Node) {
  const scopes = new WeakMap<Node, Scope>(), writes: Array<{ node: Node; scope: Scope }> = [];
  const names = (node?: Node): string[] => !node ? [] : node.type === "Identifier" ? [node.name]
    : node.type === "RestElement" ? names(node.argument) : node.type === "AssignmentPattern" ? names(node.left)
      : node.type === "ArrayPattern" ? node.elements.flatMap(names)
        : node.type === "ObjectPattern" ? node.properties.flatMap((property: Node) => names(property.type === "RestElement" ? property.argument : property.value)) : [];
  const declare = (scope: Scope, node: Node | undefined, kind: string, init?: Node) => {
    for (const name of names(node)) scope.bindings.set(name, scope.bindings.has(name) ? { kind: "ambiguous", mutable: true } : { kind, init, mutable: false });
  };
  const root: Scope = { functionScope: true, bindings: new Map() };
  const scan = (node: Node, parent: Scope) => {
    if (!node || typeof node !== "object" || typeof node.type !== "string") return;
    let scope = parent;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      if (node.type === "FunctionDeclaration") declare(parent, node.id, "function");
      scope = { parent, functionScope: true, bindings: new Map() };
      if (node.type === "FunctionExpression") declare(scope, node.id, "function");
      node.params.forEach((param: Node) => declare(scope, param, "parameter"));
    } else if (node.type === "BlockStatement" || node.type === "CatchClause" || ["ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type)) {
      scope = { parent, functionScope: false, bindings: new Map() };
      if (node.type === "CatchClause") declare(scope, node.param, "catch");
    }
    scopes.set(node, scope);
    if (node.type === "ClassDeclaration") declare(scope, node.id, "class");
    if (node.type === "VariableDeclaration") {
      let destination = scope;
      if (node.kind === "var") while (!destination.functionScope && destination.parent) destination = destination.parent;
      for (const declaration of node.declarations) declare(destination, declaration.id, node.kind, declaration.id.type === "Identifier" ? declaration.init : undefined);
    }
    if (["AssignmentExpression", "UpdateExpression"].includes(node.type)) writes.push({ node: node.left || node.argument, scope });
    if (["ForInStatement", "ForOfStatement"].includes(node.type) && node.left.type !== "VariableDeclaration") writes.push({ node: node.left, scope });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => scan(child, scope));
      else if (value && typeof value === "object") scan(value as Node, scope);
    }
  };
  const binding = (name: string, scope?: Scope): Binding | undefined => scope?.bindings.get(name) || (scope?.parent ? binding(name, scope.parent) : undefined);
  scan(tree, root);
  for (const write of writes) {
    let target = write.node;
    while (target?.type === "MemberExpression") target = target.object;
    for (const name of names(target)) { const found = binding(name, write.scope); if (found) found.mutable = true; }
  }
  return (node: Node): Node | undefined => {
    const found = node.type === "Identifier" ? binding(node.name, scopes.get(node)) : undefined;
    return found?.kind === "const" && !found.mutable ? found.init : undefined;
  };
}
const isExpectation = (node?: Node): boolean => Boolean(node && (node.type === "CallExpression" && node.callee.type === "Identifier" && ["expect", "playwrightExpect"].includes(node.callee.name)
  || node.type === "MemberExpression" && !node.computed && ["not", "resolves", "rejects"].includes(node.property.name) && isExpectation(node.object)));

/** Only executable data positions are editable. Locators, comments, regexes,
 * arbitrary helpers, capture identities and unrelated literals are preserved. */
export function collectAutomationInputBindings(step: BindingStep): AutomationInputBinding[] {
  const inputs: AutomationInputBinding[] = [];
  if (step.step_type === "api") {
    const request = step.api_request;
    if (!request) return inputs;
    const add = (path: Array<string | number>, value: unknown, label: string) => {
      if (typeof value === "string") inputs.push({ id: JSON.stringify(path), path, value, label });
    };
    add(["url"], request.url, "Request URL");
    add(["body"], request.body, "Request body");
    for (const key of ["headers", "query_params", "cookies"] as const) request[key]?.forEach((item, index) => add([key, index, "value"], item.value, `${key === "headers" ? "Header" : key === "cookies" ? "Cookie" : "Query"} ${item.key}`));
    request.validations?.forEach((item, index) => { if (item.kind !== "header_present") add(["validations", index, "expected"], item.expected, `Expected ${item.kind}`); });
    return inputs;
  }
  const source = step.automation_code || "";
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) as unknown as Node;
  const alias = locatorAliases(tree);
  const frameDepth = (node?: Node, seen = new Set<Node>()): number | null => {
    if (isPage(node)) return 0;
    if (!node || seen.has(node)) return null;
    const next = new Set([...seen, node]), init = alias(node);
    if (init) return frameDepth(init, next);
    if (node.type !== "CallExpression" || node.optional || node.callee.optional || method(node) !== "frameLocator" || node.arguments.length !== 1) return null;
    const selector = literal(node.arguments[0]), parent = frameDepth(node.callee.object, next);
    return selector?.trim() && selector.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(selector)
      && !/^(?:page\.)?(?:frameLocator|locator|getBy\w+)\s*\(/.test(selector.trim()) && parent !== null && parent < 3 ? parent + 1 : null;
  };
  const isLocator = (node?: Node, seen = new Set<Node>()): boolean => {
    if (!node || seen.has(node)) return false;
    const next = new Set([...seen, node]), init = alias(node);
    if (init) return isLocator(init, next);
    return node.type === "CallExpression" && !node.optional && !node.callee.optional
      && ["locator", "getByRole", "getByLabel", "getByText", "getByPlaceholder", "getByTitle", "getByAltText", "getByTestId", "filter", "first", "last", "nth"].includes(method(node))
      && (frameDepth(node.callee.object) !== null || isLocator(node.callee.object, next));
  };
  const add = (node: Node | undefined, label: string) => {
    const value = literal(node);
    if (value !== null && node && !inputs.some(input => input.start === node.start)) inputs.push({ id: `${node.start}:${node.end}`, start: node.start, end: node.end, value, label });
  };
  const walk = (node: Node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression") {
      const name = method(node), receiver = node.callee.object;
      const keyword = receiver?.type === "Identifier" && ["web", "mobile", "android", "ios"].includes(receiver.name);
      const page = isPage(receiver), locator = isLocator(receiver), assertion = isExpectation(receiver);
      if ((keyword || page || locator) && ["fill", "type", "press", "pressSequentially", "selectOption", "select", "uploadFile", "uploadLocalFile", "uploadRemoteFile", "setInputFiles"].includes(name)) add(node.arguments[(keyword || page) ? 1 : 0], `${name} input`);
      else if ((keyword || page) && ["goto", "openTab", "expectUrl"].includes(name)) add(node.arguments[0], `${name} URL`);
      else if (keyword && ["expectText", "expectValue"].includes(name)) add(node.arguments[name === "expectText" && node.arguments.length === 1 ? 0 : 1], `${name} expected value`);
      else if (assertion && ["toHaveText", "toContainText", "toHaveValue", "toHaveURL", "toHaveTitle", "toEqual", "toBe", "toContain"].includes(name)) add(node.arguments[0], `${name} expected value`);
      else if (assertion && ["toHaveAttribute", "toHaveCSS"].includes(name)) add(node.arguments[1], `${name} expected value`);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value as Node);
    }
  };
  walk(tree);
  return inputs.sort((a, b) => (a.start || 0) - (b.start || 0));
}

/** Reparse current source and apply selected AST ranges. No text substitution
 * or evaluation can turn a locator or quoted value into JavaScript syntax. */
export function applyAutomationInputBindings<T extends BindingStep>(step: T, selections: Record<string, string>): T {
  const inputs = collectAutomationInputBindings(step);
  const selected = Object.entries(selections).filter(([, reference]) => reference);
  const updates = selected.map(([id, reference]) => {
    const input = inputs.find(item => item.id === id), parameter = parseStepParameterName(reference);
    if (!input || !parameter || !isBinding(reference)) throw new Error("An input or parameter reference changed. Reopen parameter bindings and review the current source.");
    return { input, parameter };
  });
  if (step.step_type === "api") {
    const request = structuredClone(step.api_request!);
    for (const { input, parameter } of updates) {
      const path = input.path!;
      let parent: any = request;
      for (const part of path.slice(0, -1)) parent = parent[part];
      parent[path.at(-1)!] = parameter.token;
    }
    return { ...step, api_request: request };
  }
  let source = step.automation_code || "";
  for (const { input, parameter } of updates.sort((a, b) => b.input.start! - a.input.start!)) source = source.slice(0, input.start) + `params[${JSON.stringify(parameter.name)}]` + source.slice(input.end);
  // Fail before changing the draft if any edit did not produce valid source.
  parse(source, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  return { ...step, automation_code: source };
}

export function suggestedAutomationInputBindings(inputs: AutomationInputBinding[], values: Record<string, string>) {
  return Object.fromEntries(inputs.flatMap(input => {
    if (isBinding(input.value)) return [[input.id, input.value]];
    const matches = Object.entries(values).filter(([, value]) => input.value !== "" && value === input.value);
    return matches.length === 1 ? [[input.id, parseStepParameterName(matches[0][0])!.token]] : [];
  }));
}
