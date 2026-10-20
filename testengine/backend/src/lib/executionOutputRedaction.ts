import type { EngineRunEnvelope } from "../contracts/hellotest.js";
import type { RuntimeExecutionContext } from "./runtimeContext.js";
import { normalizeScopedParameterKey } from "./stepParameterReferences.js";

const REDACTED = "[REDACTED]";
const SECRET_KEY = /(?:password|passwd|secret|token|credential|api.?key|authorization|cookie|private.?key|passcode|(?:^|[._-])pin(?:$|[._-])|otp|verification.?code|one.?time.?code)/i;
const HEADER_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|passwd|secret|token|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key)$/i;
const IDENTITY_KEYS = new Set(["id", "step_id", "engine_run_id", "hellotest_run_id", "hellotest_execution_id", "hellotest_test_case_id",
  "attachment_id", "attachmentId", "checksum", "checksum_sha256", "trace_path", "video_path", "summary_path", "status", "state", "event",
  "error_code", "code", "provider", "browser", "mime_type", "mimeType", "content_type", "kind", "operation_kind", "action_outcome", "assertion_outcome"]);
const APPLICATION_KEYS = new Set(["request", "response", "body", "json", "console", "network", "headers", "captures", "stepCaptures", "captured_values", "values"]);
const hostIdentity = (path: string, key: string) => IDENTITY_KEYS.has(key) && (
  path === "" && ["engine_run_id", "hellotest_run_id", "hellotest_execution_id", "hellotest_test_case_id", "status", "state", "event"].includes(key)
  || /^(?:case_result|step_outcomes\.\d+)$/.test(path) && ["step_id", "status"].includes(key)
  || /^(?:case_result\.logs\.)?stepAutomationDetails\.[^.]+$/.test(path) && ["step_id", "status", "provider", "error_code"].includes(key)
  || /^(?:artifact_bundle(?:\.|$)|artifact_refs\.\d+$)/.test(path)
);

type ContextReader = () => Array<RuntimeExecutionContext | null | undefined>;

/** Collect frozen values and actual running contexts; never evaluate a data
 * generator to discover what a private input might have been. Superseded secret
 * layer values remain sensitive if an exception or response echoes them. */
function privateValues(envelope: EngineRunEnvelope, contexts: ContextReader) {
  const names = new Set<string>(), values = new Set<string>();
  const addNames = (policy: EngineRunEnvelope["data_policy"]) => {
    for (const options of [policy?.case, policy?.suite, policy?.run]) {
      for (const name of options?.private_parameter_names || []) {
        const key = normalizeScopedParameterKey(name, "r");
        if (key) names.add(key);
      }
    }
  };
  const add = (key: string, value: unknown, scope: "t" | "s" | "r" = "r", declared = false) => {
    const normalized = normalizeScopedParameterKey(key, scope);
    if (normalized && (declared || names.has(normalized) || SECRET_KEY.test(normalized))) {
      if (typeof value === "string" && value) values.add(value);
      else if (typeof value === "number" || typeof value === "boolean") values.add(String(value));
    }
  };
  const steps = [...(envelope.steps || []), ...(envelope.hooks || []).flatMap(hook => hook.steps || [])];
  const sources = [envelope, ...steps.map(step => step.source_case_context).filter(Boolean)];
  for (const source of sources) {
    addNames(source?.data_policy);
    addNames(source?.data_set?.data_scope_policy);
  }
  for (const source of sources) {
    for (const [key, value] of Object.entries(source?.case_parameters || {})) add(key, value);
    for (const [key, value] of Object.entries(source?.suite_parameters || {})) add(key, value, "s");
    for (const [layer, data] of Object.entries(source?.data_set?.parameter_data_layers || {})) {
      for (const row of data?.rows || []) for (const [key, value] of Object.entries(row)) add(key, value, layer === "suite" ? "s" : "r");
    }
    for (const row of source?.data_set?.rows || []) {
      if (source?.data_set?.mode === "key_value" && row.key) add(row.key, row.value);
      else for (const [key, value] of Object.entries(row)) add(key, value);
    }
  }
  for (const entries of [envelope.environment?.variables, envelope.configuration?.variables]) {
    for (const entry of entries || []) add(entry.key, entry.value, "r", entry.is_secret === true);
  }
  for (const source of [envelope.manual_spec?.test_data, envelope.run_parameters]) {
    for (const [key, value] of Object.entries(source || {})) add(key, value);
  }
  for (const step of steps) {
    for (const [key, value] of Object.entries(step.shared_parameter_values || {})) add(key, value);
    for (const [key, value] of Object.entries(step.source_case_parameters || {})) add(key, value, "t");
  }
  for (const context of contexts()) for (const [key, value] of Object.entries(context?.values || {})) add(key, value);
  return values;
}

