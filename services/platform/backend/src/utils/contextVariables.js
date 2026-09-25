const { randomUUID } = require("crypto");

function parseStoredVariables(variables = []) {
  if (typeof variables === "string") {
    try {
      return parseStoredVariables(JSON.parse(variables));
    } catch {
      return [];
    }
  }

  if (!Array.isArray(variables)) {
    return [];
  }

  return variables
    .map((entry = {}) => ({
      id: String(entry.id || "").trim() || randomUUID(),
      key: String(entry.key || "").trim(),
      value: entry.value === null || entry.value === undefined ? "" : String(entry.value),
      is_secret: Boolean(entry.is_secret)
    }))
    .filter((entry) => entry.key);
}

function sanitizeVariablesForRead(variables = []) {
  return parseStoredVariables(variables).map((entry) =>
    entry.is_secret
      ? {
          id: entry.id,
          key: entry.key,
          value: "",
          is_secret: true,
          has_stored_value: Boolean(entry.value)
        }
      : {
          id: entry.id,
          key: entry.key,
          value: entry.value,
          is_secret: false,
          has_stored_value: false
        }
  );
}

function buildVariablesForStorage(variables = [], existingVariables = []) {
  const existingById = new Map(parseStoredVariables(existingVariables).map((entry) => [entry.id, entry]));

  if (!Array.isArray(variables)) {
    return [];
  }

  return variables
    .map((entry = {}) => {
      const id = String(entry.id || "").trim() || randomUUID();
      const key = String(entry.key || "").trim();

      if (!key) {
        return null;
      }

      const isSecret = Boolean(entry.is_secret);
      const incomingValue = entry.value === null || entry.value === undefined ? "" : String(entry.value);
      const existingEntry = existingById.get(id);
      const hasStoredValue = Boolean(entry.has_stored_value);
      const value = isSecret
        ? incomingValue !== ""
          ? incomingValue
          : existingEntry?.is_secret && hasStoredValue
            ? existingEntry.value
            : ""
        : incomingValue;

      return {
        id,
        key,
        value,
        is_secret: isSecret
      };
    })
    .filter(Boolean);
}

module.exports = {
  buildVariablesForStorage,
  parseStoredVariables,
  sanitizeVariablesForRead
};
