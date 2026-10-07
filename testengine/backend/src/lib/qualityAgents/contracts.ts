import { QUALITY_AGENT_KINDS, type QualityRunInput, type QualityStep } from "../../contracts/qualityAgents.js";

export class QualityError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message); this.name = "QualityError"; }
}
const fail = (message: string): never => { throw new QualityError("QUALITY_INPUT_INVALID", message); };
const object = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(`${name} must be an object.`);
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[], name: string) => { if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${name} contains an unsupported property.`); };
const text = (value: unknown, name: string, maximum = 255) => { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) return fail(`${name} must be a non-empty string of at most ${maximum} characters.`); return value.trim(); };
const number = (value: unknown, minimum: number, maximum: number, name: string, integer = false) => { if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) return fail(`${name} must be between ${minimum} and ${maximum}.`); return value; };
export const safeText = (value: unknown, maximum = 1200) => String(value || "").replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, "$1 [redacted]").replace(/((?:[?&]|\b)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[:=]\s*["']?)[^&#\s,"']*/gi, "$1[redacted]").replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]").replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g,"[redacted]").slice(0, maximum);
const secretPattern = /\b(?:Bearer|Basic)\s+\S+|-----BEGIN .*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i;
export const publicUrl = (value: string) => { const url = new URL(value); url.search = ""; url.hash = ""; return url.href; };
export function validQualityUrl(value: unknown): string {
  const input = text(value, "target_url", 2048);
  let url: URL;
  try { url = new URL(input); } catch { return fail("Use an absolute HTTP or HTTPS target URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || secretPattern.test(input)) return fail("Use an HTTP(S) URL without credentials or secrets.");
  for (const key of url.searchParams.keys()) if (/(?:password|passwd|secret|token|api.?key|authorization|credential)/i.test(key)) return fail("Secrets cannot be supplied in target query parameters.");
  url.hash = "";
  return url.href;
}
export function parseQualityInput(value: unknown): QualityRunInput {
  const input = object(value, "run"); keys(input, ["client_run_id", "kind", "target_url", "scope", "options", "limits"], "run");
  const clientId = text(input.client_run_id, "client_run_id", 128);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(clientId)) fail("client_run_id must contain 8–128 safe identifier characters.");
  if (!QUALITY_AGENT_KINDS.includes(input.kind as never)) fail("kind must be web, security, performance, accessibility or visual.");
  const target = validQualityUrl(input.target_url);
  const scope = object(input.scope, "scope"); keys(scope, ["project_id", "app_type_id"], "scope");
  const result: QualityRunInput = { client_run_id: clientId, kind: input.kind as QualityRunInput["kind"], target_url: target, scope: { project_id: text(scope.project_id, "project_id"), app_type_id: scope.app_type_id == null ? null : text(scope.app_type_id, "app_type_id") }, options: {}, limits: { max_pages: 1, max_duration_ms: 60000 } };
  if (input.limits !== undefined) {
    const limits = object(input.limits, "limits"); keys(limits, ["max_pages", "max_duration_ms"], "limits");
    if (limits.max_pages !== undefined) result.limits!.max_pages = number(limits.max_pages, 1, 5, "max_pages", true);
    if (limits.max_duration_ms !== undefined) result.limits!.max_duration_ms = number(limits.max_duration_ms, 5000, 120000, "max_duration_ms", true);
  }
  if (input.options !== undefined) {
    const options = object(input.options, "options"); keys(options, ["viewport", "wait_until", "budgets", "masks", "baseline_id", "max_diff_ratio", "pixel_threshold", "approved_steps"], "options");
    if (options.viewport !== undefined) { const viewport = object(options.viewport, "viewport"); keys(viewport, ["width", "height"], "viewport"); result.options!.viewport = { width: number(viewport.width, 320, 1920, "viewport width", true), height: number(viewport.height, 240, 1200, "viewport height", true) }; }
    if (options.wait_until !== undefined) { if (!["domcontentloaded", "load"].includes(String(options.wait_until))) fail("wait_until must be domcontentloaded or load."); result.options!.wait_until = options.wait_until as "load"; }
    if (options.baseline_id !== undefined) { const id = text(options.baseline_id, "baseline_id", 128); if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) fail("Invalid baseline identifier."); result.options!.baseline_id = id; }
    if (options.max_diff_ratio !== undefined) result.options!.max_diff_ratio = number(options.max_diff_ratio, 0, 1, "max_diff_ratio");
    if (options.pixel_threshold !== undefined) result.options!.pixel_threshold = number(options.pixel_threshold, 0, 255, "pixel_threshold", true);
    if (options.masks !== undefined) {
      if (!Array.isArray(options.masks) || options.masks.length > 20) fail("masks must contain at most 20 selectors.");
      result.options!.masks = (options.masks as unknown[]).map(value => text(value, "mask selector", 240));
    }
    if (options.budgets !== undefined) {
      const budgets = object(options.budgets, "budgets"); keys(budgets, ["navigation_ms", "lcp_ms", "cls", "resource_count", "transfer_bytes"], "budgets");
      result.options!.budgets = {};
      const bounds: Record<string, [number, number]> = { navigation_ms: [100,120000], lcp_ms: [100,120000], cls: [0,10], resource_count: [1,250], transfer_bytes: [1000,100000000] };
      for (const [key, value] of Object.entries(budgets)) (result.options!.budgets as Record<string, number>)[key] = number(value, ...bounds[key], key);
    }
    if (options.approved_steps !== undefined) {
      if (result.kind !== "web" || !Array.isArray(options.approved_steps) || options.approved_steps.length > 12) fail("Only the web agent accepts up to 12 approved journey steps.");
      result.options!.approved_steps = (options.approved_steps as unknown[]).map(raw => {
        const step = object(raw, "step"); keys(step, ["action", "selector", "value", "text", "url"], "step");
        if (!["click", "fill", "assert_text", "assert_url"].includes(String(step.action))) fail("Unsupported journey action.");
        const parsed: QualityStep = { action: step.action as QualityStep["action"] };
        if (step.selector !== undefined) parsed.selector = text(step.selector, "step selector", 240);
        if (/(password|passwd|secret|token|otp|credential|api.?key)/i.test(parsed.selector || "")) fail("Sensitive fields are not supported by browser journey agents.");
        if (step.value !== undefined) {
          const value = step.value;
          if (typeof value !== "string") return fail("step value must be a string of at most 500 characters without control characters.");
          if (value.length > 500 || /[\u0000-\u001f]/.test(value)) fail("step value must be a string of at most 500 characters without control characters.");
          // Playwright fill('') clears a field; padding can be part of the reviewed test.
          parsed.value = value;
          if (secretPattern.test(value) || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)) fail("Secrets cannot be supplied as step values.");
        }
        if (step.text !== undefined) parsed.text = text(step.text, "expected text", 500);
        if (step.url !== undefined) { parsed.url = validQualityUrl(step.url); if (new URL(parsed.url).origin !== new URL(target).origin) fail("Journey assertions must use the target origin."); }
        if ((["click", "fill"].includes(parsed.action) && !parsed.selector) || (parsed.action === "fill" && parsed.value === undefined) || (parsed.action === "assert_text" && !parsed.text) || (parsed.action === "assert_url" && !parsed.url)) fail("The journey action is missing its required selector or expected value.");
        return parsed;
      });
    }
  }
  return result;
}
