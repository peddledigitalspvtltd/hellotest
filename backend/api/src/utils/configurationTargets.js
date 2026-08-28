const { randomUUID } = require("crypto");

const TARGET_FIELDS = ["os", "browser", "mobile_os", "version"];
const OPERATING_SYSTEM_ALIASES = new Map([
  ["windows", "Windows"],
  ["win", "Windows"],
  ["macos", "macOS"],
  ["mac", "macOS"],
  ["osx", "macOS"],
  ["os x", "macOS"],
  ["linux", "Linux"]
]);
const MOBILE_OS_ALIASES = new Map([
  ["android", "Android"],
  ["ios", "iOS"]
]);

const normalizeText = (value) => String(value ?? "").trim();

const createTargetError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const canonicalValue = (value, aliases, label, rowNumber) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";

  const canonical = aliases.get(normalized.toLowerCase());
  if (!canonical) {
    throw createTargetError(
      `Configuration target row ${rowNumber} ${label} must be one of: ${[...new Set(aliases.values())].join(", ")}`
    );
  }
  return canonical;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeStoredTarget = (target = {}) => {
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;

  const storedOs = normalizeText(target.os);
  const storedMobileOs = normalizeText(target.mobile_os);

  const normalized = {
    ...(normalizeText(target.id) ? { id: normalizeText(target.id) } : {}),
    os: OPERATING_SYSTEM_ALIASES.get(storedOs.toLowerCase()) || storedOs,
    browser: normalizeText(target.browser),
    mobile_os: MOBILE_OS_ALIASES.get(storedMobileOs.toLowerCase()) || storedMobileOs,
    version: normalizeText(target.version)
  };

  return TARGET_FIELDS.some((field) => normalized[field]) ? normalized : null;
};

const parseStoredConfigurationTargets = (targets) => parseJsonArray(targets)
  .map(normalizeStoredTarget)
  .filter(Boolean);

const buildConfigurationTargetsForStorage = (targets) => {
  if (!Array.isArray(targets)) {
    throw createTargetError("Configuration targets must be an array");
  }

  if (targets.length > 100) {
    throw createTargetError("Configuration targets must contain at most 100 rows");
  }

  const usedIds = new Set();
  const usedTuples = new Set();

  return targets.map((target, index) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw createTargetError(`Configuration target row ${index + 1} must be an object`);
    }

    for (const field of ["id", ...TARGET_FIELDS]) {
      const value = target[field];
      if (value !== undefined && value !== null && typeof value !== "string") {
        throw createTargetError(`Configuration target row ${index + 1} field '${field}' must be a string`);
      }
    }

    const normalized = normalizeStoredTarget(target);
    if (!normalized) {
      throw createTargetError(`Configuration target row ${index + 1} must include an operating system, browser, mobile OS, or version`);
    }

    let id = normalizeText(normalized.id);
    if (!id || usedIds.has(id)) id = randomUUID();
    usedIds.add(id);

    const os = canonicalValue(normalized.os, OPERATING_SYSTEM_ALIASES, "operating system", index + 1);
    const mobileOs = canonicalValue(normalized.mobile_os, MOBILE_OS_ALIASES, "mobile OS", index + 1);
    const tupleKey = [os, normalized.browser, mobileOs, normalized.version]
      .map((value) => value.toLowerCase())
      .join("\u0000");
    if (usedTuples.has(tupleKey)) {
      throw createTargetError(`Configuration target row ${index + 1} duplicates an earlier target`);
    }
    usedTuples.add(tupleKey);

    for (const [field, value] of Object.entries({ id, os, browser: normalized.browser, mobile_os: mobileOs, version: normalized.version })) {
      if (value.length > 255) {
        throw createTargetError(`Configuration target row ${index + 1} field '${field}' must be at most 255 characters`);
      }
    }

    return {
      id,
      os,
      browser: normalized.browser,
      mobile_os: mobileOs,
      version: normalized.version
    };
  });
};

const legacyConfigurationTarget = ({ browser, mobile_os, platform_version } = {}) => {
  const target = {
    id: "legacy-target",
    os: "",
    browser: normalizeText(browser),
    mobile_os: normalizeText(mobile_os),
    version: normalizeText(platform_version)
  };

  return TARGET_FIELDS.some((field) => target[field]) ? target : null;
};

const configurationTargetsForRead = (targets, legacyFields = {}) => {
  const storedTargets = parseStoredConfigurationTargets(targets);
  if (storedTargets.length) return storedTargets;

  const compatibilityTarget = legacyConfigurationTarget(legacyFields);
  return compatibilityTarget ? [compatibilityTarget] : [];
};

const firstConfigurationTarget = (targets, legacyFields = {}) =>
  configurationTargetsForRead(targets, legacyFields)[0] || null;

const configurationTargetsUseMobile = (targets) =>
  parseStoredConfigurationTargets(targets).some((target) => Boolean(target.mobile_os));

module.exports = {
  TARGET_FIELDS,
  MOBILE_OS_ALIASES,
  OPERATING_SYSTEM_ALIASES,
  buildConfigurationTargetsForStorage,
  configurationTargetsForRead,
  configurationTargetsUseMobile,
  firstConfigurationTarget,
  legacyConfigurationTarget,
  parseStoredConfigurationTargets
};
