const { randomBytes } = require("crypto");

const GENERATOR_TOKEN_PATTERN = /\{\{\s*(randomNumber|randomString|aiData|oneOf|yopmail|date)(?::([^}]+))?\s*\}\}/gi;
const GENERATOR_ALIAS_PATTERN = /(?<![A-Za-z0-9_])@(?:t\.)?(random|string|randomString|randomNumber|yopmail|today|timestamp)\b/gi;
const GENERATOR_ALIAS_TEMPLATES = {
  random: "{{randomString:3}}",
  string: "{{randomString:8}}",
  randomstring: "{{randomString:8}}",
  randomnumber: "{{randomNumber:6}}",
  yopmail: "{{yopmail}}",
  today: "{{date:YYYY-MM-DD}}",
  timestamp: "{{date:ISO}}"
};

const clampLength = (value, fallback, maximum) => {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Math.max(1, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
};

const randomFromAlphabet = (length, alphabet) => {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

const generateRandomNumber = (option) =>
  randomFromAlphabet(clampLength(option, 6, 12), "0123456789");

const generateRandomString = (option) =>
  randomFromAlphabet(clampLength(option, 8, 32), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");

const resolveDate = (rawOption, now) => {
  const [rawFormat, rawOffset] = String(rawOption || "YYYY-MM-DD").split("|").map((item) => item.trim());
  const format = rawFormat || "YYYY-MM-DD";
  const date = new Date(now.getTime());
  const offsetMatch = rawOffset?.match(/^([+-]\d+)\s*([dwmy])$/i);

  if (offsetMatch) {
    const amount = Number(offsetMatch[1]);
    const unit = offsetMatch[2].toLowerCase().trim();
    if (unit === "d") date.setUTCDate(date.getUTCDate() + amount);
    if (unit === "w") date.setUTCDate(date.getUTCDate() + amount * 7);
    if (unit === "m") date.setUTCMonth(date.getUTCMonth() + amount);
    if (unit === "y") date.setUTCFullYear(date.getUTCFullYear() + amount);
  }

  if (format.toLowerCase() === "iso") {
    return date.toISOString();
  }

  const replacements = {
    YYYY: String(date.getUTCFullYear()),
    MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
    DD: String(date.getUTCDate()).padStart(2, "0"),
    HH: String(date.getUTCHours()).padStart(2, "0"),
    mm: String(date.getUTCMinutes()).padStart(2, "0"),
    ss: String(date.getUTCSeconds()).padStart(2, "0")
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => replacements[token]);
};

const generateYopmailAddress = (option, now) => {
  const prefix = String(option || "hellotest")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "hellotest";
  const stamp = resolveDate("YYYYMMDDHHmmss", now);
  return `${prefix}-${stamp}-${randomFromAlphabet(6, "abcdefghijklmnopqrstuvwxyz0123456789")}@yopmail.com`;
};

const generateAiData = (option, now) => {
  const prompt = String(option || "value").toLowerCase();
  const suffix = randomFromAlphabet(6, "abcdefghijklmnopqrstuvwxyz0123456789");

  if (prompt.includes("email")) {
    return `ai-${resolveDate("YYYYMMDDHHmmss", now)}-${suffix}@yopmail.com`;
  }

  if (prompt.includes("phone") || prompt.includes("mobile")) {
    return `9${randomFromAlphabet(9, "0123456789")}`;
  }

  if (prompt.includes("name")) {
    return `AI User ${suffix.toUpperCase()}`;
  }

  if (prompt.includes("address")) {
    return `${randomFromAlphabet(3, "123456789")} HelloTest Test Street`;
  }

  return `ai-${suffix}`;
};

const decodeGeneratedValuePool = (rawValue) => {
  try {
    const values = JSON.parse(Buffer.from(String(rawValue || ""), "base64url").toString("utf8"));
    return Array.isArray(values)
      ? values.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 20)
      : [];
  } catch {
    return [];
  }
};

const hasGeneratorTemplate = (value) => {
  GENERATOR_TOKEN_PATTERN.lastIndex = 0;
  GENERATOR_ALIAS_PATTERN.lastIndex = 0;
  const source = String(value ?? "");
  return GENERATOR_TOKEN_PATTERN.test(source) || GENERATOR_ALIAS_PATTERN.test(source);
};

const materializeTemplateToken = (_, kind, rawOption, now) => {
    const option = String(rawOption || "").trim();
    if (kind.toLowerCase() === "randomnumber") return generateRandomNumber(option);
    if (kind.toLowerCase() === "randomstring") return generateRandomString(option);
    if (kind.toLowerCase() === "aidata") return generateAiData(option, now);
    if (kind.toLowerCase() === "oneof") {
      const pool = decodeGeneratedValuePool(option);
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : "";
    }
    if (kind.toLowerCase() === "yopmail") return generateYopmailAddress(option, now);
    return resolveDate(option, now);
};

const materializeTemplateValue = (value, now = new Date()) =>
  String(value ?? "")
    .replace(GENERATOR_TOKEN_PATTERN, (match, kind, rawOption) => materializeTemplateToken(match, kind, rawOption, now))
    .replace(GENERATOR_ALIAS_PATTERN, (match, alias) =>
      materializeTemplateValue(GENERATOR_ALIAS_TEMPLATES[String(alias || "").toLowerCase()] || match, now)
    );

const materializeParameterValues = (values = {}, now = new Date()) =>
  Object.entries(values || {}).reduce((next, [key, value]) => {
    next[key] = materializeTemplateValue(value, now);
    return next;
  }, {});

const materializeDataSetSnapshot = (snapshot, now = new Date()) => {
  if (!snapshot) {
    return null;
  }

  const sourceRows = Array.isArray(snapshot.template_rows)
    ? snapshot.template_rows
    : Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const templateRows = sourceRows.map((row) => ({ ...(row || {}) }));
  let generatedFieldCount = 0;
  const hasGenerators = templateRows.some((row) =>
    Object.values(row || {}).some((value) => hasGeneratorTemplate(value))
  );

  if (!hasGenerators) {
    return {
      ...snapshot,
      columns: Array.isArray(snapshot.columns) ? [...snapshot.columns] : [],
      rows: templateRows
    };
  }

  const rows = templateRows.map((row) =>
    Object.entries(row || {}).reduce((next, [key, value]) => {
      if (hasGeneratorTemplate(value)) {
        generatedFieldCount += 1;
      }
      next[key] = materializeTemplateValue(value, now);
      return next;
    }, {})
  );

  return {
    ...snapshot,
    columns: Array.isArray(snapshot.columns) ? [...snapshot.columns] : [],
    template_rows: templateRows,
    rows,
    generated_at: now.toISOString(),
    generated_field_count: generatedFieldCount
  };
};

module.exports = {
  hasGeneratorTemplate,
  materializeDataSetSnapshot,
  materializeParameterValues,
  materializeTemplateValue
};
