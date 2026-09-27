import { parse } from "acorn";
export type AutomationLineResult = { line: number; status: "passed" | "failed"; duration_ms: number; attempt: number; error?: string };
/** Instrument awaited operations with an AST; comments, strings and multiline expressions stay intact. */
export function instrumentAutomationLines(source: string) {
  let prefix = "async function __hellotest_source__() {\n";
  let tree;
  try { tree = parse(`${prefix}${source}\n}`, { ecmaVersion: "latest", locations: true }); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // Anonymous async wrappers are expressions, not declarations. Keep their original line positions.
    prefix += "(";
    tree = parse(`${prefix}${source}\n)}`, { ecmaVersion: "latest", locations: true });
  }
  const insertions: Array<{ position: number; text: string; order: number }> = [];
  function visit(node: any) {
    if (!node || typeof node !== "object") return;
    if (node.type === "AwaitExpression") {
      insertions.push({ position: node.argument.start - prefix.length, text: `__hellotestTrace(${node.loc.start.line - 1}, async () => (`, order: 1 });
      insertions.push({ position: node.argument.end - prefix.length, text: "))", order: 0 });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(tree);
  let output = source;
  for (const { position, text } of insertions.sort((a, b) => b.position - a.position || a.order - b.order)) output = output.slice(0, position) + text + output.slice(position);
  return output;
}
export function createAutomationLineTracer(results: AutomationLineResult[], attempt: number) {
  return async (line: number, operation: () => Promise<unknown>) => {
    const start = Date.now();
    try {
      const value = await operation();
      if (results.length < 1000) results.push({ line, status: "passed", duration_ms: Date.now() - start, attempt });
      return value;
    } catch (error) {
      const result: AutomationLineResult = { line, status: "failed", duration_ms: Date.now() - start, attempt, error: error instanceof Error ? error.message.slice(0, 2000) : "Operation failed" };
      if (results.length >= 1000) results[results.length - 1] = result; else results.push(result);
      if (error instanceof Error) (error as Error & { hellotestLine?: number }).hellotestLine ??= line;
      throw error;
    }
  };
}
