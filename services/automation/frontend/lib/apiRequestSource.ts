import type { StepApiRequest } from "@hellotest/platform/frontend/src/types";

export function parseApiRequestSource(source: string): StepApiRequest {
  let request: StepApiRequest;
  try { request = JSON.parse(source); } catch { throw new Error("API source must be a JSON request with a URL, method and optional assertions."); }
  if (!request || Array.isArray(request) || typeof request !== "object" || typeof request.url !== "string" || !request.url.trim()) throw new Error("An API request URL is required.");
  if (request.method && !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(request.method)) throw new Error("Choose a supported HTTP method.");
  for (const field of ["headers", "query_params", "cookies"] as const) {
    if (request[field] !== undefined && (!Array.isArray(request[field]) || request[field]!.some((row) => !row || typeof row.key !== "string" || typeof row.value !== "string"))) throw new Error(`${field} must be an array of key/value strings.`);
  }
  if (request.body != null && typeof request.body !== "string") throw new Error("The request body must be a string. Encode JSON bodies as a JSON string.");
  if (request.validations !== undefined && (!Array.isArray(request.validations) || request.validations.some((item) => !item || !["status", "header", "header_present", "body_contains", "body_not_contains", "json_path", "json_schema", "response_time"].includes(item.kind)))) throw new Error("Each assertion must have a supported validation kind.");
  if (request.captures !== undefined && (!Array.isArray(request.captures) || request.captures.some((item) => !item || typeof item.path !== "string" || typeof item.parameter !== "string" || !item.parameter.trim()))) throw new Error("Each response capture needs a path and parameter.");
  return request;
}
