import type { EngineApiRequest, EngineRunEnvelope, EngineRunStep } from "../contracts/hellotest.js";
import { decodeParameterColumnName, normalizeParameterReferenceKey, normalizeScopedParameterKey, STEP_PARAMETER_PATTERN } from "./stepParameterReferences.js";

export type RuntimeExecutionContext = {
  values: Record<string, string>;
  capturedValues?: Record<string, string>;
};

const GENERATOR_TOKEN_PATTERN = /\{\{\s*(randomNumber|randomString|aiData|oneOf|yopmail|date)(?::([^}]+))?\s*\}\}/gi;
const GENERATOR_ALIAS_PATTERN = /(?<![A-Za-z0-9_])@(?:t\.)?(random|string|randomString|randomNumber|yopmail|today|timestamp)\b/gi;
const GENERATED_CONTEXT_ALIASES: Record<string, string> = {
  "t.random": "{{randomString:3}}",
  random: "{{randomString:3}}",
  "t.randomstring": "{{randomString:8}}",
  randomstring: "{{randomString:8}}",
  "t.randomnumber": "{{randomNumber:6}}",
  randomnumber: "{{randomNumber:6}}",
  "t.yopmail": "{{yopmail}}",
  yopmail: "{{yopmail}}",
  "t.today": "{{date:YYYY-MM-DD}}",
  today: "{{date:YYYY-MM-DD}}",
  "t.timestamp": "{{date:ISO}}",
  timestamp: "{{date:ISO}}",
  "r.random": "{{randomString:3}}",
  "r.randomstring": "{{randomString:8}}",
  "r.randomnumber": "{{randomNumber:6}}",
  "r.yopmail": "{{yopmail}}",
  "r.today": "{{date:YYYY-MM-DD}}",
  "r.timestamp": "{{date:ISO}}",

};
const GENERATOR_ALIAS_TEMPLATES: Record<string, string> = {
  random: "{{randomString:3}}",
  string: "{{randomString:8}}",
  randomstring: "{{randomString:8}}",
  randomnumber: "{{randomNumber:6}}",
  yopmail: "{{yopmail}}",
  today: "{{date:YYYY-MM-DD}}",
  timestamp: "{{date:ISO}}"
};

export const normalizeText = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

export const stringifyValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const randomCharacters = (length: number, alphabet: string) =>
  Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");

const decodeGeneratedValuePool = (rawValue: string | undefined) => {
  try {
    const values = JSON.parse(Buffer.from(String(rawValue || ""), "base64url").toString("utf8"));
    return Array.isArray(values)
      ? values.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 20)
      : [];
  } catch {
    return [];
  }
};

const resolveDate = (rawOption: string | undefined, now: Date) => {
  const [rawFormat, rawOffset] = String(rawOption || "YYYY-MM-DD").split("|").map((entry) => entry.trim());
  const format = rawFormat || "YYYY-MM-DD";
  const date = new Date(now.getTime());
  const offsetMatch = rawOffset?.match(/^([+-]\d+)\s*([dwmy])$/i);

  if (offsetMatch) {
    const amount = Number.parseInt(offsetMatch[1], 10);
    const unit = offsetMatch[2].toLowerCase();
    if (unit === "d") date.setUTCDate(date.getUTCDate() + amount);
    if (unit === "w") date.setUTCDate(date.getUTCDate() + amount * 7);
    if (unit === "m") date.setUTCMonth(date.getUTCMonth() + amount);
    if (unit === "y") date.setUTCFullYear(date.getUTCFullYear() + amount);
  }

  if (format.toLowerCase() === "iso") {
    return date.toISOString();
  }

  const values: Record<string, string> = {
    YYYY: String(date.getUTCFullYear()),
    MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
    DD: String(date.getUTCDate()).padStart(2, "0"),
    HH: String(date.getUTCHours()).padStart(2, "0"),
    mm: String(date.getUTCMinutes()).padStart(2, "0"),
    ss: String(date.getUTCSeconds()).padStart(2, "0")
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => values[token]);
};

