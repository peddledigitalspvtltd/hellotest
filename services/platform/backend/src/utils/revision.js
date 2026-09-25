const normalizeExpectedRevision = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    const error = new Error("expected_revision must be a positive integer.");
    error.statusCode = 400;
    error.code = "INVALID_REVISION";
    throw error;
  }

  return revision;
};

const assertExpectedRevision = (currentRevision, expectedRevision, entityLabel = "Record") => {
  const expected = normalizeExpectedRevision(expectedRevision);
  const current = Number(currentRevision || 1);

  if (expected !== null && expected !== current) {
    const error = new Error(`${entityLabel} was changed by another user. Refresh and try again.`);
    error.statusCode = 409;
    error.code = "REVISION_CONFLICT";
    error.current_revision = current;
    throw error;
  }

  return current;
};

module.exports = { assertExpectedRevision, normalizeExpectedRevision };
