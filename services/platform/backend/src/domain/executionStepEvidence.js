const normalizeJsonValue = (value, fallback) => {
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

const stringifyValue = (value) => {
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

const normalizeCaptureRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = String(key || "").trim().replace(/^@+/, "").toLowerCase();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry === undefined || entry === null ? "" : String(entry);
    return accumulator;
  }, {});
};

const normalizeStepCaptures = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [stepId, captures]) => {
    const normalizedStepId = String(stepId || "").trim();

    if (!normalizedStepId) {
      return accumulator;
    }

    const normalizedCaptures = normalizeCaptureRecord(captures);

    if (!Object.keys(normalizedCaptures).length) {
      return accumulator;
    }

    accumulator[normalizedStepId] = normalizedCaptures;
    return accumulator;
  }, {});
};

const mergeCaptureValues = (target, captures) => {
  Object.entries(normalizeCaptureRecord(captures)).forEach(([key, value]) => {
    target[key] = value;
  });

  return target;
};

exports.parseStructuredLogs = (value) => {
  const parsed = normalizeJsonValue(value, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      stepStatuses: {},
      stepNotes: {},
      stepEvidence: {},
      stepApiDetails: {},
      stepWebDetails: {},
      stepCaptures: {},
      aiAnalysis: null
    };
  }

  const normalizedStepCaptures = normalizeStepCaptures(parsed.stepCaptures);

  return {
    stepStatuses: parsed.stepStatuses && typeof parsed.stepStatuses === "object" && !Array.isArray(parsed.stepStatuses)
      ? { ...parsed.stepStatuses }
      : {},
    stepNotes: parsed.stepNotes && typeof parsed.stepNotes === "object" && !Array.isArray(parsed.stepNotes)
      ? { ...parsed.stepNotes }
      : {},
    stepEvidence: parsed.stepEvidence && typeof parsed.stepEvidence === "object" && !Array.isArray(parsed.stepEvidence)
      ? { ...parsed.stepEvidence }
      : {},
    stepApiDetails: parsed.stepApiDetails && typeof parsed.stepApiDetails === "object" && !Array.isArray(parsed.stepApiDetails)
      ? { ...parsed.stepApiDetails }
      : {},
    stepWebDetails: parsed.stepWebDetails && typeof parsed.stepWebDetails === "object" && !Array.isArray(parsed.stepWebDetails)
      ? { ...parsed.stepWebDetails }
      : {},
    stepCaptures: normalizedStepCaptures,
    aiAnalysis: parsed.aiAnalysis && typeof parsed.aiAnalysis === "object" && !Array.isArray(parsed.aiAnalysis)
      ? { ...parsed.aiAnalysis }
      : null
  };
};

exports.extractCapturedValuesFromLogs = (logs) => {
  const parsed = exports.parseStructuredLogs(logs);
  const mergedCaptures = Object.values(parsed.stepCaptures || {}).reduce(
    (accumulator, captures) => mergeCaptureValues(accumulator, captures),
    {}
  );

  return Object.values(parsed.stepApiDetails || {}).reduce((accumulator, detail) => {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
      return accumulator;
    }

    const captures = detail.captures;

    if (!captures || typeof captures !== "object" || Array.isArray(captures)) {
      return accumulator;
    }

    mergeCaptureValues(accumulator, captures);

    return accumulator;
  }, mergedCaptures);
};

exports.deriveCaseStatusFromStepStatuses = (stepIds, stepStatuses = {}) => {
  if (!Array.isArray(stepIds) || !stepIds.length) {
    return "passed";
  }

  if (Object.values(stepStatuses).some((status) => status === "failed")) {
    return "failed";
  }

  const allResolved = stepIds.every((id) => Boolean(stepStatuses[id]));

  if (!allResolved) {
    return Object.keys(stepStatuses).length ? "running" : "blocked";
  }

  if (stepIds.some((id) => stepStatuses[id] === "blocked")) {
    return "blocked";
  }

  return "passed";
};

exports.formatApiStepEvidenceNote = (stepResult) => {
  const lines = [String(stepResult?.note || "").trim()].filter(Boolean);
  const assertions = Array.isArray(stepResult?.detail?.assertions) ? stepResult.detail.assertions : [];
  const captures = stepResult?.captures && typeof stepResult.captures === "object" && !Array.isArray(stepResult.captures)
    ? Object.entries(stepResult.captures)
    : [];

  if (assertions.length) {
    lines.push("Assertions:");
    assertions.forEach((assertion, index) => {
      const target = assertion.target ? ` ${assertion.target}` : "";
      const expected = assertion.expected ? ` expected ${assertion.expected}` : "";
      const actual = assertion.actual ? ` actual ${assertion.actual}` : "";
      lines.push(
        `${assertion.passed ? "PASS" : "FAIL"} ${index + 1}. ${assertion.kind || "assertion"}${target}${expected}${actual}`.trim()
      );
    });
  }

  if (captures.length) {
    lines.push("Captures:");
    captures.forEach(([key, value]) => {
      lines.push(`${key} = ${stringifyValue(value)}`);
    });
  }

  return lines.join("\n");
};