export const materializeTemplateValue = (value: unknown, now = new Date()): string => {
  GENERATOR_TOKEN_PATTERN.lastIndex = 0;
  GENERATOR_ALIAS_PATTERN.lastIndex = 0;
  const evaluateToken = (_match: string, rawKind: string, rawOption: string | undefined) => {
    const kind = rawKind.toLowerCase();
    const option = String(rawOption || "").trim();
    if (kind === "randomnumber") return randomCharacters(Math.max(1, Math.min(12, Number.parseInt(option, 10) || 6)), "0123456789");
    if (kind === "randomstring") return randomCharacters(Math.max(1, Math.min(32, Number.parseInt(option, 10) || 8)), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    if (kind === "oneof") {
      const pool = decodeGeneratedValuePool(option);
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : "";
    }
    if (kind === "yopmail") return `hellotest-${resolveDate("YYYYMMDDHHmmss", now)}-${randomCharacters(6, "abcdefghijklmnopqrstuvwxyz0123456789")}@yopmail.com`;
    if (kind === "aidata") return option.toLowerCase().includes("email") ? `ai-${resolveDate("YYYYMMDDHHmmss", now)}-${randomCharacters(6, "abcdefghijklmnopqrstuvwxyz0123456789")}@yopmail.com` : `ai-${randomCharacters(6, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
    return resolveDate(option || "YYYY-MM-DD", now);
  };

  return String(value ?? "")
    .replace(GENERATOR_TOKEN_PATTERN, evaluateToken)
    .replace(GENERATOR_ALIAS_PATTERN, (match: string, rawAlias: string): string =>
      materializeTemplateValue(GENERATOR_ALIAS_TEMPLATES[String(rawAlias || "").toLowerCase()] || match, now)
    );
};

export const normalizeKey = (value: string | null | undefined) => {
  const normalized = normalizeParameterReferenceKey(value || "") || null;
  return normalized;
};

export const registerContextValue = (
  context: RuntimeExecutionContext,
  key: string | null | undefined,
  value: unknown
) => {
  const normalizedKey = normalizeScopedParameterKey(key || "", "r");

  if (!normalizedKey) {
    return;
  }

  const normalizedValue = stringifyValue(value);
  context.values[normalizedKey] = normalizedValue;
  (context.capturedValues ||= {})[normalizedKey] = normalizedValue;

};

export const buildInitialContext = (envelope: EngineRunEnvelope, capturedValues: Record<string, string> = {}, step?: EngineRunStep) => {
  // A setup/teardown case keeps its own authored values, dataset and suite
  // policy. Shared run environment and captured outputs still flow through.
  if (step?.source_case_context) envelope = {...envelope,...step.source_case_context,manual_spec:{...envelope.manual_spec,test_data:{}}};
  const context: RuntimeExecutionContext = { values: {} };
  const apply = (values: Record<string, unknown> | undefined, scope: "t" | "s" | "r") => {
    for (const [key, value] of Object.entries(values || {})) {
      const scoped = normalizeScopedParameterKey(key, scope);
      if (!scoped) continue;
      context.values[scoped] = envelope.parameters_frozen ? stringifyValue(value) : materializeTemplateValue(value);
    }
  };
  const entries = (values: Array<{ key: string; value: string }> = []) => Object.fromEntries(values.map((entry) => [entry.key, entry.value]));
  const policy = envelope.data_policy || envelope.data_set?.data_scope_policy;
  if (policy?.version === 2) {
    const normalize = (values: Record<string, unknown> | undefined, scope: "r" | "s" = "r") => Object.fromEntries(Object.entries(values || {}).map(([key,value]) => [normalizeScopedParameterKey(key, scope), value]).filter(([key]) => Boolean(key)));
    const row = (layer: "case" | "suite" | "run") => envelope.data_set?.parameter_data_layers?.[layer]?.rows[0] || {};
    const shared = normalize(step?.shared_parameter_values);
    const caseLayer = { ...normalize(envelope.manual_spec?.test_data), ...normalize(envelope.case_parameters), ...row("case") };
    const suiteLayer = { ...normalize(envelope.suite_parameters, "s"), ...row("suite") };
    const runLayer = { ...normalize(entries(envelope.environment?.variables)), ...normalize(entries(envelope.configuration?.variables)), ...normalize(envelope.run_parameters), ...row("run") };
    apply(shared, "r");
    const suiteKeys = new Set<string>();
    const isShared = step?.group_kind === "reusable";
    const applyLayer = (values: Record<string, unknown>, options: typeof policy.case, scope: "case" | "suite" | "run") => apply(Object.fromEntries(Object.entries(values).filter(([key]) => {
      if (isShared && options?.override_shared_steps === false && Object.hasOwn(shared, key)) return false;
      if (scope !== "case" && options?.override_test_case_data === false && (key.startsWith("t.") || Object.hasOwn(caseLayer,key)) && !(isShared && Object.hasOwn(shared,key) && policy.case?.override_shared_steps === false)) return false;
      if (scope === "run" && options?.override_suite_data === false && (key.startsWith("s.") || suiteKeys.has(key))) return false;
      if (scope === "suite") suiteKeys.add(key);
      return true;
    })), "r");
    applyLayer(caseLayer, policy.case, "case");
    applyLayer(suiteLayer, policy.suite, "suite");
    applyLayer(runLayer, policy.run, "run");
    const authored=normalize(envelope.case_parameters),explicitRun=normalize(envelope.run_parameters);
    for(const name of policy.case?.parameter_overrides||[]){
      const key=normalizeScopedParameterKey(name,"t");
      if(!Object.hasOwn(authored,key)||isShared&&policy.case?.override_shared_steps===false&&Object.hasOwn(shared,key))continue;
      apply({[key]:authored[key]},"r");
      if(Object.hasOwn(explicitRun,key)&&!(policy.run?.override_test_case_data===false&&(key.startsWith("t.")||Object.hasOwn(caseLayer,key)))&&!(policy.run?.override_suite_data===false&&(key.startsWith("s.")||suiteKeys.has(key))))apply({[key]:explicitRun[key]},"r");
    }
  } else {
  apply(step?.shared_parameter_values, "r");
  apply(envelope.manual_spec?.test_data, "r");
  apply(envelope.case_parameters, "r");
  apply(envelope.suite_parameters, "s");
  apply(entries(envelope.environment?.variables), "r");
  apply(entries(envelope.configuration?.variables), "r");
  apply(envelope.run_parameters, "r");
  const sharedRows = step?.group_kind === "reusable" ? envelope.data_set?.shared_rows : undefined;
  const rows = sharedRows || envelope.data_set?.rows || [];
  apply(!sharedRows && envelope.data_set?.mode === "key_value"
    ? Object.fromEntries(rows.filter((row) => row?.key).map((row) => [row.key, row.value]))
    : rows[0], "r");
  }
  if (!step?.source_case_context) apply(step?.source_case_parameters, "t");
  Object.entries(capturedValues).forEach(([key, value]) => registerContextValue(context, key, value));
  for (const [key, template] of Object.entries(GENERATED_CONTEXT_ALIASES)) {
    if (/^[tr]\./.test(key) && !Object.hasOwn(context.values, key)) context.values[key] = materializeTemplateValue(template);
  }
  return context;
};

export const resolveContextValue = (
  context: RuntimeExecutionContext,
  scopedKey: string,
  fallbackScope = "r"
) => {
  const normalizedKey = normalizeKey(scopedKey);

  if (!normalizedKey) {
    return "";
  }

  if (context.values[normalizedKey] !== undefined) {
    return context.values[normalizedKey];
  }

  if (!normalizedKey.includes(".")) {
    const direct = context.values[`${fallbackScope}.${normalizedKey}`];
    if (direct !== undefined) {
      return direct;
    }

    const suite = context.values[`s.${normalizedKey}`];
    if (suite !== undefined) {
      return suite;
    }

    const run = context.values[`r.${normalizedKey}`];
    if (run !== undefined) {
      return run;
    }
  }

  if (GENERATED_CONTEXT_ALIASES[normalizedKey]) {
    return materializeTemplateValue(GENERATED_CONTEXT_ALIASES[normalizedKey]);
  }

  return "";
};

export const interpolateText = (
  value: string | null | undefined,
  context: RuntimeExecutionContext
) =>
  String(value || "").replace(STEP_PARAMETER_PATTERN, (token, scope, referenceName, offset, source) => {
    if (!scope && /^[tsr]$/i.test(referenceName) && source[offset + token.length] === ".") return token;
    const rawName = referenceName.startsWith("[") ? decodeParameterColumnName(referenceName.slice(1, -1)) : referenceName;
    let normalizedKey = `${scope ? String(scope).toLowerCase() : "r"}.${String(rawName).toLowerCase()}`;
    if(!scope&&!Object.hasOwn(context.values,normalizedKey)&&Object.hasOwn(context.values,`t.${String(rawName).toLowerCase()}`))normalizedKey=`t.${String(rawName).toLowerCase()}`;

    return resolveContextValue(context, normalizedKey, scope ? String(scope).toLowerCase() : "r");
  });

export const interpolateHeaders = (
  headers: EngineApiRequest["headers"],
  context: RuntimeExecutionContext
) =>
  (headers || []).reduce<Record<string, string>>((accumulator, header) => {
    const key = interpolateText(header?.key || "", context).trim();

    if (!key) {
      return accumulator;
    }

    accumulator[key] = interpolateText(header?.value || "", context);
    return accumulator;
  }, {});

export const toParameterValuesRecord = (context: RuntimeExecutionContext) => ({ ...context.values });
