// Keep the reference grammar aligned with Test Engine's stepParameterReferences.ts.
const PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const decodeColumnName = (value) => value.replace(/\\([\\\]])/g, "$1");

export const normalizeMobileParameterKey = (key) => String(key || "").trim().replace(/^@+/, "")
  .replace(/^([tsr])\.\[((?:\\.|[^\]\\])+)\]$/i, (_match, scope, name) => `${scope}.${decodeColumnName(name)}`)
  .toLowerCase();

export function buildMobileParameterValues(values = {}) {
  const result = Object.create(null);
  if (!values || typeof values !== "object" || Array.isArray(values)) return result;
  for (const [key, value] of Object.entries(values)) {
    const normalized = normalizeMobileParameterKey(key);
    if (normalized) result[normalized] = String(value ?? "");
  }
  return result;
}

export function interpolateMobileText(value, params) {
  return String(value ?? "").replace(PARAMETER_PATTERN, (token, scope, name, offset, source) => {
    if (!scope && /^[tsr]$/i.test(name) && source[offset + token.length] === ".") return token;
    const rawName = name.startsWith("[") ? decodeColumnName(name.slice(1, -1)) : name;
    const key = `${scope ? `${scope}.` : ""}${rawName}`.toLowerCase();
    if (Object.hasOwn(params, key)) return params[key];
    if (!key.includes(".")) {
      for (const fallbackScope of ["t", "s", "r"]) {
        if (Object.hasOwn(params, `${fallbackScope}.${key}`)) return params[`${fallbackScope}.${key}`];
      }
    }
    return "";
  });
}

export function interpolateMobileValue(value, params) {
  if (typeof value === "string") return interpolateMobileText(value, params);
  if (Array.isArray(value)) return value.map((entry) => interpolateMobileValue(entry, params));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, interpolateMobileValue(entry, params)]));
  }
  return value;
}
