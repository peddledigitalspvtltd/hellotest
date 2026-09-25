import { JSONPath } from "jsonpath-plus";

export type JsonPathResult = { found: boolean; value?: unknown; error?: string };

// API assertions and captures use the first match, preserving the prototype's
// capture contract. An array selected as a value remains an array. No query
// may evaluate JavaScript supplied by a test author or an upstream response.
export function readJsonPathValue(source: unknown, path?: string | null): JsonPathResult {
  const query = String(path ?? "$").trim() || "$";
  if (!query.startsWith("$")) return { found: false, error: "JPath must start with $" };
  if (query === "$") return { found: source !== undefined, value: source };
  if (source === null || typeof source !== "object") return { found: false, error: "JPath did not match a response value" };
  try {
    const matches = JSONPath<unknown[]>({ path: query, json: source, eval: false, wrap: true });
    return matches.length
      ? { found: true, value: matches[0] }
      : { found: false, error: "JPath did not match a response value" };
  } catch {
    return { found: false, error: "Invalid JPath or disabled script expression" };
  }
}

export function readJsonPath(source: unknown, path?: string | null): unknown {
  return readJsonPathValue(source, path).value;
}