/** Redact diagnostic copies, preserving raw runtime contexts and binary
 * artifact references. Runtime capture transport is sanitized by its public
 * persistence boundary, rather than altering values needed by following steps. */
export function createExecutionOutputRedactor(envelope: EngineRunEnvelope, contexts: ContextReader = () => []) {
  const knownPrivate = new Set<string>();
  let privateBytes = 0, inventoryFull = false;
  const retain = (values: Set<string>) => {
    for (const value of values) if (!knownPrivate.has(value)) {
      privateBytes += Buffer.byteLength(value, "utf8");
      if (knownPrivate.size >= 1024 || privateBytes > 1024 * 1024) {
        inventoryFull = true;
        knownPrivate.clear();
        return;
      }
      knownPrivate.add(value);
    }
  };
  retain(privateValues(envelope, () => []));
  return <T>(payload: T): T => {
    if (!inventoryFull) retain(privateValues(envelope, contexts));
    const secrets = [...knownPrivate];
    const variants = new Set<string>();
    for (const value of secrets) {
      variants.add(value);
      variants.add(JSON.stringify(value).slice(1, -1));
      try { variants.add(encodeURIComponent(value)); } catch { /* Raw value still matches malformed Unicode. */ }
    }
    const ordered = [...variants].filter(Boolean).sort((left, right) => right.length - left.length);
    const text = (value: string) => {
      if (/^data:(?:image|video)\/[\w.+-]+;base64,/i.test(value)) return value;
      if (inventoryFull) return "[DIAGNOSTIC_REDACTED_LIMIT]";
      let result = value;
      for (const secret of ordered) {
        if (secret.length >= 4) result = result.split(secret).join(REDACTED);
        else result = result.replace(new RegExp(`(?<![A-Za-z0-9])${secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g"), REDACTED);
      }
      return result.replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`)
        .replace(/((?:[?&]|\b)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[:=]\s*["']?)[^&#\s,"']*/gi, `$1${REDACTED}`)
        .replace(/\b(https?|postgres(?:ql)?):\/\/[^\s/@]+:[^\s/@]+@/gi, `$1://${REDACTED}@`);
    };
    const seen = new WeakSet<object>();
    const visit = (value: unknown, depth = 0, captures = false, application = false, path = ""): unknown => {
      if (typeof value === "string") return text(value);
      if (!value || typeof value !== "object") return application && (inventoryFull || secrets.includes(String(value))) ? REDACTED : value;
      if (seen.has(value) || depth > 32) return "[DIAGNOSTIC_LIMIT]";
      seen.add(value);
      try {
        if (Array.isArray(value)) return value.map((item, index) => visit(item, depth + 1, captures, application, `${path}.${index}`.replace(/^\./, "")));
        if (value instanceof Error) return visit({name: value.name, message: value.message, stack: value.stack,
          code: (value as Error & {code?: unknown}).code}, depth + 1, captures, application, path);
        const input = value as Record<string, unknown>;
        const secretEntry = input.is_secret === true || HEADER_KEY.test(String(input.key || input.name || ""));
        const originalKeys = new Set(Object.keys(input)), outputKeys = new Set<string>();
        let redactedKey = 0;
        return Object.fromEntries(Object.entries(input).map(([key, entry]) => {
          let publicKey = key;
          if (application && text(key) !== key) {
            do { publicKey = `[REDACTED_KEY_${++redactedKey}]`; } while (originalKeys.has(publicKey) || outputKeys.has(publicKey));
          }
          outputKeys.add(publicKey);
          return [publicKey,
          !application && (hostIdentity(path, key) || /^(?:case_result\.logs\.)?stepStatuses$/.test(path)) ? entry
            : HEADER_KEY.test(key) || SECRET_KEY.test(key) || secretEntry && key === "value" ? REDACTED
              : visit(entry, depth + 1, captures || ["captures", "stepCaptures", "captured_values"].includes(key),
                application || APPLICATION_KEYS.has(key), path ? `${path}.${key}` : key)];
        }));
      } finally { seen.delete(value); }
    };
    return visit(payload) as T;
  };
}
