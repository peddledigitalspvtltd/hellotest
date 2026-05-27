import type { TestDataSetRow } from "../types";

export const TEST_DATA_GENERATOR_TEMPLATES = {
  randomNumber: "{{randomNumber:6}}",
  randomString: "{{randomString:8}}",
  yopmail: "{{yopmail}}",
  date: "{{date:YYYY-MM-DD}}",
  tomorrow: "{{date:YYYY-MM-DD|+1d}}",
  timestamp: "{{date:ISO}}"
} as const;

const GENERATOR_TOKEN_PATTERN = /\{\{\s*(randomNumber|randomString|yopmail|date)(?::([^}]+))?\s*\}\}/gi;

function clampLength(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Math.max(1, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
}

function randomCharacters(length: number, alphabet: string) {
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function resolveDate(rawOption: string | undefined, now: Date) {
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
}

function generateYopmailAddress(rawPrefix: string | undefined, now: Date) {
  const prefix = String(rawPrefix || "qaira")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "qaira";
  const timestamp = resolveDate("YYYYMMDDHHmmss", now);
  return `${prefix}-${timestamp}-${randomCharacters(6, "abcdefghijklmnopqrstuvwxyz0123456789")}@yopmail.com`;
}

export function hasTestDataGeneratorTemplate(value: unknown) {
  GENERATOR_TOKEN_PATTERN.lastIndex = 0;
  return GENERATOR_TOKEN_PATTERN.test(String(value ?? ""));
}

export function evaluateTestDataTemplate(value: unknown, now = new Date()) {
  GENERATOR_TOKEN_PATTERN.lastIndex = 0;
  return String(value ?? "").replace(GENERATOR_TOKEN_PATTERN, (_, rawKind: string, rawOption: string | undefined) => {
    const kind = rawKind.toLowerCase();
    const option = String(rawOption || "").trim();

    if (kind === "randomnumber") {
      return randomCharacters(clampLength(option, 6, 12), "0123456789");
    }

    if (kind === "randomstring") {
      return randomCharacters(clampLength(option, 8, 32), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    }

    if (kind === "yopmail") {
      return generateYopmailAddress(option, now);
    }

    return resolveDate(option || "YYYY-MM-DD", now);
  });
}

export function materializeTestDataRows(rows: TestDataSetRow[], now = new Date()) {
  return rows.map((row) =>
    Object.entries(row).reduce<TestDataSetRow>((resolved, [key, value]) => {
      resolved[key] = evaluateTestDataTemplate(value, now);
      return resolved;
    }, {})
  );
}

export function countGeneratedTestDataFields(rows: TestDataSetRow[]) {
  return rows.reduce(
    (count, row) => count + Object.values(row).filter((value) => hasTestDataGeneratorTemplate(value)).length,
    0
  );
}
