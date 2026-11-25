import type { StepApiRequest } from "@hellotest/platform/frontend/src/types";
import { parseApiRequestSource as parse } from "../../shared/apiRequestSource.mjs";

export function parseApiRequestSource(source: string): StepApiRequest {
  return parse(source) as StepApiRequest;
}

/** An authored request can be saved before its endpoint or assertions are ready to run. */
export function parseApiRequestDraftSource(source: string): StepApiRequest | null {
  if (!source.trim()) return null;
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error("Enter a valid JSON request object."); }
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Enter a valid JSON request object.");
  return Object.keys(value).length ? value as StepApiRequest : null;
}
