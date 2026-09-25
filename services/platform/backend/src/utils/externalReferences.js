const splitListValue = (value) =>
  String(value || "")
    .split(/,|\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeReferenceList = (value) => {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => (Array.isArray(item) ? item : [item]))
    : splitListValue(value);

  return [...new Set(
    rawValues
      .flatMap((item) => (typeof item === "string" ? splitListValue(item) : [item]))
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const normalizeStoredReferenceList = (value) => normalizeReferenceList(parseJsonValue(value, []));

module.exports = {
  normalizeReferenceList,
  normalizeStoredReferenceList
};
